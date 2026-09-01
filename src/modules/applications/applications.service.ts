import { prisma, PRISMA_TX_OPTIONS, type PrismaTransactionClient } from "../../config/db";
import { NotFoundError, BadRequestError } from "../../utils/errors";
import { ApplicationCategory, Gender, PaymentMode, Role } from "@prisma/client";
import { isValidUuid } from "../../utils/compat-helpers";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  normalizeListFilters,
  applyAddressContains,
  applyDateRangeToField,
  buildOrderBy,
  paginateByFormNumberSeq,
} from "../../utils/list-filters";
import { parseDateInput } from "../../utils/parse-date";
import { softDeleteWithChildren } from "../../utils/soft-delete";
import { resolveAssociatedUntilText } from "../../utils/associated-until";
import { recordLegacyPaymentEntry, formatCashFlowName, formatEmiContributionName } from "../../utils/legacy-payment-entry";
import { assertAadharAvailable } from "../../utils/aadhar-uniqueness";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { WhatsAppService } from "../../utils/whatsapp";
import { EpinsService } from "../epins/epins.service";
import { DocumentsService } from "../documents/documents.service";

const epinsService = new EpinsService();
const documentsService = new DocumentsService();

function parseRequiredDate(value: unknown, field: string): Date {
  return parseDateInput(value, field);
}

function normalizeGender(value: unknown): Gender {
  const raw = String(value || "").trim();
  if (/^male$/i.test(raw)) return Gender.Male;
  if (/^female$/i.test(raw)) return Gender.Female;
  if (/^other$/i.test(raw)) return Gender.Other;
  if (Object.values(Gender).includes(raw as Gender)) return raw as Gender;
  throw new BadRequestError("Invalid gender");
}

function normalizeCategory(value: unknown): ApplicationCategory {
  const category = String(value || "").trim().toUpperCase();
  if (!Object.values(ApplicationCategory).includes(category as ApplicationCategory)) {
    throw new BadRequestError("Invalid category");
  }
  return category as ApplicationCategory;
}

function normalizePaymentMode(value: unknown): PaymentMode {
  const mode = String(value || "CASH").trim().toUpperCase().replace(/-/g, "_");
  if (mode === "RAZORPAY" || mode === "ONLINE") return PaymentMode.RAZORPAY;
  if (mode === "BANK_TRANSFER") return PaymentMode.BANK_TRANSFER;
  return PaymentMode.CASH;
}

// Normalizes a worker/agent name for matching during bulk import: collapses
// internal whitespace and Unicode-normalizes so visually-identical Hindi
// names typed slightly differently still match an existing agent.
function normalizeAgentName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

// The entry/marriage date can never fall before the account's membership
// (registration) join date — mirrors the client-side check in the
// suraksha-bima-yojana add/edit forms, enforced here too so it can't be
// bypassed via a direct API call.
function assertEntryDateNotBeforeRegistration(entryDate: Date, registrationDate: Date) {
  const entry = new Date(entryDate); entry.setHours(0, 0, 0, 0);
  const reg = new Date(registrationDate); reg.setHours(0, 0, 0, 0);
  if (entry < reg) {
    throw new BadRequestError(
      "Date cannot be earlier than the account registration date"
    );
  }
}

function resolveDeductionFields(data: Record<string, unknown>) {
  const percent = Number(data.deductionPercent) || 10;
  const amount = Number(data.deductionAmount) || 0;
  if (data.deducted10Percent !== undefined || data.deducted25Percent !== undefined) {
    return {
      deducted10Percent: Number(data.deducted10Percent || 0),
      deducted25Percent: Number(data.deducted25Percent || 0),
    };
  }
  return {
    deducted10Percent: percent === 10 ? amount : 0,
    deducted25Percent: percent === 25 ? amount : 0,
  };
}

// Attaches each record's most recent installment as `installments: [latest]`
// (or `[]`), matching the shape mapGeneralApplicationRecord already expects
// from the by-id endpoint's full `include: { installments }`.
//
// Deliberately NOT done via Prisma's `include: { installments: { take: 1 } }`
// on the list query: with 138K+ installment rows, that per-parent `take`
// doesn't get pushed down into a single indexed lateral join by this Prisma
// version's default relation-loading strategy, and instead hangs for minutes
// across ~3K applications. A single raw lateral-join query scoped to just the
// already-fetched IDs runs in seconds even for the whole table.
async function attachLatestInstallments(records: Array<{ id: string; installments?: unknown }>) {
  if (records.length === 0) return;

  const ids = records.map((r) => r.id);
  const latest = await prisma.$queryRaw<Array<{ applicationId: string; date: Date; paymentMode: string }>>`
    SELECT ga.id AS "applicationId", i.date AS "date", i.payment_mode AS "paymentMode"
    FROM general_applications ga
    JOIN LATERAL (
      SELECT date, payment_mode
      FROM general_application_installments gi
      WHERE gi.application_id = ga.id
      ORDER BY gi.date DESC
      LIMIT 1
    ) i ON true
    WHERE ga.id = ANY(${ids}::uuid[])
  `;

  const byApplicationId = new Map(latest.map((row) => [row.applicationId, row]));
  for (const record of records) {
    const match = byApplicationId.get(record.id);
    record.installments = match ? [{ date: match.date, paymentMode: match.paymentMode }] : [];
  }
}

