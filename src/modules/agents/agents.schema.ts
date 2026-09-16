import { z } from "zod";

const genderSchema = z.preprocess((val) => {
  const raw = String(val ?? "").trim().toLowerCase();
  if (raw === "female") return "Female";
  if (raw === "other") return "Other";
  if (raw === "male") return "Male";
  return val;
}, z.enum(["Male", "Female", "Other"]));

const ageSchema = z.preprocess((val) => {
  if (val === undefined || val === null || String(val).trim() === "") return undefined;
  const num = Number(val);
  return isNaN(num) ? val : num;
}, z.number().int("Age must be an integer").positive("Age must be positive").optional().nullable());

const mobilePhoneSchema = z
  .string()
  .trim()
  .min(10, "Mobile number must be at least 10 digits")
  .max(15, "Mobile number must not exceed 15 digits")
  .regex(/^\d+$/, "Mobile number must contain digits only");

const optionalMobileSchema = z.preprocess((val) => {
  if (val === undefined || val === null || String(val).trim() === "") return undefined;
  return String(val).trim();
}, z.string().min(10, "Mobile number must be at least 10 digits").max(15, "Mobile number must not exceed 15 digits").regex(/^\d+$/, "Mobile number must contain digits only").optional().nullable());

export const createAgentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters"),
    mobile: mobilePhoneSchema,
    email: z.preprocess((val) => (val === "" ? undefined : val), z.string().trim().email("Invalid email format").optional().nullable()),
    password: z.string().min(6, "Password must be at least 6 characters"),

    // Hierarchy fields
    seniorEmployeeId: z.string().trim().optional().nullable(),
    seniorId: z.string().trim().optional().nullable(),
    parentAgentId: z.string().trim().optional().nullable(),
    senior_employee_id: z.string().trim().optional().nullable(),

    // Agent Profile fields
    employeeId: z.string().trim().max(50).optional().nullable(),
    employee_id: z.string().trim().max(50).optional().nullable(),
    offlineFormNumber: z.string().trim().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
    offline_form_number: z.string().trim().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
    offlineFormNo: z.string().trim().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),

    fatherName: z.string().trim().optional().nullable(),
    father_name: z.string().trim().optional().nullable(),
    gotra: z.string().trim().optional().nullable(),
    age: ageSchema,
    gender: genderSchema.optional().default("Male"),
    village: z.string().trim().optional().nullable(),
    address: z.string().trim().optional().nullable(),
    tehsil: z.string().trim().optional().nullable(),
    district: z.string().trim().optional().nullable(),
    workArea: z.string().trim().optional().nullable(),
    work_area: z.string().trim().optional().nullable(),

    // Bank details (optional in registration)
    bankName: z.string().trim().optional().nullable(),
    bank_name: z.string().trim().optional().nullable(),
    accountNumber: z.string().trim().optional().nullable(),
    account_number: z.string().trim().optional().nullable(),
    ifscCode: z.string().trim().optional().nullable(),
    ifsc: z.string().trim().optional().nullable(),
    ifsc_code: z.string().trim().optional().nullable(),

    // Nominee details (optional in registration)
    nomineeName: z.string().trim().optional().nullable(),
    nominee_name: z.string().trim().optional().nullable(),
    nomineeMobile: optionalMobileSchema,
    nominee_mobile: optionalMobileSchema,
    nomineeRelation: z.string().trim().optional().nullable(),
    nominee_relation: z.string().trim().optional().nullable(),

    // Extra fields
    aadhaar: z.string().trim().optional().nullable(),
    aadhar: z.string().trim().optional().nullable(),
    aadharNumber: z.string().trim().optional().nullable(),
    aadhar_number: z.string().trim().optional().nullable(),
    designation: z.string().trim().optional().nullable(),
    profileImageUrl: z.string().optional().nullable(),
    profile_image_url: z.string().optional().nullable(),
    profile_image: z.string().optional().nullable(),
    profileImage: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    date_of_birth: z.string().optional().nullable(),
    dob: z.string().optional().nullable(),
    dateOfJoining: z.string().optional().nullable(),
    date_of_joining: z.string().optional().nullable(),
    doj: z.string().optional().nullable(),
    registrationDate: z.string().optional().nullable(),
    registration_date: z.string().optional().nullable(),
    date: z.string().optional().nullable(),
  }),
});

export const updateAgentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).optional(),
    mobile: mobilePhoneSchema.optional(),
    email: z.preprocess((val) => (val === "" ? undefined : val), z.string().trim().email("Invalid email format").optional().nullable()),
    password: z.string().min(6).optional(),

    // Hierarchy updates
    seniorEmployeeId: z.string().trim().optional().nullable(),
    seniorId: z.string().trim().optional().nullable(),
    parentAgentId: z.string().trim().optional().nullable(),
    senior_employee_id: z.string().trim().optional().nullable(),

    // Optional profile updates
    employeeId: z.string().trim().max(50).optional().nullable(),
    employee_id: z.string().trim().max(50).optional().nullable(),
    offlineFormNumber: z.string().trim().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
    offline_form_number: z.string().trim().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
    offlineFormNo: z.string().trim().max(50, "Offline form number must not exceed 50 characters").optional().nullable(),
    fatherName: z.string().trim().optional().nullable(),
    father_name: z.string().trim().optional().nullable(),
    gotra: z.string().trim().optional().nullable(),
    age: ageSchema,
    gender: genderSchema.optional(),
    village: z.string().trim().optional().nullable(),
    address: z.string().trim().optional().nullable(),
    tehsil: z.string().trim().optional().nullable(),
    district: z.string().trim().optional().nullable(),
    workArea: z.string().trim().optional().nullable(),
    work_area: z.string().trim().optional().nullable(),
    bankName: z.string().trim().optional().nullable(),
    bank_name: z.string().trim().optional().nullable(),
    accountNumber: z.string().trim().optional().nullable(),
    account_number: z.string().trim().optional().nullable(),
    ifscCode: z.string().trim().optional().nullable(),
    ifsc: z.string().trim().optional().nullable(),
    ifsc_code: z.string().trim().optional().nullable(),
    nomineeName: z.string().trim().optional().nullable(),
    nominee_name: z.string().trim().optional().nullable(),
    nomineeMobile: optionalMobileSchema,
    nominee_mobile: optionalMobileSchema,
    nomineeRelation: z.string().trim().optional().nullable(),
    nominee_relation: z.string().trim().optional().nullable(),
    aadhaar: z.string().trim().optional().nullable(),
    aadhar: z.string().trim().optional().nullable(),
    aadharNumber: z.string().trim().optional().nullable(),
    aadhar_number: z.string().trim().optional().nullable(),
    designation: z.string().trim().optional().nullable(),
    profileImageUrl: z.string().optional().nullable(),
    profile_image_url: z.string().optional().nullable(),
    profile_image: z.string().optional().nullable(),
    profileImage: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    date_of_birth: z.string().optional().nullable(),
    dob: z.string().optional().nullable(),
    dateOfJoining: z.string().optional().nullable(),
    date_of_joining: z.string().optional().nullable(),
    doj: z.string().optional().nullable(),
    registrationDate: z.string().optional().nullable(),
    registration_date: z.string().optional().nullable(),
    date: z.string().optional().nullable(),
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
