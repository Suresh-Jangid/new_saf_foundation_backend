import { prisma, PRISMA_TX_OPTIONS, type PrismaTransactionClient } from "../../config/db";
import { NotFoundError, BadRequestError, AppError } from "../../utils/errors";
import { softDeleteRecord } from "../../utils/soft-delete";
import { Gender, Prisma } from "@prisma/client";
import { isValidUuid } from "../../utils/compat-helpers";
import {
  normalizeListFilters,
  applyAddressContains,
  applyDateRangeToField,
  buildOrderBy,
  paginateByFormNumberSeq,
} from "../../utils/list-filters";
import { parseDateInput } from "../../utils/parse-date";
import { resolveAssociatedUntilText } from "../../utils/associated-until";
import { recordLegacyPaymentEntry, formatCashFlowName, formatEmiContributionName } from "../../utils/legacy-payment-entry";
import { assertAadharAvailable } from "../../utils/aadhar-uniqueness";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { ConfigurationService } from "../configuration/configuration.service";

const configService = new ConfigurationService();

function parseMarriageDate(value: unknown, field: string): Date {
  return parseDateInput(value, field);
}

import { saveImagePayload } from "../../utils/file-upload";

function resolvePhotoUpload(
  data: Record<string, unknown>,
  current: string | null | undefined
): string | null {
  for (const key of ["photo", "photoUrl", "passportPhoto", "passportPhotoUrl"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return saveImagePayload(value.trim());
    }
  }
  if (
    data.existingPhotoUrl === "" ||
    data.existingPhotoUrl === null ||
    data.existingPassportPhoto === "" ||
    data.existingPassportPhoto === null ||
    data.clearPhoto === true ||
    data.clearPhoto === "true"
  ) {
    return null;
  }
  for (const key of ["existingPhotoUrl", "existingPassportPhoto"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return saveImagePayload(value.trim());
    }
  }
  return saveImagePayload(current) ?? null;
}

async function readDisabilityCyclePhoto(id: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ photo_url: string | null }>>`
    SELECT photo_url FROM disability_cycles WHERE id = ${id}::uuid
  `;
  return rows[0]?.photo_url ?? null;
}

