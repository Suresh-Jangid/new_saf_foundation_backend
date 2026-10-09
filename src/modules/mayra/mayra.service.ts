import { resolveMayraGroup, validateContributionGroupMatch, getExpectedInstallmentAmount } from "../../utils/contribution-group";
import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { NotFoundError, BadRequestError } from "../../utils/errors";
import { isValidUuid, resolveAgentSeniorHierarchyBatch } from "../../utils/compat-helpers";
import {
  normalizeListFilters,
  applyAddressContains,
  applyDateRangeToField,
  paginateByFormNumberSeq,
} from "../../utils/list-filters";
import { parseDateInput } from "../../utils/parse-date";
import { softDeleteRecord, softDeleteWithChildren } from "../../utils/soft-delete";
import { Gender } from "@prisma/client";
import { normalizePaymentMode } from "../../utils/normalize";
import { recordLegacyPaymentEntry, formatCashFlowName, formatEmiContributionName } from "../../utils/legacy-payment-entry";
import { assertAadharAvailable } from "../../utils/aadhar-uniqueness";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { WhatsAppService } from "../../utils/whatsapp";
import { EpinsService } from "../epins/epins.service";

const epinsService = new EpinsService();

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

// count()-based numbering jumps ahead whenever soft-deleted rows (test data,
// aborted concurrency tests, etc.) inflate the row total without occupying a
// real slot in the visible MYR-### sequence. Deriving from the highest
// formNumber actually in use among live rows keeps new registrations
// continuing right after the last visible record instead.
async function nextMayraFormNumber(tx: PrismaTransactionClient): Promise<string> {
  await lockFormNumberSequence(tx, "mayra_registration_form_number");

  const result = await tx.$queryRawUnsafe<Array<{ formNumber: string }>>(`
    SELECT form_number AS "formNumber"
    FROM mayra_registrations
    WHERE form_number LIKE 'MYR-%' AND deleted_at IS NULL
    ORDER BY LENGTH(form_number) DESC, form_number DESC
    LIMIT 1
  `);

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

  return `MYR-${maxNum + 1}`;
}

