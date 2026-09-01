import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from "../../utils/errors";
import {
  ApplicationCategory,
  Gender,
  LadoBahinAccountType,
  PaymentMode,
  Prisma,
} from "@prisma/client";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { parseDateInput } from "../../utils/parse-date";
import { saveImagePayload } from "../../utils/file-upload";
import { EpinsService } from "../epins/epins.service";
import {
  LADO_BAHIN_FORM_PREFIX,
  LADO_BAHIN_MEMBERSHIP_FEE,
  LADO_BAHIN_POOL,
  LADO_BAHIN_SCHEME_TYPE,
  LADO_BAHIN_ACCOUNT_AMOUNTS,
  CreateLadoBahinInput,
  UpdateLadoBahinInput,
  LadoBahinFilter,
  LadoBahinInstallmentInput,
  LadoBahinFinancialSummary,
} from "./lado-bahin.types";

const epinsService = new EpinsService();

function normalizeGender(value: unknown): Gender {
  const raw = String(value || "").trim();
  if (/^male$/i.test(raw)) return Gender.Male;
  if (/^female$/i.test(raw)) return Gender.Female;
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

function normalizeAccountType(value: unknown): LadoBahinAccountType {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "LADO_BAHIN_300" || raw === "300" || raw === "SCHEME_300") {
    return LadoBahinAccountType.LADO_BAHIN_300;
  }
  if (raw === "LADO_BAHIN_1000" || raw === "1000" || raw === "SCHEME_1000") {
    return LadoBahinAccountType.LADO_BAHIN_1000;
  }
  if (Object.values(LadoBahinAccountType).includes(raw as LadoBahinAccountType)) {
    return raw as LadoBahinAccountType;
  }
  throw new BadRequestError(
    `Invalid account type '${value}'. Valid values are: LADO_BAHIN_300, LADO_BAHIN_1000`
  );
}

export function computeLadoBahinFinancialSummary(
  installments: Array<{ accountType: LadoBahinAccountType; amount: Prisma.Decimal | number; deletedAt?: Date | null }>
): LadoBahinFinancialSummary {
  const activeInstallments = installments.filter((inst) => !inst.deletedAt);

  const inst300 = activeInstallments.filter(
    (inst) => inst.accountType === LadoBahinAccountType.LADO_BAHIN_300
  );
  const totalCollected300 = inst300.reduce(
    (acc, cur) => acc + Number(cur.amount),
    0
  );

  const inst1000 = activeInstallments.filter(
    (inst) => inst.accountType === LadoBahinAccountType.LADO_BAHIN_1000
  );
  const totalCollected1000 = inst1000.reduce(
    (acc, cur) => acc + Number(cur.amount),
    0
  );

  return {
    membershipFee: LADO_BAHIN_MEMBERSHIP_FEE,
    account300: {
      accountType: LadoBahinAccountType.LADO_BAHIN_300,
      installmentAmount: LADO_BAHIN_ACCOUNT_AMOUNTS.LADO_BAHIN_300,
      totalCollected: totalCollected300,
      installmentCount: inst300.length,
      pending: 0,
    },
    account1000: {
      accountType: LadoBahinAccountType.LADO_BAHIN_1000,
      installmentAmount: LADO_BAHIN_ACCOUNT_AMOUNTS.LADO_BAHIN_1000,
      totalCollected: totalCollected1000,
      installmentCount: inst1000.length,
      pending: 0,
    },
  };
}

