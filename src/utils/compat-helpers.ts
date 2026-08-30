type FieldMapping = {
  key: string;
  transform?: (value: unknown) => unknown;
};

export const isValidUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function buildUpdateData(
  payload: Record<string, unknown>,
  mappings: FieldMapping[]
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};

  for (const { key, transform } of mappings) {
    if (payload[key] === undefined || payload[key] === null || payload[key] === "") {
      continue;
    }

    const value = transform ? transform(payload[key]) : payload[key];
    if (value === undefined || (typeof value === "number" && Number.isNaN(value))) {
      continue;
    }

    updateData[key] = value;
  }

  return updateData;
}

export async function applyPartialUpdate<T extends { deletedAt?: Date | null }>(
  delegate: {
    findUnique: (args: { where: { id: string } }) => Promise<T | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<T>;
  },
  id: string,
  updateData: Record<string, unknown>,
  entityLabel: string
): Promise<{ ok: true; data: T; message: string } | { ok: false; message: string }> {
  const existing = await delegate.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    return { ok: false, message: `${entityLabel} not found` };
  }

  if (Object.keys(updateData).length === 0) {
    return {
      ok: true,
      data: existing,
      message: `${entityLabel} updated successfully`,
    };
  }

  const data = await delegate.update({ where: { id }, data: updateData });
  return { ok: true, data, message: `${entityLabel} updated successfully` };
}

export function resolvePayerApplicationWhere(
  applicationId: unknown
): Array<{ formNumber: string } | { id: string }> | null {
  if (applicationId === undefined || applicationId === null || applicationId === "") {
    return null;
  }

  const id = String(applicationId);
  const conditions: Array<{ formNumber: string } | { id: string }> = [{ formNumber: id }];
  if (isValidUuid(id)) {
    conditions.push({ id });
  }
  return conditions;
}

function calculateAgeFromDateOfBirth(dateOfBirth: unknown): string {
  if (!dateOfBirth) return "";
  const birth = new Date(String(dateOfBirth));
  if (Number.isNaN(birth.getTime())) return "";

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return String(Math.max(age, 0));
}

/** Latest (by date) installment out of an array in either sort order, or undefined if empty. */
function latestInstallment(installments: unknown): Record<string, any> | undefined {
  if (!Array.isArray(installments) || installments.length === 0) return undefined;
  return installments.reduce((latest, current) =>
    new Date(current.date).getTime() > new Date(latest.date).getTime() ? current : latest
  );
}

/** Map Prisma general application rows to legacy PHP field names expected by the admin UI. */
export function mapGeneralApplicationRecord(app: Record<string, any>) {
  const addedBy = app.addedBy || {};
  const isActive = app.isActive === true || app.isActive === 1 || app.is_active === 1;
  const totalAmount = app.totalAmount !== undefined && app.totalAmount !== null ? Number(app.totalAmount) : null;
  const pendingAmount = app.pendingAmount !== undefined && app.pendingAmount !== null ? Number(app.pendingAmount) : null;
  const lastInstallment = latestInstallment(app.installments);

  return {
    ...app,
    paymentAmount: totalAmount !== null && pendingAmount !== null ? totalAmount - pendingAmount : null,
    paymentMode: lastInstallment?.paymentMode ?? null,
    paymentDate: lastInstallment?.date ?? null,
    form_number: app.formNumber ?? app.form_number,
    application_date: app.applicationDate ?? app.application_date,
    applicant_name: app.applicantName ?? app.applicant_name,
    father_name: app.fatherName ?? app.father_name,
    mother_name: app.motherName ?? app.mother_name,
    date_of_birth: app.dateOfBirth ?? app.date_of_birth,
    aadhar_number: app.aadharNumber ?? app.aadhar_number,
    pin_code: app.pinCode ?? app.pin_code,
    nominee_name: app.nomineeName ?? app.nominee_name,
    nominee_relation: app.nomineeRelation ?? app.nominee_relation,
    passport_photo: app.passportPhotoUrl ?? app.passport_photo ?? app.passportPhoto,
    passportPhoto: app.passportPhotoUrl ?? app.passportPhoto ?? app.passport_photo,
    affidavit: app.affidavitUrl ?? app.affidavit,
    age: app.age ?? calculateAgeFromDateOfBirth(app.dateOfBirth ?? app.date_of_birth),
    is_active: isActive ? 1 : 0,
    isActive,
    added_name: app.added_name ?? addedBy.name ?? "",
    added_mobile: app.added_mobile ?? addedBy.mobile ?? "",
    workerName: app.workerName ?? addedBy.name ?? "",
    workerMobile: app.workerMobile ?? addedBy.mobile ?? "",
    addedby_id: app.addedById ?? app.addedby_id,
  };
}

