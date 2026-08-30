import { z } from "zod";

export const updateAppConfigSchema = z.object({
  appName: z.string().min(1, "App name is required").optional(),
  mobile: z.string().regex(/^\d{10,15}$/, "Valid mobile number is required").optional(),
  contactEmail: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  defaultDeductionPercent: z.number().min(0).max(100).optional(),
  status: z.string().optional(),
});

export const updateModuleConfigSchema = z.object({
  displayName: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  status: z.string().optional(),
});

export const createSchemeMasterSchema = z.object({
  code: z.string().min(1, "Scheme code is required").toUpperCase(),
  name: z.string().min(1, "Scheme name is required"),
  moduleCode: z.string().min(1, "Module code is required").toUpperCase(),
  description: z.string().nullable().optional(),
  poolType: z.enum(["FEMALE_POOL", "MALE_POOL", "UNIFIED_POOL"]).default("FEMALE_POOL"),
  deductionPercent: z.number().min(0).max(100).default(15.0),
  status: z.string().default("ACTIVE"),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
});

export const updateSchemeMasterSchema = createSchemeMasterSchema.partial().omit({ code: true });

export const createSchemeTypeSchema = z.object({
  code: z.string().min(1, "Code is required").toUpperCase(),
  name: z.string().min(1, "Name is required"),
  amount: z.number().positive("Amount must be positive"),
  description: z.string().nullable().optional(),
  status: z.string().default("ACTIVE"),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
});

export const updateSchemeTypeSchema = createSchemeTypeSchema.partial().omit({ code: true });

export const baseAgeSlabSchema = z.object({
  slabCode: z.string().min(1, "Slab code is required").toUpperCase(),
  slabName: z.string().min(1, "Slab name is required"),
  minAge: z.number().int().min(0, "Min age must be non-negative"),
  maxAge: z.number().int().positive().nullable().optional(),
  joiningFee: z.number().min(0, "Joining fee must be non-negative"),
  installment: z.number().min(0, "Installment must be non-negative"),
  schemeType: z.string().default("GENERAL"),
  status: z.string().default("Active"),
  displayOrder: z.number().int().default(0),
});

export const createAgeSlabSchema = baseAgeSlabSchema.refine((data) => {
  if (data.maxAge !== null && data.maxAge !== undefined) {
    return data.maxAge >= data.minAge;
  }
  return true;
}, {
  message: "maxAge must be greater than or equal to minAge",
  path: ["maxAge"],
});

export const updateAgeSlabSchema = baseAgeSlabSchema.partial().omit({ slabCode: true });

export const resolveAgeSlabQuerySchema = z.object({
  age: z.preprocess((val) => Number(val), z.number().int().min(0)),
  schemeType: z.string().default("GENERAL"),
});

export const createPoolConfigSchema = z.object({
  code: z.string().min(1, "Pool code is required").toUpperCase(),
  name: z.string().min(1, "Pool name is required"),
  gender: z.enum(["Male", "Female", "Other"]).nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().default("ACTIVE"),
});

export const updatePoolConfigSchema = createPoolConfigSchema.partial().omit({ code: true });

export const generateEPinSchema = z.object({
  schemeCode: z.string().min(1, "Scheme code is required").toUpperCase(),
  slabCode: z.string().optional(),
  amount: z.number().positive("Amount must be positive"),
  count: z.number().int().min(1).max(500).default(1),
});

export const assignEPinSchema = z.object({
  pinCodes: z.array(z.string().min(1)).min(1, "At least one pinCode is required"),
  assignedToId: z.string().uuid("Valid agent user ID is required"),
});

export const useEPinSchema = z.object({
  pinCode: z.string().min(1, "pinCode is required"),
  usedInModule: z.string().min(1, "usedInModule is required"),
  usedEntityId: z.string().uuid("Valid entity ID is required"),
  expectedSchemeCode: z.string().optional(),
  expectedAmount: z.number().optional(),
});

export const burnEPinSchema = z.object({
  pinCodes: z.array(z.string().min(1)).min(1, "At least one pinCode is required"),
  burnReason: z.string().min(3, "Burn reason is required"),
});
