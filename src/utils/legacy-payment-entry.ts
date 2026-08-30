import { Prisma } from "@prisma/client";
import { prisma } from "../config/db";

type LegacyEntryClient = Pick<typeof prisma, "legacyPaymentEntry">;

/**
 * Builds the Cash Flow "Name/Type" display string as `FormNumber - Name - Village`,
 * matching the format the legacy-imported rows already use. Any part that's missing
 * (e.g. no form number on file) is dropped rather than shown as a blank segment.
 */
export function formatCashFlowName(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter((part) => part.length > 0)
    .join(" - ");
}

export interface EmiRecipient {
  /** Who the contribution ultimately benefits, e.g. the wedding/claim owner. */
  name?: string | null;
  code?: string | null;
  /** Human label for what's being funded, e.g. "marriage" or "Mayra congratulations". */
  scheme: string;
}

/**
 * Marriage/Mayra Congratulations EMI and Suraksha Bima EMI are mutual-aid
 * collections: one member (the payer) contributes toward a *different*
 * member's fund (the recipient). Plain `formatCashFlowName` only captures one
 * side, so contributions from many different payers into the same recipient's
 * fund render as indistinguishable duplicate rows on Cash Flow. This appends
 * who the money was for onto the payer's own identity.
 */
export function formatEmiContributionName(
  payerParts: Array<string | null | undefined>,
  recipient: EmiRecipient | null | undefined
): string {
  const payer = formatCashFlowName(payerParts);
  const recipientName = recipient?.name?.trim();
  if (!recipientName) return payer;

  const codeSuffix = recipient?.code ? ` (${recipient.code})` : "";
  const suffix = `for ${recipientName}'s ${recipient!.scheme}${codeSuffix}`;
  return payer ? `${payer} → ${suffix}` : suffix;
}

export interface LegacyPaymentEntryInput {
  /** Id of the underlying row (Payment, *Installment, *Payment, etc.) this entry mirrors. */
  legacyId: string;
  date: Date | string;
  amount: number | string | Prisma.Decimal;
  name?: string | null;
  source: string;
  type: "In" | "Out";
}

/**
 * Cash Flow (`getPaymentList`) reads from the `legacy_payment_entries` table only — it no
 * longer queries every module's live tables directly (that approach timed out once
 * legacy-import volume hit the hundreds of thousands of rows). So every place that creates a
 * payment/installment on a live table must also mirror it here, or it silently never shows up
 * on the Cash Flow page. Call this in the same transaction as the source-of-truth write
 * whenever one is open, so the two can't drift apart on partial failure.
 */
export async function recordLegacyPaymentEntry(
  client: LegacyEntryClient,
  entry: LegacyPaymentEntryInput
) {
  const dateStr =
    typeof entry.date === "string"
      ? entry.date.split(/[T ]/)[0]
      : entry.date.toISOString().split("T")[0];

  await client.legacyPaymentEntry.create({
    data: {
      legacyId: entry.legacyId,
      entryDate: dateStr,
      amount: entry.amount as any,
      name: entry.name || null,
      source: entry.source,
      type: entry.type,
    },
  });
}
