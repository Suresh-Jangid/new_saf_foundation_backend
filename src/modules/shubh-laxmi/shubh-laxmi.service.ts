import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from "../../utils/errors";
import {
  ApplicationCategory,
  Gender,
  PaymentMode,
  Prisma,
} from "@prisma/client";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { parseDateInput } from "../../utils/parse-date";
import { saveImagePayload } from "../../utils/file-upload";
import { EpinsService } from "../epins/epins.service";
import {
  SHUBH_LAXMI_FORM_PREFIX,
  SHUBH_LAXMI_MEMBERSHIP_FEE,
  SHUBH_LAXMI_INSTALLMENT_AMOUNT,
  SHUBH_LAXMI_POOL,
  SHUBH_LAXMI_SCHEME_TYPE,
  SHUBH_LAXMI_DEDUCTION_PERCENT,
  SHUBH_LAXMI_BENEFIT_MATURITY_MONTHS,
  SHUBH_LAXMI_MAX_CONSECUTIVE_MISSED_INSTALLMENTS,
  SHUBH_LAXMI_SCHEME_DURATION_NOTE,
  CreateShubhLaxmiInput,
  UpdateShubhLaxmiInput,
  ShubhLaxmiFilter,
  ShubhLaxmiInstallmentInput,
  ShubhLaxmiFinancialSummary,
} from "./shubh-laxmi.types";

const epinsService = new EpinsService();

function normalizeGender(value: unknown): Gender {
  const raw = String(value || "").trim();
  if (/^female$/i.test(raw)) return Gender.Female;
  if (/^male$/i.test(raw)) return Gender.Male;
  if (/^other$/i.test(raw)) return Gender.Other;
  if (Object.values(Gender).includes(raw as Gender)) return raw as Gender;
  return Gender.Female;
}

function normalizeCategory(value: unknown): ApplicationCategory {
  const category = String(value || "A").trim().toUpperCase();
  if (Object.values(ApplicationCategory).includes(category as ApplicationCategory)) {
    return category as ApplicationCategory;
  }
  return ApplicationCategory.A;
}

function normalizePaymentMode(value: unknown): PaymentMode {
  const mode = String(value || "CASH").trim().toUpperCase().replace(/-/g, "_");
  if (mode === "RAZORPAY" || mode === "ONLINE") return PaymentMode.RAZORPAY;
  if (mode === "BANK_TRANSFER") return PaymentMode.BANK_TRANSFER;
  return PaymentMode.CASH;
}

/**
 * Calculates financial summary and evaluates 3-consecutive-missed-installments rule:
 * "तीन किस्त लगातार जमा नहीं करवाने पर सदस्यता समाप्त कर दी जाएगी।"
 */
export function computeShubhLaxmiFinancialSummary(
  installments: Array<{ amount: Prisma.Decimal | number; date?: Date | string; deletedAt?: Date | null }>,
  applicationDate?: Date | string,
  currentDate: Date = new Date()
): ShubhLaxmiFinancialSummary {
  const activeInstallments = installments.filter((inst) => !inst.deletedAt);
  const totalCollected = activeInstallments.reduce(
    (acc, cur) => acc + Number(cur.amount),
    0
  );

  let consecutiveMissed = 0;
  let membershipStatus: "ACTIVE" | "TERMINATION_WARNING" | "TERMINATED" = "ACTIVE";

  if (applicationDate) {
    const appDate = new Date(applicationDate);
    const monthsElapsed = Math.max(
      0,
      (currentDate.getFullYear() - appDate.getFullYear()) * 12 +
        (currentDate.getMonth() - appDate.getMonth())
    );

    const paidCount = activeInstallments.length;
    const expectedInstallments = Math.min(monthsElapsed, 12);
    const missed = Math.max(0, expectedInstallments - paidCount);

    consecutiveMissed = missed;
    if (consecutiveMissed >= SHUBH_LAXMI_MAX_CONSECUTIVE_MISSED_INSTALLMENTS) {
      membershipStatus = "TERMINATED";
    } else if (consecutiveMissed === 2) {
      membershipStatus = "TERMINATION_WARNING";
    } else {
      membershipStatus = "ACTIVE";
    }
  }

  return {
    membershipFee: SHUBH_LAXMI_MEMBERSHIP_FEE,
    installmentAmount: SHUBH_LAXMI_INSTALLMENT_AMOUNT,
    totalCollected: totalCollected,
    installmentCount: activeInstallments.length,
    pending: 0,
    deductionPercent: SHUBH_LAXMI_DEDUCTION_PERCENT,
    benefitMaturityMonths: SHUBH_LAXMI_BENEFIT_MATURITY_MONTHS,
    maxConsecutiveMissedInstallments: SHUBH_LAXMI_MAX_CONSECUTIVE_MISSED_INSTALLMENTS,
    membershipStatus,
    consecutiveMissedInstallments: consecutiveMissed,
    schemeDurationNote: SHUBH_LAXMI_SCHEME_DURATION_NOTE,
  };
}

