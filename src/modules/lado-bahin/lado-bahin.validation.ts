import { z } from "zod";

export const createLadoBahinSchema = z.object({
  body: z.object({
    applicationDate: z.string().min(1, "Application date is required"),
    applicantName: z.string().min(1, "Applicant name is required"),
    fatherName: z.string().min(1, "Father name is required"),
    husbandName: z.string().optional().nullable(),
    motherName: z.string().optional().nullable(),
    dateOfBirth: z.string().min(1, "Date of birth is required"),
    age: z.union([z.number(), z.string()]).optional().nullable(),
    aadharNumber: z
      .string()
      .regex(/^\d{12}$/, "Aadhaar must be exactly 12 digits"),
    gotra: z.string().min(1, "Gotra is required"),
    mobile: z
      .string()
      .regex(/^\d{10,15}$/, "Mobile must be at least 10 digits"),
    address: z.string().min(1, "Address is required"),
    pinCode: z.string().min(1, "PIN code is required"),
    tehsil: z.string().min(1, "Tehsil is required"),
    district: z.string().min(1, "District is required"),
    state: z.string().optional().default("Rajasthan"),
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    nomineeMobile: z.string().optional().nullable(),
    nomineeAadhar: z.string().optional().nullable(),
    passportPhotoUrl: z.string().optional().nullable(),
    affidavitUrl: z.string().optional().nullable(),
    gender: z.enum(["Male", "Female", "Other"]).optional().default("Female"),
    category: z.enum(["A", "B", "C", "D", "E", "F"]).optional().default("A"),
    schemeType: z.string().optional().default("LADO_BAHIN"),
    pool: z.string().optional().default("FEMALE_POOL"),
    membershipFee: z.number().optional().default(5100),
    epinCode: z.string().optional().nullable(),
    pinNumber: z.string().optional().nullable(),
    selectedAgentId: z.string().optional().nullable(),
    initialAccountType: z
      .enum(["LADO_BAHIN_300", "LADO_BAHIN_1000"])
      .optional()
      .nullable(),
    paymentAmount: z.number().optional().nullable(),
    paymentMode: z
      .enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"])
      .optional()
      .default("CASH"),
  }),
});

export const updateLadoBahinSchema = z.object({
  body: z.object({
    applicantName: z.string().optional(),
    fatherName: z.string().optional(),
    husbandName: z.string().optional().nullable(),
    motherName: z.string().optional().nullable(),
    dateOfBirth: z.string().optional(),
    age: z.union([z.number(), z.string()]).optional().nullable(),
    gotra: z.string().optional(),
    mobile: z
      .string()
      .regex(/^\d{10,15}$/, "Mobile must be at least 10 digits")
      .optional(),
    address: z.string().optional(),
    pinCode: z.string().optional(),
    tehsil: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    nomineeName: z.string().optional().nullable(),
    nomineeRelation: z.string().optional().nullable(),
    nomineeMobile: z.string().optional().nullable(),
    nomineeAadhar: z.string().optional().nullable(),
    passportPhotoUrl: z.string().optional().nullable(),
    affidavitUrl: z.string().optional().nullable(),
    gender: z.enum(["Male", "Female", "Other"]).optional(),
    category: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
  }),
});

export const addLadoBahinInstallmentSchema = z.object({
  body: z.object({
    accountType: z.enum(["LADO_BAHIN_300", "LADO_BAHIN_1000"], {
      required_error: "accountType is required (LADO_BAHIN_300 or LADO_BAHIN_1000)",
    }),
    amount: z.number().positive("Installment amount must be greater than zero"),
    date: z.string().min(1, "Date is required"),
    note: z.string().optional().nullable(),
    rashidNumber: z.string().optional().nullable(),
    paymentMode: z
      .enum(["CASH", "ONLINE", "RAZORPAY", "BANK_TRANSFER"])
      .optional()
      .default("CASH"),
  }),
});

export const verifyEPinSchema = z.object({
  body: z.object({
    pinCode: z.string().min(1, "pinCode is required"),
  }),
});
