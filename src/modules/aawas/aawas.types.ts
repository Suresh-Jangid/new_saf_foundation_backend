import { ApplicationCategory, Gender, PaymentMode } from "@prisma/client";

export const AAWAS_TOTAL_BENEFIT = 15000;
export const AAWAS_INSTALLMENT_AMOUNT = 1000;
export const AAWAS_SCHEME_NAME = "गृह प्रवेश आवास योजना";
export const AAWAS_FORM_PREFIX = "AW";

export interface CreateAawasInput {
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
  gender?: Gender;
  category?: ApplicationCategory;
  totalAmount?: number;
  paymentAmount?: number;
  paymentMode?: PaymentMode;
  selectedAgentId?: string;
  epinCode?: string | null;
  pinNumber?: string | null;
}

export interface UpdateAawasInput {
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
  gender?: Gender;
  category?: ApplicationCategory;
  totalAmount?: number;
  pendingAmount?: number;
}

export interface AawasFilter {
  page?: number;
  limit?: number;
  search?: string;
  agentId?: string;
  district?: string;
  tehsil?: string;
  gotra?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
}

export interface AawasInstallmentInput {
  amount: number;
  date: Date | string;
  note?: string | null;
  rashidNumber?: string | null;
  paymentMode?: PaymentMode;
}
