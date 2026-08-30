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

// General Application Creation Validation
export const createGeneralApplicationSchema = z.object({
  body: z.object({
    applicationDate: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2, "Applicant name is required"),
    fatherName: z.string().min(2, "Father's name is required"),
    motherName: z.string().min(2, "Mother's name is required"),
    dateOfBirth: z.string().transform((val) => new Date(val)),
    aadharNumber: aadharSchema,
    gotra: z.string().min(2, "Gotra is required"),
    mobile: mobilePhoneSchema,
    address: z.string().min(5, "Address must be at least 5 characters"),
    pinCode: z.string().length(6, "PIN Code must be 6 digits"),
    tehsil: z.string().min(2, "Tehsil is required"),
    district: z.string().min(2, "District is required"),
    state: z.string().min(2, "State is required"),
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    gender: z.enum(["Male", "Female", "Other"]),
    category: z.enum(["A", "B", "C"]),
    totalAmount: z.preprocess((val) => Number(val), z.number().positive()),
    
    // Initial payment details (optional)
    paymentAmount: z.preprocess((val) => val ? Number(val) : 0, z.number().nonnegative()).optional(),
    paymentMode: z.enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"]).optional(),
    selectedAgentId: z.string().uuid("Agent selection is required"),
  }),
});

// Update General Application
export const updateGeneralApplicationSchema = z.object({
  body: z.object({
    applicantName: z.string().optional(),
    fatherName: z.string().optional(),
    motherName: z.string().optional(),
    gotra: z.string().optional(),
    mobile: mobilePhoneSchema.optional(),
    address: z.string().optional(),
    pinCode: z.string().optional(),
    tehsil: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    gender: z.enum(["Male", "Female", "Other"]).optional(),
    category: z.enum(["A", "B", "C"]).optional(),
    totalAmount: z.preprocess((val) => Number(val), z.number().positive()).optional(),
    pendingAmount: z.preprocess((val) => Number(val), z.number().nonnegative()).optional(),
  }),
});

// Create Installment Validation
export const createInstallmentSchema = z.object({
  body: z.object({
    amount: z.preprocess((val) => Number(val), z.number().positive("Amount must be greater than 0")),
    date: z.string().transform((val) => new Date(val)),
    note: z.string().optional().nullable(),
    paymentMode: z.enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"]).default("CASH"),
  }),
});

// Insurance Application Creation Validation
export const createInsuranceApplicationSchema = z.object({
  body: z.object({
    applicationDate: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2, "Applicant name is required"),
    fatherName: z.string().min(2, "Father's name is required"),
    wifeName: z.string().optional().nullable(),
    motherName: z.string().min(2, "Mother's name is required"),
    dateOfBirth: z.string().transform((val) => new Date(val)),
    aadharNumber: aadharSchema,
    gotra: z.string().min(2, "Gotra is required"),
    mobile: mobilePhoneSchema,
    address: z.string().min(5, "Address must be at least 5 characters"),
    pinCode: z.string().length(6, "PIN Code must be 6 digits"),
    tehsil: z.string().min(2, "Tehsil is required"),
    district: z.string().min(2, "District is required"),
    state: z.string().min(2, "State is required"),
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    gender: z.enum(["Male", "Female", "Other"]),
    category: z.enum(["A", "B", "C"]),
    totalAmount: z.preprocess((val) => Number(val), z.number().positive()),
    
    // Initial payment details (optional)
    paymentAmount: z.preprocess((val) => val ? Number(val) : 0, z.number().nonnegative()).optional(),
    paymentMode: z.enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"]).optional(),
    selectedAgentId: z.string().uuid("Agent selection is required"),
  }),
});

// Create Suraksha Bima Yojana Schema
export const createSurakshaBimaSchema = z.object({
  body: z.object({
    date: z.string().transform((val) => new Date(val)),
    codeNumber: z.string().min(1, "Code Number is required"),
    bimaNumber: z.string().min(1, "Bima Number is required"),
    membershipJoinDate: z.string().transform((val) => new Date(val)),
    associatedUntil: z.string().transform((val) => new Date(val)),
    permanentFee: z.preprocess((val) => Number(val), z.number().nonnegative()),
    installmentAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    totalGrantAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    totalMembersServing: z.preprocess((val) => Number(val), z.number().int().nonnegative()),
    rate200: z.preprocess((val) => Number(val), z.number().nonnegative()),
    deducted10Percent: z.preprocess((val) => Number(val), z.number().nonnegative()),
    deducted25Percent: z.preprocess((val) => Number(val), z.number().nonnegative()),
    totalPaidAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    remark: z.string().optional().nullable(),
  }),
});
