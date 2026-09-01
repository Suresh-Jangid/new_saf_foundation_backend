import { z } from "zod";
import {
  SHUBH_LAXMI_INSTALLMENT_AMOUNT,
  SHUBH_LAXMI_MEMBERSHIP_FEE,
  SHUBH_LAXMI_SCHEME_TYPE,
  SHUBH_LAXMI_POOL,
} from "./shubh-laxmi.types";

const dateStringSchema = z.string().refine((val) => !isNaN(Date.parse(val)), {
  message: "Invalid date format",
});

export const createShubhLaxmiSchema = z.object({
  body: z.object({
    applicationDate: dateStringSchema,
    applicantName: z.string().trim().min(1, "Applicant name is required"),
    fatherName: z.string().trim().min(1, "Father name is required"),
    husbandName: z.string().trim().nullable().optional(),
    motherName: z.string().trim().nullable().optional(),
    dateOfBirth: dateStringSchema,
    age: z.coerce.number().int().nonnegative().optional().nullable(),
    aadharNumber: z
      .string()
      .trim()
      .refine((v) => v.replace(/\D/g, "").length === 12, {
        message: "Aadhaar number must be exactly 12 digits",
      }),
    gotra: z.string().trim().min(1, "Gotra is required"),
    mobile: z
      .string()
      .trim()
      .refine((v) => v.replace(/\D/g, "").length >= 10, {
        message: "Mobile must be at least 10 digits",
      }),
    address: z.string().trim().min(1, "Address is required"),
    pinCode: z.string().trim().min(1, "PIN code is required"),
    tehsil: z.string().trim().min(1, "Tehsil is required"),
    district: z.string().trim().min(1, "District is required"),
    state: z.string().trim().optional(),
    nomineeName: z.string().trim().nullable().optional(),
    nomineeRelation: z.string().trim().nullable().optional(),
    nomineeMobile: z.string().trim().nullable().optional(),
    nomineeAadhar: z.string().trim().nullable().optional(),
    passportPhotoUrl: z.string().nullable().optional(),
    affidavitUrl: z.string().nullable().optional(),
    gender: z.enum(["Male", "Female", "Other", "male", "female", "other"]).optional(),
    category: z.enum(["A", "B", "C", "D", "E", "a", "b", "c", "d", "e"]).optional(),
    schemeType: z
      .string()
      .optional()
      .refine((v) => !v || v.toUpperCase() === SHUBH_LAXMI_SCHEME_TYPE, {
        message: `Scheme type must be ${SHUBH_LAXMI_SCHEME_TYPE}`,
      }),
    pool: z
      .string()
      .optional()
      .refine((v) => !v || v.toUpperCase() === SHUBH_LAXMI_POOL, {
        message: `Pool must be ${SHUBH_LAXMI_POOL}`,
      }),
    membershipFee: z
      .coerce
      .number()
      .optional()
      .refine((v) => v === undefined || v === SHUBH_LAXMI_MEMBERSHIP_FEE, {
        message: `ShubhLaxmi membership fee must be exactly ₹${SHUBH_LAXMI_MEMBERSHIP_FEE}`,
      }),
    paymentAmount: z
      .coerce
      .number()
      .optional()
      .refine(
        (v) => v === undefined || v === 0 || v === SHUBH_LAXMI_INSTALLMENT_AMOUNT,
        {
          message: `Initial installment amount must be exactly ₹${SHUBH_LAXMI_INSTALLMENT_AMOUNT}`,
        }
      ),
    paymentMode: z
      .enum(["CASH", "RAZORPAY", "BANK_TRANSFER", "cash", "razorpay", "bank_transfer", "ONLINE", "online"])
      .optional(),
    selectedAgentId: z.string().uuid().optional(),
    epinCode: z.string().trim().nullable().optional(),
    pinNumber: z.string().trim().nullable().optional(),
    note: z.string().trim().nullable().optional(),
  }),
});

export const updateShubhLaxmiSchema = z.object({
  body: z.object({
    applicantName: z.string().trim().min(1).optional(),
    fatherName: z.string().trim().min(1).optional(),
    husbandName: z.string().trim().nullable().optional(),
    motherName: z.string().trim().nullable().optional(),
    dateOfBirth: dateStringSchema.optional(),
    age: z.coerce.number().int().nonnegative().optional().nullable(),
    gotra: z.string().trim().optional(),
    mobile: z
      .string()
      .trim()
      .refine((v) => v.replace(/\D/g, "").length >= 10, {
        message: "Mobile must be at least 10 digits",
      })
      .optional(),
    address: z.string().trim().optional(),
    pinCode: z.string().trim().optional(),
    tehsil: z.string().trim().optional(),
    district: z.string().trim().optional(),
    state: z.string().trim().optional(),
    nomineeName: z.string().trim().nullable().optional(),
    nomineeRelation: z.string().trim().nullable().optional(),
    nomineeMobile: z.string().trim().nullable().optional(),
    nomineeAadhar: z.string().trim().nullable().optional(),
    passportPhotoUrl: z.string().nullable().optional(),
    affidavitUrl: z.string().nullable().optional(),
    gender: z.enum(["Male", "Female", "Other", "male", "female", "other"]).optional(),
    category: z.enum(["A", "B", "C", "D", "E", "a", "b", "c", "d", "e"]).optional(),
  }),
});

export const addShubhLaxmiInstallmentSchema = z.object({
  body: z.object({
    amount: z.coerce.number().refine((v) => v === SHUBH_LAXMI_INSTALLMENT_AMOUNT, {
      message: `ShubhLaxmi installment amount must be exactly ₹${SHUBH_LAXMI_INSTALLMENT_AMOUNT}`,
    }),
    date: dateStringSchema,
    note: z.string().trim().nullable().optional(),
    rashidNumber: z.string().trim().nullable().optional(),
    paymentMode: z
      .enum(["CASH", "RAZORPAY", "BANK_TRANSFER", "cash", "razorpay", "bank_transfer", "ONLINE", "online"])
      .optional(),
  }),
});

export const verifyEPinSchema = z.object({
  body: z.object({
    pinCode: z.string().trim().min(1, "E-PIN code is required"),
  }),
});
