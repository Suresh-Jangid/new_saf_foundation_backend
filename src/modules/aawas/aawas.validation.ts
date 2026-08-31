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

const pinCodeSchema = z
  .string()
  .min(5, "PIN Code must be at least 5 digits")
  .max(10, "PIN Code max 10 digits")
  .regex(/^\d+$/, "PIN Code must contain digits only");

export const createAawasSchema = z.object({
  body: z.object({
    applicationDate: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2, "Applicant name is required"),
    fatherName: z.string().min(2, "Father's name is required"),
    husbandName: z.string().optional().nullable(),
    motherName: z.string().optional().nullable(),
    dateOfBirth: z.string().transform((val) => new Date(val)),
    age: z
      .preprocess(
        (val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined),
        z.number().int().min(0, "Age must be valid")
      )
      .optional(),
    aadharNumber: aadharSchema,
    gotra: z.string().min(2, "Gotra is required"),
    mobile: mobilePhoneSchema,
    address: z.string().min(3, "Address must be at least 3 characters"),
    pinCode: pinCodeSchema,
    tehsil: z.string().min(2, "Tehsil is required"),
    district: z.string().min(2, "District is required"),
    state: z.string().optional().default("Rajasthan"),

    // Nominee Details
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    nomineeMobile: mobilePhoneSchema.optional().nullable(),
    nomineeAadhar: aadharSchema.optional().nullable(),

    // Attachments
    passportPhotoUrl: z.string().optional().nullable(),
    affidavitUrl: z.string().optional().nullable(),

    // Categorization & Fee
    gender: z.enum(["Male", "Female", "Other"]).optional().default("Male"),
    category: z.enum(["A", "B", "C", "D", "E", "F"]).optional().default("A"),
    totalAmount: z
      .preprocess(
        (val) => (val !== undefined && val !== null && val !== "" ? Number(val) : 15000),
        z.number().nonnegative()
      )
      .optional(),

    // Initial Payment / E-PIN
    paymentAmount: z
      .preprocess((val) => (val ? Number(val) : 0), z.number().nonnegative())
      .optional(),
    paymentMode: z.enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"]).optional().default("CASH"),
    selectedAgentId: z.string().uuid("Valid agent ID is required").optional(),
    epinCode: z.string().optional().nullable(),
    pinNumber: z.string().optional().nullable(),
  }),
});

export const updateAawasSchema = z.object({
  body: z.object({
    applicantName: z.string().min(2).optional(),
    fatherName: z.string().min(2).optional(),
    husbandName: z.string().optional().nullable(),
    motherName: z.string().optional().nullable(),
    dateOfBirth: z.string().transform((val) => new Date(val)).optional(),
    age: z
      .preprocess(
        (val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined),
        z.number().int().min(0)
      )
      .optional(),
    gotra: z.string().min(2).optional(),
    mobile: mobilePhoneSchema.optional(),
    address: z.string().min(3).optional(),
    pinCode: pinCodeSchema.optional(),
    tehsil: z.string().min(2).optional(),
    district: z.string().min(2).optional(),
    state: z.string().optional(),
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    nomineeMobile: mobilePhoneSchema.optional().nullable(),
    nomineeAadhar: aadharSchema.optional().nullable(),
    passportPhotoUrl: z.string().optional().nullable(),
    affidavitUrl: z.string().optional().nullable(),
    gender: z.enum(["Male", "Female", "Other"]).optional(),
    category: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
    totalAmount: z.number().nonnegative().optional(),
    pendingAmount: z.number().nonnegative().optional(),
  }),
});

export const addAawasInstallmentSchema = z.object({
  body: z.object({
    amount: z.number().positive("Installment amount must be greater than 0"),
    date: z.string().transform((val) => new Date(val)),
    note: z.string().optional().nullable(),
    rashidNumber: z.string().optional().nullable(),
    paymentMode: z.enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"]).optional().default("CASH"),
  }),
});
