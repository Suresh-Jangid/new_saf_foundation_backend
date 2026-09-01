import { PaymentMode, Gender, ApplicationCategory } from "@prisma/client";

export const DHUNDHOTSAV_MODULE_CODE = "DHUNDHOTSAV";
export const DHUNDHOTSAV_POOL = "MALE_POOL";
export const DHUNDHOTSAV_SCHEME_TYPE = "DHUNDHOTSAV";
export const DHUNDHOTSAV_MEMBERSHIP_FEE = 5100;
export const DHUNDHOTSAV_INSTALLMENT_AMOUNT = 300;
export const DHUNDHOTSAV_FORM_PREFIX = "DH";

export interface CreateDhundhotsavInput {
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
  paymentAmount?: number | null;
  paymentMode?: PaymentMode | string;
}

export interface UpdateDhundhotsavInput {
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

export interface DhundhotsavFilter {
  page?: number;
  limit?: number;
  search?: string;
  gender?: Gender | string;
  category?: ApplicationCategory | string;
  district?: string;
  tehsil?: string;
  startDate?: string;
  endDate?: string;
  addedById?: string;
}

export interface DhundhotsavInstallmentInput {
  amount: number;
  date: string | Date;
  note?: string | null;
  rashidNumber?: string | null;
  paymentMode?: PaymentMode | string;
}

export interface DhundhotsavFinancialSummary {
  membershipFee: number;
  installmentAmount: number;
  totalCollected: number;
  installmentCount: number;
  pending: number;
}

export interface DhundhotsavDetailResponse {
  id: string;
  srNo: number;
  formNumber: string;
  applicationDate: Date;
  applicantName: string;
  fatherName: string;
  husbandName: string | null;
  motherName: string | null;
  dateOfBirth: Date;
  age: number | null;
  aadharNumber: string;
  gotra: string;
  mobile: string;
  address: string;
  pinCode: string;
  tehsil: string;
  district: string;
  state: string;
  nomineeName: string | null;
  nomineeRelation: string | null;
  nomineeMobile: string | null;
  nomineeAadhar: string | null;
  passportPhotoUrl: string | null;
  affidavitUrl: string | null;
  gender: Gender;
  category: ApplicationCategory;
  schemeType: string;
  pool: string;
  membershipFee: number;
  epinCode: string | null;
  isActive: boolean;
  addedById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  installments: Array<{
    id: string;
    amount: number;
    date: Date;
    note: string | null;
    rashidNumber: string | null;
    paymentMode: PaymentMode;
    addedById: string;
    createdAt: Date;
  }>;
  financialSummary: DhundhotsavFinancialSummary;
}