export class MayraService {
  /**
   * Create new Mayra Registration & optional initial installment
   */
  public async createMayraRegistration(data: any, addedById: string, actorRole?: string) {
    const rawPin = (data.epinCode || data.pinNumber || "").trim();
    const selectedAgentId =
      actorRole !== "AGENT" && data.selectedAgentId && isValidUuid(String(data.selectedAgentId))
        ? String(data.selectedAgentId)
        : (actorRole === "AGENT" ? addedById : undefined);

    const rawOffline = data.offlineFormNumber ?? data.offline_form_number;
    const offlineFormNumber =
      rawOffline !== undefined && rawOffline !== null && String(rawOffline).trim() !== ""
        ? String(rawOffline).trim()
        : null;

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

    return prisma.$transaction(async (tx) => {
      // Duplicate detection for offlineFormNumber if provided
      if (offlineFormNumber) {
        const existingOffline = await tx.mayraRegistration.findFirst({
          where: { offlineFormNumber, deletedAt: null },
          select: { id: true, formNumber: true, applicantName: true },
        });
        if (existingOffline) {
          throw new BadRequestError(
            `Offline Form Number "${offlineFormNumber}" is already assigned to application ${existingOffline.formNumber} (${existingOffline.applicantName})`
          );
        }
      }

      const formNumber = await nextMayraFormNumber(tx);

      const applicationDate = parseRequiredDate(
        data.applicationDate || data.paymentDate,
        "applicationDate"
      );
      const dateOfBirth = parseRequiredDate(data.dateOfBirth, "dateOfBirth");

      let calculatedAge = new Date().getFullYear() - dateOfBirth.getFullYear();
      const m = new Date().getMonth() - dateOfBirth.getMonth();
      if (m < 0 || (m === 0 && new Date().getDate() < dateOfBirth.getDate())) {
        calculatedAge--;
      }

      if (calculatedAge < 10) {
        throw new BadRequestError("Age must be at least 10 years for Mayra Registration");
      }

      const activeSlabs = await tx.schemeAgeSlab.findMany({
        where: { schemeType: 'MAYRA', status: 'Active' },
      });

      const matchedSlab = activeSlabs.find(slab => calculatedAge >= slab.minAge && (slab.maxAge === null || calculatedAge <= slab.maxAge));

      if (!matchedSlab) {
        throw new BadRequestError("No active age slab found for the provided Date of Birth");
      }

      const rawExplicit =
        data.mayraInstallment ??
        data.mayra_installment ??
        data.installmentAmount;

      const numExplicit =
        rawExplicit != null && rawExplicit !== ""
          ? Number(rawExplicit)
          : null;

      let resolvedInstallment: number;
      if (numExplicit === 300) {
        resolvedInstallment = 300;
      } else if (numExplicit === 1000) {
        resolvedInstallment = 1000;
      } else {
        throw new BadRequestError("Mayra installment must be 300 or 1000");
      }

      const aadharNumber = String(data.aadharNumber || "").replace(/\D/g, "");
      await assertAadharAvailable(tx, aadharNumber, undefined, "mayraRegistration");

      const registration = await tx.mayraRegistration.create({
        data: {
          formNumber,
          offlineFormNumber,
          applicationDate,
          applicantName: data.applicantName,
          fatherName: data.fatherName,
          motherName: data.motherName,
          dateOfBirth,
          age: calculatedAge,
          slabCode: matchedSlab.slabCode,
          slabName: matchedSlab.slabName,
          resolvedMinAge: matchedSlab.minAge,
          resolvedMaxAge: matchedSlab.maxAge,
          joiningFee: matchedSlab.joiningFee,
          mayraInstallment: resolvedInstallment,
          gotra: data.gotra,
          address: data.address,
          aadharNumber,
          mobile: data.mobile,
          nomineeName: data.nomineeName,
          nomineeFatherName:
            data.nomineeFatherName || data.nomineeFathername || null,
          nomineeHusbandName:
            data.nomineeHusbandName || data.nomineeHusbandname || null,
          nomineeGotra: data.nomineeGotra || null,
          nomineeAddress: data.nomineeAddress || null,
          nomineeAadhar:
            data.nomineeAadhar ||
            data.nominee_aadhar ||
            data.nomineeAadhaar ||
            data.nominee_aadhaar ||
            data.nomineeAadharNumber ||
            data.nomineeAadhaarNumber ||
            null,
          nomineeMobile: data.nomineeMobile || data.nominee_mobile || null,
          // These columns are NOT NULL in the DB but are optional / conditionally
          // sent by the form (e.g. workerName is only sent when an agent is picked).
          // Default them to "" so a submit without them still succeeds instead of
          // silently failing with a Prisma "missing argument" error (which made the
          // Mayra registration never appear in the list).
          tehsil: data.tehsil || "",
          district: data.district || "",
          pinCode: data.pinCode || "",
          nomineeRelation:
            String(data.nomineeRelation ?? data.nominee_relation ?? "").trim(),
          workerName: data.workerName || "",
          workerMobile: data.workerMobile || null,
          passportPhotoUrl: data.passportPhoto || data.passportPhotoUrl || null,
          nomineePhotoUrl:
            data.nomineePassportPhoto || data.nomineePhotoUrl || null,
          gender: normalizeGender(data.gender),
          // Agents can never attribute a registration to a different worker
          // via this dropdown — only admins can; see resolveAddedById in
          // applications.service.ts for the fuller rationale.
          addedById:
            actorRole !== "AGENT" && data.selectedAgentId && isValidUuid(String(data.selectedAgentId))
              ? String(data.selectedAgentId)
              : addedById,
        },
      });

      if (data.paymentAmount && Number(data.paymentAmount) > 0) {
        const installment = await tx.mayraInstallment.create({
          data: {
            mayraRegistrationId: registration.id,
            amount: data.paymentAmount,
            date: applicationDate,
            note: "Registration Initial Payment",
            paymentMode: normalizePaymentMode(data.paymentMode),
            addedById: addedById,
          },
        });

        await recordLegacyPaymentEntry(tx, {
          legacyId: installment.id,
          date: applicationDate,
          amount: data.paymentAmount,
          name: formatCashFlowName([registration.formNumber, registration.applicantName, registration.address]),
          source: "mayra_application",
          type: "In",
        });
      }

      // If E-PIN was provided, consume it atomically inside transaction
      if (rawPin) {
        await epinsService.consumeEPin(
          {
            pinCode: rawPin,
            applicationId: registration.id,
            applicantName: registration.applicantName,
            module: "MAYRA",
            agentId: selectedAgentId,
            usedById: addedById,
            remarks: `Consumed for Mayra Application ${registration.formNumber} (${registration.applicantName})`,
          },
          { userId: addedById, role: (actorRole as any) || "ADMIN" },
          tx
        );
      }

      // Send dynamic standardized WhatsApp thank-you message via Green API
      if (registration?.mobile) {
        void (async () => {
          try {
            await WhatsAppService.sendSchemeRegistrationThankYou(registration.mobile, {
              applicantName: registration.applicantName,
              applicationNumber: registration.formNumber,
              schemeName: "मायरा योजना",
            });
          } catch (e) {
            console.error("Backend error sending Mayra WhatsApp notification:", e);
          }
        })();
      }

      return registration;
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * List all Mayra registrations
   */
  public async getAllMayraRegistrations(filters: any) {
    const f = normalizeListFilters(filters);
    const whereClause: any = { deletedAt: null };

    if (f.search) {
      whereClause.OR = [
        { applicantName: { contains: f.search, mode: "insensitive" } },
        { mobile: { contains: f.search } },
        { aadharNumber: { contains: f.search } },
        { formNumber: { contains: f.search, mode: "insensitive" } },
        { offlineFormNumber: { contains: f.search, mode: "insensitive" } },
      ];
    }

    if (f.gender) {
      whereClause.gender = f.gender;
    }

    if (f.addedById) {
      whereClause.addedById = f.addedById;
    }

    applyAddressContains(whereClause, f.address);
    applyDateRangeToField(whereClause, "applicationDate", f.fromDate, f.toDate);

    const page = f.page;
    const limit = f.limit;    const candidates = await prisma.mayraRegistration.findMany({
      where: whereClause,
      select: { id: true, formNumber: true, applicationDate: true, createdAt: true },
    });
    const { data: records, total } = await paginateByFormNumberSeq(candidates, page, limit, (ids) =>
      prisma.mayraRegistration.findMany({
        where: { id: { in: ids } },
        include: {
          addedBy: {
            select: {
              id: true,
              name: true,
              mobile: true,
              role: true,
              agentProfile: {
                select: {
                  id: true,
                  employeeId: true,
                  offlineFormNumber: true,
                  workArea: true,
                  designation: true,
                },
              },
            },
          },
          mayraCongrats: true,
          installments: {
            select: { amount: true, date: true, paymentMode: true },
          },
        },
      })
    );

    // Batch resolve senior hierarchy for all Mayra registrations
    const addedByIds = records.map((r: any) => r.addedById).filter(Boolean);
    const hierarchyMap = await resolveAgentSeniorHierarchyBatch(addedByIds);
    for (const r of records as any[]) {
      const hierarchy = r.addedById ? hierarchyMap.get(r.addedById) : null;
      const isAdmin = r.addedBy?.role === "ADMIN";
      const agentEmployeeId = r.addedBy?.agentProfile?.employeeId || "";
      const workerOfflineFormNumber = r.addedBy?.agentProfile?.offlineFormNumber || "";

      let rawWorkerCode = r.workerCode || (isAdmin ? "ADMIN" : workerOfflineFormNumber || agentEmployeeId || "ADMIN");
      if (!rawWorkerCode || isValidUuid(rawWorkerCode)) {
        rawWorkerCode = isAdmin ? "ADMIN" : (workerOfflineFormNumber || agentEmployeeId || "ADMIN");
      }
      r.workerCode = rawWorkerCode || (isAdmin ? "ADMIN" : "ADMIN");
      r.workerName = r.workerName || r.addedBy?.name || (isAdmin ? "Super Admin" : "Super Admin");
      r.workerMobile = r.workerMobile || r.addedBy?.mobile || "";
      r.workerOfflineFormNumber = workerOfflineFormNumber || "";
      r.agentOfflineFormNumber = workerOfflineFormNumber || "";

      if (hierarchy) {
        r.seniorCode = hierarchy.seniorCode;
        r.seniorName = hierarchy.seniorName;
        r.seniorOfflineFormNumber = hierarchy.seniorOfflineFormNumber || hierarchy.seniorCode;
        r.seniorAgentOfflineFormNumber = r.seniorOfflineFormNumber;
        r.parentAgentId = hierarchy.parentAgentId;
      } else if (isAdmin) {
        r.seniorCode = "ADMIN";
        r.seniorName = r.addedBy?.name || "Super Admin";
        r.seniorOfflineFormNumber = "";
        r.seniorAgentOfflineFormNumber = "";
        r.parentAgentId = null;
      } else {
        r.seniorCode = "ADMIN";
        r.seniorName = "Super Admin";
        r.seniorOfflineFormNumber = "";
        r.seniorAgentOfflineFormNumber = "";
        r.parentAgentId = null;
      }
      r.uplineCode = r.seniorCode;
      r.seniorWorker = r.seniorName;
    }

    if (page !== undefined && limit !== undefined) {
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
   * Retrieve Mayra Registration by id
   */
  public async getMayraRegistrationById(id: string) {
    const reg = await prisma.mayraRegistration.findFirst({
      where: { id, deletedAt: null },
      include: {
        addedBy: {
          select: {
            id: true,
            name: true,
            mobile: true,
            role: true,
            agentProfile: {
              select: {
                id: true,
                employeeId: true,
                offlineFormNumber: true,
                workArea: true,
                designation: true,
              },
            },
          },
        },
        installments: {
          orderBy: { date: "asc" },
        },
        mayraCongrats: {
          include: {
            payments: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (!reg) {
      throw new NotFoundError("Mayra Registration not found");
    }

    if (reg.addedById) {
      const hierarchyMap = await resolveAgentSeniorHierarchyBatch([reg.addedById]);
      const hierarchy = hierarchyMap.get(reg.addedById);
      const isAdmin = reg.addedBy?.role === "ADMIN";
      const agentEmployeeId = reg.addedBy?.agentProfile?.employeeId || "";
      const workerOfflineFormNumber = reg.addedBy?.agentProfile?.offlineFormNumber || "";

      let rawWorkerCode = (reg as any).workerCode || (isAdmin ? "ADMIN" : workerOfflineFormNumber || agentEmployeeId || "ADMIN");
      if (!rawWorkerCode || isValidUuid(rawWorkerCode)) {
        rawWorkerCode = isAdmin ? "ADMIN" : (workerOfflineFormNumber || agentEmployeeId || "ADMIN");
      }
      (reg as any).workerCode = rawWorkerCode || (isAdmin ? "ADMIN" : "ADMIN");
      (reg as any).workerName = reg.workerName || reg.addedBy?.name || (isAdmin ? "Super Admin" : "Super Admin");
      (reg as any).workerMobile = reg.workerMobile || reg.addedBy?.mobile || "";
      (reg as any).workerOfflineFormNumber = workerOfflineFormNumber || "";
      (reg as any).agentOfflineFormNumber = workerOfflineFormNumber || "";

      if (hierarchy) {
        (reg as any).seniorCode = hierarchy.seniorCode;
        (reg as any).seniorName = hierarchy.seniorName;
        (reg as any).seniorOfflineFormNumber = hierarchy.seniorOfflineFormNumber || hierarchy.seniorCode;
        (reg as any).seniorAgentOfflineFormNumber = (reg as any).seniorOfflineFormNumber;
        (reg as any).parentAgentId = hierarchy.parentAgentId;
      } else if (isAdmin) {
        (reg as any).seniorCode = "ADMIN";
        (reg as any).seniorName = reg.addedBy?.name || "Super Admin";
        (reg as any).seniorOfflineFormNumber = "";
        (reg as any).seniorAgentOfflineFormNumber = "";
        (reg as any).parentAgentId = null;
      } else {
        (reg as any).seniorCode = "ADMIN";
        (reg as any).seniorName = "Super Admin";
        (reg as any).seniorOfflineFormNumber = "";
        (reg as any).seniorAgentOfflineFormNumber = "";
        (reg as any).parentAgentId = null;
      }
      (reg as any).uplineCode = (reg as any).seniorCode;
      (reg as any).seniorWorker = (reg as any).seniorName;
    }

    return reg;
  }

  /**
   * Update Mayra Registration details
   */
  public async updateMayraRegistration(id: string, data: any) {
    const reg = await prisma.mayraRegistration.findFirst({
      where: { id, deletedAt: null },
    });

    if (!reg) {
      throw new NotFoundError("Mayra Registration not found");
    }

    if (data.aadharNumber !== undefined) {
      const newAadhar = String(data.aadharNumber).replace(/\D/g, "");
      if (newAadhar !== reg.aadharNumber) {
        await assertAadharAvailable(prisma, newAadhar, { model: "mayraRegistration", id }, "mayraRegistration");
      }
    }

    const rawOfflineUpdate =
      data.offlineFormNumber !== undefined ? data.offlineFormNumber : data.offline_form_number;
    let newOfflineFormNumber: string | null | undefined = undefined;

    if (rawOfflineUpdate !== undefined) {
      const trimmedOffline =
        rawOfflineUpdate !== null && String(rawOfflineUpdate).trim() !== ""
          ? String(rawOfflineUpdate).trim()
          : null;

      if (trimmedOffline && trimmedOffline !== reg.offlineFormNumber) {
        const existingOffline = await prisma.mayraRegistration.findFirst({
          where: { offlineFormNumber: trimmedOffline, deletedAt: null, id: { not: id } },
          select: { id: true, formNumber: true, applicantName: true },
        });
        if (existingOffline) {
          throw new BadRequestError(
            `Offline Form Number "${trimmedOffline}" is already assigned to application ${existingOffline.formNumber} (${existingOffline.applicantName})`
          );
        }
      }
      newOfflineFormNumber = trimmedOffline;
    }

    const nomineeFatherName =
      data.nomineeFatherName !== undefined
        ? data.nomineeFatherName
        : data.nomineeFathername !== undefined
        ? data.nomineeFathername
        : reg.nomineeFatherName;

    const nomineeHusbandName =
      data.nomineeHusbandName !== undefined
        ? data.nomineeHusbandName
        : data.nomineeHusbandname !== undefined
        ? data.nomineeHusbandname
        : reg.nomineeHusbandName;

    const nomineeAadharRaw =
      data.nomineeAadhar !== undefined
        ? data.nomineeAadhar
        : data.nominee_aadhar !== undefined
        ? data.nominee_aadhar
        : data.nomineeAadhaar !== undefined
        ? data.nomineeAadhaar
        : data.nominee_aadhaar !== undefined
        ? data.nominee_aadhaar
        : data.nomineeAadharNumber !== undefined
        ? data.nomineeAadharNumber
        : data.nomineeAadhaarNumber !== undefined
        ? data.nomineeAadhaarNumber
        : undefined;
    const nomineeAadhar =
      nomineeAadharRaw !== undefined
        ? (nomineeAadharRaw ? String(nomineeAadharRaw).replace(/\D/g, "") : null)
        : reg.nomineeAadhar;

    const nomineeMobileRaw =
      data.nomineeMobile !== undefined
        ? data.nomineeMobile
        : data.nominee_mobile !== undefined
        ? data.nominee_mobile
        : undefined;
    const nomineeMobile =
      nomineeMobileRaw !== undefined
        ? (nomineeMobileRaw ? String(nomineeMobileRaw).trim() : null)
        : reg.nomineeMobile;

    const rawUpdateInstallment =
      data.mayraInstallment !== undefined
        ? data.mayraInstallment
        : data.mayra_installment !== undefined
        ? data.mayra_installment
        : data.installmentAmount !== undefined
        ? data.installmentAmount
        : undefined;

    let mayraInstallment = reg.mayraInstallment;
    if (rawUpdateInstallment !== undefined && rawUpdateInstallment !== null && rawUpdateInstallment !== "") {
      const numUpdateInstallment = Number(rawUpdateInstallment);
      if (numUpdateInstallment === 300 || numUpdateInstallment === 1000) {
        mayraInstallment = numUpdateInstallment as any;
      } else {
        throw new BadRequestError("Mayra installment must be 300 or 1000");
      }
    }

    const addedByCandidate =
      data.selectedAgentId ?? data.addedby_id ?? data.addedById;

    const resolvePhoto = (
      fileOrUrl: unknown,
      existingUrl: unknown,
      current: string | null
    ): string | null => {
      if (typeof fileOrUrl === "string" && fileOrUrl.trim()) return fileOrUrl.trim();
      if (typeof existingUrl === "string" && existingUrl.trim()) return existingUrl.trim();
      return current ?? null;
    };

    return prisma.mayraRegistration.update({
      where: { id },
      data: {
        ...(newOfflineFormNumber !== undefined ? { offlineFormNumber: newOfflineFormNumber } : {}),
        applicationDate:
          data.applicationDate !== undefined
            ? parseDateInput(data.applicationDate, "applicationDate")
            : reg.applicationDate,
        applicantName: data.applicantName !== undefined ? data.applicantName : reg.applicantName,
        fatherName: data.fatherName !== undefined ? data.fatherName : reg.fatherName,
        motherName: data.motherName !== undefined ? data.motherName : reg.motherName,
        dateOfBirth:
          data.dateOfBirth !== undefined
            ? parseDateInput(data.dateOfBirth, "dateOfBirth")
            : reg.dateOfBirth,
        age: data.age !== undefined ? Number(data.age) : reg.age,
        aadharNumber:
          data.aadharNumber !== undefined
            ? String(data.aadharNumber).replace(/\D/g, "")
            : reg.aadharNumber,
        gotra: data.gotra !== undefined ? data.gotra : reg.gotra,
        mobile: data.mobile !== undefined ? data.mobile : reg.mobile,
        address: data.address !== undefined ? data.address : reg.address,
        pinCode: data.pinCode !== undefined ? data.pinCode : reg.pinCode,
        tehsil: data.tehsil !== undefined ? data.tehsil : reg.tehsil,
        district: data.district !== undefined ? data.district : reg.district,
        nomineeName: data.nomineeName !== undefined ? data.nomineeName : reg.nomineeName,
        nomineeFatherName,
        nomineeHusbandName,
        nomineeGotra: data.nomineeGotra !== undefined ? data.nomineeGotra : reg.nomineeGotra,
        nomineeAddress: data.nomineeAddress !== undefined ? data.nomineeAddress : reg.nomineeAddress,
        nomineeAadhar,
        nomineeRelation:
          data.nomineeRelation !== undefined
            ? (data.nomineeRelation !== null ? String(data.nomineeRelation).trim() : "")
            : data.nominee_relation !== undefined
              ? (data.nominee_relation !== null ? String(data.nominee_relation).trim() : "")
              : reg.nomineeRelation,
        nomineeMobile,
        mayraInstallment,
        workerName: data.workerName !== undefined ? data.workerName : reg.workerName,
        workerMobile: data.workerMobile !== undefined ? data.workerMobile : reg.workerMobile,
        gender: data.gender !== undefined ? data.gender : reg.gender,
        ...(addedByCandidate && isValidUuid(String(addedByCandidate))
          ? { addedById: String(addedByCandidate) }
          : {}),
        passportPhotoUrl: resolvePhoto(
          data.passportPhoto,
          data.existingPassportPhoto ?? data.existingPhotoUrl,
          reg.passportPhotoUrl
        ),
        nomineePhotoUrl: resolvePhoto(
          data.nomineePassportPhoto,
          data.existingNomineePassportPhoto ?? data.existingNomineePhotoUrl,
          reg.nomineePhotoUrl
        ),
      },
    });
  }

  /**
   * Soft delete Mayra Registration
   */
  public async softDeleteMayraRegistration(id: string) {
    return softDeleteWithChildren(
      prisma.mayraRegistration,
      id,
      "Mayra Registration",
      [{ model: prisma.mayraInstallment, fkField: "mayraRegistrationId" }],
      { deactivate: true }
    );
  }

  /**
   * Add installment payment to Mayra Registration
   */
  public async addMayraInstallment(mayraRegistrationId: string, data: any, addedById: string) {
    const reg = await prisma.mayraRegistration.findFirst({
      where: { id: mayraRegistrationId, deletedAt: null },
    });

    if (!reg) {
      throw new NotFoundError("Mayra Registration not found");
    }

    const installmentDate = parseDateInput(data.date, "date");
    const installment = await prisma.mayraInstallment.create({
      data: {
        mayraRegistrationId,
        amount: data.amount,
        date: installmentDate,
        note: data.note || null,
        paymentMode: normalizePaymentMode(data.paymentMode),
        addedById: addedById,
      },
    });

    await recordLegacyPaymentEntry(prisma, {
      legacyId: installment.id,
      date: installmentDate,
      amount: data.amount,
      name: formatCashFlowName([reg.formNumber, reg.applicantName, reg.address]),
      source: "mayra_registration",
      type: "In",
    });

    return installment;
  }

  // ==========================================
  // MAYRA CONGRATULATIONS & PAYOUTS
  // ==========================================

  /**
   * Bind Mayra Congratulations (Bond details) to Registration
   */
  public async createMayraCongratulations(mayraRegistrationId: string, data: any, addedById: string) {
    const reg = await prisma.mayraRegistration.findFirst({
      where: { id: mayraRegistrationId, deletedAt: null },
    });

    if (!reg) {
      throw new NotFoundError("Mayra Registration not found");
    }

    const existing = await prisma.mayraCongratulations.findFirst({
      where: { mayraRegistrationId, deletedAt: null },
    });

    if (existing) {
      throw new BadRequestError(
        `Mayra congratulations record already exists for application ${reg.formNumber} (${reg.applicantName}). Please edit the existing record from the list instead of creating a new one.`
      );
    }

    let mayraNumber = data.mayraNumber;
    if (!mayraNumber) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = `MYC-${Math.floor(Math.random() * 90000) + 10000}`;
        const dup = await prisma.mayraCongratulations.findFirst({
          where: { mayraNumber: candidate },
          select: { id: true },
        });
        if (!dup) {
          mayraNumber = candidate;
          break;
        }
      }
      if (!mayraNumber) {
        mayraNumber = `MYC-${Date.now()}`;
      }
    }

    const codeNumber = String(data.codeNumber || reg.formNumber || "").trim();
    if (!codeNumber) {
      throw new BadRequestError("Code number is required");
    }

    const regGroup = resolveMayraGroup(reg.mayraInstallment);
    if (!regGroup) {
      throw new BadRequestError(
        `Applicant Mayra registration (${reg.formNumber}) must have an authoritative installment of ₹300 or ₹1000 (found: ${reg.mayraInstallment || 'none'}). Cannot create Mayra Congratulations.`
      );
    }
    const authoritativeInstallment = getExpectedInstallmentAmount(regGroup);

    const toDecimal = (val: unknown, fallback = 0) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : fallback;
    };

    const createdRecord = await prisma.mayraCongratulations.create({
      data: {
        mayraRegistrationId,
        date: parseRequiredDate(data.date, "date"),
        codeNumber,
        mayraNumber: mayraNumber,
        applicantName: reg.applicantName,
        fatherName: reg.fatherName,
        wifeOf: data.wifeOf || null,
        gotra: reg.gotra,
        address: reg.address,
        membershipJoinDate: parseRequiredDate(data.membershipJoinDate, "membershipJoinDate"),
        associatedUntil: data.associatedUntil,
        permanentFee: toDecimal(data.permanentFee),
        installmentAmount: authoritativeInstallment,
        totalGrantAmount: toDecimal(data.totalGrantAmount),
        totalMembersServing: Math.trunc(toDecimal(data.totalMembersServing)),
        rate200: toDecimal(data.rate200),
        rate300: toDecimal(data.rate300),
        deductionPercent: toDecimal(data.deductionPercent),
        deductedAmount: toDecimal(data.deductedAmount),
        totalPaidAmount: toDecimal(data.totalPaidAmount),
        gender: data.gender,
        addedById: addedById,
      },
    });

    // Deactivate beneficiary registration once Mayra congratulations record is created
    await prisma.mayraRegistration.update({
      where: { id: reg.id },
      data: { isActive: false },
    });

    return createdRecord;
  }

  /**
   * Add contribution payment (payout) to Congratulations record
   */
  public async addMayraCongratulationsPayment(mayraCongratulationsId: string, data: any, addedById: string) {
    if (!isValidUuid(mayraCongratulationsId)) {
      throw new BadRequestError("Valid Mayra Congratulations ID is required");
    }

    return prisma.$transaction(async (tx) => {
      const congrats = await tx.mayraCongratulations.findUnique({
        where: { id: mayraCongratulationsId },
        include: { mayraRegistration: true },
      });

      if (!congrats) {
        throw new NotFoundError("Mayra Congratulations record not found");
      }

      const recipientGroup = resolveMayraGroup(congrats.mayraRegistration?.mayraInstallment ?? congrats.installmentAmount);
      if (!recipientGroup) {
        throw new BadRequestError(
          `Recipient Mayra record (${congrats.mayraNumber}) has an ambiguous or unassigned installment group (${congrats.installmentAmount || 'none'}). Contributions are blocked pending administrative review.`
        );
      }

      const payerId = data.applicationId || data.mayra_id || data.application_id || null;
      if (!payerId || !isValidUuid(String(payerId))) {
        throw new BadRequestError("Valid payer Mayra registration ID is required");
      }

      // Check cross-module: ensure payer is NOT a General Application
      const generalCheck = await tx.generalApplication.findFirst({
        where: { id: String(payerId), deletedAt: null },
        select: { id: true, formNumber: true },
      });
      if (generalCheck) {
        throw new BadRequestError(
          `Cross-module contribution rejected: General Marriage record (${generalCheck.formNumber}) cannot contribute to Mayra. General Marriage and Mayra pools are strictly separated.`
        );
      }

      const payer = await tx.mayraRegistration.findFirst({
        where: { id: String(payerId), deletedAt: null },
        select: { id: true, formNumber: true, applicantName: true, address: true, mayraInstallment: true, isActive: true, gender: true, slabCode: true },
      });
      if (!payer) {
        throw new NotFoundError("Payer Mayra registration record not found");
      }
      if (!payer.isActive) {
        throw new BadRequestError(`Mayra member ${payer.formNumber} is inactive and cannot make contributions`);
      }
      if (payer.gender !== congrats.gender) {
        throw new BadRequestError("Gender mismatch: Mayra contributions must match the Mayra pool gender");
      }

      const payerGroup = resolveMayraGroup(payer.mayraInstallment);
      const { expectedAmount } = validateContributionGroupMatch({
        sourceModule: "mayra",
        recipientModule: "mayra",
        sourceGroup: payerGroup,
        recipientGroup: recipientGroup,
        sourceLabel: `Payer Mayra record (${payer.formNumber})`,
        recipientLabel: `Recipient Mayra (${congrats.mayraNumber})`,
      });

      const paymentAmount = data.amount !== undefined ? Number(data.amount) : expectedAmount;

      // Duplicate check inside transaction
      const existingPayment = await tx.mayraCongratulationsPayment.findFirst({
        where: {
          mayraCongratulationsId: congrats.id,
          applicationId: payer.id,
          deletedAt: null,
        },
      });
      if (existingPayment) {
        throw new BadRequestError(
          `Payment already recorded for member ${payer.formNumber} towards Mayra ${congrats.mayraNumber}`
        );
      }

      const payment = await tx.mayraCongratulationsPayment.create({
        data: {
          mayraCongratulationsId: congrats.id,
          amount: paymentAmount,
          category: payer.slabCode || data.category || "EMI",
          applicationId: payer.id,
          addedById: addedById,
        },
      });

      await recordLegacyPaymentEntry(tx, {
        legacyId: payment.id,
        date: payment.createdAt,
        amount: paymentAmount,
        name: formatEmiContributionName(
          [payer.formNumber, payer.applicantName, payer.address],
          { name: congrats.applicantName, code: congrats.mayraNumber, scheme: "Mayra congratulations" }
        ),
        source: "mayra_congratulations_emi",
        type: "In",
      });

      return payment;
    }, PRISMA_TX_OPTIONS);
  }

  public async getMayraCongratulationsMembers(mayraRegistrationId: string) {
    const congrats = await prisma.mayraCongratulations.findFirst({
      where: {
        OR: [
          ...(isValidUuid(mayraRegistrationId) ? [{ id: mayraRegistrationId }, { mayraRegistrationId }] : [{ mayraRegistrationId }])
        ],
        deletedAt: null
      },
      include: { mayraRegistration: true },
    });
    if (!congrats) {
      throw new NotFoundError("Mayra Congratulations record not found");
    }

    const recipientGroup = resolveMayraGroup(congrats.mayraRegistration?.mayraInstallment ?? congrats.installmentAmount);
    if (!recipientGroup) {
      throw new BadRequestError(
        `Recipient Mayra record (${congrats.mayraNumber}) has an ambiguous or unassigned installment group (${congrats.installmentAmount || 'none'}). Cannot retrieve eligible members pending administrative review.`
      );
    }
    const expectedInstallment = getExpectedInstallmentAmount(recipientGroup);

    // Fetch active Mayra Registration members of matching gender and same installment group
    const members = await prisma.mayraRegistration.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        gender: congrats.gender,
        mayraInstallment: expectedInstallment,
      },
      select: {
        id: true,
        applicantName: true,
        formNumber: true,
        mayraInstallment: true,
        slabCode: true,
      },
    });

    // Fetch all payments made towards this congratulations record
    const payments = await prisma.mayraCongratulationsPayment.findMany({
      where: { mayraCongratulationsId: congrats.id, deletedAt: null },
      select: { applicationId: true },
    });

    const paidMemberIds = new Set(payments.map(p => p.applicationId).filter(Boolean));

    // Group by category (slabCode letter: A, B, C or other)
    const categories: Record<string, { members: any[] }> = {
      A: { members: [] },
      B: { members: [] },
      C: { members: [] },
    };

    members.forEach((m) => {
      const code = (m.slabCode ?? "C").toString().toUpperCase();
      const cat = code.split("_").pop() || "C";
      if (!categories[cat]) {
        categories[cat] = { members: [] };
      }
      categories[cat].members.push({
        id: m.id,
        applicantName: m.applicantName,
        formNumber: m.formNumber,
        category: cat,
        mayraInstallment: Number(m.mayraInstallment),
        payment_status: paidMemberIds.has(m.id) ? 1 : 0,
      });
    });

    return {
      status: true,
      group: recipientGroup,
      installmentAmount: expectedInstallment,
      categories,
      members: members.map(m => ({
        id: m.id,
        applicantName: m.applicantName,
        formNumber: m.formNumber,
        mayraInstallment: Number(m.mayraInstallment),
        payment_status: paidMemberIds.has(m.id) ? 1 : 0,
      }))
    };
  }

  public async getMayraCongratulationsPayments(mayraRegistrationId: string) {
    if (!isValidUuid(mayraRegistrationId)) {
      throw new NotFoundError("Mayra Congratulations record not found");
    }

    const congrats = await prisma.mayraCongratulations.findUnique({
      where: { mayraRegistrationId },
    });
    if (!congrats) {
      throw new NotFoundError("Mayra Congratulations record not found");
    }

    const payments = await prisma.mayraCongratulationsPayment.findMany({
      where: { mayraCongratulationsId: congrats.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
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
        mayraCongratulationsId: p.mayraCongratulationsId,
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

  public async deleteMayraCongratulationsPayment(paymentId: string) {
    return softDeleteRecord(
      prisma.mayraCongratulationsPayment,
      paymentId,
      "Payment record"
    );
  }
}
