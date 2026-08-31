import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from "../../utils/errors";
import { ApplicationCategory, Gender, PaymentMode, Prisma } from "@prisma/client";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { parseDateInput } from "../../utils/parse-date";
import { saveImagePayload } from "../../utils/file-upload";
import { EpinsService } from "../epins/epins.service";
import {
  CreateJanniDeliveryInput,
  UpdateJanniDeliveryInput,
  JanniDeliveryFilter,
  JanniDeliveryInstallmentInput,
} from "./janni-delivery.types";

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

async function nextJanniFormNumber(tx: PrismaTransactionClient): Promise<string> {
  const prefix = "JN";
  await lockFormNumberSequence(tx, "janni_delivery_form_number");

  const result = await tx.$queryRawUnsafe<Array<{ formNumber: string }>>(`
    SELECT form_number AS "formNumber"
    FROM janni_delivery_registrations
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

export class JanniDeliveryService {
  /**
   * 1. CREATE JANNI DELIVERY REGISTRATION APPLICATION
   */
  public async createRegistration(
    data: CreateJanniDeliveryInput,
    addedById: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const rawAadhar = String(data.aadharNumber || "").replace(/\D/g, "");
    if (rawAadhar.length !== 12) {
      throw new BadRequestError("Aadhaar number must be exactly 12 digits");
    }

    // Check duplicate Aadhaar within Janni Delivery
    const existing = await prisma.janniDeliveryRegistration.findFirst({
      where: {
        aadharNumber: rawAadhar,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictError(
        `An active Janni Delivery registration already exists for Aadhaar ${rawAadhar} (Form: ${existing.formNumber})`
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
    const deliveryDate = data.deliveryDate
      ? parseDateInput(data.deliveryDate, "deliveryDate")
      : null;

    const totalAmount = Number(data.totalAmount || 0);
    const paymentAmount = Number(data.paymentAmount || 0);
    const pendingAmount = Math.max(totalAmount - paymentAmount, 0);

    return prisma.$transaction(async (tx) => {
      const formNumber = await nextJanniFormNumber(tx);

      const registration = await tx.janniDeliveryRegistration.create({
        data: {
          formNumber,
          applicationDate,
          applicantName: String(data.applicantName).trim(),
          fatherName: String(data.fatherName).trim(),
          husbandName: data.husbandName ? String(data.husbandName).trim() : null,
          motherName: data.motherName ? String(data.motherName).trim() : null,
          dateOfBirth,
          age: data.age ? Number(data.age) : null,
          aadharNumber: rawAadhar,
          gotra: String(data.gotra).trim(),
          mobile: String(data.mobile).replace(/\D/g, ""),
          address: String(data.address).trim(),
          pinCode: String(data.pinCode).trim(),
          tehsil: String(data.tehsil).trim(),
          district: String(data.district).trim(),
          state: data.state ? String(data.state).trim() : "Rajasthan",
          childName: data.childName ? String(data.childName).trim() : null,
          childGender: data.childGender ? normalizeGender(data.childGender) : null,
          deliveryDate,
          hospitalName: data.hospitalName ? String(data.hospitalName).trim() : null,
          nomineeName: data.nomineeName ? String(data.nomineeName).trim() : null,
          nomineeRelation: data.nomineeRelation ? String(data.nomineeRelation).trim() : null,
          nomineeMobile: data.nomineeMobile ? String(data.nomineeMobile).replace(/\D/g, "") : null,
          passportPhotoUrl: saveImagePayload(data.passportPhotoUrl),
          affidavitUrl: saveImagePayload(data.affidavitUrl),
          gender: data.gender ? normalizeGender(data.gender) : Gender.Female,
          category: normalizeCategory(data.category),
          totalAmount,
          pendingAmount,
          epinCode: rawPin || null,
          addedById: ownerId,
        },
      });

      // If initial payment is made, record installment
      if (paymentAmount > 0) {
        await tx.janniDeliveryInstallment.create({
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
            module: "JANNI_DELIVERY",
            remarks: `Consumed for Janni Delivery Application ${registration.formNumber} (${registration.applicantName})`,
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
   * 2. LIST JANNI DELIVERY REGISTRATIONS (PAGINATED + AGENT ISOLATION)
   */
  public async getRegistrations(
    filter: JanniDeliveryFilter,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const page = Math.max(Number(filter.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filter.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.JanniDeliveryRegistrationWhereInput = {
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
        where.applicationDate.gte = parseDateInput(filter.startDate, "startDate");
      }
      if (filter.endDate) {
        where.applicationDate.lte = parseDateInput(filter.endDate, "endDate");
      }
    }

    const [total, records] = await Promise.all([
      prisma.janniDeliveryRegistration.count({ where }),
      prisma.janniDeliveryRegistration.findMany({
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
            },
          },
          installments: {
            where: { deletedAt: null },
            orderBy: { date: "desc" },
            take: 1,
          },
        },
      }),
    ]);

    return {
      success: true,
      data: records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 3. GET SINGLE REGISTRATION BY ID
   */
  public async getRegistrationById(
    id: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.janniDeliveryRegistration.findFirst({
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
        },
      },
    });

    if (!record) {
      throw new NotFoundError(`Janni Delivery Registration '${id}' not found`);
    }

    // Enforce Agent isolation
    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError(
        "Access Denied: You do not have permission to access this registration"
      );
    }

    return {
      success: true,
      data: record,
    };
  }

  /**
   * 4. UPDATE REGISTRATION
   */
  public async updateRegistration(
    id: string,
    data: UpdateJanniDeliveryInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.janniDeliveryRegistration.findFirst({
      where: { id, deletedAt: null },
    });

    if (!record) {
      throw new NotFoundError(`Janni Delivery Registration '${id}' not found`);
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError(
        "Access Denied: You do not have permission to update this registration"
      );
    }

    const updated = await prisma.janniDeliveryRegistration.update({
      where: { id },
      data: {
        ...(data.applicantName ? { applicantName: String(data.applicantName).trim() } : {}),
        ...(data.fatherName ? { fatherName: String(data.fatherName).trim() } : {}),
        ...(data.husbandName !== undefined ? { husbandName: data.husbandName ? String(data.husbandName).trim() : null } : {}),
        ...(data.motherName !== undefined ? { motherName: data.motherName ? String(data.motherName).trim() : null } : {}),
        ...(data.dateOfBirth ? { dateOfBirth: parseDateInput(data.dateOfBirth, "dateOfBirth") } : {}),
        ...(data.age !== undefined ? { age: data.age ? Number(data.age) : null } : {}),
        ...(data.gotra ? { gotra: String(data.gotra).trim() } : {}),
        ...(data.mobile ? { mobile: String(data.mobile).replace(/\D/g, "") } : {}),
        ...(data.address ? { address: String(data.address).trim() } : {}),
        ...(data.pinCode ? { pinCode: String(data.pinCode).trim() } : {}),
        ...(data.tehsil ? { tehsil: String(data.tehsil).trim() } : {}),
        ...(data.district ? { district: String(data.district).trim() } : {}),
        ...(data.state ? { state: String(data.state).trim() } : {}),
        ...(data.childName !== undefined ? { childName: data.childName ? String(data.childName).trim() : null } : {}),
        ...(data.childGender !== undefined ? { childGender: data.childGender ? normalizeGender(data.childGender) : null } : {}),
        ...(data.deliveryDate !== undefined ? { deliveryDate: data.deliveryDate ? parseDateInput(data.deliveryDate, "deliveryDate") : null } : {}),
        ...(data.hospitalName !== undefined ? { hospitalName: data.hospitalName ? String(data.hospitalName).trim() : null } : {}),
        ...(data.nomineeName !== undefined ? { nomineeName: data.nomineeName ? String(data.nomineeName).trim() : null } : {}),
        ...(data.nomineeRelation !== undefined ? { nomineeRelation: data.nomineeRelation ? String(data.nomineeRelation).trim() : null } : {}),
        ...(data.nomineeMobile !== undefined ? { nomineeMobile: data.nomineeMobile ? String(data.nomineeMobile).replace(/\D/g, "") : null } : {}),
        ...(data.passportPhotoUrl !== undefined ? { passportPhotoUrl: saveImagePayload(data.passportPhotoUrl) } : {}),
        ...(data.affidavitUrl !== undefined ? { affidavitUrl: saveImagePayload(data.affidavitUrl) } : {}),
        ...(data.gender ? { gender: normalizeGender(data.gender) } : {}),
        ...(data.category ? { category: normalizeCategory(data.category) } : {}),
        ...(data.totalAmount !== undefined ? { totalAmount: Number(data.totalAmount) } : {}),
        ...(data.pendingAmount !== undefined ? { pendingAmount: Number(data.pendingAmount) } : {}),
      },
    });

    return {
      success: true,
      message: "Janni Delivery registration updated successfully",
      data: updated,
    };
  }

  /**
   * 5. SOFT DELETE REGISTRATION
   */
  public async softDeleteRegistration(
    id: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.janniDeliveryRegistration.findFirst({
      where: { id, deletedAt: null },
    });

    if (!record) {
      throw new NotFoundError(`Janni Delivery Registration '${id}' not found`);
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError(
        "Access Denied: You do not have permission to delete this registration"
      );
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.janniDeliveryRegistration.update({
        where: { id },
        data: { deletedAt: now },
      });
      await tx.janniDeliveryInstallment.updateMany({
        where: { registrationId: id, deletedAt: null },
        data: { deletedAt: now },
      });
    }, PRISMA_TX_OPTIONS);

    return {
      success: true,
      message: `Janni Delivery Registration ${record.formNumber} deleted successfully`,
    };
  }

  /**
   * 6. ADD INSTALLMENT PAYMENT
   */
  public async addInstallment(
    registrationId: string,
    data: JanniDeliveryInstallmentInput,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    const record = await prisma.janniDeliveryRegistration.findFirst({
      where: { id: registrationId, deletedAt: null },
    });

    if (!record) {
      throw new NotFoundError(
        `Janni Delivery Registration '${registrationId}' not found`
      );
    }

    if (actor.role === "AGENT" && record.addedById !== actor.userId) {
      throw new ForbiddenError(
        "Access Denied: You do not have permission to record payments for this registration"
      );
    }

    const installmentAmount = Number(data.amount);
    if (!installmentAmount || installmentAmount <= 0) {
      throw new BadRequestError("Installment amount must be greater than 0");
    }

    const installmentDate = parseDateInput(data.date, "date");

    return prisma.$transaction(async (tx) => {
      const installment = await tx.janniDeliveryInstallment.create({
        data: {
          registrationId,
          amount: installmentAmount,
          date: installmentDate,
          note: data.note ? String(data.note).trim() : null,
          rashidNumber: data.rashidNumber ? String(data.rashidNumber).trim() : null,
          paymentMode: normalizePaymentMode(data.paymentMode),
          addedById: actor.userId,
        },
      });

      const updatedPending = Math.max(
        Number(record.pendingAmount) - installmentAmount,
        0
      );

      await tx.janniDeliveryRegistration.update({
        where: { id: registrationId },
        data: {
          pendingAmount: updatedPending,
        },
      });

      return {
        success: true,
        message: `Installment payment of ₹${installmentAmount} recorded successfully`,
        data: installment,
        pendingAmount: updatedPending,
      };
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * 7. VERIFY E-PIN FOR JANNI DELIVERY WORKFLOW
   */
  public async verifyEPin(
    pinCode: string,
    actor: { userId: string; role: "ADMIN" | "AGENT" }
  ) {
    return epinsService.validateEPin({ pinCode }, actor);
  }
}