async function nextLadoBahinFormNumber(tx: PrismaTransactionClient): Promise<string> {
  const prefix = LADO_BAHIN_FORM_PREFIX;
  await lockFormNumberSequence(tx, "lado_bahin_form_number");

  const result = await tx.$queryRawUnsafe<Array<{ formNumber: string }>>(`
    SELECT form_number AS "formNumber"
    FROM lado_bahin_registrations
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

export class LadoBahinService {
  /**
   * 1. CREATE LADO BAHIN REGISTRATION APPLICATION
   */
  public async createRegistration(
    data: CreateLadoBahinInput,
    addedById: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const rawAadhar = String(data.aadharNumber || "").replace(/\D/g, "");
    if (rawAadhar.length !== 12) {
      throw new BadRequestError("Aadhaar number must be exactly 12 digits");
    }

    // Check duplicate Aadhaar within active Lado Bahin registrations
    const existing = await prisma.ladoBahinRegistration.findFirst({
      where: {
        aadharNumber: rawAadhar,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictError(
        `An active Lado Bahin registration already exists for Aadhaar ${rawAadhar} (Form: ${existing.formNumber})`
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

    const membershipFee = LADO_BAHIN_MEMBERSHIP_FEE;
    const paymentAmount = data.paymentAmount ? Number(data.paymentAmount) : 0;

    let initialAccountType: LadoBahinAccountType | null = null;
    if (paymentAmount > 0) {
      if (!data.initialAccountType) {
        throw new BadRequestError(
          "initialAccountType (LADO_BAHIN_300 or LADO_BAHIN_1000) is required when initial paymentAmount is provided"
        );
      }
      initialAccountType = normalizeAccountType(data.initialAccountType);
      const expectedAmount = LADO_BAHIN_ACCOUNT_AMOUNTS[initialAccountType];
      if (paymentAmount !== expectedAmount) {
        throw new BadRequestError(
          `Initial installment payment amount for ${initialAccountType} must be exactly ₹${expectedAmount}. Received: ₹${paymentAmount}`
        );
      }
    }

    return prisma.$transaction(async (tx) => {
      const formNumber = await nextLadoBahinFormNumber(tx);

      const registration = await tx.ladoBahinRegistration.create({
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
          schemeType: LADO_BAHIN_SCHEME_TYPE,
          pool: LADO_BAHIN_POOL,
          membershipFee,
          epinCode: rawPin || null,
          addedById: ownerId,
        },
      });

      // If initial payment is made, record installment with designated account type
      if (paymentAmount > 0 && initialAccountType) {
        await tx.ladoBahinInstallment.create({
          data: {
            registrationId: registration.id,
            accountType: initialAccountType,
            amount: paymentAmount,
            date: applicationDate,
            paymentMode: normalizePaymentMode(data.paymentMode),
            note: `Initial Registration Payment (${initialAccountType})`,
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
            module: "LADO_BAHIN",
            remarks: `Consumed for Lado Bahin Application ${registration.formNumber} (${registration.applicantName})`,
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
   * 2. LIST LADO BAHIN REGISTRATIONS (PAGINATED + AGENT ISOLATION)
   */
  public async getRegistrations(
    filter: LadoBahinFilter,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const page = Math.max(Number(filter.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filter.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.LadoBahinRegistrationWhereInput = {
      deletedAt: null,
    };

    // Agent isolation: Agents only see applications they created/own
    if (actor.role === "AGENT") {
      where.addedById = actor.userId;
    } else if (filter.agentId) {
      where.addedById = filter.agentId;
    }

    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { formNumber: { contains: q, mode: "insensitive" } },
        { applicantName: { contains: q, mode: "insensitive" } },
        { fatherName: { contains: q, mode: "insensitive" } },
        { husbandName: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q } },
        { aadharNumber: { contains: q } },
        { gotra: { contains: q, mode: "insensitive" } },
      ];
    }

    if (filter.district) {
      where.district = { equals: filter.district.trim(), mode: "insensitive" };
    }

    if (filter.tehsil) {
      where.tehsil = { equals: filter.tehsil.trim(), mode: "insensitive" };
    }

    if (filter.gotra) {
      where.gotra = { equals: filter.gotra.trim(), mode: "insensitive" };
    }

    if (filter.category) {
      where.category = normalizeCategory(filter.category);
    }

    if (filter.startDate || filter.endDate) {
      where.applicationDate = {};
      if (filter.startDate) {
        where.applicationDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.applicationDate.lte = new Date(filter.endDate);
      }
    }

    const [total, records] = await Promise.all([
      prisma.ladoBahinRegistration.count({ where }),
      prisma.ladoBahinRegistration.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
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

    const enrichedRecords = records.map((rec) => {
      const summary = computeLadoBahinFinancialSummary(rec.installments);
      return {
        ...rec,
        financialSummary: summary,
      };
    });

    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      data: enrichedRecords,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * 3. GET SINGLE LADO BAHIN REGISTRATION BY ID
   */
  public async getRegistrationById(
    id: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.ladoBahinRegistration.findFirst({
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
              },
            },
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundError("Lado Bahin registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to view this application");
    }

    const financialSummary = computeLadoBahinFinancialSummary(record.installments);

    return {
      success: true,
      data: {
        ...record,
        financialSummary,
      },
    };
  }

  /**
   * 4. UPDATE LADO BAHIN REGISTRATION
   */
  public async updateRegistration(
    id: string,
    data: UpdateLadoBahinInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.ladoBahinRegistration.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!record) {
      throw new NotFoundError("Lado Bahin registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to edit this application");
    }

    const updateData: Prisma.LadoBahinRegistrationUpdateInput = {};

    if (data.applicantName !== undefined) updateData.applicantName = String(data.applicantName).trim();
    if (data.fatherName !== undefined) updateData.fatherName = String(data.fatherName).trim();
    if (data.husbandName !== undefined) updateData.husbandName = data.husbandName ? String(data.husbandName).trim() : null;
    if (data.motherName !== undefined) updateData.motherName = data.motherName ? String(data.motherName).trim() : null;
    if (data.dateOfBirth !== undefined) updateData.dateOfBirth = parseDateInput(data.dateOfBirth, "dateOfBirth");
    if (data.age !== undefined) updateData.age = data.age !== null ? Number(data.age) : null;
    if (data.gotra !== undefined) updateData.gotra = String(data.gotra).trim();
    if (data.mobile !== undefined) updateData.mobile = String(data.mobile).replace(/\D/g, "");
    if (data.address !== undefined) updateData.address = String(data.address).trim();
    if (data.pinCode !== undefined) updateData.pinCode = String(data.pinCode).trim();
    if (data.tehsil !== undefined) updateData.tehsil = String(data.tehsil).trim();
    if (data.district !== undefined) updateData.district = String(data.district).trim();
    if (data.state !== undefined) updateData.state = String(data.state).trim();
    if (data.nomineeName !== undefined) updateData.nomineeName = data.nomineeName ? String(data.nomineeName).trim() : null;
    if (data.nomineeRelation !== undefined) updateData.nomineeRelation = data.nomineeRelation ? String(data.nomineeRelation).trim() : null;
    if (data.nomineeMobile !== undefined) updateData.nomineeMobile = data.nomineeMobile ? String(data.nomineeMobile).replace(/\D/g, "") : null;
    if (data.nomineeAadhar !== undefined) updateData.nomineeAadhar = data.nomineeAadhar ? String(data.nomineeAadhar).replace(/\D/g, "") : null;
    if (data.passportPhotoUrl !== undefined) updateData.passportPhotoUrl = saveImagePayload(data.passportPhotoUrl);
    if (data.affidavitUrl !== undefined) updateData.affidavitUrl = saveImagePayload(data.affidavitUrl);
    if (data.gender !== undefined) updateData.gender = normalizeGender(data.gender);
    if (data.category !== undefined) updateData.category = normalizeCategory(data.category);

    const updated = await prisma.ladoBahinRegistration.update({
      where: { id },
      data: updateData,
      include: {
        installments: {
          where: { deletedAt: null },
          orderBy: { date: "asc" },
        },
      },
    });

    const financialSummary = computeLadoBahinFinancialSummary(updated.installments);

    return {
      success: true,
      message: "Lado Bahin registration updated successfully",
      data: {
        ...updated,
        financialSummary,
      },
    };
  }

  /**
   * 5. SOFT DELETE LADO BAHIN REGISTRATION
   */
  public async softDeleteRegistration(
    id: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.ladoBahinRegistration.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!record) {
      throw new NotFoundError("Lado Bahin registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to delete this application");
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.ladoBahinRegistration.update({
        where: { id },
        data: { deletedAt: now, isActive: false },
      });
      await tx.ladoBahinInstallment.updateMany({
        where: { registrationId: id, deletedAt: null },
        data: { deletedAt: now },
      });
    }, PRISMA_TX_OPTIONS);

    return {
      success: true,
      message: "Lado Bahin registration deleted successfully",
    };
  }

  /**
   * 6. ADD INSTALLMENT PAYMENT WITH STRICT ACCOUNT-AMOUNT VALIDATION
   */
  public async addInstallment(
    registrationId: string,
    data: LadoBahinInstallmentInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.ladoBahinRegistration.findFirst({
      where: {
        id: registrationId,
        deletedAt: null,
      },
    });

    if (!record) {
      throw new NotFoundError("Lado Bahin registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to add installments to this application");
    }

    const accountType = normalizeAccountType(data.accountType);
    const amount = Number(data.amount);

    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestError("Installment amount must be greater than zero");
    }

    const expectedAmount = LADO_BAHIN_ACCOUNT_AMOUNTS[accountType];
    if (amount !== expectedAmount) {
      throw new BadRequestError(
        `Installment amount for ${accountType} must be exactly ₹${expectedAmount}. Received: ₹${amount}`
      );
    }

    const installmentDate = parseDateInput(data.date, "date");

    return prisma.$transaction(async (tx) => {
      const installment = await tx.ladoBahinInstallment.create({
        data: {
          registrationId,
          accountType,
          amount,
          date: installmentDate,
          note: data.note ? String(data.note).trim() : null,
          rashidNumber: data.rashidNumber ? String(data.rashidNumber).trim() : null,
          paymentMode: normalizePaymentMode(data.paymentMode),
          addedById: actor.userId,
        },
      });

      // Fetch all updated installments to compute fresh separate ledger summaries
      const allInstallments = await tx.ladoBahinInstallment.findMany({
        where: { registrationId, deletedAt: null },
      });

      const financialSummary = computeLadoBahinFinancialSummary(allInstallments);

      return {
        success: true,
        message: "Installment payment recorded successfully",
        data: installment,
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
