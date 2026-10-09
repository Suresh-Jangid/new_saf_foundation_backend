import { prisma } from "../config/db";
import { BadRequestError, ConflictError } from "./errors";

type AadharCheckClient =
  | Pick<
      typeof prisma,
      | "generalApplication"
      | "insuranceApplication"
      | "mayraRegistration"
      | "disabilityCycle"
      | "marriageSewingMachine"
      | "sewingMachineCamp"
    >
  | Record<string, any>;

export type AadharSourceModel =
  | "generalApplication"
  | "insuranceApplication"
  | "mayraRegistration"
  | "disabilityCycle"
  | "marriageSewingMachine"
  | "sewingMachineCamp";

export const AADHAR_SCHEME_LABELS: Record<AadharSourceModel, string> = {
  generalApplication: "General Application",
  insuranceApplication: "Insurance Application",
  mayraRegistration: "Mayra Registration",
  disabilityCycle: "Disability Cycle",
  marriageSewingMachine: "Marriage Sewing Machine",
  sewingMachineCamp: "Sewing Machine Camp",
};

/**
 * Strips non-digits from the Aadhaar number.
 */
export function normalizeAadharNumber(rawAadhar: string | null | undefined): string {
  return String(rawAadhar || "").replace(/\D/g, "");
}

/**
 * Aadhaar number must be unique PER MODULE / SCHEME, NOT globally.
 * Cross-scheme duplicate Aadhaar numbers are valid and allowed.
 * Within the same scheme, duplicate Aadhaar numbers among active (non-soft-deleted) records are blocked.
 * `sourceModel` is strictly required to enforce scheme isolation. Global fallback is prohibited.
 * `exclude` lets an edit keep its own current Aadhaar without flagging itself.
 */
export async function findAadharOwner(
  client: AadharCheckClient,
  aadharNumber: string | null | undefined,
  exclude?: { model: AadharSourceModel; id: string },
  sourceModel?: AadharSourceModel
): Promise<{ model: AadharSourceModel; label: string; id: string } | null> {
  const normalized = normalizeAadharNumber(aadharNumber);
  if (!normalized) {
    return null;
  }

  if (!sourceModel || !AADHAR_SCHEME_LABELS[sourceModel]) {
    throw new Error(
      `Aadhaar duplicate check requires a valid sourceModel for scheme scoping. Received: "${String(sourceModel)}"`
    );
  }

  const delegate = (client as any)[sourceModel];
  if (!delegate || typeof delegate.findFirst !== "function") {
    throw new Error(`Prisma delegate for "${sourceModel}" is not available on client`);
  }

  const where: Record<string, any> = {
    aadharNumber: normalized,
    deletedAt: null,
  };

  if (exclude && exclude.model === sourceModel && exclude.id) {
    where.id = { not: exclude.id };
  }

  const match = await delegate.findFirst({
    where,
    select: { id: true },
  });

  if (match) {
    return {
      model: sourceModel,
      label: AADHAR_SCHEME_LABELS[sourceModel],
      id: match.id,
    };
  }

  return null;
}

export async function assertAadharAvailable(
  client: AadharCheckClient,
  aadharNumber: string | null | undefined,
  exclude?: { model: AadharSourceModel; id: string },
  sourceModel?: AadharSourceModel
): Promise<void> {
  const normalized = normalizeAadharNumber(aadharNumber);
  if (!normalized) {
    return;
  }

  if (normalized.length !== 12) {
    throw new BadRequestError("Aadhaar number must be exactly 12 digits");
  }

  const owner = await findAadharOwner(client, normalized, exclude, sourceModel);
  if (owner) {
    throw new ConflictError(
      `This Aadhaar number is already registered under ${owner.label}. Duplicate Aadhaar numbers are not allowed in the same scheme. / यह आधार नंबर पहले से "${owner.label}" में दर्ज है। एक ही योजना में डुप्लीकेट आधार नंबर की अनुमति नहीं है।`
    );
  }
}
