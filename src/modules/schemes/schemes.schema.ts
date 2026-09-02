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

// Loan application validation
export const createLoanSchema = z.object({
  body: z.object({
    date: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2, "Applicant name is required"),
    fatherName: z.string().min(2, "Father's name is required"),
    motherName: z.string().min(2, "Mother's name is required"),
    address: z.string().min(5, "Address must be at least 5 characters"),
    reason: z.string().min(5, "Reason must be at least 5 characters"),
  }),
});

export const createLoanInstallmentSchema = z.object({
  body: z.object({
    amount: z.preprocess((val) => Number(val), z.number().positive()),
    date: z.string().transform((val) => new Date(val)),
    type: z.enum(["USER_REPAYMENT", "WE_PAID"]),
    note: z.string().optional().nullable(),
  }),
});

// Financial Help schema
export const createFinancialHelpSchema = z.object({
  body: z.object({
    formNumber: z.string().min(1, "Form number is required"),
    date: z.string().transform((val) => new Date(val)),
    name: z.string().min(2, "Name is required"),
    gender: z.enum(["Male", "Female", "Other"]),
    fatherName: z.string().min(2, "Father name is required"),
    address: z.string().min(5, "Address is required"),
    district: z.string().min(2, "District is required"),
    village: z.string().min(2, "Village is required"),
    tehsil: z.string().min(2, "Tehsil is required"),
    phone: mobilePhoneSchema,
    donatedAmount: z.preprocess((val) => Number(val), z.number().positive()),
  }),
});

// Disability Cycle schema
export const createDisabilityCycleSchema = z.object({
  body: z.object({
    formNumber: z.string().min(1, "Form number is required"),
    applicationDate: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2),
    fatherName: z.string().min(2),
    motherName: z.string().min(2),
    dateOfBirth: z.string().transform((val) => new Date(val)),
    aadharNumber: aadharSchema,
    gotra: z.string().min(2),
    age: z.preprocess((val) => Number(val), z.number().int().positive()),
    mobile: mobilePhoneSchema,
    address: z.string().min(5),
    pinCode: z.string().length(6),
    tehsil: z.string().min(2),
    district: z.string().min(2),
    state: z.string().min(2),
  }),
});

// Marriage Congratulations schema
export const createMarriageCongratsSchema = z.object({
  body: z.object({
    date: z.string().transform((val) => new Date(val)),
    codeNumber: z.string().min(1),
    marriageNumber: z.string().min(1),
    applicantName: z.string().min(2),
    fatherName: z.string().min(2),
    wifeOf: z.string().optional().nullable(),
    gotra: z.string().min(2),
    address: z.string().min(5),
    membershipJoinDate: z.string().transform((val) => new Date(val)),
    associatedUntil: z.string().transform((val) => new Date(val)),
    permanentFee: z.preprocess((val) => Number(val), z.number().nonnegative()),
    installmentAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    totalGrantAmount: z.preprocess((val) => Number(val), z.number().nonnegative()),
    totalMembersServing: z.preprocess((val) => Number(val), z.number().int().nonnegative()),
    rate100: z.preprocess((val) => Number(val), z.number().nonnegative()),
    rate200: z.preprocess((val) => Number(val), z.number().nonnegative()),
    rate300: z.preprocess((val) => Number(val), z.number().nonnegative()),
    deductionPercent: z.preprocess((val) => (val === undefined || val === null || val === "" ? 15 : Number(val)), z.number().nonnegative()).default(15),
    deductedAmount: z.preprocess((val) => (val === undefined || val === null || val === "" ? 0 : Number(val)), z.number().nonnegative()).optional(),
    totalPaidAmount: z.preprocess((val) => (val === undefined || val === null || val === "" ? 0 : Number(val)), z.number().nonnegative()).optional(),
    gender: z.enum(["Male", "Female", "Other"]),
  }),
});

// Marriage Congrats Payment schema
export const createMarriageCongratsPaymentSchema = z.object({
  body: z.object({
    amount: z.preprocess((val) => Number(val), z.number().positive()),
    category: z.string().min(1),
    applicationId: z.string().uuid().optional().nullable(),
  }),
});

// Marriage Sewing Machine schema
export const createMarriageSewingMachineSchema = z.object({
  body: z.object({
    formNumber: z.string().min(1),
    applicationDate: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2),
    fatherName: z.string().min(2),
    motherName: z.string().min(2),
    dateOfBirth: z.string().transform((val) => new Date(val)),
    aadharNumber: aadharSchema,
    gotra: z.string().min(2),
    age: z.preprocess((val) => Number(val), z.number().int().positive()),
    mobile: mobilePhoneSchema,
    address: z.string().min(5),
    pinCode: z.string().length(6),
    tehsil: z.string().min(2),
    district: z.string().min(2),
    state: z.string().min(2),
    gender: z.enum(["Male", "Female", "Other"]),
  }),
});

// Pension schema
export const createPensionSchema = z.object({
  body: z.object({
    date: z.string().transform((val) => new Date(val)),
    name: z.string().min(2),
    fatherName: z.string().min(2),
    gotra: z.string().min(2),
    age: z.preprocess((val) => Number(val), z.number().int().positive()),
    gender: z.enum(["Male", "Female", "Other"]),
    village: z.string().min(2),
    tehsil: z.string().min(2),
    district: z.string().min(2),
    mobile: mobilePhoneSchema,
    bankName: z.string().min(2),
    accountNumber: z.string().min(5),
    ifscCode: z.string().min(4),
    monthlyPension: z.preprocess((val) => Number(val), z.number().positive()),
  }),
});

// Pension Payout schema
export const createPensionPaymentSchema = z.object({
  body: z.object({
    amount: z.preprocess((val) => Number(val), z.number().positive()),
    date: z.string().transform((val) => new Date(val)),
    note: z.string().optional().nullable(),
  }),
});

// Sewing Machine Camp schema
export const createSewingCampSchema = z.object({
  body: z.object({
    campNumber: z.string().min(1),
    formNumber: z.string().min(1),
    applicationDate: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2),
    fatherName: z.string().min(2),
    motherName: z.string().min(2),
    dateOfBirth: z.string().transform((val) => new Date(val)),
    aadharNumber: aadharSchema,
    gotra: z.string().min(2),
    age: z.preprocess((val) => Number(val), z.number().int().positive()),
    mobile: mobilePhoneSchema,
    address: z.string().min(5),
    pinCode: z.string().length(6),
    tehsil: z.string().min(2),
    district: z.string().min(2),
    state: z.string().min(2),
  }),
});
