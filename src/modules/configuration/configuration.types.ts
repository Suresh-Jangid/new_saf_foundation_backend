export interface AppConfigData {
  appName: string;
  mobile: string;
  contactEmail?: string | null;
  address?: string | null;
  defaultDeductionPercent: number;
  status: string;
}

export interface ModuleRegistryItem {
  code: string;
  name: string;
  displayName: string;
  description?: string | null;
  isEnabled: boolean;
  sortOrder: number;
  parentModule?: string | null;
  permissions?: string[];
  status: string;
}

export interface SchemeMasterItem {
  code: string;
  name: string;
  moduleCode: string;
  description?: string | null;
  poolType: "FEMALE_POOL" | "MALE_POOL" | "UNIFIED_POOL" | string;
  deductionPercent: number;
  status: string;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
}

export interface SchemeTypeItem {
  code: string;
  name: string;
  amount: number;
  description?: string | null;
  status: string;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
}

export interface AgeSlabItem {
  slabCode: string;
  slabName: string;
  minAge: number;
  maxAge: number | null;
  joiningFee: number;
  installment: number;
  schemeType: string;
  status: string;
  displayOrder?: number;
}

export interface PoolConfigItem {
  code: string;
  name: string;
  gender?: "Male" | "Female" | "Other" | null;
  description?: string | null;
  status: string;
}

export interface AgeSlabResolutionResult {
  slabCode: string;
  slabName: string;
  minAge: number;
  maxAge: number | null;
  joiningFee: number;
  installment: number;
  schemeType: string;
}

export type EPinLifecycleStatus = "ACTIVE" | "ASSIGNED" | "USED" | "BURNT";

export interface EPinCreateInput {
  schemeCode: string;
  slabCode?: string | null;
  amount: number;
  count?: number;
  generatedById: string;
}

export interface EPinAssignInput {
  pinCodes: string[];
  assignedToId: string;
  performedById: string;
}

export interface EPinUseInput {
  pinCode: string;
  usedById: string;
  usedInModule: string;
  usedEntityId: string;
  expectedSchemeCode?: string;
  expectedAmount?: number;
}

export interface EPinBurnInput {
  pinCodes: string[];
  burntById: string;
  burnReason: string;
}