export function mapGeneralApplicationList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapGeneralApplicationRecord(record as Record<string, any>));
}

/** Map Prisma mayra registration rows to legacy PHP field names expected by the admin UI. */
export function mapMayraApplicationRecord(reg: Record<string, any>) {
  const addedBy = reg.addedBy || {};
  const isActive = reg.isActive === true || reg.isActive === 1 || reg.is_active === 1;
  const passportPhoto =
    reg.passportPhotoUrl ?? reg.passportPhoto ?? reg.passport_photo ?? "";
  const nomineePhoto =
    reg.nomineePhotoUrl ??
    reg.nomineePassportPhoto ??
    reg.nomineePhoto ??
    reg.nominee_photo ??
    "";

  // MayraRegistration has no totalAmount/paymentAmount/pendingAmount columns
  // (unlike GeneralApplication) — the one-time fee owed is the age-slab
  // joiningFee, and what's actually been paid lives in the installments relation.
  const installments = Array.isArray(reg.installments) ? reg.installments : [];
  const paymentAmount = installments.reduce((sum, inst) => sum + Number(inst.amount || 0), 0);
  const totalAmount = Number(reg.joiningFee || 0);
  const pendingAmount = totalAmount - paymentAmount;
  const lastInstallment = latestInstallment(installments);

  return {
    ...reg,
    totalAmount,
    paymentAmount,
    pendingAmount,
    paymentMode: lastInstallment?.paymentMode ?? null,
    paymentDate: lastInstallment?.date ?? null,
    form_number: reg.formNumber ?? reg.form_number,
    formNumber: reg.formNumber ?? reg.form_number,
    sr_no: reg.srNo ?? reg.sr_no,
    application_date: reg.applicationDate ?? reg.application_date,
    applicant_name: reg.applicantName ?? reg.applicant_name,
    father_name: reg.fatherName ?? reg.father_name,
    mother_name: reg.motherName ?? reg.mother_name,
    date_of_birth: reg.dateOfBirth ?? reg.date_of_birth,
    aadhar_number: reg.aadharNumber ?? reg.aadhar_number,
    pin_code: reg.pinCode ?? reg.pin_code,
    nominee_name: reg.nomineeName ?? reg.nominee_name,
    nominee_father_name: reg.nomineeFatherName ?? reg.nominee_father_name,
    nominee_relation: reg.nomineeRelation ?? reg.nominee_relation,
    passport_photo: passportPhoto,
    passportPhoto,
    passportPhotoUrl: reg.passportPhotoUrl ?? passportPhoto,
    nominee_photo: nomineePhoto,
    nomineePhoto: nomineePhoto,
    nomineePassportPhoto: nomineePhoto,
    nomineePhotoUrl: reg.nomineePhotoUrl ?? nomineePhoto,
    age: reg.age ?? calculateAgeFromDateOfBirth(reg.dateOfBirth ?? reg.date_of_birth),
    is_active: isActive ? 1 : 0,
    isActive,
    added_name: reg.added_name ?? addedBy.name ?? "",
    added_mobile: reg.added_mobile ?? addedBy.mobile ?? "",
    workerName: reg.workerName ?? addedBy.name ?? "",
    workerMobile: reg.workerMobile ?? addedBy.mobile ?? "",
    addedby_id: reg.addedById ?? reg.addedby_id,
    addedById: reg.addedById ?? reg.addedby_id,
  };
}

export function mapMayraApplicationList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapMayraApplicationRecord(record as Record<string, any>));
}