async function generateUniqueBimaNumber(tx: PrismaTransactionClient): Promise<string> {
  await lockFormNumberSequence(tx, "suraksha_bima_bima_number");
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `SB-${Math.floor(Math.random() * 90000) + 10000}`;
    const existing = await tx.surakshaBimaYojana.findFirst({
      where: { bimaNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  const count = await tx.surakshaBimaYojana.count();
  return `SB-${1000 + count + 1}`;
}

function resolveAddedById(data: Record<string, unknown>, fallbackUserId: string, actorRole?: string): string {
  // The Add Application form submits the chosen worker as `addedby_id` (see
  // add/page.tsx), not `selectedAgentId`. Checking the explicit selection —
  // whichever field it arrives under — before falling back to the logged-in
  // user is required: previously `fallbackUserId` was checked before
  // `addedby_id`/`addedById`, so whenever Super Admin submitted the form on
  // behalf of a field worker, the application was silently attributed to
  // Super Admin instead of the worker actually selected in the dropdown.
  //
  // Agents never get this override: the same dropdown is required on
  // agent-facing forms too, so an agent's own submission must always be
  // attributed to themselves regardless of what it holds, or it silently
  // disappears from that agent's own (self-filtered) list view.
  if (actorRole !== "AGENT") {
    const explicitId = data.selectedAgentId ?? data.addedById ?? data.addedby_id;
    if (explicitId && isValidUuid(String(explicitId))) {
      return String(explicitId);
    }
  }

  if (fallbackUserId && isValidUuid(fallbackUserId)) {
    return fallbackUserId;
  }

  throw new BadRequestError("Valid agent/user id is required");
}

import { saveImagePayload } from "../../utils/file-upload";

function resolveUpdatedPhotoUrl(
  data: Record<string, unknown>,
  currentUrl: string | null | undefined
): string | null {
  const candidates = [data.passportPhoto, data.passportPhotoUrl, data.existingPhotoUrl, data.photo, data.passport_photo];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return saveImagePayload(value.trim());
    }
  }
  return saveImagePayload(currentUrl) ?? null;
}

// Boys and girls get separate account-code sequences (like the legacy software):
// Female -> F-001, Male -> M-001, each counting only its own gender so the two
// streams stay independent.
async function nextGeneralFormNumber(tx: PrismaTransactionClient, gender: string) {
  const normalized = normalizeGender(gender);
  const prefix = normalized === "Male" ? "M" : normalized === "Female" ? "F" : "GEN";

  await lockFormNumberSequence(tx, `general_application_form_number:${prefix}`);

  // Fetch only the single highest form number matching the prefix
  const result = await tx.$queryRawUnsafe<Array<{ formNumber: string }>>(`
    SELECT form_number AS "formNumber"
    FROM general_applications
    WHERE form_number LIKE $1
    ORDER BY LENGTH(form_number) DESC, form_number DESC
    LIMIT 1
  `, `${prefix}-%`);

  const maxFormNumber = result[0]?.formNumber;
  let maxNum = 0;
  if (maxFormNumber) {
    const parts = maxFormNumber.split("-");
    if (parts.length === 2) {
      const num = parseInt(parts[1], 10);
      if (!isNaN(num)) {
        maxNum = num;
      }
    }
  }

  return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
}

export class ApplicationsService {
  
  // ==========================================
  // GENERAL APPLICATIONS
  // ==========================================

  /**
   * Create new General Application & optional initial installment
   */
  public async createGeneralApplication(data: any, addedById: string, actorRole?: string) {
    const totalAmount = Number(data.totalAmount);
    const paymentAmount = Number(data.paymentAmount || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new BadRequestError("totalAmount is required");
    }

    const pendingAmount =
      data.pendingAmount !== undefined && data.pendingAmount !== ""
        ? Number(data.pendingAmount)
        : totalAmount - paymentAmount;

    const applicationDate = parseRequiredDate(
      data.applicationDate || data.paymentDate,
      "applicationDate"
    );
    const dateOfBirth = parseRequiredDate(data.dateOfBirth, "dateOfBirth");
    const ownerId = resolveAddedById(data, addedById, actorRole);
    const paymentMode = normalizePaymentMode(data.paymentMode);
    const installmentDate = data.paymentDate
      ? parseRequiredDate(data.paymentDate, "paymentDate")
      : applicationDate;

    const createData = {
      applicationDate,
      applicantName: String(data.applicantName || "").trim(),
      fatherName: String(data.fatherName || "").trim(),
      motherName: String(data.motherName || "").trim(),
      dateOfBirth,
      aadharNumber: String(data.aadharNumber || "").replace(/\D/g, ""),
      gotra: String(data.gotra || "").trim(),
      mobile: String(data.mobile || "").replace(/\D/g, ""),
      address: String(data.address || "").trim(),
      pinCode: String(data.pinCode || "").trim(),
      tehsil: String(data.tehsil || "").trim(),
      district: String(data.district || "").trim(),
      state: String(data.state || "").trim(),
      nomineeName: data.nomineeName ? String(data.nomineeName).trim() : null,
      nomineeRelation: data.nomineeRelation ? String(data.nomineeRelation).trim() : null,
      affidavitUrl: saveImagePayload(data.affidavitUrl || data.affidavit || data.affidavit_url),
      passportPhotoUrl: saveImagePayload(data.passportPhotoUrl || data.passportPhoto || data.passport_photo || data.photo),
      gender: normalizeGender(data.gender),
      category: normalizeCategory(data.category),
      totalAmount,
      pendingAmount: pendingAmount >= 0 ? pendingAmount : 0,
      addedById: ownerId,
    };

    if (!createData.applicantName || !createData.fatherName || !createData.aadharNumber) {
      throw new BadRequestError("Applicant name, father name, and Aadhaar are required");
    }

    const rawPin = (data.epinCode || data.pinNumber || data.pinCode || "").trim();
    const selectedAgentId = data.selectedAgentId || data.agentId || (actorRole === "AGENT" ? addedById : undefined);

    // Validate E-PIN if supplied
    if (rawPin) {
      const validationResult = await epinsService.validateEPin(
        { pinCode: rawPin, agentId: selectedAgentId },
        { userId: addedById, role: (actorRole as any) || "ADMIN" }
      );
      if (!validationResult.valid) {
        throw new BadRequestError(`E-PIN Validation Failed: ${validationResult.message}`);
      }
    }

    const application = await prisma.$transaction(async (tx) => {
      await assertAadharAvailable(tx, createData.aadharNumber);
      const formNumber = await nextGeneralFormNumber(tx, data.gender);

      const application = await tx.generalApplication.create({
        data: { ...createData, formNumber },
      });

      if (paymentAmount > 0) {
        const installment = await tx.generalApplicationInstallment.create({
          data: {
            applicationId: application.id,
            amount: paymentAmount,
            date: installmentDate,
            note: "Registration Initial Payment",
            paymentMode,
            addedById: isValidUuid(addedById) ? addedById : ownerId,
          },
        });

        await recordLegacyPaymentEntry(tx, {
          legacyId: installment.id,
          date: installmentDate,
          amount: paymentAmount,
          name: formatCashFlowName([application.formNumber, application.applicantName, application.address]),
          source: "applications_installment",
          type: "In",
        });
      }

      // If E-PIN was provided, consume it atomically inside transaction
      if (rawPin) {
        await epinsService.consumeEPin(
          {
            pinCode: rawPin,
            applicationId: application.id,
            applicantName: application.applicantName,
            module: "GENERAL_MARRIAGE",
            agentId: selectedAgentId,
            usedById: addedById,
            remarks: `Consumed for Marriage Application ${application.formNumber} (${application.applicantName})`,
          },
          { userId: addedById, role: (actorRole as any) || "ADMIN" },
          tx
        );
      }

      return application;
    }, PRISMA_TX_OPTIONS);

    // Send dynamic standardized WhatsApp thank-you message & Bond PDF via Green API
    if (application?.mobile) {
      void (async () => {
        // 1. Text Message
        try {
          await WhatsAppService.sendSchemeRegistrationThankYou(application.mobile, {
            applicantName: application.applicantName,
            applicationNumber: application.formNumber,
            schemeName: "विवाह योजना",
          });
        } catch (e) {
          console.error("Backend error sending Marriage WhatsApp text notification:", e);
        }

        // 2. Bond PDF Document Delivery
        try {
          const pdfBuffer = await documentsService.generateGeneralApplicationPDF(application.id);
          await WhatsAppService.sendFileByUpload(
            application.mobile,
            pdfBuffer,
            `Marriage_Bond_${application.formNumber}.pdf`,
            `SAF Foundation - विवाह योजना आवेदन पत्र (${application.formNumber})`
          );
        } catch (e) {
          console.error("Backend error sending Marriage WhatsApp Bond PDF:", e);
        }
      })();
    }

    return application;
  }

  /**
   * Retrieve general applications with filter support
   */
  public async getAllGeneralApplications(filters: any) {
    const f = normalizeListFilters(filters);
    const whereClause: any = { deletedAt: null };

    if (f.search) {
      whereClause.OR = [
        { applicantName: { contains: f.search, mode: "insensitive" } },
        { mobile: { contains: f.search } },
        { aadharNumber: { contains: f.search } },
        { formNumber: { contains: f.search, mode: "insensitive" } },
      ];
    }

    if (f.gender) {
      whereClause.gender = f.gender;
    }

    if (f.category) {
      whereClause.category = f.category;
    }

    if (f.addedById) {
      whereClause.addedById = f.addedById;
    }

    applyAddressContains(whereClause, f.address);
    applyDateRangeToField(whereClause, "applicationDate", f.fromDate, f.toDate);

    const page = f.page;
    const limit = f.limit;
    const includeOptions = {
      addedBy: {
        select: { id: true, name: true, mobile: true },
      },
    };

    // Form numbers like "M-1259" can't be ORDER BY'd directly in SQL
    // (lexicographic, not numeric), and DB insertion order reflects when a row
    // was data-entered rather than real paper-form sequence. Paginate using
    // paginateByFormNumberSeq so date ties sort in exact numerical sequence descending.
    const candidates = await prisma.generalApplication.findMany({
      where: whereClause,
      select: { id: true, formNumber: true, applicationDate: true, createdAt: true },
    });
    const { data: records, total } = await paginateByFormNumberSeq(candidates, page, limit, (ids) =>
      prisma.generalApplication.findMany({ where: { id: { in: ids } }, include: includeOptions })
    );
    await attachLatestInstallments(records);

    if (page !== undefined && limit !== undefined) {
      return { data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    }
    return records;
  }

  /**
   * Retrieve general application with installments list
   */
  public async getGeneralApplicationById(id: string) {
    const app = await prisma.generalApplication.findFirst({
      where: { id, deletedAt: null },
      include: {
        addedBy: {
          select: { id: true, name: true, mobile: true },
        },
        installments: {
          orderBy: { date: "asc" },
        },
      },
    });

    if (!app) {
      throw new NotFoundError("General Application not found");
    }

    return app;
  }

  /**
   * Update general application details
   */
  public async updateGeneralApplication(id: string, data: any) {
    const app = await prisma.generalApplication.findFirst({
      where: { id, deletedAt: null },
    });

    if (!app) {
      throw new NotFoundError("General Application not found");
    }

    if (data.aadharNumber !== undefined) {
      const newAadhar = String(data.aadharNumber).replace(/\D/g, "");
      if (newAadhar !== app.aadharNumber) {
        await assertAadharAvailable(prisma, newAadhar, { model: "generalApplication", id });
      }
    }

    const addedByCandidate =
      data.selectedAgentId ?? data.addedby_id ?? data.addedById;

    return prisma.generalApplication.update({
      where: { id },
      data: {
        applicationDate:
          data.applicationDate !== undefined
            ? parseRequiredDate(data.applicationDate, "applicationDate")
            : app.applicationDate,
        applicantName: data.applicantName !== undefined ? data.applicantName : app.applicantName,
        fatherName: data.fatherName !== undefined ? data.fatherName : app.fatherName,
        motherName: data.motherName !== undefined ? data.motherName : app.motherName,
        dateOfBirth:
          data.dateOfBirth !== undefined
            ? parseRequiredDate(data.dateOfBirth, "dateOfBirth")
            : app.dateOfBirth,
        aadharNumber:
          data.aadharNumber !== undefined
            ? String(data.aadharNumber).replace(/\D/g, "")
            : app.aadharNumber,
        gotra: data.gotra !== undefined ? data.gotra : app.gotra,
        mobile: data.mobile !== undefined ? data.mobile : app.mobile,
        address: data.address !== undefined ? data.address : app.address,
        pinCode: data.pinCode !== undefined ? data.pinCode : app.pinCode,
        tehsil: data.tehsil !== undefined ? data.tehsil : app.tehsil,
        district: data.district !== undefined ? data.district : app.district,
        state: data.state !== undefined ? data.state : app.state,
        nomineeName: data.nomineeName !== undefined ? data.nomineeName : app.nomineeName,
        nomineeRelation: data.nomineeRelation !== undefined ? data.nomineeRelation : app.nomineeRelation,
        gender: data.gender !== undefined ? normalizeGender(data.gender) : app.gender,
        category: data.category !== undefined ? normalizeCategory(data.category) : app.category,
        ...(data.totalAmount !== undefined ? { totalAmount: data.totalAmount } : {}),
        ...(data.pendingAmount !== undefined ? { pendingAmount: data.pendingAmount } : {}),
        ...(addedByCandidate && isValidUuid(String(addedByCandidate))
          ? { addedById: String(addedByCandidate) }
          : {}),
        passportPhotoUrl: resolveUpdatedPhotoUrl(data, app.passportPhotoUrl),
        affidavitUrl:
          data.affidavit !== undefined && data.affidavit !== ""
            ? data.affidavit
            : data.affidavitUrl !== undefined
            ? data.affidavitUrl
            : app.affidavitUrl,
      },
    });
  }

  /**
   * Update insurance application details
   */
  public async updateInsuranceApplication(id: string, data: any) {
    const app = await prisma.insuranceApplication.findFirst({
      where: { id, deletedAt: null },
    });

    if (!app) {
      throw new NotFoundError("Insurance Application not found");
    }

    if (data.aadharNumber !== undefined) {
      const newAadhar = String(data.aadharNumber).replace(/\D/g, "");
      if (newAadhar !== app.aadharNumber) {
        await assertAadharAvailable(prisma, newAadhar, { model: "insuranceApplication", id });
      }
    }

    const addedByCandidate =
      data.selectedAgentId ?? data.addedby_id ?? data.addedById;

    return prisma.insuranceApplication.update({
      where: { id },
      data: {
        applicationDate:
          data.applicationDate !== undefined
            ? parseRequiredDate(data.applicationDate, "applicationDate")
            : app.applicationDate,
        applicantName: data.applicantName !== undefined ? data.applicantName : app.applicantName,
        fatherName: data.fatherName !== undefined ? data.fatherName : app.fatherName,
        wifeName: data.wifeName !== undefined ? data.wifeName : app.wifeName,
        motherName: data.motherName !== undefined ? data.motherName : app.motherName,
        dateOfBirth:
          data.dateOfBirth !== undefined
            ? parseRequiredDate(data.dateOfBirth, "dateOfBirth")
            : app.dateOfBirth,
        aadharNumber:
          data.aadharNumber !== undefined
            ? String(data.aadharNumber).replace(/\D/g, "")
            : app.aadharNumber,
        gotra: data.gotra !== undefined ? data.gotra : app.gotra,
        mobile: data.mobile !== undefined ? data.mobile : app.mobile,
        address: data.address !== undefined ? data.address : app.address,
        pinCode: data.pinCode !== undefined ? data.pinCode : app.pinCode,
        tehsil: data.tehsil !== undefined ? data.tehsil : app.tehsil,
        district: data.district !== undefined ? data.district : app.district,
        state: data.state !== undefined ? data.state : app.state,
        nomineeName: data.nomineeName !== undefined ? data.nomineeName : app.nomineeName,
        nomineeRelation: data.nomineeRelation !== undefined ? data.nomineeRelation : app.nomineeRelation,
        gender: data.gender !== undefined ? normalizeGender(data.gender) : app.gender,
        category: data.category !== undefined ? normalizeCategory(data.category) : app.category,
        ...(data.totalAmount !== undefined ? { totalAmount: data.totalAmount } : {}),
        ...(data.pendingAmount !== undefined ? { pendingAmount: data.pendingAmount } : {}),
        ...(addedByCandidate && isValidUuid(String(addedByCandidate))
          ? { addedById: String(addedByCandidate) }
          : {}),
        passportPhotoUrl: resolveUpdatedPhotoUrl(
          {
            passportPhoto: data.passportPhoto,
            passportPhotoUrl: data.passportPhotoUrl,
            existingPhotoUrl: data.existingPhotoUrl ?? data.existingPassportPhoto,
          },
          app.passportPhotoUrl
        ),
      },
    });
  }

  /**
   * Soft delete General Application
   */
  public async softDeleteGeneralApplication(id: string) {
    return softDeleteWithChildren(
      prisma.generalApplication,
      id,
      "General Application",
      [{ model: prisma.generalApplicationInstallment, fkField: "applicationId" }],
      { deactivate: true }
    );
  }

  /**
   * Add installment payment to General Application
   */
  public async addGeneralInstallment(applicationId: string, data: any, addedById: string) {
    const app = await prisma.generalApplication.findFirst({
      where: { id: applicationId, deletedAt: null },
    });

    if (!app) {
      throw new NotFoundError("General Application not found");
    }

    const installmentDate = parseRequiredDate(data.date, "date");

    return prisma.$transaction(async (tx) => {
      // Create installment record
      const installment = await tx.generalApplicationInstallment.create({
        data: {
          applicationId,
          amount: data.amount,
          date: installmentDate,
          note: data.note || null,
          paymentMode: normalizePaymentMode(data.paymentMode),
          addedById: addedById,
        },
      });

      // Deduct pending amount
      const newPendingAmount = Number(app.pendingAmount) - Number(data.amount);
      await tx.generalApplication.update({
        where: { id: applicationId },
        data: { pendingAmount: newPendingAmount >= 0 ? newPendingAmount : 0 },
      });

      await recordLegacyPaymentEntry(tx, {
        legacyId: installment.id,
        date: installmentDate,
        amount: data.amount,
        name: formatCashFlowName([app.formNumber, app.applicantName, app.address]),
        source: "applications_installment",
        type: "In",
      });

      return installment;
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * Create new Insurance Application
   */
  public async createInsuranceApplication(data: any, addedById: string, actorRole?: string) {
    const totalAmount = Number(data.totalAmount);
    const paymentAmount = Number(data.paymentAmount || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new BadRequestError("totalAmount is required");
    }

    const pendingAmount =
      data.pendingAmount !== undefined && data.pendingAmount !== ""
        ? Number(data.pendingAmount)
        : totalAmount - paymentAmount;

    const applicationDate = parseRequiredDate(
      data.applicationDate || data.paymentDate,
      "applicationDate"
    );
    const dateOfBirth = parseRequiredDate(data.dateOfBirth, "dateOfBirth");
    const ownerId = resolveAddedById(data, addedById, actorRole);
    const paymentMode = normalizePaymentMode(data.paymentMode);
    const installmentDate = data.paymentDate
      ? parseRequiredDate(data.paymentDate, "paymentDate")
      : applicationDate;

    const aadharNumber = String(data.aadharNumber || "").replace(/\D/g, "");

    const rawPin = (data.epinCode || data.pinNumber || data.pinCode || "").trim();
    const selectedAgentId = data.selectedAgentId || data.agentId || (actorRole === "AGENT" ? addedById : undefined);

    // Validate E-PIN if supplied
    if (rawPin) {
      const validationResult = await epinsService.validateEPin(
        { pinCode: rawPin, agentId: selectedAgentId },
        { userId: addedById, role: (actorRole as any) || "ADMIN" }
      );
      if (!validationResult.valid) {
        throw new BadRequestError(`E-PIN Validation Failed: ${validationResult.message}`);
      }
    }

    const application = await prisma.$transaction(async (tx) => {
      await lockFormNumberSequence(tx, "insurance_application_form_number");
      await assertAadharAvailable(tx, aadharNumber);

      // Continue the existing S-### sequence (legacy-imported data goes up to
      // S-491) rather than starting a separate INS-#### numbering scheme.
      const result = await tx.$queryRawUnsafe<Array<{ formNumber: string }>>(`
        SELECT form_number AS "formNumber"
        FROM insurance_applications
        WHERE form_number LIKE 'S-%'
        ORDER BY LENGTH(form_number) DESC, form_number DESC
        LIMIT 1
      `);
      const maxFormNumber = result[0]?.formNumber;
      let maxSNum = 0;
      if (maxFormNumber) {
        const num = parseInt(maxFormNumber.split("-")[1], 10);
        if (!isNaN(num)) maxSNum = num;
      }
      const formNumber = `S-${maxSNum + 1}`;

      const application = await tx.insuranceApplication.create({
        data: {
          formNumber,
          applicationDate,
          applicantName: String(data.applicantName || "").trim(),
          fatherName: String(data.fatherName || "").trim(),
          wifeName: data.wifeName ? String(data.wifeName).trim() : null,
          motherName: String(data.motherName || "").trim(),
          dateOfBirth,
          aadharNumber,
          gotra: String(data.gotra || "").trim(),
          mobile: String(data.mobile || "").replace(/\D/g, ""),
          address: String(data.address || "").trim(),
          pinCode: String(data.pinCode || "").trim(),
          tehsil: String(data.tehsil || "").trim(),
          district: String(data.district || "").trim(),
          state: String(data.state || "").trim(),
          nomineeName: data.nomineeName ? String(data.nomineeName).trim() : null,
          nomineeRelation: data.nomineeRelation ? String(data.nomineeRelation).trim() : null,
          gender: normalizeGender(data.gender),
          category: normalizeCategory(data.category),
          totalAmount,
          pendingAmount: pendingAmount >= 0 ? pendingAmount : 0,
          passportPhotoUrl: data.passportPhotoUrl || data.passportPhoto || null,
          addedById: ownerId,
        },
      });

      if (paymentAmount > 0) {
        const installment = await tx.insuranceApplicationInstallment.create({
          data: {
            applicationInsuranceId: application.id,
            amount: paymentAmount,
            date: installmentDate,
            note: "Registration Initial Payment",
            paymentMode,
            addedById: isValidUuid(addedById) ? addedById : ownerId,
          },
        });

        await recordLegacyPaymentEntry(tx, {
          legacyId: installment.id,
          date: installmentDate,
          amount: paymentAmount,
          name: formatCashFlowName([application.formNumber, application.applicantName, application.address]),
          source: "application_insurance_installment",
          type: "In",
        });
      }

      // If E-PIN was provided, consume it atomically inside transaction
      if (rawPin) {
        await epinsService.consumeEPin(
          {
            pinCode: rawPin,
            applicationId: application.id,
            applicantName: application.applicantName,
            module: "INSURANCE_BIMA",
            agentId: selectedAgentId,
            usedById: addedById,
            remarks: `Consumed for Insurance Application ${application.formNumber} (${application.applicantName})`,
          },
          { userId: addedById, role: (actorRole as any) || "ADMIN" },
          tx
        );
      }

      return application;
    }, PRISMA_TX_OPTIONS);

    // Send dynamic standardized WhatsApp thank-you message & Bond PDF via Green API
    if (application?.mobile) {
      void (async () => {
        // 1. Text Message
        try {
          await WhatsAppService.sendSchemeRegistrationThankYou(application.mobile, {
            applicantName: application.applicantName,
            applicationNumber: application.formNumber,
            schemeName: "बीमा योजना",
          });
        } catch (e) {
          console.error("Backend error sending Insurance WhatsApp text notification:", e);
        }

        // 2. Bond PDF Document Delivery
        try {
          const pdfBuffer = await documentsService.generateInsuranceApplicationPDF(application.id);
          await WhatsAppService.sendFileByUpload(
            application.mobile,
            pdfBuffer,
            `Insurance_Bond_${application.formNumber}.pdf`,
            `SAF Foundation - बीमा योजना आवेदन पत्र (${application.formNumber})`
          );
        } catch (e) {
          console.error("Backend error sending Insurance WhatsApp Bond PDF:", e);
        }
      })();
    }

    return application;
  }

  /**
   * Get insurance applications
   */
  public async getAllInsuranceApplications(filters: any) {
    const f = normalizeListFilters(filters);
    const whereClause: any = { deletedAt: null };

    if (f.search) {
      whereClause.OR = [
        { applicantName: { contains: f.search, mode: "insensitive" } },
        { mobile: { contains: f.search } },
        { aadharNumber: { contains: f.search } },
        { formNumber: { contains: f.search, mode: "insensitive" } },
      ];
    }

    if (f.gender) {
      whereClause.gender = f.gender;
    }

    if (f.category) {
      whereClause.category = f.category;
    }

    if (f.addedById) {
      whereClause.addedById = f.addedById;
    }

    if (f.tehsil) {
      whereClause.tehsil = { contains: f.tehsil, mode: "insensitive" };
    }

    applyAddressContains(whereClause, f.address);
    applyDateRangeToField(whereClause, "applicationDate", f.fromDate, f.toDate);

    const page = f.page;
    const limit = f.limit;
    const includeOptions = {
      addedBy: {
        select: { id: true, name: true, mobile: true },
      },
      surakshaBima: true,
    };

    if (f.sortBy === "lastAdded") {
      // See paginateByFormNumberSeq in list-filters.ts / the matching fix in
      // getAllGeneralApplications above -- same lexicographic-vs-numeric bug.
      const candidates = await prisma.insuranceApplication.findMany({
        where: whereClause,
        select: { id: true, formNumber: true, createdAt: true },
      });
      const { data: records, total } = await paginateByFormNumberSeq(candidates, page, limit, (ids) =>
        prisma.insuranceApplication.findMany({ where: { id: { in: ids } }, include: includeOptions })
      );

      if (page !== undefined && limit !== undefined) {
        return { data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
      }
      return records;
    }

    const queryOptions: any = {
      where: whereClause,
      include: includeOptions,
      orderBy: buildOrderBy(f.sortBy, "srNo"),
    };

    if (page !== undefined && limit !== undefined) {
      queryOptions.skip = (page - 1) * limit;
      queryOptions.take = limit;
    }

    const records = await prisma.insuranceApplication.findMany(queryOptions);

    if (page !== undefined && limit !== undefined) {
      const total = await prisma.insuranceApplication.count({ where: whereClause });
      return {
        data: records,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    return records;
  }

  /**
   * Get insurance application by id
   */
  public async getInsuranceApplicationById(id: string) {
    const app = await prisma.insuranceApplication.findFirst({
      where: { id, deletedAt: null },
      include: {
        addedBy: {
          select: { id: true, name: true, mobile: true },
        },
        installments: {
          orderBy: { date: "asc" },
        },
        surakshaBima: true,
      },
    });

    if (!app) {
      throw new NotFoundError("Insurance Application not found");
    }

    return app;
  }

  /**
   * Soft delete insurance application
   */
  public async softDeleteInsuranceApplication(id: string) {
    return softDeleteWithChildren(
      prisma.insuranceApplication,
      id,
      "Insurance Application",
      [{ model: prisma.insuranceApplicationInstallment, fkField: "applicationInsuranceId" }],
      { deactivate: true }
    );
  }

  /**
   * Add installment to Insurance Application
   */
  public async addInsuranceInstallment(insuranceAppId: string, data: any, addedById: string) {
    const app = await prisma.insuranceApplication.findFirst({
      where: { id: insuranceAppId, deletedAt: null },
    });

    if (!app) {
      throw new NotFoundError("Insurance Application not found");
    }

    return prisma.$transaction(async (tx) => {
      const installmentDate = parseRequiredDate(data.date, "date");
      const installment = await tx.insuranceApplicationInstallment.create({
        data: {
          applicationInsuranceId: insuranceAppId,
          amount: data.amount,
          date: installmentDate,
          note: data.note || null,
          paymentMode: normalizePaymentMode(data.paymentMode),
          addedById: addedById,
        },
      });

      const newPendingAmount = Number(app.pendingAmount) - Number(data.amount);
      await tx.insuranceApplication.update({
        where: { id: insuranceAppId },
        data: { pendingAmount: newPendingAmount >= 0 ? newPendingAmount : 0 },
      });

      // BIMA_PAYMENT-tagged notes belong to Suraksha Bima EMI collection, not the plain
      // insurance installment ledger — see createSurakshaBimaPayment for the usual writer.
      const isBimaPayment = (data.note || "").startsWith("BIMA_PAYMENT:");
      const bimaId = isBimaPayment ? data.note.match(/^BIMA_PAYMENT:([^\s]+)/)?.[1] : null;
      const bima = bimaId
        ? await tx.surakshaBimaYojana.findUnique({ where: { id: bimaId }, select: { applicantName: true, bimaNumber: true } })
        : null;

      await recordLegacyPaymentEntry(tx, {
        legacyId: installment.id,
        date: installmentDate,
        amount: data.amount,
        name: isBimaPayment
          ? formatEmiContributionName(
              [app.formNumber, app.applicantName, app.address],
              bima ? { name: bima.applicantName, code: bima.bimaNumber, scheme: "Suraksha Bima Yojana" } : null
            )
          : formatCashFlowName([app.formNumber, app.applicantName, app.address]),
        source: isBimaPayment ? "suraksha_bima_emi" : "application_insurance_installment",
        type: "In",
      });

      return installment;
    }, PRISMA_TX_OPTIONS);
  }

  // ==========================================
  // SURAKSHA BIMA YOJANA DETAILS
  // ==========================================

  /**
   * Create or bind Suraksha Bima Yojana details to Insurance Application
   */
  public async createSurakshaBima(insuranceApplicationId: string, data: any) {
    if (!insuranceApplicationId || !isValidUuid(String(insuranceApplicationId))) {
      throw new BadRequestError("Valid insuranceApplication_id is required");
    }

    const app = await prisma.insuranceApplication.findFirst({
      where: { id: insuranceApplicationId, deletedAt: null },
    });

    if (!app) {
      throw new NotFoundError("Insurance Application not found");
    }

    // Check if bima details already exist
    const existing = await prisma.surakshaBimaYojana.findUnique({
      where: { insuranceApplicationId },
    });

    if (existing) {
      throw new BadRequestError("Suraksha Bima Yojana details are already bound to this application");
    }

    const deductions = resolveDeductionFields(data);
    const entryDate = parseRequiredDate(data.date, "date");
    const membershipJoinDate = parseRequiredDate(data.membershipJoinDate, "membershipJoinDate");
    assertEntryDateNotBeforeRegistration(entryDate, membershipJoinDate);

    return prisma.$transaction(async (tx) => {
      const bimaNumber =
        typeof data.bimaNumber === "string" && data.bimaNumber.trim()
          ? data.bimaNumber.trim()
          : await generateUniqueBimaNumber(tx);

      const record = await tx.surakshaBimaYojana.create({
        data: {
          insuranceApplicationId,
          date: entryDate,
          codeNumber: String(data.codeNumber || app.formNumber || "").trim(),
          bimaNumber,
          applicantName: app.applicantName,
          fatherName: app.fatherName,
          wifeOf: app.wifeName || null,
          gotra: app.gotra,
          address: app.address,
          membershipJoinDate,
          associatedUntil: resolveAssociatedUntilText({
            associatedUntil: data.associatedUntil,
            date: entryDate,
            membershipJoinDate,
          }),
          permanentFee: Number(data.permanentFee || 0),
          installmentAmount: Number(data.installmentAmount || 0),
          totalGrantAmount: Number(data.totalGrantAmount || 0),
          totalMembersServing: Number(data.totalMembersServing || 0),
          rate200: Number(data.rate200 || 0),
          deducted10Percent: deductions.deducted10Percent,
          deducted25Percent: deductions.deducted25Percent,
          totalPaidAmount: Number(data.totalPaidAmount || 0),
          remark: data.remark || null,
        },
      });

      // Once Suraksha Bima Yojana details are submitted for this member, their
      // insurance application is deactivated so no further bima EMI is
      // calculated or paid for them going forward.
      await tx.insuranceApplication.update({
        where: { id: insuranceApplicationId },
        data: { isActive: false },
      });

      return record;
    });
  }

  public async updateSurakshaBima(id: string, data: any) {
    if (!id || !isValidUuid(String(id))) {
      throw new BadRequestError("Valid id is required");
    }

    const existing = await prisma.surakshaBimaYojana.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundError("Suraksha Bima record not found");
    }

    const deductions = resolveDeductionFields(data);
    const entryDate = data.date !== undefined ? parseRequiredDate(data.date, "date") : existing.date;
    const membershipJoinDate =
      data.membershipJoinDate !== undefined
        ? parseRequiredDate(data.membershipJoinDate, "membershipJoinDate")
        : existing.membershipJoinDate;
    assertEntryDateNotBeforeRegistration(entryDate, membershipJoinDate);

    return prisma.surakshaBimaYojana.update({
      where: { id },
      data: {
        date: data.date !== undefined ? entryDate : undefined,
        codeNumber: data.codeNumber !== undefined ? String(data.codeNumber) : undefined,
        bimaNumber: data.bimaNumber !== undefined ? String(data.bimaNumber) : undefined,
        applicantName: data.applicantName !== undefined ? String(data.applicantName) : undefined,
        fatherName: data.fatherName !== undefined ? String(data.fatherName) : undefined,
        wifeOf: data.wifeOf !== undefined ? (data.wifeOf || null) : undefined,
        gotra: data.gotra !== undefined ? String(data.gotra) : undefined,
        address: data.address !== undefined ? String(data.address) : undefined,
        membershipJoinDate: data.membershipJoinDate !== undefined ? membershipJoinDate : undefined,
        associatedUntil:
          data.associatedUntil !== undefined
            ? resolveAssociatedUntilText({
                associatedUntil: data.associatedUntil,
                date: entryDate,
                membershipJoinDate,
              })
            : undefined,
        permanentFee: data.permanentFee !== undefined ? Number(data.permanentFee) : undefined,
        installmentAmount: data.installmentAmount !== undefined ? Number(data.installmentAmount) : undefined,
        totalGrantAmount: data.totalGrantAmount !== undefined ? Number(data.totalGrantAmount) : undefined,
        totalMembersServing: data.totalMembersServing !== undefined ? Number(data.totalMembersServing) : undefined,
        rate200: data.rate200 !== undefined ? Number(data.rate200) : undefined,
        deducted10Percent: data.deductionPercent !== undefined || data.deducted10Percent !== undefined
          ? deductions.deducted10Percent
          : undefined,
        deducted25Percent: data.deductionPercent !== undefined || data.deducted25Percent !== undefined
          ? deductions.deducted25Percent
          : undefined,
        totalPaidAmount: data.totalPaidAmount !== undefined ? Number(data.totalPaidAmount) : undefined,
        remark: data.remark !== undefined ? (data.remark || null) : undefined,
      },
    });
  }

  public async bulkImportGeneralApplications(rows: any[], currentAdminId: string) {
    const defaultAdminId = currentAdminId;

    // Fetch all existing users to build cache
    const existingUsers = await prisma.user.findMany({
      select: { id: true, name: true, mobile: true, role: true }
    });

    const userByMobile = new Map<string, string>();
    const userByName = new Map<string, string>();

    for (const user of existingUsers) {
      if (user.mobile) userByMobile.set(user.mobile.trim(), user.id);
      if (user.name) userByName.set(normalizeAgentName(user.name), user.id);
    }

    // 1. Gather all unique agents/workers from rows
    const uniqueAgents = new Map<string, { name: string; mobile: string }>();
    for (const row of rows) {
      const agentName = String(row['कार्यकर्ता का नाम'] || '').trim();
      const agentMobile = String(row['कार्यकर्ता का मोबाइल'] || '').trim().replace(/\D/g, '');

      if (agentName || agentMobile) {
        const key = agentMobile || agentName;
        if (!uniqueAgents.has(key)) {
          uniqueAgents.set(key, { name: agentName || 'Unknown Agent', mobile: agentMobile });
        }
      }
    }

    // Password hash for auto-created agents
    const salt = await bcrypt.genSalt(10);
    const defaultPasswordHash = await bcrypt.hash('123456', salt);

    // Resolve/Create agents in the database
    const resolvedAgentIds = new Map<string, string>();
    // Agent keys we couldn't confidently resolve to a real user. Rows referencing
    // these are skipped (not silently attributed to the importing admin) so the
    // sheet's original worker name isn't lost/mislabeled — see bulk-import agent
    // attribution bug: unmatched name + no mobile used to overwrite addedById
    // with the importing Super Admin's id.
    const unresolvedAgentKeys = new Set<string>();
    let createdAgentsCount = 0;

    for (const [key, agent] of uniqueAgents.entries()) {
      let agentId: string | null = null;

      // Check by mobile
      if (agent.mobile && userByMobile.has(agent.mobile)) {
        agentId = userByMobile.get(agent.mobile)!;
      }
      // Check by name
      else if (agent.name && userByName.has(normalizeAgentName(agent.name))) {
        agentId = userByName.get(normalizeAgentName(agent.name))!;
      }

      if (agentId) {
        resolvedAgentIds.set(key, agentId);
      } else {
        if (!agent.mobile) {
          unresolvedAgentKeys.add(key);
          continue;
        }

        try {
          const newUser = await prisma.$transaction(async (tx) => {
            await lockFormNumberSequence(tx, "agent_employee_id");
            const agentCount = await tx.agentProfile.count();
            const employeeId = `EMP-${String(agentCount + 1).padStart(3, "0")}`;

            const user = await tx.user.create({
              data: {
                name: agent.name,
                mobile: agent.mobile,
                passwordHash: defaultPasswordHash,
                role: Role.AGENT,
                isActive: true,
              },
            });

            await tx.agentProfile.create({
              data: {
                userId: user.id,
                employeeId,
                fatherName: "Default",
                gotra: "Prajapat",
                age: 25,
                gender: Gender.Male,
                village: "",
                address: "",
                tehsil: "",
                district: "",
                workArea: "",
                bankName: "",
                accountNumber: "",
                ifscCode: "",
                nomineeName: "",
                nomineeMobile: "",
                nomineeRelation: "",
                registrationDate: new Date(),
              },
            });

            const defaultModules = [
              "dashboard",
              "agent_registration",
              "applicant_registration",
              "mayra_registration",
              "payment_management",
              "marriage_congratulations_payment",
              "suraksha_bima_yojana_payment",
              "bulk_marriage_emi",
              "bulk_suraksha_bima_emi",
              "bulk_mayra_emi",
            ];

            await tx.agentPermission.createMany({
              data: defaultModules.map((mod) => ({
                userId: user.id,
                module: mod,
                canView: true,
                canCreate: mod.includes("registration"),
                canUpdate: mod.includes("registration"),
                canDelete: false,
              })),
            });

            return user;
          }, {
            timeout: 30000
          });

          userByMobile.set(agent.mobile, newUser.id);
          userByName.set(normalizeAgentName(agent.name), newUser.id);
          resolvedAgentIds.set(key, newUser.id);
          createdAgentsCount++;
        } catch (err: any) {
          console.error(`Failed to create agent ${agent.name} (${agent.mobile}):`, err.message);
          unresolvedAgentKeys.add(key);
        }
      }
    }

    // 2. Fetch existing General Applications to ensure idempotency by Aadhaar
    const existingApps = await prisma.generalApplication.findMany({
      select: { aadharNumber: true }
    });
    const existingAadhars = new Set(existingApps.map(app => app.aadharNumber.trim()));

    // Counters for generating form numbers
    const femaleCountDB = await prisma.generalApplication.count({ where: { gender: Gender.Female } });
    const maleCountDB = await prisma.generalApplication.count({ where: { gender: Gender.Male } });
    const otherCountDB = await prisma.generalApplication.count({ where: { gender: Gender.Other } });

    let femaleCounter = femaleCountDB;
    let maleCounter = maleCountDB;
    let otherCounter = otherCountDB;

    const generateNextFormNumber = (g: Gender) => {
      if (g === Gender.Female) {
        femaleCounter++;
        return `GF-${String(femaleCounter).padStart(3, "0")}`;
      } else if (g === Gender.Male) {
        maleCounter++;
        return `GM-${String(maleCounter).padStart(3, "0")}`;
      } else {
        otherCounter++;
        return `GEN-${String(otherCounter).padStart(3, "0")}`;
      }
    };

    // Helpers for validation/mapping
    const parseImportDate = (val: any): Date | null => {
      if (!val) return null;
      if (val instanceof Date) {
        if (!isNaN(val.getTime())) {
          return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
        }
        return null;
      }
      if (typeof val === 'number') {
        const d = new Date((val - 25569) * 86400 * 1000);
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      }
      try {
        return parseDateInput(val, 'importDate');
      } catch {
        return null;
      }
    };

    const mapImportGender = (val: any) => {
      const raw = String(val || "").trim().toLowerCase();
      if (raw.includes("female") || raw.includes("महिला") || raw.includes("स्त्री")) {
        return Gender.Female;
      }
      if (raw.includes("male") || raw.includes("पुरुष") || raw.includes("मर्द्")) {
        return Gender.Male;
      }
      return Gender.Other;
    };

    const mapImportCategory = (val: any) => {
      const raw = String(val || "").trim().toUpperCase();
      if (raw === 'A' || raw === 'B' || raw === 'C') {
        return raw as ApplicationCategory;
      }
      return ApplicationCategory.A;
    };

    const getImportFee = (cat: ApplicationCategory) => {
      if (cat === ApplicationCategory.A) return 3000;
      if (cat === ApplicationCategory.B) return 6000;
      if (cat === ApplicationCategory.C) return 9000;
      return 3000;
    };

    const validateAndClamp = (idx: number, fieldName: string, val: any, maxLength: number) => {
      if (val === undefined || val === null) return null;
      const str = String(val).trim();
      if (str.length > maxLength) {
        console.warn(`Row ${idx + 2}: Field "${fieldName}" truncated from ${str.length} to ${maxLength} characters.`);
        return str.substring(0, maxLength);
      }
      return str;
    };

    const applicationsToInsert: any[] = [];
    let skippedRowsCount = 0;
    let duplicateSkipCount = 0;
    let skippedUnresolvedAgentCount = 0;

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];

      const aadharNumber = String(row['आधार संख्या'] || '').trim().replace(/\D/g, '');
      if (aadharNumber && existingAadhars.has(aadharNumber)) {
        duplicateSkipCount++;
        continue;
      }

      const applicantName = String(row['आवेदक का नाम'] || '').trim();
      const fatherName = String(row['पिता का नाम'] || '').trim();

      if (!applicantName || !fatherName || !aadharNumber) {
        skippedRowsCount++;
        continue;
      }

      const appDate = parseImportDate(row['आवेदन तिथि']);
      const dob = parseImportDate(row['जन्म तिथि']);
      if (!appDate || !dob) {
        skippedRowsCount++;
        continue;
      }

      const motherName = String(row['माता का नाम'] || '').trim();
      const gotra = String(row['गोत्र'] || 'Prajapat').trim();
      const mobile = String(row['मोबाइल'] || '').trim().replace(/\D/g, '');
      const address = String(row['गाँव'] || '').trim();
      const pinCode = String(row['पिन कोड'] || '').trim();
      const tehsil = String(row['तहसील'] || '').trim();
      const district = String(row['जिला'] || '').trim();
      const state = String(row['राज्य'] || '').trim();
      const nomineeName = row['नामिनी का नाम'] ? String(row['नामिनी का नाम']).trim() : null;
      const nomineeRelation = row['नामिनी का सम्बन्ध'] ? String(row['नामिनी का सम्बन्ध']).trim() : null;

      const gender = mapImportGender(row['लिंग']);
      const category = mapImportCategory(row['श्रेणी']);
      const totalAmount = getImportFee(category);

      const agentName = String(row['कार्यकर्ता का नाम'] || '').trim();
      const agentMobile = String(row['कार्यकर्ता का मोबाइल'] || '').trim().replace(/\D/g, '');
      const agentKey = agentMobile || agentName;

      // A named worker that couldn't be matched or auto-created must not be
      // silently imported under the admin's identity — skip so the sheet can
      // be corrected (add a mobile number or fix the name) and re-imported.
      if (agentKey && unresolvedAgentKeys.has(agentKey)) {
        skippedUnresolvedAgentCount++;
        continue;
      }

      const addedById = resolvedAgentIds.get(agentKey) || defaultAdminId;

      const isActive = String(row['Active'] || 'Yes').trim().toLowerCase().startsWith('y') ||
                       String(row['Active'] || '').trim().toLowerCase() === 'active';

      const generatedFormNumber = generateNextFormNumber(gender);
      existingAadhars.add(aadharNumber);

      applicationsToInsert.push({
        id: randomUUID(),
        formNumber: generatedFormNumber,
        applicationDate: appDate,
        applicantName: validateAndClamp(idx, 'applicantName', applicantName, 100),
        fatherName: validateAndClamp(idx, 'fatherName', fatherName, 100),
        motherName: validateAndClamp(idx, 'motherName', motherName, 100),
        dateOfBirth: dob,
        aadharNumber: validateAndClamp(idx, 'aadharNumber', aadharNumber, 12),
        gotra: validateAndClamp(idx, 'gotra', gotra, 50),
        mobile: validateAndClamp(idx, 'mobile', mobile, 15),
        address,
        pinCode: validateAndClamp(idx, 'pinCode', pinCode, 10),
        tehsil: validateAndClamp(idx, 'tehsil', tehsil, 100),
        district: validateAndClamp(idx, 'district', district, 100),
        state: validateAndClamp(idx, 'state', state, 100),
        nomineeName: validateAndClamp(idx, 'nomineeName', nomineeName, 100),
        nomineeRelation: validateAndClamp(idx, 'nomineeRelation', nomineeRelation, 50),
        gender,
        category,
        totalAmount,
        pendingAmount: totalAmount,
        isActive,
        addedById,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const CHUNK_SIZE = 500;
    let importedCount = 0;

    for (let i = 0; i < applicationsToInsert.length; i += CHUNK_SIZE) {
      const chunk = applicationsToInsert.slice(i, i + CHUNK_SIZE);
      await prisma.generalApplication.createMany({ data: chunk });
      importedCount += chunk.length;
    }

    return {
      totalRows: rows.length,
      imported: importedCount,
      skippedIncomplete: skippedRowsCount,
      skippedExisting: duplicateSkipCount,
      skippedUnresolvedAgent: skippedUnresolvedAgentCount,
      createdAgents: createdAgentsCount,
    };
  }
}
