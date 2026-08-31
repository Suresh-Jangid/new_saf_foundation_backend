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

export const createJanniDeliverySchema = z.object({
  body: z.object({
    applicationDate: z.string().transform((val) => new Date(val)),
    applicantName: z.string().min(2, "Applicant (mother) name is required"),
    fatherName: z.string().min(2, "Father's name is required"),
    husbandName: z.string().optional().nullable(),
    motherName: z.string().optional().nullable(),
    dateOfBirth: z.string().transform((val) => new Date(val)),
    age: z.preprocess((val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined), z.number().int().min(1, "Age must be valid")).optional(),
    aadharNumber: aadharSchema,
    gotra: z.string().min(2, "Gotra is required"),
    mobile: mobilePhoneSchema,
    address: z.string().min(3, "Address must be at least 3 characters"),
    pinCode: z.string().min(5, "PIN Code must be at least 5 digits").max(10, "PIN Code max 10 digits"),
    tehsil: z.string().min(2, "Tehsil is required"),
    district: z.string().min(2, "District is required"),
    state: z.string().optional().default("Rajasthan"),
    
    // Delivery & Child Details
    childName: z.string().optional().nullable(),
    childGender: z.enum(["Male", "Female", "Other"]).optional().nullable(),
    deliveryDate: z.string().optional().nullable().transform((val) => (val ? new Date(val) : null)),
    hospitalName: z.string().optional().nullable(),

    // Nominee Details
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    nomineeMobile: mobilePhoneSchema.optional().nullable(),

    // Attachments
    passportPhotoUrl: z.string().optional().nullable(),
    affidavitUrl: z.string().optional().nullable(),

    // Categorization & Fee
    gender: z.enum(["Male", "Female", "Other"]).optional().default("Female"),
    category: z.enum(["A", "B", "C", "D", "E", "F"]).optional().default("A"),
    totalAmount: z.preprocess((val) => (val !== undefined && val !== null && val !== "" ? Number(val) : 0), z.number().nonnegative()).optional(),
    
    // Initial Payment / E-PIN
    paymentAmount: z.preprocess((val) => (val ? Number(val) : 0), z.number().nonnegative()).optional(),
    paymentMode: z.enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"]).optional().default("CASH"),
    selectedAgentId: z.string().uuid("Valid agent ID is required").optional(),
    epinCode: z.string().optional().nullable(),
    pinNumber: z.string().optional().nullable(),
  }),
});

export const updateJanniDeliverySchema = z.object({
  body: z.object({
    applicantName: z.string().min(2).optional(),
    fatherName: z.string().min(2).optional(),
    husbandName: z.string().optional().nullable(),
    motherName: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().transform((val) => (val ? new Date(val) : undefined)),
    age: z.preprocess((val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined), z.number().int().min(1)).optional(),
    gotra: z.string().min(2).optional(),
    mobile: mobilePhoneSchema.optional(),
    address: z.string().min(3).optional(),
    pinCode: z.string().optional(),
    tehsil: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    childName: z.string().optional().nullable(),
    childGender: z.enum(["Male", "Female", "Other"]).optional().nullable(),
    deliveryDate: z.string().optional().nullable().transform((val) => (val ? new Date(val) : null)),
    hospitalName: z.string().optional().nullable(),
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    nomineeMobile: mobilePhoneSchema.optional().nullable(),
    passportPhotoUrl: z.string().optional().nullable(),
    affidavitUrl: z.string().optional().nullable(),
    gender: z.enum(["Male", "Female", "Other"]).optional(),
    category: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
    totalAmount: z.preprocess((val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined), z.number().nonnegative()).optional(),
    pendingAmount: z.preprocess((val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined), z.number().nonnegative()).optional(),
  }),
});

export const addJanniInstallmentSchema = z.object({
  body: z.object({
    amount: z.preprocess((val) => Number(val), z.number().positive("Installment amount must be greater than 0")),
    date: z.string().transform((val) => new Date(val)),
    note: z.string().optional().nullable(),
    rashidNumber: z.string().optional().nullable(),
    paymentMode: z.enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"]).optional().default("CASH"),
  }),
});
