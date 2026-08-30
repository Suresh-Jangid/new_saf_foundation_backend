import { z } from "zod";

export const createAgentSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    mobile: z
      .string()
      .min(10, "Mobile number must be at least 10 digits")
      .max(15, "Mobile number must not exceed 15 digits")
      .regex(/^\d+$/, "Mobile number must contain digits only"),
    email: z.string().email("Invalid email format").optional().nullable(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    
    // Agent Profile fields
    employeeId: z.string().min(2, "Employee ID is required"),
    fatherName: z.string().min(2, "Father's name is required"),
    gotra: z.string().min(2, "Gotra is required"),
    age: z.preprocess((val) => Number(val), z.number().int().positive()),
    gender: z.enum(["Male", "Female", "Other"]),
    village: z.string().min(2, "Village is required"),
    address: z.string().min(5, "Address must be at least 5 characters"),
    tehsil: z.string().min(2, "Tehsil is required"),
    district: z.string().min(2, "District is required"),
    workArea: z.string().min(2, "Work Area is required"),
    bankName: z.string().min(2, "Bank name is required"),
    accountNumber: z.string().min(5, "Bank account number is required"),
    ifscCode: z.string().min(4, "IFSC code is required"),
    nomineeName: z.string().min(2, "Nominee name is required"),
    nomineeMobile: z
      .string()
      .min(10, "Nominee mobile must be at least 10 digits")
      .regex(/^\d+$/, "Nominee mobile must be digits only"),
    nomineeRelation: z.string().min(2, "Nominee relation is required"),
  }),
});

export const updateAgentSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional().nullable(),
    password: z.string().min(6).optional(),
    
    // Optional profile updates
    fatherName: z.string().optional(),
    gotra: z.string().optional(),
    age: z.preprocess((val) => Number(val), z.number().int().positive()).optional(),
    gender: z.enum(["Male", "Female", "Other"]).optional(),
    village: z.string().optional(),
    address: z.string().optional(),
    tehsil: z.string().optional(),
    district: z.string().optional(),
    workArea: z.string().optional(),
    bankName: z.string().optional(),
    accountNumber: z.string().optional(),
    ifscCode: z.string().optional(),
    nomineeName: z.string().optional(),
    nomineeMobile: z.string().optional(),
    nomineeRelation: z.string().optional(),
  }),
});

export const updatePermissionsSchema = z.object({
  body: z.object({
    permissions: z.array(
      z.object({
        module: z.string(),
        canView: z.boolean(),
        canCreate: z.boolean(),
        canUpdate: z.boolean(),
        canDelete: z.boolean(),
      })
    ),
  }),
});