/** Map Prisma insurance application rows to legacy field names expected by the admin UI. */
export function mapInsuranceApplicationRecord(app: Record<string, any>) {
  const addedBy = app.addedBy || {};
  const isActive = app.isActive === true || app.isActive === 1 || app.is_active === 1;
  const installments = Array.isArray(app.installments) ? app.installments : [];
  const firstInstallment = installments[0] || {};
  const passportPhoto =
    app.passportPhotoUrl ?? app.passport_photo ?? app.passportPhoto ?? "";

  return {
    ...app,
    form_number: app.formNumber ?? app.form_number,
    formNumber: app.formNumber ?? app.form_number,
    application_date: app.applicationDate ?? app.application_date,
    applicationDate: app.applicationDate ?? app.application_date,
    applicant_name: app.applicantName ?? app.applicant_name,
    applicantName: app.applicantName ?? app.applicant_name,
    father_name: app.fatherName ?? app.father_name,
    fatherName: app.fatherName ?? app.father_name,
    wife_name: app.wifeName ?? app.wife_name,
    wifeName: app.wifeName ?? app.wife_name,
    mother_name: app.motherName ?? app.mother_name,
    motherName: app.motherName ?? app.mother_name,
    date_of_birth: app.dateOfBirth ?? app.date_of_birth,
    dateOfBirth: app.dateOfBirth ?? app.date_of_birth,
    aadhar_number: app.aadharNumber ?? app.aadhar_number,
    aadharNumber: app.aadharNumber ?? app.aadhar_number,
    pin_code: app.pinCode ?? app.pin_code,
    pinCode: app.pinCode ?? app.pin_code,
    nominee_name: app.nomineeName ?? app.nominee_name,
    nomineeName: app.nomineeName ?? app.nominee_name,
    nominee_relation: app.nomineeRelation ?? app.nominee_relation,
    nomineeRelation: app.nomineeRelation ?? app.nominee_relation,
    passport_photo: passportPhoto,
    passportPhoto,
    passportPhotoUrl: app.passportPhotoUrl ?? passportPhoto,
    affidavit: app.affidavitUrl ?? app.affidavit ?? "",
    age: app.age ?? calculateAgeFromDateOfBirth(app.dateOfBirth ?? app.date_of_birth),
    is_active: isActive ? 1 : 0,
    isActive,
    added_name: app.added_name ?? addedBy.name ?? "",
    added_mobile: app.added_mobile ?? addedBy.mobile ?? "",
    workerName: app.workerName ?? addedBy.name ?? "",
    workerMobile: app.workerMobile ?? addedBy.mobile ?? "",
    addedby_id: app.addedById ?? app.addedby_id ?? addedBy.id,
    addedById: app.addedById ?? app.addedby_id ?? addedBy.id,
    payment_amount: firstInstallment.amount ?? app.payment_amount ?? app.paymentAmount,
    paymentAmount: String(
      firstInstallment.amount ?? app.paymentAmount ?? app.payment_amount ?? ""
    ),
    payment_mode: firstInstallment.paymentMode ?? app.payment_mode ?? app.paymentMode,
    paymentMode: firstInstallment.paymentMode ?? app.paymentMode ?? app.payment_mode ?? "",
    payment_date: firstInstallment.date ?? app.payment_date ?? app.paymentDate,
    paymentDate: firstInstallment.date ?? app.paymentDate ?? app.payment_date ?? "",
    total_amount: app.totalAmount ?? app.total_amount,
    totalAmount: app.totalAmount ?? app.total_amount,
    pending_amount: app.pendingAmount ?? app.pending_amount,
    pendingAmount: app.pendingAmount ?? app.pending_amount,
  };
}

export function mapInsuranceApplicationList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapInsuranceApplicationRecord(record as Record<string, any>));
}

/** Map Prisma mayra congratulations rows to legacy field names expected by the admin UI. */
export function mapMayraCongratulationsRecord(record: Record<string, any>) {
  const reg = record.mayraRegistration || {};
  const addedBy = record.addedBy || {};
  const formNumber =
    reg.formNumber ??
    reg.form_number ??
    record.formNumber ??
    record.form_number ??
    record.codeNumber ??
    "";

  return {
    ...record,
    formNumber,
    form_number: formNumber,
    mayra_id: record.mayraRegistrationId ?? record.mayra_id ?? reg.id ?? "",
    payment_status: record.paymentStatus ?? record.payment_status ?? 0,
    added_name: record.added_name ?? addedBy.name ?? "",
    codeNumber: record.codeNumber || formNumber,
  };
}

