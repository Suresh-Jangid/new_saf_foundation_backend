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
    
    // Hierarchy fields
    seniorEmployeeId: z.string().optional().nullable(),
    seniorId: z.string().optional().nullable(),
    parentAgentId: z.string().optional().nullable(),
    senior_employee_id: z.string().optional().nullable(),

    // Agent Profile fields
    employeeId: z.string().min(2, "Employee ID is required"),
    offlineFormNumber: z.string().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
    offline_form_number: z.string().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
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
      .max(15, "Nominee mobile must not exceed 15 digits")
      .regex(/^\d+$/, "Nominee mobile must be digits only"),
    nomineeRelation: z.string().min(2, "Nominee relation is required"),
    aadhaar: z.string().optional().nullable(),
    designation: z.string().optional().nullable(),
    profileImageUrl: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    dateOfJoining: z.string().optional().nullable(),
    registrationDate: z.string().optional().nullable(),
  }),
});

export const updateAgentSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional().nullable(),
    password: z.string().min(6).optional(),
    
    // Hierarchy updates
    seniorEmployeeId: z.string().optional().nullable(),
    seniorId: z.string().optional().nullable(),
    parentAgentId: z.string().optional().nullable(),
    senior_employee_id: z.string().optional().nullable(),

    // Optional profile updates
    offlineFormNumber: z.string().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
    offline_form_number: z.string().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
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
    aadhaar: z.string().optional().nullable(),
    designation: z.string().optional().nullable(),
    profileImageUrl: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    dateOfJoining: z.string().optional().nullable(),
    registrationDate: z.string().optional().nullable(),
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
