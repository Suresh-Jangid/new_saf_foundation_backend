import { PaymentMode } from "@prisma/client";

/** Normalize any frontend/legacy payment mode string to Prisma PaymentMode enum for database storage. */
export function normalizePaymentMode(value: unknown): PaymentMode {
  const mode = String(value || "cash")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");

  // Razorpay must remain RAZORPAY for payment gateway / transaction records
  if (mode === "razorpay") return PaymentMode.RAZORPAY;

  // Bank transfer remains BANK_TRANSFER
  if (mode === "bank_transfer" || mode === "banktransfer") return PaymentMode.BANK_TRANSFER;

  // Electronic / UPI / Online payment modes mapped to ONLINE enum
  if (
    mode === "upi" ||
    mode === "online" ||
    mode === "neft" ||
    mode === "rtgs" ||
    mode === "imps" ||
    mode === "netbanking"
  ) {
    return PaymentMode.ONLINE;
  }

  // Cheque / DD: Not in DB enum, safely store as CASH (business display is handled via formatPaymentModeForPdf or receipt notes)
  if (mode === "cheque" || mode === "check") return PaymentMode.CASH;
  if (mode === "dd" || mode === "d.d." || mode === "d.d" || mode === "demand_draft") return PaymentMode.CASH;

  if (mode === "cash") return PaymentMode.CASH;

  const upper = mode.toUpperCase();
  if (upper in PaymentMode) return upper as PaymentMode;

  return PaymentMode.CASH;
}
