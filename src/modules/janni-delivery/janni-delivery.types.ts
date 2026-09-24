import { ApplicationCategory, Gender, PaymentMode } from "@prisma/client";

export interface CreateJanniDeliveryInput {
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
  childName?: string | null;
  childGender?: Gender | null;
  deliveryDate?: Date | string | null;
  hospitalName?: string | null;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  nomineeMobile?: string | null;
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
  offlineFormNumber?: string | null;
  offline_form_number?: string | null;
  offlineFormNo?: string | null;
  nomineeAadhar?: string | null;
  nominee_aadhar?: string | null;
  nomineeAadhaar?: string | null;
  nomineePhotoUrl?: string | null;
  nominee_photo_url?: string | null;
  nomineePhoto?: string | null;
  nomineePassportPhoto?: string | null;
}

export interface UpdateJanniDeliveryInput {
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
  childName?: string | null;
  childGender?: Gender | null;
  deliveryDate?: Date | string | null;
  hospitalName?: string | null;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  nomineeMobile?: string | null;
  nomineeAadhar?: string | null;
  nominee_aadhar?: string | null;
  nomineeAadhaar?: string | null;
  nomineePhotoUrl?: string | null;
  nominee_photo_url?: string | null;
  nomineePhoto?: string | null;
  nomineePassportPhoto?: string | null;
  offlineFormNumber?: string | null;
  offline_form_number?: string | null;
  offlineFormNo?: string | null;
  passportPhotoUrl?: string | null;
  affidavitUrl?: string | null;
  gender?: Gender;
  category?: ApplicationCategory;
  totalAmount?: number;
  pendingAmount?: number;
  selectedAgentId?: string | null;
  addedById?: string | null;
  agentId?: string | null;
  addedby_id?: string | null;
}

export interface JanniDeliveryFilter {
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

export interface JanniDeliveryInstallmentInput {
  amount: number;
  date: Date | string;
  note?: string | null;
  rashidNumber?: string | null;
  paymentMode?: PaymentMode;
}
