import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from "../../utils/errors";
import { ApplicationCategory, Gender, PaymentMode, Prisma } from "@prisma/client";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { parseDateInput } from "../../utils/parse-date";
import { saveImagePayload } from "../../utils/file-upload";
import { WhatsAppService } from "../../utils/whatsapp";
import { EpinsService } from "../epins/epins.service";
import {
  AAWAS_TOTAL_BENEFIT,
  AAWAS_FORM_PREFIX,
  CreateAawasInput,
  UpdateAawasInput,
  AawasFilter,
  AawasInstallmentInput,
} from "./aawas.types";

const epinsService = new EpinsService();

function normalizeGender(value: unknown): Gender {
  const raw = String(value || "").trim();
  if (/^male$/i.test(raw)) return Gender.Male;
  if (/^female$/i.test(raw)) return Gender.Female;
  if (/^other$/i.test(raw)) return Gender.Other;
  if (Object.values(Gender).includes(raw as Gender)) return raw as Gender;
  return Gender.Male;
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

async function nextAawasFormNumber(tx: PrismaTransactionClient): Promise<string> {
  const prefix = AAWAS_FORM_PREFIX;
  await lockFormNumberSequence(tx, "aawas_form_number");

  const result = await tx.$queryRawUnsafe<Array<{ formNumber: string }>>(`
    SELECT form_number AS "formNumber"
    FROM aawas_registrations
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

export class AawasService {
  /**
   * 1. CREATE AAWAS REGISTRATION APPLICATION
   */
  public async createRegistration(
    data: CreateAawasInput,
    addedById: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const rawAadhar = String(data.aadharNumber || "").replace(/\D/g, "");
    if (rawAadhar.length !== 12) {
      throw new BadRequestError("Aadhaar number must be exactly 12 digits");
    }

    // Check duplicate Aadhaar within active Aawas registrations
    const existing = await prisma.aawasRegistration.findFirst({
      where: {
        aadharNumber: rawAadhar,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictError(
        `An active Aawas registration already exists for Aadhaar ${rawAadhar} (Form: ${existing.formNumber})`
      );
    }

    // Resolve owner agent ID
    const ownerId =
      actor.role === "ADMIN" && data.selectedAgentId
        ? data.selectedAgentId
        : addedById;

    const rawPin = (data.epinCode || data.pinNumber || "").trim();

    const selectedAgentId =
      actor.role === "ADMIN" && data.selectedAgentId
        ? data.selectedAgentId
        : (actor.role === "AGENT" ? addedById : undefined);

    // Validate E-PIN if supplied
    if (rawPin) {
      const validationResult = await epinsService.validateEPin(
        { pinCode: rawPin, agentId: selectedAgentId },
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

    // Server-authoritative financial calculation
    const totalAmount = AAWAS_TOTAL_BENEFIT;
    const paymentAmount = Number(data.paymentAmount || 0);
    const pendingAmount = Math.max(totalAmount - paymentAmount, 0);

    return prisma.$transaction(async (tx) => {
      const formNumber = await nextAawasFormNumber(tx);

      const registration = await tx.aawasRegistration.create({
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
          gender: data.gender ? normalizeGender(data.gender) : Gender.Male,
          category: normalizeCategory(data.category),
          totalAmount,
          pendingAmount,
          epinCode: rawPin || null,
          addedById: ownerId,
        },
      });

      // If initial payment is made, record installment
      if (paymentAmount > 0) {
        await tx.aawasInstallment.create({
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
            module: "AAWAS",
            agentId: selectedAgentId,
            remarks: `Consumed for Aawas Application ${registration.formNumber} (${registration.applicantName})`,
            usedById: actor.userId,
          },
          actor,
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
              schemeName: "आवास योजना",
            });
          } catch (e) {
            console.error("Backend error sending Aawas WhatsApp notification:", e);
          }
        })();
      }

      return registration;
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * 2. LIST AAWAS REGISTRATIONS (PAGINATED + AGENT ISOLATION)
   */
  public async getRegistrations(
    filter: AawasFilter,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const page = Math.max(Number(filter.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filter.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.AawasRegistrationWhereInput = {
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
      prisma.aawasRegistration.count({ where }),
      prisma.aawasRegistration.findMany({
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

    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      data: records,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * 3. GET SINGLE AAWAS REGISTRATION BY ID
   */
  public async getRegistrationById(
    id: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.aawasRegistration.findFirst({
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
      throw new NotFoundError("Aawas registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to view this application");
    }

    return {
      success: true,
      data: record,
    };
  }

  /**
   * 4. UPDATE AAWAS REGISTRATION
   */
  public async updateRegistration(
    id: string,
    data: UpdateAawasInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.aawasRegistration.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!record) {
      throw new NotFoundError("Aawas registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to edit this application");
    }

    const updateData: Prisma.AawasRegistrationUpdateInput = {};

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

    const updated = await prisma.aawasRegistration.update({
      where: { id },
      data: updateData,
      include: {
        installments: {
          where: { deletedAt: null },
          orderBy: { date: "asc" },
        },
      },
    });

    return {
      success: true,
      message: "Aawas registration updated successfully",
      data: updated,
    };
  }

  /**
   * 5. SOFT DELETE AAWAS REGISTRATION
   */
  public async softDeleteRegistration(
    id: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.aawasRegistration.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!record) {
      throw new NotFoundError("Aawas registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to delete this application");
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.aawasRegistration.update({
        where: { id },
        data: { deletedAt: now, isActive: false },
      });
      await tx.aawasInstallment.updateMany({
        where: { registrationId: id, deletedAt: null },
        data: { deletedAt: now },
      });
    }, PRISMA_TX_OPTIONS);

    return {
      success: true,
      message: "Aawas registration deleted successfully",
    };
  }

  /**
   * 6. ADD INSTALLMENT PAYMENT
   */
  public async addInstallment(
    registrationId: string,
    data: AawasInstallmentInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.aawasRegistration.findFirst({
      where: {
        id: registrationId,
        deletedAt: null,
      },
    });

    if (!record) {
      throw new NotFoundError("Aawas registration not found");
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError("Access Denied: You do not have permission to add installments to this application");
    }

    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestError("Installment amount must be greater than zero");
    }

    const installmentDate = parseDateInput(data.date, "date");

    return prisma.$transaction(async (tx) => {
      const installment = await tx.aawasInstallment.create({
        data: {
          registrationId,
          amount,
          date: installmentDate,
          note: data.note ? String(data.note).trim() : null,
          rashidNumber: data.rashidNumber ? String(data.rashidNumber).trim() : null,
          paymentMode: normalizePaymentMode(data.paymentMode),
          addedById: actor.userId,
        },
      });

      // Recalculate pending balance
      const newPending = Math.max(0, Number(record.pendingAmount) - amount);

      await tx.aawasRegistration.update({
        where: { id: registrationId },
        data: {
          pendingAmount: newPending,
        },
      });

      return {
        success: true,
        message: "Installment payment recorded successfully",
        data: installment,
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
