import { z } from "zod";

const mobilePhoneSchema = z
  .string()
  .min(10, "Mobile must be at least 10 digits")
  .max(15, "Mobile must not exceed 15 digits")
  .regex(/^\d+$/, "Mobile must contain digits only");

const aadharSchema = z
  .string()
  .length(12, "Aadhaar must be exactly 12 digits")
  .regex(/^\d+$/, "Aadhaar must contain digits only");

// Mayra Registration Schema
export const createMayraRegistrationSchema = z.object({
  body: z.object({
    applicationDate: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2, "Applicant name is required"),
    fatherName: z.string().min(2, "Father's name is required"),
    motherName: z.string().min(2, "Mother's name is required"),
    dateOfBirth: z.string().transform((val) => new Date(val)),
    age: z.preprocess((val) => Number(val), z.number().int().min(10, "Age must be at least 10 years for Mayra Registration")),
    gotra: z.string().min(2, "Gotra is required"),
    address: z.string().min(5, "Address must be at least 5 characters"),
    aadharNumber: aadharSchema,
    mobile: mobilePhoneSchema,
    nomineeName: z.string().min(2, "Nominee name is required"),
    nomineeFatherName: z.string().optional().nullable(),
    nomineeGotra: z.string().optional().nullable(),
    nomineeAddress: z.string().optional().nullable(),
    tehsil: z.string().min(2, "Tehsil is required"),
    district: z.string().min(2, "District is required"),
    pinCode: z.string().length(6, "PIN Code must be 6 digits"),
    nomineeRelation: z.string().min(2, "Nominee relation is required"),
    workerName: z.string().min(2, "Worker name is required"),
    workerMobile: mobilePhoneSchema.optional().nullable(),
    gender: z.enum(["Male", "Female", "Other"]),
    
    // Initial payment details
    paymentAmount: z.preprocess((val) => val ? Number(val) : 0, z.number().nonnegative()).optional(),
    paymentMode: z.enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"]).optional(),
    selectedAgentId: z.string().uuid("Agent selection is required"),
  }),
});

// Mayra Congratulations schema
export const createMayraCongratsSchema = z.object({
  body: z.object({
    date: z.string().transform((val) => new Date(val)),
    codeNumber: z.string().min(1, "Code Number is required"),
    mayraNumber: z.string().optional().nullable(),
    membershipJoinDate: z.string().transform((val) => new Date(val)),
    associatedUntil: z.string().min(1, "Associated until is required"),
    permanentFee: z.preprocess((val) => Number(val), z.number().nonnegative()),
    installmentAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    totalGrantAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    totalMembersServing: z.preprocess((val) => Number(val), z.number().int().nonnegative()),
    rate200: z.preprocess((val) => Number(val), z.number().nonnegative()),
    rate300: z.preprocess((val) => Number(val), z.number().nonnegative()),
    deductionPercent: z.preprocess((val) => Number(val), z.number().nonnegative()),
    deductedAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    totalPaidAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    gender: z.enum(["Male", "Female", "Other"]),
  }),
});

// Mayra Payout Payment schema
export const createMayraCongratsPaymentSchema = z.object({
  body: z.object({
    amount: z.preprocess((val) => Number(val), z.number().positive()),
    category: z.string().min(1, "Category is required"),
    applicationId: z.string().uuid().optional().nullable(),
  }),
});
