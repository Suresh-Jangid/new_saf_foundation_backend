export type EPinLifecycleStatus = "ACTIVE" | "ASSIGNED" | "USED" | "BURNT";

export interface EPinInventoryFilter {
  pinNumber?: string;
  pinCode?: string;
  batchNumber?: string;
  status?: EPinLifecycleStatus;
  schemeTypeId?: string;
  schemeCode?: string;
  poolId?: string;
  slabCode?: string;
  assignedAgentId?: string;
  agentId?: string;
  page?: number;
  limit?: number;
}

export interface EPinGenerateInput {
  count: number;
  schemeAmount?: number;
  amount?: number;
  schemeTypeId?: string;
  schemeCode?: string;
  poolId?: string;
  slabCode?: string;
  remarks?: string;
  generatedById: string;
}

export interface EPinAssignInput {
  epinIds?: string[];
  pinNumbers?: string[];
  pinCodes?: string[];
  agentId: string;
  agentName?: string;
  remarks?: string;
  performedById: string;
}

export interface EPinValidateInput {
  pinNumber?: string;
  pinCode?: string;
  agentId?: string;
}

export interface EPinConsumeInput {
  pinNumber?: string;
  pinCode?: string;
  applicationId: string;
  applicantName?: string;
  module?: string;
  remarks?: string;
  usedById: string;
}

export interface EPinBurnInput {
  epinId?: string;
  pinNumber?: string;
  pinCode?: string;
  reason: string;
  burntById: string;
}

export interface EPinAuditQueryInput {
  epinId?: string;
  pinNumber?: string;
  pinCode?: string;
  applicationId?: string;
  agentId?: string;
  page?: number;
  limit?: number;
}
