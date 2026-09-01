import { LadoBahinAccountType, PaymentMode, Gender, ApplicationCategory } from "@prisma/client";

export const LADO_BAHIN_MODULE_CODE = "LADO_BAHIN";
export const LADO_BAHIN_POOL = "FEMALE_POOL";
export const LADO_BAHIN_SCHEME_TYPE = "LADO_BAHIN";
export const LADO_BAHIN_MEMBERSHIP_FEE = 5100;
export const LADO_BAHIN_FORM_PREFIX = "LB";

export const LADO_BAHIN_ACCOUNT_AMOUNTS: Record<LadoBahinAccountType, number> = {
  LADO_BAHIN_300: 300,
  LADO_BAHIN_1000: 1000,
};

export interface CreateLadoBahinInput {
  applicationDate: string | Date;
  applicantName: string;
  fatherName: string;
  husbandName?: string | null;
  motherName?: string | null;
  dateOfBirth: string | Date;
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
  epinCode?: string | null;
  pinNumber?: string | null;
  selectedAgentId?: string | null;
  initialAccountType?: LadoBahinAccountType | string | null;
  paymentAmount?: number | null;
  paymentMode?: PaymentMode | string;
}

export interface UpdateLadoBahinInput {
  applicantName?: string;
  fatherName?: string;
  husbandName?: string | null;
  motherName?: string | null;
  dateOfBirth?: string | Date;
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

export interface LadoBahinInstallmentInput {
  accountType: LadoBahinAccountType | string;
  amount: number;
  date: string | Date;
  note?: string | null;
  rashidNumber?: string | null;
  paymentMode?: PaymentMode | string;
}

export interface LadoBahinFilter {
  page?: number;
  limit?: number;
  search?: string;
  district?: string;
  tehsil?: string;
  gotra?: string;
  category?: ApplicationCategory | string;
  schemeType?: string;
  accountType?: LadoBahinAccountType | string;
  startDate?: string;
  endDate?: string;
  agentId?: string;
}

export interface LadoBahinAccountSummary {
  accountType: LadoBahinAccountType;
  installmentAmount: number;
  totalCollected: number;
  installmentCount: number;
  pending: number;
}

export interface LadoBahinFinancialSummary {
  membershipFee: number;
  account300: LadoBahinAccountSummary;
  account1000: LadoBahinAccountSummary;
}
