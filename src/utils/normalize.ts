import { PaymentMode } from "@prisma/client";

/** Normalize any frontend/legacy payment mode string to Prisma PaymentMode enum. */
export function normalizePaymentMode(value: unknown): PaymentMode {
  const mode = String(value || "cash")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");

  if (mode === "razorpay") return PaymentMode.RAZORPAY;
  if (mode === "bank_transfer") return PaymentMode.BANK_TRANSFER;
  if (mode === "upi" || mode === "online") return PaymentMode.ONLINE;
  if (mode === "cash") return PaymentMode.CASH;

  const upper = mode.toUpperCase();
  if (upper in PaymentMode) return upper as PaymentMode;

  return PaymentMode.CASH;
}
