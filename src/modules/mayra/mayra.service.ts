import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { NotFoundError, BadRequestError } from "../../utils/errors";
import { isValidUuid } from "../../utils/compat-helpers";
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
    return prisma.$transaction(async (tx) => {
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

      const aadharNumber = String(data.aadharNumber || "").replace(/\D/g, "");
      await assertAadharAvailable(tx, aadharNumber, undefined, "mayraRegistration");

      const registration = await tx.mayraRegistration.create({
        data: {
          formNumber,
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
          mayraInstallment: matchedSlab.installment,
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
          // These columns are NOT NULL in the DB but are optional / conditionally
          // sent by the form (e.g. workerName is only sent when an agent is picked).
          // Default them to "" so a submit without them still succeeds instead of
          // silently failing with a Prisma "missing argument" error (which made the
          // Mayra registration never appear in the list).
          tehsil: data.tehsil || "",
          district: data.district || "",
          pinCode: data.pinCode || "",
          nomineeRelation: data.nomineeRelation || "",
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

      // Send WhatsApp message via Green API
      if (registration?.mobile) {
        void (async () => {
          try {
            const msg = `नमस्ते ${registration.applicantName},\n\nपुरबिया प्रजापति बालिका विवाह & सशक्तिकरण फाउण्डेशन के मायरा योजना (आवेदन सं. ${registration.formNumber}) मे जुड़ने के लिए आपका बहुत बहुत धन्यवाद 🙏\n\nअधिक जानकारी हेतु संपर्क करें:\nपीराराम तेनगरिया जसोल\n9413032072, 8209467238`;
            await WhatsAppService.sendTextMessage(registration.mobile, msg);
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
            select: { id: true, name: true, mobile: true },
          },
          mayraCongrats: true,
          installments: {
            select: { amount: true, date: true, paymentMode: true },
          },
        },
      })
    );

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
          select: { id: true, name: true, mobile: true },
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
        nomineeRelation: data.nomineeRelation !== undefined ? data.nomineeRelation : reg.nomineeRelation,
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

    const toDecimal = (val: unknown, fallback = 0) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : fallback;
    };

    return prisma.mayraCongratulations.create({
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
        installmentAmount: toDecimal(data.installmentAmount),
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
  }

  /**
   * Add contribution payment (payout) to Congratulations record
   */
  public async addMayraCongratulationsPayment(mayraCongratulationsId: string, data: any, addedById: string) {
    if (!isValidUuid(mayraCongratulationsId)) {
      throw new BadRequestError("Mayra Congratulations record not found");
    }

    const congrats = await prisma.mayraCongratulations.findUnique({
      where: { id: mayraCongratulationsId },
    });

    if (!congrats) {
      throw new NotFoundError("Mayra Congratulations record not found");
    }

    const payerApplicationId = data.applicationId || null;
    const payer = payerApplicationId && isValidUuid(String(payerApplicationId))
      ? await prisma.generalApplication.findFirst({
          where: { id: String(payerApplicationId), deletedAt: null },
          select: { formNumber: true, applicantName: true, address: true },
        })
      : null;

    const payment = await prisma.mayraCongratulationsPayment.create({
      data: {
        mayraCongratulationsId,
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
        payer ? [payer.formNumber, payer.applicantName, payer.address] : [congrats.codeNumber, congrats.applicantName, congrats.address],
        payer ? { name: congrats.applicantName, code: congrats.codeNumber, scheme: "Mayra congratulations" } : null
      ),
      source: "mayra_congratulations_emi",
      type: "In",
    });

    return payment;
  }

  public async getMayraCongratulationsMembers(mayraRegistrationId: string) {
    const congrats = await prisma.mayraCongratulations.findUnique({
      where: { mayraRegistrationId },
    });
    if (!congrats) {
      throw new NotFoundError("Mayra Congratulations record not found");
    }

    // Fetch all active members (General Applications)
    const members = await prisma.generalApplication.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        applicantName: true,
        formNumber: true,
        category: true,
      },
    });

    // Fetch all payments made towards this congratulations record
    const payments = await prisma.mayraCongratulationsPayment.findMany({
      where: { mayraCongratulationsId: congrats.id, deletedAt: null },
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
