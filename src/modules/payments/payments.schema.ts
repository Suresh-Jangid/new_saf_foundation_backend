import { z } from "zod";

// Cash Book/Flow Schema
export const createPaymentSchema = z.object({
  body: z.object({
    date: z.string().transform((val) => new Date(val)),
    type: z.string().min(1, "Income/Expense category type is required"),
    amount: z.preprocess((val) => Number(val), z.number().positive()),
    remark: z.string().optional().nullable(),
  }),
});

// Agent Commission payout schema
export const createAgentPayoutSchema = z.object({
  body: z.object({
    amount: z.preprocess((val) => Number(val), z.number().positive()),
    startDate: z.string().transform((val) => new Date(val)),
    endDate: z.string().transform((val) => new Date(val)),
  }),
});

// Razorpay order schema
export const createRazorpayOrderSchema = z.object({
  body: z.object({
    amount: z.preprocess((val) => Number(val), z.number().positive("Amount must be greater than 0")),
    receipt: z.string().optional(),
  }),
});

// Razorpay signature verification schema
export const verifyRazorpayPaymentSchema = z.object({
  body: z.object({
    razorpay_order_id: z.string().min(1, "Order ID is required"),
    razorpay_payment_id: z.string().min(1, "Payment ID is required"),
    razorpay_signature: z.string().min(1, "Signature is required"),
  }),
});
