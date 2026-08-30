import { NotFoundError } from "./errors";
import { isValidUuid } from "./compat-helpers";
import { prisma } from "../config/db";

/**
 * Cash Flow entries are mirrored separately (see legacy-payment-entry.ts) and carry no
 * FK back to the record that spawned them — they're only linked by `legacyId` matching
 * the source row's own id. So every soft-delete must also soft-delete any mirror rows
 * keyed to the id(s) being deleted, or the deleted form keeps showing up on Cash Flow.
 */
async function softDeleteLegacyPaymentEntries(ids: string[], deletedAt: Date) {
  if (ids.length === 0) return;
  await prisma.legacyPaymentEntry.updateMany({
    where: { legacyId: { in: ids }, deletedAt: null },
    data: { deletedAt },
  });
}

type SoftDeleteModel<T> = {
  findFirst: (args: { where: Record<string, unknown> }) => Promise<T | null>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<T>;
};

export type SoftDeleteOptions = {
  extraWhere?: Record<string, unknown>;
  deactivate?: boolean;
  requireUuid?: boolean;
};

/**
 * Soft-delete a record by setting deletedAt (never removes rows from the database).
 */
export async function softDeleteRecord<T extends { id: string }>(
  model: SoftDeleteModel<T>,
  id: string,
  entityLabel: string,
  options: SoftDeleteOptions = {}
): Promise<T> {
  if (options.requireUuid !== false && !isValidUuid(id)) {
    throw new NotFoundError(`${entityLabel} not found`);
  }

  const existing = await model.findFirst({
    where: { id, deletedAt: null, ...(options.extraWhere || {}) },
  });

  if (!existing) {
    throw new NotFoundError(`${entityLabel} not found`);
  }

  const deletedAt = new Date();
  const data: Record<string, unknown> = { deletedAt };
  if (options.deactivate) {
    data.isActive = false;
  }

  const result = await model.update({ where: { id }, data });
  await softDeleteLegacyPaymentEntries([id], deletedAt);

  return result;
}

type CascadeChild = {
  /** The child model to soft-delete rows on, e.g. prisma.generalApplicationInstallment. */
  model: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: { id: true };
    }) => Promise<{ id: string }[]>;
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  /** The child's foreign-key column pointing back at the parent id. */
  fkField: string;
};

/**
 * Soft-delete a record and, in the same pass, soft-delete its own child rows
 * (installments/payments that carry a real FK back to it) so a deleted
 * form's payment history stops showing up elsewhere (e.g. Payment Management)
 * instead of only hiding the parent record.
 */
export async function softDeleteWithChildren<T extends { id: string }>(
  model: SoftDeleteModel<T>,
  id: string,
  entityLabel: string,
  children: CascadeChild[],
  options: SoftDeleteOptions = {}
): Promise<T> {
  const record = await softDeleteRecord(model, id, entityLabel, options);

  const deletedAt = new Date();
  for (const child of children) {
    const where = { [child.fkField]: id, deletedAt: null };

    // Cash Flow's legacy_payment_entries mirror rows are keyed to these child
    // ids (see recordLegacyPaymentEntry), not the parent id, so their ids must
    // be captured before updateMany hides them from a follow-up lookup.
    const rows = await child.model.findMany({ where, select: { id: true } });

    await child.model.updateMany({ where, data: { deletedAt } });

    await softDeleteLegacyPaymentEntries(rows.map((row) => row.id), deletedAt);
  }

  return record;
}