async function nextShubhLaxmiFormNumber(tx: PrismaTransactionClient): Promise<string> {
  const prefix = SHUBH_LAXMI_FORM_PREFIX;
  await lockFormNumberSequence(tx, "shubh_laxmi_form_number");

  const result = await tx.$queryRawUnsafe<Array<{ formNumber: string }>>(`
    SELECT form_number AS "formNumber"
    FROM shubh_laxmi_registrations
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

export class ShubhLaxmiService {
  /**
   * 1. CREATE SHUBHLAXMI REGISTRATION APPLICATION
   */
  public async createRegistration(
    data: CreateShubhLaxmiInput,
    addedById: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const rawAadhar = String(data.aadharNumber || "").replace(/\D/g, "");
    if (rawAadhar.length !== 12) {
      throw new BadRequestError("Aadhaar number must be exactly 12 digits");
    }

    // Check duplicate Aadhaar within active ShubhLaxmi registrations
    const existing = await prisma.shubhLaxmiRegistration.findFirst({
      where: {
        aadharNumber: rawAadhar,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictError(
        `An active ShubhLaxmi registration already exists for Aadhaar ${rawAadhar} (Form: ${existing.formNumber})`
      );
    }

    // Resolve owner agent ID
    const ownerId =
      actor.role === "ADMIN" && data.selectedAgentId
        ? data.selectedAgentId
        : addedById;

    const rawPin = (data.epinCode || data.pinNumber || "").trim();

    // Validate E-PIN if supplied
    if (rawPin) {
      const validationResult = await epinsService.validateEPin(
        { pinCode: rawPin },
        actor
      );

      if (!validationResult.valid) {
        throw new BadRequestError(
          `E-PIN Validation Failed: ${validationResult.message}`
        );
      }
    }

    const applicationDate = parseDateInput(data.applicationDate, "applicationDate");
    const dateOfBirth = parseDateInput(data.dateOfBirth, "dateOfBirth");

    const membershipFee = SHUBH_LAXMI_MEMBERSHIP_FEE;
    const paymentAmount = data.paymentAmount ? Number(data.paymentAmount) : 0;

    if (paymentAmount > 0) {
      if (paymentAmount !== SHUBH_LAXMI_INSTALLMENT_AMOUNT) {
        throw new BadRequestError(
          `Initial installment payment amount must be exactly ₹${SHUBH_LAXMI_INSTALLMENT_AMOUNT}. Received: ₹${paymentAmount}`
        );
      }
    }

    return prisma.$transaction(async (tx) => {
      const formNumber = await nextShubhLaxmiFormNumber(tx);

      const existingInTx = await tx.shubhLaxmiRegistration.findFirst({
        where: {
          aadharNumber: rawAadhar,
          deletedAt: null,
        },
      });

      if (existingInTx) {
        throw new ConflictError(
          `An active ShubhLaxmi registration already exists for Aadhaar ${rawAadhar} (Form: ${existingInTx.formNumber})`
        );
      }

      const registration = await tx.shubhLaxmiRegistration.create({
        data: {
          formNumber,
          applicationDate,
          applicantName: String(data.applicantName).trim(),
          fatherName: String(data.fatherName).trim(),
          husbandName: data.husbandName ? String(data.husbandName).trim() : null,
          motherName: data.motherName ? String(data.motherName).trim() : null,
          dateOfBirth,
          age: data.age !== undefined && data.age !== null ? Number(data.age) : null,
          aadharNumber: rawAadhar,
          gotra: String(data.gotra).trim(),
          mobile: String(data.mobile).replace(/\D/g, ""),
          address: String(data.address).trim(),
          pinCode: String(data.pinCode).trim(),
          tehsil: String(data.tehsil).trim(),
          district: String(data.district).trim(),
          state: data.state ? String(data.state).trim() : "Rajasthan",
          nomineeName: data.nomineeName ? String(data.nomineeName).trim() : null,
          nomineeRelation: data.nomineeRelation ? String(data.nomineeRelation).trim() : null,
          nomineeMobile: data.nomineeMobile ? String(data.nomineeMobile).replace(/\D/g, "") : null,
          nomineeAadhar: data.nomineeAadhar ? String(data.nomineeAadhar).replace(/\D/g, "") : null,
          passportPhotoUrl: saveImagePayload(data.passportPhotoUrl),
          affidavitUrl: saveImagePayload(data.affidavitUrl),
          gender: data.gender ? normalizeGender(data.gender) : Gender.Female,
          category: normalizeCategory(data.category),
          schemeType: SHUBH_LAXMI_SCHEME_TYPE,
          pool: SHUBH_LAXMI_POOL,
          membershipFee,
          epinCode: rawPin || null,
          addedById: ownerId,
        },
      });

      // If initial payment is made, record installment
      if (paymentAmount > 0) {
        await tx.shubhLaxmiInstallment.create({
          data: {
            registrationId: registration.id,
            amount: paymentAmount,
            date: applicationDate,
            paymentMode: normalizePaymentMode(data.paymentMode),
            note: "Initial Registration Payment",
            addedById: ownerId,
          },
        });
      }

      // If E-PIN was provided, consume it atomically inside transaction
      if (rawPin) {
        await epinsService.consumeEPin(
          {
            pinCode: rawPin,
            applicationId: registration.id,
            applicantName: registration.applicantName,
            module: "SHUBH_LAXMI",
            remarks: `Consumed for ShubhLaxmi Application ${registration.formNumber} (${registration.applicantName})`,
            usedById: actor.userId,
          },
          actor,
          tx
        );
      }

      return registration;
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * 2. LIST SHUBHLAXMI REGISTRATIONS (PAGINATED + AGENT ISOLATION)
   */
  public async getRegistrations(
    filter: ShubhLaxmiFilter & { agentId?: string },
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const page = Math.max(Number(filter.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filter.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.ShubhLaxmiRegistrationWhereInput = {
      deletedAt: null,
    };

    // Agent isolation: Agents only see applications they created/own
    if (actor.role === "AGENT") {
      where.addedById = actor.userId;
    } else if (filter.agentId) {
      where.addedById = filter.agentId;
    }

    if (filter.search) {
      const search = String(filter.search).trim();
      where.OR = [
        { applicantName: { contains: search, mode: "insensitive" } },
        { fatherName: { contains: search, mode: "insensitive" } },
        { husbandName: { contains: search, mode: "insensitive" } },
        { formNumber: { contains: search, mode: "insensitive" } },
        { aadharNumber: { contains: search } },
        { mobile: { contains: search } },
        { gotra: { contains: search, mode: "insensitive" } },
        { district: { contains: search, mode: "insensitive" } },
        { tehsil: { contains: search, mode: "insensitive" } },
      ];
    }

    if (filter.district) {
      where.district = { contains: String(filter.district).trim(), mode: "insensitive" };
    }

    if (filter.tehsil) {
      where.tehsil = { contains: String(filter.tehsil).trim(), mode: "insensitive" };
    }

    if (filter.gender) {
      where.gender = normalizeGender(filter.gender);
    }

    if (filter.category) {
      where.category = normalizeCategory(filter.category);
    }

    if (filter.startDate || filter.endDate) {
      where.applicationDate = {};
      if (filter.startDate) {
        where.applicationDate.gte = parseDateInput(filter.startDate, "startDate");
      }
      if (filter.endDate) {
        where.applicationDate.lte = parseDateInput(filter.endDate, "endDate");
      }
    }

    const [total, records] = await Promise.all([
      prisma.shubhLaxmiRegistration.count({ where }),
      prisma.shubhLaxmiRegistration.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          addedBy: {
            select: {
              id: true,
              name: true,
              mobile: true,
              role: true,
            },
          },
          installments: {
            where: { deletedAt: null },
            orderBy: { date: "asc" },
          },
        },
      }),
    ]);

    const formattedRecords = records.map((rec) => {
      const financialSummary = computeShubhLaxmiFinancialSummary(
        rec.installments,
        rec.applicationDate
      );
      return {
        ...rec,
        membershipFee: Number(rec.membershipFee),
        installments: rec.installments.map((inst) => ({
          ...inst,
          amount: Number(inst.amount),
        })),
        financialSummary,
      };
    });

    return {
      success: true,
      data: formattedRecords,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 3. GET SINGLE SHUBHLAXMI REGISTRATION BY ID
   */
  public async getRegistrationById(
    id: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.shubhLaxmiRegistration.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        addedBy: {
          select: {
            id: true,
            name: true,
            mobile: true,
            role: true,
          },
        },
        installments: {
          where: { deletedAt: null },
          orderBy: { date: "asc" },
          include: {
            addedBy: {
              select: {
                id: true,
                name: true,
                mobile: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundError("ShubhLaxmi registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to view this application");
    }

    const financialSummary = computeShubhLaxmiFinancialSummary(
      record.installments,
      record.applicationDate
    );

    return {
      success: true,
      data: {
        ...record,
        membershipFee: Number(record.membershipFee),
        installments: record.installments.map((inst) => ({
          ...inst,
          amount: Number(inst.amount),
        })),
        financialSummary,
      },
    };
  }

  /**
   * 4. UPDATE SHUBHLAXMI REGISTRATION
   */
  public async updateRegistration(
    id: string,
    data: UpdateShubhLaxmiInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.shubhLaxmiRegistration.findFirst({
      where: { id, deletedAt: null },
    });

    if (!record) {
      throw new NotFoundError("ShubhLaxmi registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to update this application");
    }

    const updateData: Prisma.ShubhLaxmiRegistrationUpdateInput = {};

    if (data.applicantName !== undefined) updateData.applicantName = String(data.applicantName).trim();
    if (data.fatherName !== undefined) updateData.fatherName = String(data.fatherName).trim();
    if (data.husbandName !== undefined) updateData.husbandName = data.husbandName ? String(data.husbandName).trim() : null;
    if (data.motherName !== undefined) updateData.motherName = data.motherName ? String(data.motherName).trim() : null;
    if (data.dateOfBirth !== undefined) updateData.dateOfBirth = parseDateInput(data.dateOfBirth, "dateOfBirth");
    if (data.age !== undefined) updateData.age = data.age !== null ? Number(data.age) : null;
    if (data.gotra !== undefined) updateData.gotra = String(data.gotra).trim();
    if (data.mobile !== undefined) {
      const cleaned = String(data.mobile).replace(/\D/g, "");
      if (cleaned.length < 10) throw new BadRequestError("Mobile must be at least 10 digits");
      updateData.mobile = cleaned;
    }
    if (data.address !== undefined) updateData.address = String(data.address).trim();
    if (data.pinCode !== undefined) updateData.pinCode = String(data.pinCode).trim();
    if (data.tehsil !== undefined) updateData.tehsil = String(data.tehsil).trim();
    if (data.district !== undefined) updateData.district = String(data.district).trim();
    if (data.state !== undefined) updateData.state = data.state ? String(data.state).trim() : "Rajasthan";
    if (data.nomineeName !== undefined) updateData.nomineeName = data.nomineeName ? String(data.nomineeName).trim() : null;
    if (data.nomineeRelation !== undefined) updateData.nomineeRelation = data.nomineeRelation ? String(data.nomineeRelation).trim() : null;
    if (data.nomineeMobile !== undefined) updateData.nomineeMobile = data.nomineeMobile ? String(data.nomineeMobile).replace(/\D/g, "") : null;
    if (data.nomineeAadhar !== undefined) updateData.nomineeAadhar = data.nomineeAadhar ? String(data.nomineeAadhar).replace(/\D/g, "") : null;
    if (data.gender !== undefined) updateData.gender = normalizeGender(data.gender);
    if (data.category !== undefined) updateData.category = normalizeCategory(data.category);

    if (data.passportPhotoUrl !== undefined) {
      updateData.passportPhotoUrl = saveImagePayload(data.passportPhotoUrl);
    }
    if (data.affidavitUrl !== undefined) {
      updateData.affidavitUrl = saveImagePayload(data.affidavitUrl);
    }

    const updated = await prisma.shubhLaxmiRegistration.update({
      where: { id },
      data: updateData,
      include: {
        installments: {
          where: { deletedAt: null },
          orderBy: { date: "asc" },
        },
      },
    });

    const financialSummary = computeShubhLaxmiFinancialSummary(
      updated.installments,
      updated.applicationDate
    );

    return {
      success: true,
      message: "ShubhLaxmi registration updated successfully",
      data: {
        ...updated,
        membershipFee: Number(updated.membershipFee),
        installments: updated.installments.map((inst) => ({
          ...inst,
          amount: Number(inst.amount),
        })),
        financialSummary,
      },
    };
  }

  /**
   * 5. SOFT DELETE SHUBHLAXMI REGISTRATION
   */
  public async softDeleteRegistration(
    id: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.shubhLaxmiRegistration.findFirst({
      where: { id, deletedAt: null },
    });

    if (!record) {
      throw new NotFoundError("ShubhLaxmi registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to delete this application");
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.shubhLaxmiInstallment.updateMany({
        where: { registrationId: id, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.shubhLaxmiRegistration.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: now,
        },
      });
    }, PRISMA_TX_OPTIONS);

    return {
      success: true,
      message: "ShubhLaxmi registration soft-deleted successfully",
    };
  }

  /**
   * 6. RECORD SHUBHLAXMI INSTALLMENT PAYMENT (EXACTLY ₹300)
   */
  public async addInstallment(
    registrationId: string,
    data: ShubhLaxmiInstallmentInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.shubhLaxmiRegistration.findFirst({
      where: { id: registrationId, deletedAt: null },
    });

    if (!record) {
      throw new NotFoundError("ShubhLaxmi registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to add installments to this application");
    }

    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestError("Installment amount must be greater than zero");
    }

    if (amount !== SHUBH_LAXMI_INSTALLMENT_AMOUNT) {
      throw new BadRequestError(
        `ShubhLaxmi installment amount must be exactly ₹${SHUBH_LAXMI_INSTALLMENT_AMOUNT}. Received: ₹${amount}`
      );
    }

    const installmentDate = parseDateInput(data.date, "date");

    return prisma.$transaction(async (tx) => {
      const installment = await tx.shubhLaxmiInstallment.create({
        data: {
          registrationId,
          amount: new Prisma.Decimal(SHUBH_LAXMI_INSTALLMENT_AMOUNT),
          date: installmentDate,
          note: data.note ? String(data.note).trim() : null,
          rashidNumber: data.rashidNumber ? String(data.rashidNumber).trim() : null,
          paymentMode: normalizePaymentMode(data.paymentMode),
          addedById: actor.userId,
        },
      });

      const allInstallments = await tx.shubhLaxmiInstallment.findMany({
        where: { registrationId, deletedAt: null },
      });

      const financialSummary = computeShubhLaxmiFinancialSummary(
        allInstallments,
        record.applicationDate
      );

      return {
        success: true,
        message: "Installment payment recorded successfully",
        data: {
          ...installment,
          amount: Number(installment.amount),
        },
        financialSummary,
      };
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * 7. VERIFY E-PIN PRE-SUBMISSION
   */
  public async verifyEPin(
    pinCode: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    return epinsService.validateEPin({ pinCode }, actor);
  }
}