async function writeDisabilityCyclePhoto(id: string, photoUrl: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE disability_cycles SET photo_url = ${photoUrl} WHERE id = ${id}::uuid
  `;
}

async function attachDisabilityCyclePhoto<T extends { id: string }>(
  record: T
): Promise<T & { photoUrl: string | null }> {
  const photoUrl = await readDisabilityCyclePhoto(record.id);
  return { ...record, photoUrl };
}

async function attachDisabilityCyclePhotos<T extends { id: string }>(
  records: T[]
): Promise<Array<T & { photoUrl: string | null }>> {
  return Promise.all(records.map((record) => attachDisabilityCyclePhoto(record)));
}

function normalizeMarriageGender(value: unknown): Gender {
  const raw = String(value || "").trim();
  if (/^male$/i.test(raw)) return Gender.Male;
  if (/^female$/i.test(raw)) return Gender.Female;
  if (/^other$/i.test(raw)) return Gender.Other;
  if (Object.values(Gender).includes(raw as Gender)) return raw as Gender;
  throw new BadRequestError("Invalid gender");
}

function normalizePensionGender(value: unknown): Gender {
  const raw = String(value || "").trim();
  if (!raw) return Gender.Other;
  if (/^male$/i.test(raw)) return Gender.Male;
  if (/^female$/i.test(raw)) return Gender.Female;
  if (/^other$/i.test(raw)) return Gender.Other;
  if (Object.values(Gender).includes(raw as Gender)) return raw as Gender;
  return Gender.Other;
}

function resolveUploadedUrl(
  data: Record<string, unknown>,
  uploadKey: string,
  existingKey: string,
  current: string | null | undefined
): string | null {
  const uploaded = data[uploadKey];
  if (typeof uploaded === "string" && uploaded.trim()) {
    return uploaded.trim();
  }
  if (data[existingKey] === "" || data[existingKey] === null) {
    return null;
  }
  const existing = data[existingKey];
  if (typeof existing === "string" && existing.trim()) {
    return existing.trim();
  }
  return current ?? null;
}

// Groom entries ("PM") and bride entries ("BF") are numbered in their own
// sequence, matching the legacy register (e.g. PM-075, BF-131).
const MARRIAGE_NUMBER_PREFIX: Record<Gender, string> = {
  [Gender.Male]: "PM",
  [Gender.Female]: "BF",
  [Gender.Other]: "MC",
};

async function generateUniqueMarriageNumber(tx: PrismaTransactionClient, gender: Gender): Promise<string> {
  const prefix = MARRIAGE_NUMBER_PREFIX[gender] || "MC";

  // Derive the next number from the highest existing suffix rather than a row
  // count, so a soft-deleted row or an out-of-band record never throws the
  // sequence off (count-based numbering previously let a single stray row
  // desync the count from the real max and produce a wildly out-of-sequence
  // number).
  const result = await tx.$queryRawUnsafe<Array<{ marriageNumber: string }>>(`
    SELECT marriage_number AS "marriageNumber"
    FROM marriage_congratulations
    WHERE marriage_number LIKE $1 AND deleted_at IS NULL
    ORDER BY LENGTH(marriage_number) DESC, marriage_number DESC
    LIMIT 1
  `, `${prefix}-%`);

  const maxMarriageNumber = result[0]?.marriageNumber;
  let maxNum = 0;
  if (maxMarriageNumber) {
    const num = parseInt(maxMarriageNumber.split("-")[1], 10);
    if (!isNaN(num)) maxNum = num;
  }

  let seq = maxNum + 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${prefix}-${String(seq).padStart(3, "0")}`;
    const existing = await tx.marriageCongratulations.findFirst({
      where: { marriageNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    seq++;
  }
  return `${prefix}-${Date.now()}`;
}

// The rate for each category tier is not manually entered — it mirrors the
// live count of the applicant's OWN gender pool (a girls' form counts only
// girls, a boys' form counts only boys — legacy behaviour), excluding the
// applicant's own application, as of the event date. This matches the
// pre-existing counting logic in compatibility.routes.ts's
// "getMarriageCongratulations" case, and totalMembersServing is just the sum
// of the three category counts (verified 1:1 against the legacy register:
// rate100 + rate200 + rate300 === totalMembersServing in every record).
async function computeMarriagePoolCounts(
  tx: any,
  gender: Gender,
  targetDate: Date
): Promise<{ A: number; B: number; C: number }> {
  const activeMembers = await tx.generalApplication.findMany({
    where: {
      // id: excludeApplicantId ? { not: excludeApplicantId } : undefined, // Applicant is now included
      applicationDate: { lte: targetDate },
      deletedAt: null,
      isActive: true,
      gender,
    },
    select: { category: true },
  });

  const counts = { A: 0, B: 0, C: 0 };
  for (const member of activeMembers) {
    const cat = String(member.category).toUpperCase();
    if (cat === "A" || cat === "B" || cat === "C") counts[cat as "A" | "B" | "C"]++;
  }
  return counts;
}

async function resolveMarriageApplicant(
  tx: PrismaTransactionClient,
  data: Record<string, unknown>
): Promise<{ codeNumber: string; applicantId: string | null; applicationDate: Date | null }> {
  const applicationId = data.application_id ?? data.applicationId;
  let applicantApp: { id: string; formNumber: string | null; applicationDate: Date } | null = null;

  if (applicationId && isValidUuid(String(applicationId))) {
    applicantApp = await tx.generalApplication.findFirst({
      where: { id: String(applicationId), deletedAt: null },
      select: { id: true, formNumber: true, applicationDate: true },
    });
  }

  if (typeof data.codeNumber === "string" && data.codeNumber.trim()) {
    const codeNumber = data.codeNumber.trim();
    if (!applicantApp) {
      applicantApp = await tx.generalApplication.findFirst({
        where: { formNumber: codeNumber, deletedAt: null },
        select: { id: true, formNumber: true, applicationDate: true },
      });
    }
    return {
      codeNumber,
      applicantId: applicantApp?.id ?? null,
      applicationDate: applicantApp?.applicationDate ?? null,
    };
  }

  if (applicantApp?.formNumber) {
    return {
      codeNumber: applicantApp.formNumber,
      applicantId: applicantApp.id,
      applicationDate: applicantApp.applicationDate,
    };
  }

  const count = await tx.marriageCongratulations.count();
  return {
    codeNumber: `MC-${1000 + count + 1}`,
    applicantId: applicantApp?.id ?? null,
    applicationDate: applicantApp?.applicationDate ?? null,
  };
}

// There's no FK column linking a MarriageCongratulations row to the
// GeneralApplication it was created from — codeNumber === formNumber is the
// durable link set at creation time (see resolveMarriageApplicant above).
// This resolves that link in bulk so the compat layer can surface
// application-side fields (formNumber, amounts, who registered them, whether
// they're now deactivated/married) alongside the marriage record.
async function attachLinkedApplications<T extends { codeNumber: string }>(
  records: T[]
): Promise<Array<T & { linkedApplication: LinkedApplication | null }>> {
  const codeNumbers = [...new Set(records.map((r) => r.codeNumber).filter(Boolean))];
  if (codeNumbers.length === 0) {
    return records.map((r) => ({ ...r, linkedApplication: null }));
  }

  const apps = await prisma.generalApplication.findMany({
    where: { formNumber: { in: codeNumbers }, deletedAt: null },
    select: {
      id: true,
      formNumber: true,
      totalAmount: true,
      pendingAmount: true,
      isActive: true,
      addedBy: { select: { id: true, name: true, mobile: true, role: true } },
    },
  });
  const byFormNumber = new Map(apps.map((a) => [a.formNumber, a]));

  return records.map((r) => ({ ...r, linkedApplication: byFormNumber.get(r.codeNumber) ?? null }));
}

type LinkedApplication = {
  id: string;
  formNumber: string;
  totalAmount: unknown;
  pendingAmount: unknown;
  isActive: boolean;
  addedBy: { id: string; name: string; mobile: string; role: string };
};

export class SchemesService {
  // ── LOANS ──────────────────────────────────────────

  private async nextLoanFormNumber(tx: PrismaTransactionClient): Promise<string> {
    await lockFormNumberSequence(tx, "loan_application_form_number");
    const count = await tx.loanApplication.count();
    return `LA-${1000 + count + 1}`;
  }

  private async backfillLoanFormNumbers(): Promise<void> {
    const records = await prisma.loanApplication.findMany({
      where: { formNumber: null, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (records.length === 0) return;

    let base = await prisma.loanApplication.count({ where: { formNumber: { not: null } } });
    for (const record of records) {
      base += 1;
      await prisma.loanApplication.update({
        where: { id: record.id },
        data: { formNumber: `LA-${1000 + base}` },
      });
    }
  }

  public async createLoan(data: any, addedById: string, actorRole?: string) {
    const resolvedAddedById =
      actorRole !== "AGENT" && data.addedby_id && isValidUuid(String(data.addedby_id))
        ? String(data.addedby_id)
        : actorRole !== "AGENT" && data.addedById && isValidUuid(String(data.addedById))
          ? String(data.addedById)
          : addedById;

    if (!resolvedAddedById || !isValidUuid(resolvedAddedById)) {
      throw new BadRequestError("Valid user id is required");
    }
    if (!data.date) {
      throw new BadRequestError("date is required");
    }

    return prisma.$transaction(async (tx) => {
      const formNumber =
        typeof data.formNumber === "string" && data.formNumber.trim()
          ? data.formNumber.trim()
          : await this.nextLoanFormNumber(tx);

      return tx.loanApplication.create({
        data: {
          formNumber,
          date: parseMarriageDate(data.date, "date"),
          applicantName: String(data.applicantName || "").trim(),
          fatherName: String(data.fatherName || "").trim(),
          motherName: String(data.motherName || "").trim(),
          address: String(data.address || "").trim(),
          reason: String(data.reason || "").trim(),
          aadhaarUrl: resolveUploadedUrl(data, "aadhaar", "existingAadhaar", null),
          incomeCertificateUrl: resolveUploadedUrl(
            data,
            "incomeCertificate",
            "existingIncomeCertificate",
            null
          ),
          moolNiwasUrl: resolveUploadedUrl(data, "moolNiwas", "existingMoolNiwas", null),
          photoUrl: resolvePhotoUpload(data, null),
          addedById: resolvedAddedById,
        },
      });
    }, PRISMA_TX_OPTIONS);
  }

  public async updateLoan(id: string, data: any) {
    const existing = await prisma.loanApplication.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError("Loan application not found");

    const updateData: Record<string, unknown> = {};

    if (data.date !== undefined && data.date !== "") {
      updateData.date = parseMarriageDate(data.date, "date");
    }
    if (data.applicantName !== undefined) updateData.applicantName = String(data.applicantName).trim();
    if (data.fatherName !== undefined) updateData.fatherName = String(data.fatherName).trim();
    if (data.motherName !== undefined) updateData.motherName = String(data.motherName).trim();
    if (data.address !== undefined) updateData.address = String(data.address).trim();
    if (data.reason !== undefined) updateData.reason = String(data.reason).trim();

    if (data.aadhaar !== undefined || data.existingAadhaar !== undefined) {
      updateData.aadhaarUrl = resolveUploadedUrl(
        data,
        "aadhaar",
        "existingAadhaar",
        existing.aadhaarUrl
      );
    }
    if (data.incomeCertificate !== undefined || data.existingIncomeCertificate !== undefined) {
      updateData.incomeCertificateUrl = resolveUploadedUrl(
        data,
        "incomeCertificate",
        "existingIncomeCertificate",
        existing.incomeCertificateUrl
      );
    }
    if (data.moolNiwas !== undefined || data.existingMoolNiwas !== undefined) {
      updateData.moolNiwasUrl = resolveUploadedUrl(
        data,
        "moolNiwas",
        "existingMoolNiwas",
        existing.moolNiwasUrl
      );
    }
    if (
      data.photo !== undefined ||
      data.existingPhotoUrl !== undefined ||
      data.existingPhoto !== undefined
    ) {
      updateData.photoUrl = resolveUploadedUrl(
        {
          ...data,
          existingPhotoUrl: data.existingPhotoUrl ?? data.existingPhoto,
        },
        "photo",
        "existingPhotoUrl",
        existing.photoUrl
      );
    }

    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    return prisma.loanApplication.update({
      where: { id },
      data: updateData,
    });
  }

  public async getAllLoans(filters: any) {
    await this.backfillLoanFormNumbers();

    const f = normalizeListFilters(filters);
    const whereClause: any = { deletedAt: null };
    if (f.search) {
      whereClause.OR = [
        { applicantName: { contains: f.search, mode: "insensitive" } },
        { fatherName: { contains: f.search, mode: "insensitive" } },
        { formNumber: { contains: f.search, mode: "insensitive" } },
      ];
    }
    if (f.addedById) {
      whereClause.addedById = f.addedById;
    }
    applyAddressContains(whereClause, f.address);
    applyDateRangeToField(whereClause, "date", f.fromDate, f.toDate);
    if (f.reason) {
      whereClause.reason = { contains: f.reason, mode: "insensitive" };
    }

    const page = f.page;
    const limit = f.limit;
    const queryOptions: any = {
      where: whereClause,
      include: {
        addedBy: { select: { id: true, name: true } },
        installments: { where: { deletedAt: null } },
      },
      orderBy: buildOrderBy(f.sortBy, "formNumber", { nullable: true }),
    };
    if (page !== undefined && limit !== undefined) {
      queryOptions.skip = (page - 1) * limit;
      queryOptions.take = limit;
    }

    const records = await prisma.loanApplication.findMany(queryOptions);

    if (page !== undefined && limit !== undefined) {
      const total = await prisma.loanApplication.count({ where: whereClause });
      return {
        data: records,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    return records;
  }

  public async getLoanById(id: string) {
    const loan = await prisma.loanApplication.findFirst({
      where: { id, deletedAt: null },
      include: {
        addedBy: { select: { id: true, name: true } },
        installments: { orderBy: { date: "asc" } },
      },
    });
    if (!loan) throw new NotFoundError("Loan application not found");
    return loan;
  }

  public async addLoanInstallment(loanApplicationId: string, data: any, addedById: string) {
    // Verify loan exists
    const loan = await prisma.loanApplication.findFirst({ where: { id: loanApplicationId, deletedAt: null } });
    if (!loan) throw new NotFoundError("Loan application not found");

    const rawType = String(data.type || "USER_REPAYMENT").toUpperCase().replace(/\s+/g, "_");
    const type = rawType.includes("WE") ? "WE_PAID" : "USER_REPAYMENT";
    const installmentDate = parseMarriageDate(data.date, "date");

    const installment = await prisma.loanApplicationInstallment.create({
      data: {
        loanApplicationId,
        amount: data.amount,
        date: installmentDate,
        type,
        note: data.note || null,
        addedById: addedById,
      },
    });

    await recordLegacyPaymentEntry(prisma, {
      legacyId: installment.id,
      date: installmentDate,
      amount: data.amount,
      name: formatCashFlowName([loan.formNumber, loan.applicantName, loan.address]),
      source: "loan_applications",
      type: type === "WE_PAID" ? "Out" : "In",
    });

    return installment;
  }

  // ── FINANCIAL HELP (DAN RASHI) ──────────────────────

  private async nextFinancialHelpFormNumber(tx: PrismaTransactionClient): Promise<string> {
    await lockFormNumberSequence(tx, "financial_help_form_number");
    const count = await tx.financialHelp.count();
    return `FH-${String(count + 1).padStart(3, "0")}`;
  }

  public async createFinancialHelp(data: any, addedById: string, actorRole?: string) {
    const resolvedAddedById =
      actorRole !== "AGENT" && data.addedby_id && isValidUuid(String(data.addedby_id))
        ? String(data.addedby_id)
        : actorRole !== "AGENT" && data.addedById && isValidUuid(String(data.addedById))
          ? String(data.addedById)
          : addedById;

    if (!resolvedAddedById || !isValidUuid(resolvedAddedById)) {
      throw new BadRequestError("Valid user id is required");
    }
    if (!data.date) {
      throw new BadRequestError("date is required");
    }

    const gotra = String(data.gotra || "").trim();
    const village = String(data.village || "").trim();

    return prisma.$transaction(async (tx) => {
      const formNumber =
        typeof data.formNumber === "string" && data.formNumber.trim()
          ? data.formNumber.trim()
          : await this.nextFinancialHelpFormNumber(tx);

      return tx.financialHelp.create({
        data: {
          formNumber,
          date: parseMarriageDate(data.date, "date"),
          name: String(data.name || "").trim(),
          gender: normalizePensionGender(data.gender),
          fatherName: String(data.fatherName || "").trim(),
          address: String(data.address || gotra || village || "-").trim(),
          district: String(data.district || "").trim(),
          village,
          tehsil: String(data.tehsil || "").trim(),
          phone: String(data.phone || "").replace(/\D/g, ""),
          donatedAmount: Number(data.donatedAmount) || 0,
          addedById: resolvedAddedById,
        },
      });
    }, PRISMA_TX_OPTIONS);
  }

  public async updateFinancialHelp(id: string, data: any) {
    const existing = await prisma.financialHelp.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError("Financial help record not found");

    const updateData: Record<string, unknown> = {};

    if (data.formNumber !== undefined && data.formNumber !== "") {
      updateData.formNumber = String(data.formNumber).trim();
    }
    if (data.date !== undefined && data.date !== "") {
      updateData.date = parseMarriageDate(data.date, "date");
    }
    if (data.name !== undefined) updateData.name = String(data.name).trim();
    if (data.gender !== undefined && data.gender !== "") {
      updateData.gender = normalizePensionGender(data.gender);
    }
    if (data.fatherName !== undefined) updateData.fatherName = String(data.fatherName).trim();
    if (data.district !== undefined) updateData.district = String(data.district).trim();
    if (data.village !== undefined) updateData.village = String(data.village).trim();
    if (data.tehsil !== undefined) updateData.tehsil = String(data.tehsil).trim();
    if (data.phone !== undefined) updateData.phone = String(data.phone).replace(/\D/g, "");
    if (data.donatedAmount !== undefined && data.donatedAmount !== "") {
      updateData.donatedAmount = Number(data.donatedAmount) || existing.donatedAmount;
    }
    if (data.address !== undefined) {
      updateData.address = String(data.address).trim();
    } else if (data.gotra !== undefined) {
      updateData.address = String(data.gotra).trim();
    }

    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    return prisma.financialHelp.update({
      where: { id },
      data: updateData,
    });
  }

  public async getAllFinancialHelps(filters: any) {
    const f = normalizeListFilters(filters);
    const whereClause: any = { deletedAt: null };
    if (f.search) {
      whereClause.OR = [
        { name: { contains: f.search, mode: "insensitive" } },
        { formNumber: { contains: f.search, mode: "insensitive" } },
        { phone: { contains: f.search } },
      ];
    }
    if (f.gender) {
      whereClause.gender = normalizePensionGender(f.gender);
    }
    if (filters.gotra) {
      whereClause.address = { equals: String(filters.gotra), mode: "insensitive" };
    } else {
      applyAddressContains(whereClause, f.address);
    }
    applyDateRangeToField(whereClause, "date", f.fromDate, f.toDate);

    const page = f.page;
    const limit = f.limit;
    const queryOptions: any = {
      where: whereClause,
      include: { addedBy: { select: { id: true, name: true } } },
      orderBy: buildOrderBy(f.sortBy, "formNumber"),
    };
    if (page !== undefined && limit !== undefined) {
      queryOptions.skip = (page - 1) * limit;
      queryOptions.take = limit;
    }

    const records = await prisma.financialHelp.findMany(queryOptions);

    if (page !== undefined && limit !== undefined) {
      const total = await prisma.financialHelp.count({ where: whereClause });
      return {
        data: records,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    return records;
  }

  public async getFinancialHelpById(id: string) {
    const record = await prisma.financialHelp.findFirst({
      where: { id, deletedAt: null },
      include: { addedBy: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundError("Financial help record not found");
    return record;
  }

  // ── DISABILITY CYCLE ──────────────────────────────

  public async createDisabilityCycle(data: any, addedById: string, actorRole?: string) {
    const resolvedAddedById =
      actorRole !== "AGENT" && data.addedby_id && isValidUuid(String(data.addedby_id))
        ? String(data.addedby_id)
        : actorRole !== "AGENT" && data.addedById && isValidUuid(String(data.addedById))
          ? String(data.addedById)
          : addedById;

    if (!resolvedAddedById || !isValidUuid(resolvedAddedById)) {
      throw new BadRequestError("Valid user id is required");
    }

    const photoUrl = resolvePhotoUpload(data, null);
    const aadharNumber = String(data.aadharNumber || "").replace(/\D/g, "");

    const record = await prisma.$transaction(async (tx) => {
      await assertAadharAvailable(tx, aadharNumber);

      let formNumber = typeof data.formNumber === "string" ? data.formNumber.trim() : "";
      if (!formNumber) {
        await lockFormNumberSequence(tx, "disability_cycle_form_number");
        const count = await tx.disabilityCycle.count();
        formNumber = `DC-${String(count + 1).padStart(3, "0")}`;
      }

      return tx.disabilityCycle.create({
        data: {
          formNumber,
          applicationDate: parseMarriageDate(data.applicationDate, "applicationDate"),
          applicantName: String(data.applicantName || "").trim(),
          fatherName: String(data.fatherName || "").trim(),
          motherName: String(data.motherName || "").trim(),
          dateOfBirth: parseMarriageDate(data.dateOfBirth, "dateOfBirth"),
          aadharNumber,
          gotra: String(data.gotra || "").trim(),
          age: Number(data.age) || 0,
          mobile: String(data.mobile || "").replace(/\D/g, ""),
          address: String(data.address || "").trim(),
          pinCode: String(data.pinCode || "").trim(),
          tehsil: String(data.tehsil || "").trim(),
          district: String(data.district || "").trim(),
          state: String(data.state || "").trim(),
          addedById: resolvedAddedById,
        },
      });
    }, PRISMA_TX_OPTIONS);

    if (photoUrl) {
      await writeDisabilityCyclePhoto(record.id, photoUrl);
    }

    return { ...record, photoUrl };
  }

  public async updateDisabilityCycle(id: string, data: any) {
    const existing = await prisma.disabilityCycle.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError("Disability cycle not found");

    if (data.aadharNumber !== undefined) {
      const newAadharCheck = String(data.aadharNumber).replace(/\D/g, "");
      if (newAadharCheck !== existing.aadharNumber) {
        await assertAadharAvailable(prisma, newAadharCheck, { model: "disabilityCycle", id });
      }
    }

    const currentPhotoUrl = await readDisabilityCyclePhoto(id);
    const updateData: Record<string, unknown> = {};
    let photoUrlUpdate: string | null | undefined;

    if (data.formNumber !== undefined && data.formNumber !== "") {
      updateData.formNumber = String(data.formNumber).trim();
    }
    if (data.applicationDate !== undefined && data.applicationDate !== "") {
      updateData.applicationDate = parseMarriageDate(data.applicationDate, "applicationDate");
    }
    if (data.applicantName !== undefined) updateData.applicantName = String(data.applicantName).trim();
    if (data.fatherName !== undefined) updateData.fatherName = String(data.fatherName).trim();
    if (data.motherName !== undefined) updateData.motherName = String(data.motherName).trim();
    if (data.dateOfBirth !== undefined && data.dateOfBirth !== "") {
      updateData.dateOfBirth = parseMarriageDate(data.dateOfBirth, "dateOfBirth");
    }
    if (data.aadharNumber !== undefined) {
      updateData.aadharNumber = String(data.aadharNumber).replace(/\D/g, "");
    }
    if (data.gotra !== undefined) updateData.gotra = String(data.gotra).trim();
    if (data.age !== undefined && data.age !== "") {
      updateData.age = Number(data.age) || existing.age;
    }
    if (data.mobile !== undefined) updateData.mobile = String(data.mobile).replace(/\D/g, "");
    if (data.address !== undefined) updateData.address = String(data.address).trim();
    if (data.pinCode !== undefined) updateData.pinCode = String(data.pinCode).trim();
    if (data.tehsil !== undefined) updateData.tehsil = String(data.tehsil).trim();
    if (data.district !== undefined) updateData.district = String(data.district).trim();
    if (data.state !== undefined) updateData.state = String(data.state).trim();

    if (
      data.photo !== undefined ||
      data.photoUrl !== undefined ||
      data.existingPhotoUrl !== undefined ||
      data.clearPhoto !== undefined
    ) {
      photoUrlUpdate = resolvePhotoUpload(data, currentPhotoUrl);
    }

    let record = existing;

    if (Object.keys(updateData).length > 0) {
      record = await prisma.disabilityCycle.update({
        where: { id },
        data: updateData,
      });
    }

    if (photoUrlUpdate !== undefined) {
      await writeDisabilityCyclePhoto(id, photoUrlUpdate);
    }

    return {
      ...record,
      photoUrl: photoUrlUpdate !== undefined ? photoUrlUpdate : currentPhotoUrl,
    };
  }

  public async getAllDisabilityCycles(filters: any) {
    const whereClause: any = { deletedAt: null };
    if (filters.search) {
      whereClause.OR = [
        { applicantName: { contains: filters.search, mode: "insensitive" } },
        { formNumber: { contains: filters.search, mode: "insensitive" } },
        { mobile: { contains: filters.search } },
      ];
    }
    return attachDisabilityCyclePhotos(
      await prisma.disabilityCycle.findMany({
        where: whereClause,
        include: { addedBy: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );
  }

  public async getDisabilityCycleById(id: string) {
    const record = await prisma.disabilityCycle.findFirst({
      where: { id, deletedAt: null },
      include: { addedBy: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundError("Disability cycle not found");
    return attachDisabilityCyclePhoto(record);
  }

  // ── MARRIAGE CONGRATULATIONS & BENEFICIARIES ───────

  public async createMarriageCongratulations(data: any, addedById: string, actorRole?: string) {
    const gender = normalizeMarriageGender(data.gender);
    const resolvedAddedById =
      actorRole !== "AGENT" && data.addedby_id && isValidUuid(String(data.addedby_id))
        ? String(data.addedby_id)
        : addedById;

    if (!resolvedAddedById || !isValidUuid(resolvedAddedById)) {
      throw new BadRequestError("Valid user id is required");
    }

    // Snapshot the applicant's own-gender category pool (excluding themselves)
    // before they're deactivated below, so this record reflects the pool as
    // it stood at submission time (matching the legacy register's numbers).
    const eventDate = parseMarriageDate(data.date, "date");
    const MAX_RETRIES = 3;
    const BACKOFF_DELAYS = [50, 100, 200];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          // marriageNumber always comes from the sequence generator, never the
          // client — a client-supplied value (e.g. from a stray API call) can
          // silently desync the register with a wrong prefix/out-of-sequence
          // number, as happened with PM-23414 landing on a Female applicant.
          const marriageNumber = await generateUniqueMarriageNumber(tx, gender);

          const { codeNumber, applicantId, applicationDate } = await resolveMarriageApplicant(tx, data);

          // An applicant only gets one marriage congratulations record ever —
          // block a second submission for the same applicant (matched by their
          // application's formNumber/codeNumber) instead of silently creating
          // a duplicate with its own duplicate Cash Flow entry.
          if (codeNumber) {
            const existingForApplicant = await tx.marriageCongratulations.findFirst({
              where: { codeNumber, deletedAt: null },
              select: { id: true, marriageNumber: true },
            });
            if (existingForApplicant) {
              throw new BadRequestError(
                `This applicant already has a marriage congratulations record (${existingForApplicant.marriageNumber})`
              );
            }
          }

          // Fall back to the linked application's own registration date, then
          // the event date, so the form never silently fails on a blank
          // optional date.
          const membershipJoinDate = parseMarriageDate(
            data.membershipJoinDate || applicationDate || data.date,
            "membershipJoinDate"
          );
          if (eventDate < membershipJoinDate) {
            throw new BadRequestError(
              "Marriage date cannot be before the registration/membership join date"
            );
          }

          const categoryCounts = await computeMarriagePoolCounts(tx, gender, eventDate);
          const membersServing = categoryCounts.A + categoryCounts.B + categoryCounts.C;

          // Compute authoritative financial fields for new Marriage Congratulations:
          const calculatedTotal =
            Number(data.totalGrantAmount || 0) ||
            (categoryCounts.A * 100 + categoryCounts.B * 200 + categoryCounts.C * 300);

          // Authoritative deduction percentage from configuration architecture (defaults to 15.0)
          const configuredScheme = await configService.getSchemeByCode("GENERAL_MARRIAGE");
          const deductionPercent = Number(configuredScheme?.deductionPercent ?? 15.0);

          // Client-supplied financial values (deductionPercent, deductedAmount, totalPaidAmount)
          // are strictly IGNORED for new records to guarantee authoritative calculations.
          const deductedAmount = Math.round((calculatedTotal * deductionPercent) / 100);
          const totalPaidAmount = calculatedTotal - deductedAmount;

          const record = await tx.marriageCongratulations.create({
            data: {
              date: eventDate,
              codeNumber,
              marriageNumber,
              applicantName: String(data.applicantName || "").trim(),
              fatherName: String(data.fatherName || "").trim(),
              wifeOf: data.wifeOf ? String(data.wifeOf).trim() : null,
              gotra: String(data.gotra || "").trim(),
              address: String(data.address || "").trim(),
              membershipJoinDate,
              associatedUntil: resolveAssociatedUntilText(data),
              permanentFee: Number(data.permanentFee || 0),
              installmentAmount: Number(data.installmentAmount || 0),
              totalGrantAmount: calculatedTotal,
              totalMembersServing: membersServing,
              rate100: categoryCounts.A,
              rate200: categoryCounts.B,
              rate300: categoryCounts.C,
              deductionPercent,
              deductedAmount,
              totalPaidAmount,
              gender,
              addedById: resolvedAddedById,
            },
          });

          // Once a member's marriage congratulation is recorded, their general
          // application is deactivated so they stop being an eligible EMI payer
          // for this or any other marriage congratulation entry going forward.
          if (applicantId) {
            await tx.generalApplication.update({
              where: { id: applicantId },
              data: { isActive: false },
            });
          }

          // Unlike General/Insurance Applications, the registration-time fee here has no
          // companion installment row of its own — totalPaidAmount is the only record of it,
          // so it needs its own Cash Flow entry (separate from the marriage_congratulations_emi
          // entries the later installment/EMI payments create).
          if (Number(record.totalPaidAmount) > 0) {
            await recordLegacyPaymentEntry(tx, {
              legacyId: record.id,
              date: record.date,
              amount: record.totalPaidAmount,
              name: formatCashFlowName([record.codeNumber, record.applicantName, record.address]),
              source: "marriage_congratulations",
              type: "Out",
            });
          }

          return record;
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        // Prisma error code P2034 corresponds to a serialization failure/write conflict
        if (error?.code === "P2034" && attempt < MAX_RETRIES) {
          await new Promise(res => setTimeout(res, BACKOFF_DELAYS[attempt]));
          continue;
        }
        
        // If all retries failed due to serialization
        if (error?.code === "P2034" && attempt === MAX_RETRIES) {
          throw new AppError("Another payment is currently being processed. Please try again.", 409);
        }
        
        throw error;
      }
    }
    
    throw new AppError("Unexpected end of transaction loop", 500);
  }

  public async getAllMarriageCongratulations(filters: any) {
    const f = normalizeListFilters(filters);
    const whereClause: any = { deletedAt: null };
    if (f.search) {
      whereClause.OR = [
        { applicantName: { contains: f.search, mode: "insensitive" } },
        { marriageNumber: { contains: f.search, mode: "insensitive" } },
        { codeNumber: { contains: f.search, mode: "insensitive" } },
      ];
    }
    if (f.gender) {
      whereClause.gender = f.gender;
    }
    if (f.addedById) {
      whereClause.addedById = f.addedById;
    }
    applyAddressContains(whereClause, f.address);
    applyDateRangeToField(whereClause, "date", f.fromDate, f.toDate);

    const page = f.page;
    const limit = f.limit;
    const candidates = await prisma.marriageCongratulations.findMany({
      where: whereClause,
      select: { id: true, marriageNumber: true, date: true, createdAt: true },
    });
    const { data: records, total } = await paginateByFormNumberSeq(candidates, page, limit, (ids) =>
      prisma.marriageCongratulations.findMany({
        where: { id: { in: ids } },
        include: { addedBy: { select: { id: true, name: true, role: true } } },
      })
    );

    if (page !== undefined && limit !== undefined) {
      return {
        data: await attachLinkedApplications(records),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }
    return attachLinkedApplications(records);
  }

  public async getMarriageCongratulationsById(id: string) {
    const record = await prisma.marriageCongratulations.findFirst({
      where: { id, deletedAt: null },
      include: {
        addedBy: { select: { id: true, name: true, role: true } },
        payments: { orderBy: { createdAt: "asc" } },
        sewingMachines: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!record) throw new NotFoundError("Marriage Congratulations record not found");
    const [withLinkedApp] = await attachLinkedApplications([record]);
    return withLinkedApp;
  }

  public async addMarriageCongratulationsPayment(marriageCongratulationsId: string, data: any, addedById: string) {
    const record = await prisma.marriageCongratulations.findFirst({ where: { id: marriageCongratulationsId, deletedAt: null } });
    if (!record) throw new NotFoundError("Marriage Congratulations record not found");

    const payerApplicationId = data.applicationId || data.application_id || null;
    const payer = payerApplicationId && isValidUuid(String(payerApplicationId))
      ? await prisma.generalApplication.findFirst({
          where: { id: String(payerApplicationId), deletedAt: null },
          select: { formNumber: true, applicantName: true, address: true },
        })
      : null;

    const payment = await prisma.marriageCongratulationsPayment.create({
      data: {
        marriageCongratulationsId,
        amount: data.amount,
        category: data.category,
        applicationId: payerApplicationId,
        addedById: addedById,
      },
    });

    await recordLegacyPaymentEntry(prisma, {
      legacyId: payment.id,
      date: payment.createdAt,
      amount: data.amount,
      name: formatEmiContributionName(
        payer ? [payer.formNumber, payer.applicantName, payer.address] : [record.codeNumber, record.applicantName, record.address],
        payer ? { name: record.applicantName, code: record.codeNumber, scheme: "marriage" } : null
      ),
      source: "marriage_congratulations_emi",
      type: "In",
    });

    return payment;
  }

  public async addMarriageSewingMachine(marriageCongratulationsId: string, data: any, addedById: string) {
    let resolvedId = marriageCongratulationsId;
    if ((!resolvedId || !isValidUuid(resolvedId)) && data.marriageNumber) {
      const congrats = await prisma.marriageCongratulations.findFirst({
        where: { marriageNumber: data.marriageNumber, deletedAt: null },
        select: { id: true }
      });
      if (congrats) {
        resolvedId = congrats.id;
      }
    }

    const record = await prisma.marriageCongratulations.findFirst({ where: { id: resolvedId, deletedAt: null } });
    if (!record) throw new NotFoundError("Marriage Congratulations record not found");

    const gender = data.gender ? normalizeMarriageGender(data.gender) : record.gender;
    const aadharNumber = String(data.aadharNumber || "").replace(/\D/g, "");

    return prisma.$transaction(async (tx) => {
      await assertAadharAvailable(tx, aadharNumber, undefined, "marriageSewingMachine");

      let formNumber = data.formNumber || "";
      if (!formNumber) {
        await lockFormNumberSequence(tx, "marriage_sewing_machine_form_number");
        const count = await tx.marriageSewingMachine.count();
        formNumber = `MS-${1000 + count + 1}`;
      }

      return tx.marriageSewingMachine.create({
        data: {
          marriageCongratulationsId: record.id,
          formNumber,
          applicationDate: parseMarriageDate(data.applicationDate, "applicationDate"),
          applicantName: data.applicantName,
          fatherName: data.fatherName,
          motherName: data.motherName,
          dateOfBirth: parseMarriageDate(data.dateOfBirth, "dateOfBirth"),
          aadharNumber,
          gotra: data.gotra,
          age: Number(data.age),
          mobile: data.mobile,
          address: data.address,
          pinCode: data.pinCode,
          tehsil: data.tehsil,
          district: data.district,
          state: data.state,
          gender,
          addedById: addedById,
        },
      });
    }, PRISMA_TX_OPTIONS);
  }

  // ── PENSION YOJANA ─────────────────────────────────

  private async nextPensionFormNumber(tx: PrismaTransactionClient): Promise<string> {
    await lockFormNumberSequence(tx, "pension_yojana_form_number");
    const count = await tx.pensionYojana.count();
    return `PY-${1000 + count + 1}`;
  }

  private async backfillPensionFormNumbers(): Promise<void> {
    const records = await prisma.pensionYojana.findMany({
      where: { formNumber: null, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (records.length === 0) return;

    let base = await prisma.pensionYojana.count({ where: { formNumber: { not: null } } });
    for (const record of records) {
      base += 1;
      await prisma.pensionYojana.update({
        where: { id: record.id },
        data: { formNumber: `PY-${1000 + base}` },
      });
    }
  }

  public async createPensionYojana(data: any, addedById: string, actorRole?: string) {
    const resolvedAddedById =
      actorRole !== "AGENT" && data.addedby_id && isValidUuid(String(data.addedby_id))
        ? String(data.addedby_id)
        : actorRole !== "AGENT" && data.addedById && isValidUuid(String(data.addedById))
          ? String(data.addedById)
          : addedById;

    if (!resolvedAddedById || !isValidUuid(resolvedAddedById)) {
      throw new BadRequestError("Valid user id is required");
    }
    if (!data.date) {
      throw new BadRequestError("date is required");
    }

    return prisma.$transaction(async (tx) => {
      const formNumber =
        typeof data.formNumber === "string" && data.formNumber.trim()
          ? data.formNumber.trim()
          : await this.nextPensionFormNumber(tx);

      return tx.pensionYojana.create({
        data: {
          formNumber,
          date: parseMarriageDate(data.date, "date"),
          dateOfBirth:
            data.dob || data.dateOfBirth
              ? parseMarriageDate(data.dob ?? data.dateOfBirth, "dob")
              : undefined,
          name: String(data.name || "").trim(),
          fatherName: String(data.fatherName || "").trim(),
          gotra: String(data.gotra || "").trim(),
          age: Number(data.age) || 0,
          gender: normalizePensionGender(data.gender),
          village: String(data.village || "").trim(),
          tehsil: String(data.tehsil || "").trim(),
          district: String(data.district || "").trim(),
          mobile: String(data.mobile || "").replace(/\D/g, ""),
          photoUrl: resolvePhotoUpload(data, null),
          bankName: String(data.bankName || "").trim(),
          accountNumber: String(data.accountNumber || "").trim(),
          ifscCode: String(data.ifscCode || "").trim(),
          monthlyPension: Number(data.monthlyPension) || 0,
          addedById: resolvedAddedById,
        },
      });
    }, PRISMA_TX_OPTIONS);
  }

  public async updatePensionYojana(id: string, data: any) {
    const existing = await prisma.pensionYojana.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError("Pension beneficiary not found");

    const updateData: Record<string, unknown> = {};

    if (data.date !== undefined && data.date !== "") {
      updateData.date = parseMarriageDate(data.date, "date");
    }
    if (data.dob !== undefined && data.dob !== "") {
      updateData.dateOfBirth = parseMarriageDate(data.dob, "dob");
    } else if (data.dateOfBirth !== undefined && data.dateOfBirth !== "") {
      updateData.dateOfBirth = parseMarriageDate(data.dateOfBirth, "dateOfBirth");
    }
    if (data.name !== undefined) updateData.name = String(data.name).trim();
    if (data.fatherName !== undefined) updateData.fatherName = String(data.fatherName).trim();
    if (data.gotra !== undefined) updateData.gotra = String(data.gotra).trim();
    if (data.age !== undefined && data.age !== "") {
      updateData.age = Number(data.age) || existing.age;
    }
    if (data.gender !== undefined && data.gender !== "") {
      updateData.gender = normalizePensionGender(data.gender);
    }
    if (data.village !== undefined) updateData.village = String(data.village).trim();
    if (data.tehsil !== undefined) updateData.tehsil = String(data.tehsil).trim();
    if (data.district !== undefined) updateData.district = String(data.district).trim();
    if (data.mobile !== undefined) updateData.mobile = String(data.mobile).replace(/\D/g, "");
    if (data.bankName !== undefined) updateData.bankName = String(data.bankName).trim();
    if (data.accountNumber !== undefined) updateData.accountNumber = String(data.accountNumber).trim();
    if (data.ifscCode !== undefined) updateData.ifscCode = String(data.ifscCode).trim();
    if (data.monthlyPension !== undefined && data.monthlyPension !== "") {
      updateData.monthlyPension = Number(data.monthlyPension) || existing.monthlyPension;
    }

    if (
      data.photo !== undefined ||
      data.photoUrl !== undefined ||
      data.existingPhotoUrl !== undefined ||
      data.clearPhoto !== undefined
    ) {
      updateData.photoUrl = resolvePhotoUpload(data, existing.photoUrl);
    }

    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    return prisma.pensionYojana.update({
      where: { id },
      data: updateData,
    });
  }

  public async getAllPensionYojanas(filters: any) {
    await this.backfillPensionFormNumbers();

    const f = normalizeListFilters(filters);
    const whereClause: any = { deletedAt: null };
    if (f.search) {
      whereClause.OR = [
        { name: { contains: f.search, mode: "insensitive" } },
        { mobile: { contains: f.search } },
      ];
    }
    if (f.village) {
      whereClause.village = { contains: f.village, mode: "insensitive" };
    } else {
      applyAddressContains(whereClause, f.address, "village");
    }
    applyDateRangeToField(whereClause, "date", f.fromDate, f.toDate);

    const page = f.page;
    const limit = f.limit;
    const queryOptions: any = {
      where: whereClause,
      include: { addedBy: { select: { id: true, name: true } } },
      orderBy: buildOrderBy(f.sortBy, "formNumber", { nullable: true }),
    };
    if (page !== undefined && limit !== undefined) {
      queryOptions.skip = (page - 1) * limit;
      queryOptions.take = limit;
    }

    const records = await prisma.pensionYojana.findMany(queryOptions);

    if (page !== undefined && limit !== undefined) {
      const total = await prisma.pensionYojana.count({ where: whereClause });
      return {
        data: records,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    }

    return records;
  }

  public async getPensionYojanaById(id: string) {
    const pension = await prisma.pensionYojana.findFirst({
      where: { id, deletedAt: null },
      include: {
        addedBy: { select: { id: true, name: true } },
        payments: { orderBy: { date: "asc" } },
      },
    });
    if (!pension) throw new NotFoundError("Pension beneficiary not found");
    return pension;
  }

  public async addPensionPayment(pensionYojanaId: string, data: any, addedById: string) {
    const beneficiary = await prisma.pensionYojana.findFirst({ where: { id: pensionYojanaId, deletedAt: null } });
    if (!beneficiary) throw new NotFoundError("Pension beneficiary not found");

    const paymentDate = parseMarriageDate(data.date, "date");
    const payment = await prisma.pensionYojanaPayment.create({
      data: {
        pensionYojanaId,
        amount: data.amount,
        date: paymentDate,
        note: data.note || null,
        addedById: addedById,
      },
    });

    await recordLegacyPaymentEntry(prisma, {
      legacyId: payment.id,
      date: paymentDate,
      amount: data.amount,
      name: formatCashFlowName([beneficiary.formNumber, beneficiary.name, beneficiary.village]),
      source: "pension_yojana",
      type: "Out",
    });

    return payment;
  }

  // ── SEWING MACHINE CAMPS ──────────────────────────

  public async createSewingMachineCamp(data: any, addedById: string, actorRole?: string) {
    const resolvedAddedById =
      actorRole !== "AGENT" && data.addedby_id && isValidUuid(String(data.addedby_id))
        ? String(data.addedby_id)
        : actorRole !== "AGENT" && data.addedById && isValidUuid(String(data.addedById))
          ? String(data.addedById)
          : addedById;

    if (!resolvedAddedById || !isValidUuid(resolvedAddedById)) {
      throw new BadRequestError("Valid user id is required");
    }

    if (!data.applicationDate) {
      throw new BadRequestError("applicationDate is required");
    }
    if (!data.dateOfBirth) {
      throw new BadRequestError("dateOfBirth is required");
    }

    const campNumber =
      typeof data.campNumber === "string" && data.campNumber.trim()
        ? data.campNumber.trim()
        : "C-1";

    const aadharNumber = String(data.aadharNumber || "").replace(/\D/g, "");

    return prisma.$transaction(async (tx) => {
      await assertAadharAvailable(tx, aadharNumber, undefined, "sewingMachineCamp");

      let formNumber = typeof data.formNumber === "string" ? data.formNumber.trim() : "";
      if (!formNumber) {
        await lockFormNumberSequence(tx, "sewing_machine_camp_form_number");
        const count = await tx.sewingMachineCamp.count();
        formNumber = `SM-${String(count + 1).padStart(3, "0")}`;
      }

      return tx.sewingMachineCamp.create({
        data: {
          campNumber,
          formNumber,
          applicationDate: parseMarriageDate(data.applicationDate, "applicationDate"),
          applicantName: String(data.applicantName || "").trim(),
          fatherName: String(data.fatherName || "").trim(),
          motherName: String(data.motherName || "").trim(),
          dateOfBirth: parseMarriageDate(data.dateOfBirth, "dateOfBirth"),
          aadharNumber,
          gotra: String(data.gotra || "").trim(),
          age: Number(data.age) || 0,
          mobile: String(data.mobile || "").replace(/\D/g, ""),
          address: String(data.address || "").trim(),
          pinCode: String(data.pinCode || "").trim(),
          tehsil: String(data.tehsil || "").trim(),
          district: String(data.district || "").trim(),
          state: String(data.state || "").trim(),
          passportPhotoUrl: resolvePhotoUpload(data, null),
          addedById: resolvedAddedById,
        },
      });
    }, PRISMA_TX_OPTIONS);
  }

  public async updateSewingMachineCamp(id: string, data: any) {
    const existing = await prisma.sewingMachineCamp.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError("Sewing machine camp not found");

    if (data.aadharNumber !== undefined) {
      const newAadharCheck = String(data.aadharNumber).replace(/\D/g, "");
      if (newAadharCheck !== existing.aadharNumber) {
        await assertAadharAvailable(prisma, newAadharCheck, { model: "sewingMachineCamp", id });
      }
    }

    const updateData: Record<string, unknown> = {};

    if (data.campNumber !== undefined && data.campNumber !== "") {
      updateData.campNumber = String(data.campNumber).trim();
    }
    if (data.formNumber !== undefined && data.formNumber !== "") {
      updateData.formNumber = String(data.formNumber).trim();
    }
    if (data.applicationDate !== undefined && data.applicationDate !== "") {
      updateData.applicationDate = parseMarriageDate(data.applicationDate, "applicationDate");
    }
    if (data.applicantName !== undefined) updateData.applicantName = String(data.applicantName).trim();
    if (data.fatherName !== undefined) updateData.fatherName = String(data.fatherName).trim();
    if (data.motherName !== undefined) updateData.motherName = String(data.motherName).trim();
    if (data.dateOfBirth !== undefined && data.dateOfBirth !== "") {
      updateData.dateOfBirth = parseMarriageDate(data.dateOfBirth, "dateOfBirth");
    }
    if (data.aadharNumber !== undefined) {
      updateData.aadharNumber = String(data.aadharNumber).replace(/\D/g, "");
    }
    if (data.gotra !== undefined) updateData.gotra = String(data.gotra).trim();
    if (data.age !== undefined && data.age !== "") {
      updateData.age = Number(data.age) || existing.age;
    }
    if (data.mobile !== undefined) updateData.mobile = String(data.mobile).replace(/\D/g, "");
    if (data.address !== undefined) updateData.address = String(data.address).trim();
    if (data.pinCode !== undefined) updateData.pinCode = String(data.pinCode).trim();
    if (data.tehsil !== undefined) updateData.tehsil = String(data.tehsil).trim();
    if (data.district !== undefined) updateData.district = String(data.district).trim();
    if (data.state !== undefined) updateData.state = String(data.state).trim();

    if (
      data.photo !== undefined ||
      data.photoUrl !== undefined ||
      data.passportPhoto !== undefined ||
      data.passportPhotoUrl !== undefined ||
      data.existingPhotoUrl !== undefined ||
      data.existingPassportPhoto !== undefined ||
      data.clearPhoto !== undefined
    ) {
      updateData.passportPhotoUrl = resolvePhotoUpload(data, existing.passportPhotoUrl);
    }

    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    return prisma.sewingMachineCamp.update({
      where: { id },
      data: updateData,
    });
  }

  public async getSewingMachineCampById(id: string) {
    const record = await prisma.sewingMachineCamp.findFirst({
      where: { id, deletedAt: null },
      include: { addedBy: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundError("Sewing machine camp not found");
    return record;
  }

  public async getAllSewingMachineCamps(filters: any) {
    const whereClause: any = { deletedAt: null };
    if (filters.search) {
      whereClause.OR = [
        { applicantName: { contains: filters.search, mode: "insensitive" } },
        { formNumber: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    return prisma.sewingMachineCamp.findMany({
      where: whereClause,
      include: { addedBy: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  public async getMarriageCongratulationsMembers(marriageCongratulationsId: string) {
    const congrats = await prisma.marriageCongratulations.findUnique({
      where: { id: marriageCongratulationsId },
    });
    if (!congrats) throw new NotFoundError("Marriage Congratulations record not found");

    // Fetch active members (General Applications) of the same gender
    const members = await prisma.generalApplication.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        gender: congrats.gender,
      },
      select: {
        id: true,
        applicantName: true,
        formNumber: true,
        category: true,
      },
    });

    // Fetch all payments made towards this congratulations record
    const payments = await prisma.marriageCongratulationsPayment.findMany({
      where: { marriageCongratulationsId, deletedAt: null },
      select: { applicationId: true },
    });

    const paidMemberIds = new Set(payments.map(p => p.applicationId).filter(Boolean));

    // Group by category
    const categories: Record<string, { members: any[] }> = {
      A: { members: [] },
      B: { members: [] },
      C: { members: [] },
    };

    members.forEach((m) => {
      const cat = m.category.toString();
      if (!categories[cat]) {
        categories[cat] = { members: [] };
      }
      categories[cat].members.push({
        id: m.id,
        applicantName: m.applicantName,
        formNumber: m.formNumber,
        category: m.category,
        payment_status: paidMemberIds.has(m.id) ? 1 : 0,
      });
    });

    return { status: true, categories };
  }

  public async getMarriageCongratulationsPayments(marriageCongratulationsId: string) {
    const payments = await prisma.marriageCongratulationsPayment.findMany({
      where: { marriageCongratulationsId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const appIds = payments.map(p => p.applicationId).filter(Boolean) as string[];

    const apps = await prisma.generalApplication.findMany({
      where: { id: { in: appIds }, deletedAt: null },
      select: { id: true, applicantName: true, formNumber: true }
    });

    const appMap = new Map(apps.map(a => [a.id, a]));

    const data = payments.map(p => {
      const app = p.applicationId ? appMap.get(p.applicationId) : null;
      return {
        id: p.id,
        marriageCongratulationsId: p.marriageCongratulationsId,
        applicationId: p.applicationId,
        amount: Number(p.amount),
        category: p.category,
        applicantName: app?.applicantName || "-",
        formNumber: app?.formNumber || "-",
        createdAt: p.createdAt,
        date: p.createdAt,
      };
    });

    return { status: true, data };
  }

  public async deleteMarriageCongratulationsPayment(paymentId: string) {
    return softDeleteRecord(
      prisma.marriageCongratulationsPayment,
      paymentId,
      "Payment record"
    );
  }
}
