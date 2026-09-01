import { ApplicationCategory, Gender, PaymentMode } from "@prisma/client";

export const SHUBH_LAXMI_MODULE_CODE = "SHUBH_LAXMI";
export const SHUBH_LAXMI_PERMISSION_KEY = "shubh_laxmi";
export const SHUBH_LAXMI_SCHEME_TYPE = "SHUBH_LAXMI";
export const SHUBH_LAXMI_POOL = "UNIFIED_POOL";
export const SHUBH_LAXMI_FORM_PREFIX = "SL";
export const SHUBH_LAXMI_MEMBERSHIP_FEE = 3100;
export const SHUBH_LAXMI_INSTALLMENT_AMOUNT = 300;
export const SHUBH_LAXMI_DEDUCTION_PERCENT = 20;
export const SHUBH_LAXMI_BENEFIT_MATURITY_MONTHS = 12;
export const SHUBH_LAXMI_MAX_CONSECUTIVE_MISSED_INSTALLMENTS = 3;
export const SHUBH_LAXMI_SCHEME_DURATION_NOTE = "यह योजना दीपावली तक ही रहेगी";

export interface CreateShubhLaxmiInput {
  applicationDate: Date | string;
  applicantName: string;
  fatherName: string;
  husbandName?: string | null;
  motherName?: string | null;
  dateOfBirth: Date | string;
  age?: number | null;
  aadharNumber: string;
  gotra: string;
  mobile: string;
  address: string;
  pinCode: string;
  tehsil: string;
  district: string;
  state?: string;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  nomineeMobile?: string | null;
  nomineeAadhar?: string | null;
  passportPhotoUrl?: string | null;
  affidavitUrl?: string | null;
  gender?: Gender | string;
  category?: ApplicationCategory | string;
  schemeType?: string;
  pool?: string;
  membershipFee?: number;
  paymentAmount?: number;
  paymentMode?: PaymentMode | string;
  selectedAgentId?: string;
  epinCode?: string | null;
  pinNumber?: string | null;
  note?: string | null;
}

export interface UpdateShubhLaxmiInput {
  applicantName?: string;
  fatherName?: string;
  husbandName?: string | null;
  motherName?: string | null;
  dateOfBirth?: Date | string;
  age?: number | null;
  gotra?: string;
  mobile?: string;
  address?: string;
  pinCode?: string;
  tehsil?: string;
  district?: string;
  state?: string;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  nomineeMobile?: string | null;
  nomineeAadhar?: string | null;
  passportPhotoUrl?: string | null;
  affidavitUrl?: string | null;
  gender?: Gender | string;
  category?: ApplicationCategory | string;
}

export interface ShubhLaxmiInstallmentInput {
  amount: number;
  date: Date | string;
  note?: string | null;
  rashidNumber?: string | null;
  paymentMode?: PaymentMode | string;
}

export interface ShubhLaxmiFilter {
  page?: number | string;
  limit?: number | string;
  search?: string;
  district?: string;
  tehsil?: string;
  gender?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  agentId?: string;
}

export interface ShubhLaxmiFinancialSummary {
  membershipFee: number;
  installmentAmount: number;
  totalCollected: number;
  installmentCount: number;
  pending: number;
  deductionPercent: number;
  benefitMaturityMonths: number;
  maxConsecutiveMissedInstallments: number;
  membershipStatus: "ACTIVE" | "TERMINATION_WARNING" | "TERMINATED";
  consecutiveMissedInstallments: number;
  schemeDurationNote: string;
}
