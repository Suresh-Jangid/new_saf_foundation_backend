import { prisma, PRISMA_TX_OPTIONS, PrismaTransactionClient } from "../../config/db";
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from "../../utils/errors";
import { ApplicationCategory, Gender, PaymentMode, Prisma } from "@prisma/client";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { parseDateInput } from "../../utils/parse-date";
import { saveImagePayload } from "../../utils/file-upload";
import { WhatsAppService } from "../../utils/whatsapp";
import { EpinsService } from "../epins/epins.service";
import { isValidUuid, resolveAgentSeniorHierarchyBatch } from "../../utils/compat-helpers";
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

    const rawOffline = data.offlineFormNumber ?? data.offline_form_number ?? data.offlineFormNo;
    const offlineFormNumber =
      rawOffline !== undefined && rawOffline !== null && String(rawOffline).trim() !== ""
        ? String(rawOffline).trim()
        : null;

    if (offlineFormNumber) {
      const existingOffline = await prisma.janniDeliveryRegistration.findFirst({
        where: {
          offlineFormNumber,
          deletedAt: null,
        },
        select: { id: true, formNumber: true, applicantName: true },
      });

      if (existingOffline) {
        throw new ConflictError(
          `Offline Form Number "${offlineFormNumber}" is already assigned to application ${existingOffline.formNumber} (${existingOffline.applicantName})`
        );
      }
    }

    const rawNomineeAadhar =
      data.nomineeAadhar !== undefined
        ? data.nomineeAadhar
        : data.nominee_aadhar !== undefined
        ? data.nominee_aadhar
        : data.nomineeAadhaar;
    let nomineeAadhar: string | null = null;
    if (rawNomineeAadhar !== undefined && rawNomineeAadhar !== null && String(rawNomineeAadhar).trim() !== "") {
      const cleanedNomineeAadhar = String(rawNomineeAadhar).replace(/\D/g, "");
      if (cleanedNomineeAadhar.length !== 12) {
        throw new BadRequestError("Nominee Aadhaar number must be exactly 12 digits");
      }
      nomineeAadhar = cleanedNomineeAadhar;
    }

    const rawNomineePhoto =
      data.nomineePhotoUrl !== undefined
        ? data.nomineePhotoUrl
        : data.nominee_photo_url !== undefined
        ? data.nominee_photo_url
        : data.nomineePhoto !== undefined
        ? data.nomineePhoto
        : data.nomineePassportPhoto;
    const nomineePhotoUrl = saveImagePayload(rawNomineePhoto);

    // Resolve owner agent ID
    const ownerId =
      actor.role === "ADMIN" && data.selectedAgentId
        ? data.selectedAgentId
        : addedById;

    const rawPinCode = (data.epinCode || "").trim();
    const rawPinNumber = (data.pinNumber || "").trim();
    if (rawPinCode && rawPinNumber && rawPinCode !== rawPinNumber) {
      throw new BadRequestError("Ambiguous E-PIN inputs provided (epinCode and pinNumber mismatch)");
    }
    const rawPin = rawPinCode || rawPinNumber;

    if (!rawPin) {
      throw new BadRequestError(
        "E-PIN आवश्यक है / E-PIN is required for Janni Delivery Registration"
      );
    }

    const selectedAgentId =
      actor.role === "ADMIN" && data.selectedAgentId
        ? data.selectedAgentId
        : (actor.role === "AGENT" ? addedById : undefined);

    // Validate E-PIN (Mandatory)
    const validationResult = await epinsService.validateEPin(
      { pinCode: rawPin, agentId: selectedAgentId },
      actor
    );

    if (!validationResult.valid) {
      throw new BadRequestError(
        `E-PIN Validation Failed: ${validationResult.message}`
      );
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
          offlineFormNumber,
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
          nomineeAadhar,
          nomineePhotoUrl,
          passportPhotoUrl: saveImagePayload(data.passportPhotoUrl),
          affidavitUrl: saveImagePayload(data.affidavitUrl),
          gender: data.gender ? normalizeGender(data.gender) : Gender.Female,
          category: normalizeCategory(data.category),
          totalAmount,
          pendingAmount,
          epinCode: rawPin,
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

      // Mandatory E-PIN consumption atomically inside transaction
      await epinsService.consumeEPin(
        {
          pinCode: rawPin,
          applicationId: registration.id,
          applicantName: registration.applicantName,
          module: "JANNI_DELIVERY",
          agentId: selectedAgentId,
          remarks: `Consumed for Janni Delivery Application ${registration.formNumber} (${registration.applicantName})`,
          usedById: actor.userId,
        },
        actor,
        tx
      );

      // Send dynamic standardized WhatsApp thank-you message via Green API
      if (registration?.mobile) {
        void (async () => {
          try {
            await WhatsAppService.sendSchemeRegistrationThankYou(registration.mobile, {
              applicantName: registration.applicantName,
              applicationNumber: registration.formNumber,
              schemeName: "जन्नी डिलीवरी योजना",
            });
          } catch (e) {
            console.error("Backend error sending Janni Delivery WhatsApp notification:", e);
          }
        })();
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
        { offlineFormNumber: { contains: q, mode: "insensitive" } },
        { applicantName: { contains: q, mode: "insensitive" } },
        { fatherName: { contains: q, mode: "insensitive" } },
        { husbandName: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q } },
        { aadharNumber: { contains: q } },
        { nomineeAadhar: { contains: q } },
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
            where: { deletedAt: null },
            orderBy: { date: "desc" },
            take: 1,
          },
        },
      }),
    ]);

    const addedByIds = records.map((r: any) => r.addedById).filter(Boolean);
    const hierarchyMap = await resolveAgentSeniorHierarchyBatch(addedByIds);

    const formattedRecords = records.map((r: any) => {
      const hierarchy = r.addedById ? hierarchyMap.get(r.addedById) : null;
      const isAdmin =
        r.addedBy?.role === "ADMIN" ||
        r.addedBy?.name === "Default Agent" ||
        r.addedBy?.name === "Super Admin";
      const agentEmployeeId = r.addedBy?.agentProfile?.employeeId || "";
      const workerOfflineFormNumber = r.addedBy?.agentProfile?.offlineFormNumber || "";

      let rawWorkerCode = r.workerCode;
      if (!rawWorkerCode || isValidUuid(rawWorkerCode)) {
        if (isAdmin || !workerOfflineFormNumber) {
          rawWorkerCode = "ADMIN";
        } else {
          rawWorkerCode = workerOfflineFormNumber || agentEmployeeId || "ADMIN";
        }
      }
      const workerCode = rawWorkerCode || (isAdmin ? "ADMIN" : "ADMIN");
      const resolvedWorkerOfflineForm = workerOfflineFormNumber || (isAdmin || !workerOfflineFormNumber ? "ADMIN" : "");
      const workerName = r.workerName || r.addedBy?.name || (isAdmin ? (r.addedBy?.name || "Super Admin") : "Super Admin");
      const workerMobile = r.workerMobile || r.addedBy?.mobile || "";

      let seniorCode = "ADMIN";
      let seniorName = "Super Admin";
      let seniorOfflineFormNumber = "ADMIN";
      let parentAgentId = null;

      if (hierarchy && hierarchy.seniorCode && hierarchy.seniorCode !== "ADMIN") {
        seniorCode = hierarchy.seniorCode;
        seniorName = hierarchy.seniorName;
        seniorOfflineFormNumber = hierarchy.seniorOfflineFormNumber || hierarchy.seniorCode;
        parentAgentId = hierarchy.parentAgentId;
      } else if (hierarchy) {
        seniorCode = hierarchy.seniorCode || "ADMIN";
        seniorName = hierarchy.seniorName || "Super Admin";
        seniorOfflineFormNumber = hierarchy.seniorOfflineFormNumber || seniorCode || "ADMIN";
        parentAgentId = hierarchy.parentAgentId || null;
      } else if (isAdmin) {
        seniorCode = "ADMIN";
        seniorName = "Super Admin";
        seniorOfflineFormNumber = "ADMIN";
        parentAgentId = null;
      } else {
        seniorCode = "ADMIN";
        seniorName = "Super Admin";
        seniorOfflineFormNumber = "ADMIN";
        parentAgentId = null;
      }

      return {
        ...r,
        offlineFormNumber: r.offlineFormNumber ?? null,
        offline_form_number: r.offlineFormNumber ?? null,
        offlineFormNo: r.offlineFormNumber ?? null,
        nomineeAadhar: r.nomineeAadhar ?? null,
        nominee_aadhar: r.nomineeAadhar ?? null,
        nomineeAadhaar: r.nomineeAadhar ?? null,
        nomineePhotoUrl: r.nomineePhotoUrl ?? null,
        nominee_photo_url: r.nomineePhotoUrl ?? null,
        nomineePhoto: r.nomineePhotoUrl ?? null,
        added_name: workerName,
        added_mobile: workerMobile,
        workerName,
        karyakartaName: workerName,
        workerMobile,
        workerCode,
        worker_code: workerCode,
        karyakartaCode: workerCode,
        agentCode: workerCode,
        agent_code: workerCode,
        workerOfflineFormNumber: resolvedWorkerOfflineForm,
        worker_offline_form_number: resolvedWorkerOfflineForm,
        agentOfflineFormNumber: resolvedWorkerOfflineForm,
        agent_offline_form_number: resolvedWorkerOfflineForm,
        seniorCode,
        senior_code: seniorCode,
        uplineCode: seniorCode,
        upline_code: seniorCode,
        seniorOfflineFormNumber,
        senior_offline_form_number: seniorOfflineFormNumber,
        seniorAgentOfflineFormNumber: seniorOfflineFormNumber,
        senior_agent_offline_form_number: seniorOfflineFormNumber,
        seniorName,
        senior_name: seniorName,
        seniorWorker: seniorName,
        senior_worker: seniorName,
        parentAgentId,
        parent_agent_id: parentAgentId,
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

    let workerCode = "ADMIN";
    let workerName = record.addedBy?.name || "Super Admin";
    let workerMobile = record.addedBy?.mobile || "";
    let workerOfflineFormNumber = "";
    let seniorCode = "ADMIN";
    let seniorName = "Super Admin";
    let seniorOfflineFormNumber = "ADMIN";
    let parentAgentId = null;

    if (record.addedById) {
      const hierarchyMap = await resolveAgentSeniorHierarchyBatch([record.addedById]);
      const hierarchy = hierarchyMap.get(record.addedById);
      const isAdmin =
        record.addedBy?.role === "ADMIN" ||
        record.addedBy?.name === "Default Agent" ||
        record.addedBy?.name === "Super Admin";
      const agentEmployeeId = record.addedBy?.agentProfile?.employeeId || "";
      workerOfflineFormNumber = record.addedBy?.agentProfile?.offlineFormNumber || "";

      let rawWorkerCode = (record as any).workerCode;
      if (!rawWorkerCode || isValidUuid(rawWorkerCode)) {
        if (isAdmin || !workerOfflineFormNumber) {
          rawWorkerCode = "ADMIN";
        } else {
          rawWorkerCode = workerOfflineFormNumber || agentEmployeeId || "ADMIN";
        }
      }
      workerCode = rawWorkerCode || (isAdmin ? "ADMIN" : "ADMIN");
      workerName = (record as any).workerName || record.addedBy?.name || (isAdmin ? (record.addedBy?.name || "Super Admin") : "Super Admin");
      workerMobile = (record as any).workerMobile || record.addedBy?.mobile || "";

      if (hierarchy && hierarchy.seniorCode && hierarchy.seniorCode !== "ADMIN") {
        seniorCode = hierarchy.seniorCode;
        seniorName = hierarchy.seniorName;
        seniorOfflineFormNumber = hierarchy.seniorOfflineFormNumber || hierarchy.seniorCode;
        parentAgentId = hierarchy.parentAgentId;
      } else if (hierarchy) {
        seniorCode = hierarchy.seniorCode || "ADMIN";
        seniorName = hierarchy.seniorName || "Super Admin";
        seniorOfflineFormNumber = hierarchy.seniorOfflineFormNumber || seniorCode || "ADMIN";
        parentAgentId = hierarchy.parentAgentId || null;
      } else if (isAdmin) {
        seniorCode = "ADMIN";
        seniorName = "Super Admin";
        seniorOfflineFormNumber = "ADMIN";
        parentAgentId = null;
      } else {
        seniorCode = "ADMIN";
        seniorName = "Super Admin";
        seniorOfflineFormNumber = "ADMIN";
        parentAgentId = null;
      }
    }

    const resolvedWorkerOfflineForm = workerOfflineFormNumber || (workerCode === "ADMIN" ? "ADMIN" : "");

    return {
      success: true,
      data: {
        ...record,
        offlineFormNumber: record.offlineFormNumber ?? null,
        offline_form_number: record.offlineFormNumber ?? null,
        offlineFormNo: record.offlineFormNumber ?? null,
        nomineeAadhar: record.nomineeAadhar ?? null,
        nominee_aadhar: record.nomineeAadhar ?? null,
        nomineeAadhaar: record.nomineeAadhar ?? null,
        nomineePhotoUrl: record.nomineePhotoUrl ?? null,
        nominee_photo_url: record.nomineePhotoUrl ?? null,
        nomineePhoto: record.nomineePhotoUrl ?? null,
        added_name: workerName,
        added_mobile: workerMobile,
        workerName,
        karyakartaName: workerName,
        workerMobile,
        workerCode,
        worker_code: workerCode,
        karyakartaCode: workerCode,
        agentCode: workerCode,
        agent_code: workerCode,
        workerOfflineFormNumber: resolvedWorkerOfflineForm,
        worker_offline_form_number: resolvedWorkerOfflineForm,
        agentOfflineFormNumber: resolvedWorkerOfflineForm,
        agent_offline_form_number: resolvedWorkerOfflineForm,
        seniorCode,
        senior_code: seniorCode,
        uplineCode: seniorCode,
        upline_code: seniorCode,
        seniorOfflineFormNumber,
        senior_offline_form_number: seniorOfflineFormNumber,
        seniorAgentOfflineFormNumber: seniorOfflineFormNumber,
        senior_agent_offline_form_number: seniorOfflineFormNumber,
        seniorName,
        senior_name: seniorName,
        seniorWorker: seniorName,
        senior_worker: seniorName,
        parentAgentId,
        parent_agent_id: parentAgentId,
      },
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

    const rawOfflineUpdate =
      data.offlineFormNumber !== undefined
        ? data.offlineFormNumber
        : data.offline_form_number !== undefined
        ? data.offline_form_number
        : data.offlineFormNo;

    let newOfflineFormNumber: string | null | undefined = undefined;

    if (rawOfflineUpdate !== undefined) {
      const trimmedOffline =
        rawOfflineUpdate !== null && String(rawOfflineUpdate).trim() !== ""
          ? String(rawOfflineUpdate).trim()
          : null;

      if (trimmedOffline && trimmedOffline !== record.offlineFormNumber) {
        const existingOffline = await prisma.janniDeliveryRegistration.findFirst({
          where: {
            offlineFormNumber: trimmedOffline,
            deletedAt: null,
            id: { not: id },
          },
          select: { id: true, formNumber: true, applicantName: true },
        });

        if (existingOffline) {
          throw new ConflictError(
            `Offline Form Number "${trimmedOffline}" is already assigned to application ${existingOffline.formNumber} (${existingOffline.applicantName})`
          );
        }
      }
      newOfflineFormNumber = trimmedOffline;
    }

    const rawNomineeAadharUpdate =
      data.nomineeAadhar !== undefined
        ? data.nomineeAadhar
        : data.nominee_aadhar !== undefined
        ? data.nominee_aadhar
        : data.nomineeAadhaar;

    let newNomineeAadhar: string | null | undefined = undefined;
    if (rawNomineeAadharUpdate !== undefined) {
      if (rawNomineeAadharUpdate === null || String(rawNomineeAadharUpdate).trim() === "") {
        newNomineeAadhar = null;
      } else {
        const cleaned = String(rawNomineeAadharUpdate).replace(/\D/g, "");
        if (cleaned.length !== 12) {
          throw new BadRequestError("Nominee Aadhaar number must be exactly 12 digits");
        }
        newNomineeAadhar = cleaned;
      }
    }

    const rawNomineePhotoUpdate =
      data.nomineePhotoUrl !== undefined
        ? data.nomineePhotoUrl
        : data.nominee_photo_url !== undefined
        ? data.nominee_photo_url
        : data.nomineePhoto !== undefined
        ? data.nomineePhoto
        : data.nomineePassportPhoto;

    let newNomineePhotoUrl: string | null | undefined = undefined;
    if (rawNomineePhotoUpdate !== undefined) {
      newNomineePhotoUrl = saveImagePayload(rawNomineePhotoUpdate);
    }

    const updated = await prisma.janniDeliveryRegistration.update({
      where: { id },
      data: {
        ...(newOfflineFormNumber !== undefined ? { offlineFormNumber: newOfflineFormNumber } : {}),
        ...(newNomineeAadhar !== undefined ? { nomineeAadhar: newNomineeAadhar } : {}),
        ...(newNomineePhotoUrl !== undefined ? { nomineePhotoUrl: newNomineePhotoUrl } : {}),
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
      data: {
        ...updated,
        offlineFormNumber: updated.offlineFormNumber ?? null,
        offline_form_number: updated.offlineFormNumber ?? null,
        offlineFormNo: updated.offlineFormNumber ?? null,
        nomineeAadhar: updated.nomineeAadhar ?? null,
        nominee_aadhar: updated.nomineeAadhar ?? null,
        nomineeAadhaar: updated.nomineeAadhar ?? null,
        nomineePhotoUrl: updated.nomineePhotoUrl ?? null,
        nominee_photo_url: updated.nomineePhotoUrl ?? null,
        nomineePhoto: updated.nomineePhotoUrl ?? null,
      },
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