export function mapMayraCongratulationsList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapMayraCongratulationsRecord(record as Record<string, any>));
}

function formatCompatDate(value: unknown): string {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [year, month, day] = raw.split("T")[0].split("-");
    return `${day}-${month}-${year}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

/** Map Prisma suraksha bima rows to legacy field names expected by the admin UI. */
export function mapSurakshaBimaRecord(record: Record<string, any>) {
  const insuranceApp = record.insuranceApplication || {};
  const deducted10 = Number(record.deducted10Percent ?? record.deducted_10_percent ?? 0);
  const deducted25 = Number(record.deducted25Percent ?? record.deducted_25_percent ?? 0);
  const deductionPercent =
    deducted25 > 0 ? "25" : deducted10 > 0 ? "10" : String(record.deductionPercent ?? "10");
  const deductionAmount = deducted25 > 0 ? deducted25 : deducted10;
  const gender = record.gender ?? insuranceApp.gender ?? "";

  return {
    ...record,
    date: formatCompatDate(record.date),
    code_number: record.codeNumber ?? record.code_number,
    codeNumber: record.codeNumber ?? record.code_number ?? "",
    bima_number: record.bimaNumber ?? record.bima_number,
    bimaNumber: record.bimaNumber ?? record.bima_number ?? "",
    applicant_name: record.applicantName ?? record.applicant_name,
    applicantName: record.applicantName ?? record.applicant_name ?? "",
    father_name: record.fatherName || insuranceApp.fatherName || record.father_name || "",
    fatherName: record.fatherName || insuranceApp.fatherName || record.father_name || "",
    wife_of: record.wifeOf ?? record.wife_of,
    wifeOf: record.wifeOf ?? record.wife_of ?? "",
    membership_join_date: record.membershipJoinDate ?? record.membership_join_date,
    membershipJoinDate: formatCompatDate(record.membershipJoinDate ?? record.membership_join_date),
    associated_until: record.associatedUntil ?? record.associated_until,
    associatedUntil: formatCompatDate(record.associatedUntil ?? record.associated_until),
    permanent_fee: record.permanentFee ?? record.permanent_fee,
    permanentFee: String(record.permanentFee ?? record.permanent_fee ?? ""),
    installment_amount: record.installmentAmount ?? record.installment_amount,
    installmentAmount: String(record.installmentAmount ?? record.installment_amount ?? ""),
    total_grant_amount: record.totalGrantAmount ?? record.total_grant_amount,
    totalGrantAmount: String(record.totalGrantAmount ?? record.total_grant_amount ?? ""),
    total_members_serving: record.totalMembersServing ?? record.total_members_serving,
    totalMembersServing: String(record.totalMembersServing ?? record.total_members_serving ?? ""),
    rate_200: record.rate200 ?? record.rate_200,
    rate200: String(record.rate200 ?? record.rate_200 ?? ""),
    deducted_10_percent: deducted10,
    deducted10Percent: String(deducted10),
    deducted_25_percent: deducted25,
    deducted25Percent: String(deducted25),
    total_paid_amount: record.totalPaidAmount ?? record.total_paid_amount,
    totalPaidAmount: String(record.totalPaidAmount ?? record.total_paid_amount ?? ""),
    deductionPercent,
    deductionAmount: String(deductionAmount),
    gender,
    insurance_application_id:
      record.insuranceApplicationId ?? record.insurance_application_id ?? insuranceApp.id ?? "",
    insuranceApplicationId:
      record.insuranceApplicationId ?? record.insurance_application_id ?? insuranceApp.id ?? "",
    created_at: record.createdAt ?? record.created_at,
    createdAt: record.createdAt ?? record.created_at,
  };
}

export function mapSurakshaBimaList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapSurakshaBimaRecord(record as Record<string, any>));
}

/** Map Prisma disability cycle rows to legacy field names expected by the admin UI. */
export function mapDisabilityCycleRecord(record: Record<string, any>) {
  return {
    ...record,
    form_number: record.formNumber ?? record.form_number,
    formNumber: record.formNumber ?? record.form_number ?? "",
    application_date: record.applicationDate ?? record.application_date,
    applicationDate: formatCompatDate(record.applicationDate ?? record.application_date),
    applicant_name: record.applicantName ?? record.applicant_name,
    applicantName: record.applicantName ?? record.applicant_name ?? "",
    father_name: record.fatherName ?? record.father_name,
    fatherName: record.fatherName ?? record.father_name ?? "",
    mother_name: record.motherName ?? record.mother_name,
    motherName: record.motherName ?? record.mother_name ?? "",
    date_of_birth: record.dateOfBirth ?? record.date_of_birth,
    dateOfBirth: formatCompatDate(record.dateOfBirth ?? record.date_of_birth),
    aadhar_number: record.aadharNumber ?? record.aadhar_number,
    aadharNumber: record.aadharNumber ?? record.aadhar_number ?? "",
    pin_code: record.pinCode ?? record.pin_code,
    pinCode: record.pinCode ?? record.pin_code ?? "",
    age: String(record.age ?? ""),
    mobile: record.mobile ?? "",
    photo_url: record.photoUrl ?? record.photo_url ?? record.photo ?? "",
    photoUrl: record.photoUrl ?? record.photo_url ?? record.photo ?? "",
    photo: record.photoUrl ?? record.photo_url ?? record.photo ?? "",
    created_at: record.createdAt ?? record.created_at,
    createdAt: formatCompatDate(record.createdAt ?? record.created_at),
  };
}

export function mapDisabilityCycleList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapDisabilityCycleRecord(record as Record<string, any>));
}

/** Map Prisma sewing machine camp rows to legacy field names expected by the admin UI. */
export function mapSewingMachineCampRecord(record: Record<string, any>) {
  const passportPhoto =
    record.passportPhotoUrl ?? record.passport_photo ?? record.passportPhoto ?? "";

  return {
    ...record,
    camp_number: record.campNumber ?? record.camp_number,
    campNumber: record.campNumber ?? record.camp_number ?? "",
    form_number: record.formNumber ?? record.form_number,
    formNumber: record.formNumber ?? record.form_number ?? "",
    application_date: record.applicationDate ?? record.application_date,
    applicationDate: formatCompatDate(record.applicationDate ?? record.application_date),
    applicant_name: record.applicantName ?? record.applicant_name,
    applicantName: record.applicantName ?? record.applicant_name ?? "",
    father_name: record.fatherName ?? record.father_name,
    fatherName: record.fatherName ?? record.father_name ?? "",
    mother_name: record.motherName ?? record.mother_name,
    motherName: record.motherName ?? record.mother_name ?? "",
    date_of_birth: record.dateOfBirth ?? record.date_of_birth,
    dateOfBirth: formatCompatDate(record.dateOfBirth ?? record.date_of_birth),
    aadhar_number: record.aadharNumber ?? record.aadhar_number,
    aadharNumber: record.aadharNumber ?? record.aadhar_number ?? "",
    pin_code: record.pinCode ?? record.pin_code,
    pinCode: record.pinCode ?? record.pin_code ?? "",
    age: String(record.age ?? ""),
    mobile: record.mobile ?? "",
    passport_photo: passportPhoto,
    passportPhoto,
    passportPhotoUrl: record.passportPhotoUrl ?? passportPhoto,
    created_at: record.createdAt ?? record.created_at,
    createdAt: formatCompatDate(record.createdAt ?? record.created_at),
  };
}

export function mapSewingMachineCampList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapSewingMachineCampRecord(record as Record<string, any>));
}

/** Map Prisma pension yojana rows to legacy field names expected by the admin UI. */
export function mapPensionYojanaRecord(record: Record<string, any>) {
  const photoUrl = record.photoUrl ?? record.photo_url ?? record.photo ?? "";
  const dob = record.dateOfBirth ?? record.dob ?? record.date_of_birth;

  return {
    ...record,
    form_number: record.formNumber ?? record.form_number ?? "",
    formNumber: record.formNumber ?? record.form_number ?? "",
    date: formatCompatDate(record.date),
    dob: formatCompatDate(dob),
    dateOfBirth: formatCompatDate(dob),
    date_of_birth: dob,
    father_name: record.fatherName ?? record.father_name,
    fatherName: record.fatherName ?? record.father_name ?? "",
    age: String(record.age ?? ""),
    photo_url: photoUrl,
    photoUrl,
    photo: photoUrl,
    bank_name: record.bankName ?? record.bank_name,
    bankName: record.bankName ?? record.bank_name ?? "",
    account_number: record.accountNumber ?? record.account_number,
    accountNumber: record.accountNumber ?? record.account_number ?? "",
    ifsc_code: record.ifscCode ?? record.ifsc_code,
    ifscCode: record.ifscCode ?? record.ifsc_code ?? "",
    monthly_pension: record.monthlyPension ?? record.monthly_pension,
    monthlyPension: String(record.monthlyPension ?? record.monthly_pension ?? ""),
    created_at: record.createdAt ?? record.created_at,
    createdAt: formatCompatDate(record.createdAt ?? record.created_at),
  };
}

export function mapPensionYojanaList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapPensionYojanaRecord(record as Record<string, any>));
}

/** Map Prisma loan application rows to legacy field names expected by the admin UI. */
export function mapLoanApplicationRecord(record: Record<string, any>) {
  const aadhaar = record.aadhaarUrl ?? record.aadhaar ?? record.aadhaar_url ?? "";
  const incomeCertificate =
    record.incomeCertificateUrl ?? record.incomeCertificate ?? record.income_certificate ?? "";
  const moolNiwas = record.moolNiwasUrl ?? record.moolNiwas ?? record.mool_niwas ?? "";
  const photo = record.photoUrl ?? record.photo ?? record.photo_url ?? "";
  // "Paid Amount" in the payment-management list is what the borrower has
  // repaid so far, not what the foundation disbursed — sum USER_REPAYMENT
  // installments only.
  const totalPaidAmount = Array.isArray(record.installments)
    ? record.installments
        .filter((i: any) => String(i.type).toUpperCase() === "USER_REPAYMENT")
        .reduce((sum: number, i: any) => sum + Number(i.amount || 0), 0)
    : undefined;

  return {
    ...record,
    ...(totalPaidAmount !== undefined ? { totalPaidAmount } : {}),
    form_number: record.formNumber ?? record.form_number ?? "",
    formNumber: record.formNumber ?? record.form_number ?? "",
    date: formatCompatDate(record.date),
    applicant_name: record.applicantName ?? record.applicant_name,
    applicantName: record.applicantName ?? record.applicant_name ?? "",
    father_name: record.fatherName ?? record.father_name,
    fatherName: record.fatherName ?? record.father_name ?? "",
    mother_name: record.motherName ?? record.mother_name,
    motherName: record.motherName ?? record.mother_name ?? "",
    aadhaar,
    aadhaarUrl: aadhaar,
    aadhaar_url: aadhaar,
    incomeCertificate,
    incomeCertificateUrl: incomeCertificate,
    income_certificate: incomeCertificate,
    moolNiwas,
    moolNiwasUrl: moolNiwas,
    mool_niwas: moolNiwas,
    photo,
    photoUrl: photo,
    photo_url: photo,
    created_at: record.createdAt ?? record.created_at,
    createdAt: formatCompatDate(record.createdAt ?? record.created_at),
  };
}

export function mapLoanApplicationList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapLoanApplicationRecord(record as Record<string, any>));
}

/** Map Prisma financial help rows to legacy field names expected by the admin UI. */
export function mapFinancialHelpRecord(record: Record<string, any>) {
  const gotra = record.gotra ?? record.address ?? "";
  const gender = record.gender ?? "";

  return {
    ...record,
    form_number: record.formNumber ?? record.form_number ?? "",
    formNumber: record.formNumber ?? record.form_number ?? "",
    date: formatCompatDate(record.date),
    father_name: record.fatherName ?? record.father_name,
    fatherName: record.fatherName ?? record.father_name ?? "",
    gotra,
    address: record.address ?? gotra,
    donated_amount: record.donatedAmount ?? record.donated_amount,
    donatedAmount: String(record.donatedAmount ?? record.donated_amount ?? ""),
    gender: typeof gender === "string" ? gender : String(gender),
    created_at: record.createdAt ?? record.created_at,
    createdAt: formatCompatDate(record.createdAt ?? record.created_at),
  };
}

export function mapFinancialHelpList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapFinancialHelpRecord(record as Record<string, any>));
}

/** Map Prisma user + agentProfile rows to legacy field names expected by the admin UI. */
export function mapAgentRecord(record: Record<string, any>) {
  if (!record || typeof record !== "object") return record;

  const profile = record.agentProfile ?? record.agent_profile ?? {};

  return {
    id: record.id ?? "",
    date: formatCompatDate(
      profile.registrationDate ??
        profile.registration_date ??
        record.date ??
        record.createdAt ??
        record.created_at,
    ),
    employee_id: profile.employeeId ?? profile.employee_id ?? record.employee_id ?? "",
    name: record.name ?? "",
    fatherName: profile.fatherName ?? profile.father_name ?? "",
    gotra: profile.gotra ?? "",
    age: String(profile.age ?? record.age ?? ""),
    village: profile.village ?? "",
    address: profile.address ?? "",
    tehsil: profile.tehsil ?? "",
    district: profile.district ?? "",
    mobile: record.mobile ?? "",
    aadhaar: profile.aadhaar ?? record.aadhaar ?? "",
    bankName: profile.bankName ?? profile.bank_name ?? "",
    accountNumber: profile.accountNumber ?? profile.account_number ?? "",
    ifsc: profile.ifscCode ?? profile.ifsc_code ?? profile.ifsc ?? record.ifsc ?? "",
    nomineeName: profile.nomineeName ?? profile.nominee_name ?? "",
    nomineeMobile: profile.nomineeMobile ?? profile.nominee_mobile ?? "",
    nomineeRelation: profile.nomineeRelation ?? profile.nominee_relation ?? "",
    workArea: profile.workArea ?? profile.work_area ?? "",
    gender: profile.gender ?? record.gender ?? "",
    dateOfBirth: formatCompatDate(profile.dateOfBirth ?? profile.date_of_birth ?? record.dateOfBirth),
    doj: formatCompatDate(profile.dateOfJoining ?? profile.date_of_joining ?? profile.doj ?? record.doj),
    designation: profile.designation ?? record.designation ?? "",
    profile_image:
      profile.profileImageUrl ?? profile.profile_image_url ?? profile.profile_image ?? record.profile_image ?? "",
    createdAt: formatCompatDate(record.createdAt ?? record.created_at),
  };
}

export function mapAgentList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapAgentRecord(record as Record<string, any>));
}

export function mapMarriageCongratulationsRecord(record: Record<string, any>) {
  if (!record || typeof record !== "object") return record;
  const app = record.linkedApplication;
  const totalAmount = app ? Number(app.totalAmount) : null;
  const pendingAmount = app ? Number(app.pendingAmount) : null;
  return {
    ...record,
    payment_status: record.paymentStatus ?? record.payment_status ?? 0,
    // Whether the linked general application has already been deactivated
    // by this (or another) marriage congratulation submission.
    is_married: app ? (app.isActive ? 0 : 1) : 0,
    application_id: app?.id ?? null,
    formNumber: app?.formNumber ?? null,
    totalAmount,
    pendingAmount,
    paymentAmount: totalAmount !== null && pendingAmount !== null ? totalAmount - pendingAmount : null,
    addedby: record.addedBy?.role ? String(record.addedBy.role).toLowerCase() : undefined,
    addedby_id: record.addedById,
    app_addedby: app?.addedBy?.role ? String(app.addedBy.role).toLowerCase() : null,
    app_addedby_id: app?.addedBy?.id ?? null,
    added_name: app?.addedBy?.name ?? null,
    added_mobile: app?.addedBy?.mobile ?? null,
  };
}

export function mapMarriageCongratulationsList(records: unknown) {
  if (!Array.isArray(records)) return records;
  return records.map((record) => mapMarriageCongratulationsRecord(record as Record<string, any>));
}

