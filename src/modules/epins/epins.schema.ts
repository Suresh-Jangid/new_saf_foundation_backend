import { z } from "zod";

export const epinInventoryQuerySchema = z.object({
  query: z.object({
    pinNumber: z.string().optional(),
    pinCode: z.string().optional(),
    batchNumber: z.string().optional(),
    status: z.enum(["ACTIVE", "ASSIGNED", "USED", "BURNT"]).optional(),
    schemeTypeId: z.string().optional(),
    schemeCode: z.string().optional(),
    poolId: z.string().optional(),
    slabCode: z.string().optional(),
    assignedAgentId: z.string().optional(),
    agentId: z.string().optional(),
    page: z.preprocess((v) => (v ? parseInt(String(v), 10) : 1), z.number().int().min(1)).optional(),
    limit: z.preprocess((v) => (v ? parseInt(String(v), 10) : 50), z.number().int().min(1).max(500)).optional(),
  }).optional(),
});

export const epinGenerateSchema = z.object({
  body: z.object({
    count: z.preprocess((v) => (v ? parseInt(String(v), 10) : 1), z.number().int().min(1).max(500)),
    schemeAmount: z.preprocess((v) => (v !== undefined ? Number(v) : undefined), z.number().positive().optional()),
    amount: z.preprocess((v) => (v !== undefined ? Number(v) : undefined), z.number().positive().optional()),
    schemeTypeId: z.string().optional(),
    schemeCode: z.string().optional(),
    poolId: z.string().optional(),
    slabCode: z.string().optional(),
    remarks: z.string().optional(),
  }).refine((data) => data.schemeAmount !== undefined || data.amount !== undefined, {
    message: "Either schemeAmount or amount is required and must be greater than 0",
  }),
});

export const epinAssignSchema = z.object({
  body: z.object({
    epinIds: z.array(z.string()).optional(),
    pinNumbers: z.array(z.string()).optional(),
    pinCodes: z.array(z.string()).optional(),
    agentId: z.string().uuid("agentId must be a valid UUID"),
    agentName: z.string().optional(),
    remarks: z.string().optional(),
  }).refine((data) => {
    const hasEpinIds = Array.isArray(data.epinIds) && data.epinIds.length > 0;
    const hasPinNumbers = Array.isArray(data.pinNumbers) && data.pinNumbers.length > 0;
    const hasPinCodes = Array.isArray(data.pinCodes) && data.pinCodes.length > 0;
    return hasEpinIds || hasPinNumbers || hasPinCodes;
  }, {
    message: "At least one E-PIN identifier (epinIds, pinNumbers, or pinCodes) must be provided",
  }),
});

export const epinValidateSchema = z.object({
  body: z.object({
    pinNumber: z.string().optional(),
    pinCode: z.string().optional(),
    agentId: z.string().uuid().optional(),
  }).refine((data) => Boolean(data.pinNumber || data.pinCode), {
    message: "pinNumber or pinCode is required",
  }),
});

export const epinConsumeSchema = z.object({
  body: z.object({
    pinNumber: z.string().optional(),
    pinCode: z.string().optional(),
    applicationId: z.string().min(1, "applicationId is required"),
    applicantName: z.string().optional(),
    module: z.string().optional(),
    remarks: z.string().optional(),
  }).refine((data) => Boolean(data.pinNumber || data.pinCode), {
    message: "pinNumber or pinCode is required",
  }),
});

export const epinBurnSchema = z.object({
  body: z.object({
    epinId: z.string().optional(),
    pinNumber: z.string().optional(),
    pinCode: z.string().optional(),
    reason: z.string().min(3, "reason is required (at least 3 characters)"),
  }).refine((data) => Boolean(data.epinId || data.pinNumber || data.pinCode), {
    message: "Either epinId, pinNumber, or pinCode is required",
  }),
});

export const epinAuditQuerySchema = z.object({
  query: z.object({
    epinId: z.string().optional(),
    pinNumber: z.string().optional(),
    pinCode: z.string().optional(),
    applicationId: z.string().optional(),
    agentId: z.string().optional(),
    page: z.preprocess((v) => (v ? parseInt(String(v), 10) : 1), z.number().int().min(1)).optional(),
    limit: z.preprocess((v) => (v ? parseInt(String(v), 10) : 50), z.number().int().min(1).max(500)).optional(),
  }).optional(),
});
