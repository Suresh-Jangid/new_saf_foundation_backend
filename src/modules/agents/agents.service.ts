import bcrypt from "bcryptjs";
import { prisma, PRISMA_TX_OPTIONS } from "../../config/db";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { Role, Gender } from "@prisma/client";
import { parseOptionalDateInput } from "../../utils/parse-date";
import { lockFormNumberSequence } from "../../utils/sequence-lock";

function normalizeGender(value: unknown): Gender {
  const raw = String(value ?? "").trim();
  if (raw.toLowerCase() === "female") return Gender.Female;
  if (raw.toLowerCase() === "other") return Gender.Other;
  return Gender.Male;
}

// Every table where an agent-attributable record is created, paired with the
// date field used for range filtering (models without a business date use
// createdAt) and whether it represents a new registration vs. a
// payment/installment collected against an existing one.
const AGENT_RECORD_CATEGORIES = [
  { key: "generalApplications", label: "General Applications", model: "generalApplication", dateField: "applicationDate", kind: "registration" },
  { key: "generalInstallments", label: "General Installments", model: "generalApplicationInstallment", dateField: "date", kind: "collection" },
  { key: "insuranceApplications", label: "Insurance Applications", model: "insuranceApplication", dateField: "applicationDate", kind: "registration" },
  { key: "insuranceInstallments", label: "Insurance Installments", model: "insuranceApplicationInstallment", dateField: "date", kind: "collection" },
  { key: "mayraRegistrations", label: "Mayra Registrations", model: "mayraRegistration", dateField: "applicationDate", kind: "registration" },
  { key: "mayraInstallments", label: "Mayra Installments", model: "mayraInstallment", dateField: "date", kind: "collection" },
  { key: "mayraCongratulations", label: "Mayra Congratulations", model: "mayraCongratulations", dateField: "date", kind: "registration" },
  { key: "mayraCongratulationsPayments", label: "Mayra Congratulations Payments", model: "mayraCongratulationsPayment", dateField: "createdAt", kind: "collection" },
  { key: "loanApplications", label: "Loan Applications", model: "loanApplication", dateField: "date", kind: "registration" },
  { key: "loanInstallments", label: "Loan Installments", model: "loanApplicationInstallment", dateField: "date", kind: "collection" },
  { key: "financialHelps", label: "Financial Help", model: "financialHelp", dateField: "date", kind: "registration" },
  { key: "financialHelpInstallments", label: "Financial Help Installments", model: "financialHelpInstallment", dateField: "date", kind: "collection" },
  { key: "disabilityCycles", label: "Disability Cycles", model: "disabilityCycle", dateField: "applicationDate", kind: "registration" },
  { key: "marriageCongratulations", label: "Marriage Congratulations", model: "marriageCongratulations", dateField: "date", kind: "registration" },
  { key: "marriageCongratulationsPayments", label: "Marriage Congratulations Payments", model: "marriageCongratulationsPayment", dateField: "createdAt", kind: "collection" },
  { key: "marriageSewingMachines", label: "Marriage Sewing Machines", model: "marriageSewingMachine", dateField: "applicationDate", kind: "registration" },
  { key: "pensionYojana", label: "Pension Yojana", model: "pensionYojana", dateField: "date", kind: "registration" },
  { key: "pensionYojanaPayments", label: "Pension Yojana Payments", model: "pensionYojanaPayment", dateField: "date", kind: "collection" },
  { key: "sewingMachineCamps", label: "Sewing Machine Camps", model: "sewingMachineCamp", dateField: "applicationDate", kind: "registration" },
] as const;

function buildAgentProfileExtras(data: Record<string, any>) {
  const extras: Record<string, any> = {};

  if (data.aadhaar !== undefined && data.aadhaar !== null && data.aadhaar !== "") {
    extras.aadhaar = data.aadhaar;
  }

  if (data.designation !== undefined && data.designation !== null && data.designation !== "") {
    extras.designation = data.designation;
  }

  const profileImage =
    data.profile_image ?? data.profileImageUrl ?? data.profile_image_url;
  if (profileImage !== undefined && profileImage !== null && profileImage !== "") {
    extras.profileImageUrl = profileImage;
  }

  const registrationDate = parseOptionalDateInput(
    data.date ?? data.registrationDate ?? data.registration_date,
    "registration date",
  );
  if (registrationDate) extras.registrationDate = registrationDate;

  const dateOfBirth = parseOptionalDateInput(
    data.dateOfBirth ?? data.date_of_birth,
    "date of birth",
  );
  if (dateOfBirth) extras.dateOfBirth = dateOfBirth;

  const dateOfJoining = parseOptionalDateInput(
    data.doj ?? data.dateOfJoining ?? data.date_of_joining,
    "date of joining",
  );
  if (dateOfJoining) extras.dateOfJoining = dateOfJoining;

  return extras;
}

export class AgentsService {
  /**
   * Register a new Agent
   */
  public async createAgent(data: any) {
    if (!data.mobile || !data.password || !data.name || !data.fatherName || !data.gender) {
      throw new BadRequestError("Name, mobile, password, father name, and gender are required.");
    }

    const existingUser = await prisma.user.findFirst({
      where: { mobile: data.mobile, deletedAt: null },
    });

    if (existingUser) {
      throw new BadRequestError("Mobile number is already registered.");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);

    const age = Number(data.age) || 25;

    return prisma.$transaction(async (tx) => {
      let employeeId = data.employeeId || data.employee_id;
      if (!employeeId) {
        await lockFormNumberSequence(tx, "agent_employee_id");
        const agentCount = await tx.agentProfile.count();
        employeeId = `EMP-${String(agentCount + 1).padStart(3, "0")}`;
      }

      const user = await tx.user.create({
        data: {
          name: data.name,
          mobile: data.mobile,
          email: data.email || null,
          passwordHash,
          role: Role.AGENT,
          isActive: true,
        },
      });

      await tx.agentProfile.create({
        data: {
          userId: user.id,
          employeeId,
          fatherName: data.fatherName,
          gotra: data.gotra || "Prajapat",
          age,
          gender: normalizeGender(data.gender),
          village: data.village || "",
          address: data.address || "",
          tehsil: data.tehsil || "",
          district: data.district || "",
          workArea: data.workArea || "",
          bankName: data.bankName || "",
          accountNumber: data.accountNumber || "",
          ifscCode: data.ifscCode || data.ifsc || "",
          nomineeName: data.nomineeName || "",
          nomineeMobile: data.nomineeMobile || "",
          nomineeRelation: data.nomineeRelation || "",
          ...buildAgentProfileExtras(data),
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

      const permissionPromises = defaultModules.map((mod) =>
        tx.agentPermission.create({
          data: {
            userId: user.id,
            module: mod,
            canView: true,
            canCreate: mod.includes("registration") ? true : false,
            canUpdate: mod.includes("registration") ? true : false,
            canDelete: false,
          },
        }),
      );

      await Promise.all(permissionPromises);

      return tx.user.findFirst({
        where: { id: user.id },
        include: { agentProfile: true },
      });
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * Retrieve all Active & Inactive Agents (ignoring soft deleted ones)
   */
  public async getAllAgents(filters?: { gender?: string; village?: string }) {
    const profileWhere: Record<string, any> = {};
    if (filters?.gender && filters.gender !== "all") {
      profileWhere.gender = normalizeGender(filters.gender);
    }
    if (filters?.village && filters.village !== "all") {
      profileWhere.village = filters.village;
    }

    return prisma.user.findMany({
      where: {
        role: Role.AGENT,
        deletedAt: null,
        ...(Object.keys(profileWhere).length > 0 ? { agentProfile: profileWhere } : {}),
      },
      include: {
        agentProfile: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  /**
   * Retrieve a single agent profile
   */
  public async getAgentById(id: string) {
    const user = await prisma.user.findFirst({
      where: {
        id,
        role: Role.AGENT,
        deletedAt: null,
      },
      include: {
        agentProfile: true,
        permissions: true,
      },
    });

    if (!user) {
      throw new NotFoundError("Agent not found");
    }

    if (user.agentProfile && !user.agentProfile.registrationDate) {
      const registrationDate = user.createdAt;
      await prisma.agentProfile.update({
        where: { userId: id },
        data: { registrationDate },
      });
      user.agentProfile.registrationDate = registrationDate;
    }

    return user;
  }

  /**
   * Update Agent Profile details
   */
  public async updateAgent(id: string, data: any) {
    const user = await prisma.user.findFirst({
      where: { id, role: Role.AGENT, deletedAt: null },
      include: { agentProfile: true },
    });

    if (!user) {
      throw new NotFoundError("Agent not found");
    }

    let passwordHash = user.passwordHash;
    if (data.password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(data.password, salt);
    }

    const profileUpdates: Record<string, any> = {
      ...buildAgentProfileExtras(data),
    };
    const profileFields: Array<{ key: string; sources: string[] }> = [
      { key: "fatherName", sources: ["fatherName", "father_name"] },
      { key: "gotra", sources: ["gotra"] },
      { key: "village", sources: ["village"] },
      { key: "address", sources: ["address"] },
      { key: "tehsil", sources: ["tehsil"] },
      { key: "district", sources: ["district"] },
      { key: "workArea", sources: ["workArea", "work_area"] },
      { key: "bankName", sources: ["bankName", "bank_name"] },
      { key: "accountNumber", sources: ["accountNumber", "account_number"] },
      { key: "ifscCode", sources: ["ifscCode", "ifsc"] },
      { key: "nomineeName", sources: ["nomineeName", "nominee_name"] },
      { key: "nomineeMobile", sources: ["nomineeMobile", "nominee_mobile"] },
      { key: "nomineeRelation", sources: ["nomineeRelation", "nominee_relation"] },
      { key: "aadhaar", sources: ["aadhaar"] },
      { key: "designation", sources: ["designation"] },
    ];

    profileFields.forEach(({ key, sources }) => {
      for (const source of sources) {
        // Blank values mean "unchanged" (matches buildAgentProfileExtras),
        // otherwise an empty string from an unedited field would wipe out
        // previously saved data (e.g. nominee details) on every re-save.
        if (data[source] !== undefined && data[source] !== null && data[source] !== "") {
          profileUpdates[key] = data[source];
          break;
        }
      }
    });

    if (data.age !== undefined && data.age !== null && data.age !== "") {
      profileUpdates.age = Number(data.age) || user.agentProfile?.age || 25;
    }

    if (data.gender !== undefined && data.gender !== null && data.gender !== "") {
      profileUpdates.gender = normalizeGender(data.gender);
    }

    return prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          name: data.name !== undefined ? data.name : user.name,
          mobile: data.mobile !== undefined ? data.mobile : user.mobile,
          email: data.email !== undefined ? data.email : user.email,
          passwordHash,
        },
      });

      if (Object.keys(profileUpdates).length > 0) {
        await tx.agentProfile.update({
          where: { userId: id },
          data: profileUpdates,
        });
      }

      return tx.user.findFirst({
        where: { id },
        include: { agentProfile: true },
      });
    });
  }

  /**
   * Toggle Agent active status
   */
  public async toggleAgentStatus(id: string) {
    const user = await prisma.user.findFirst({
      where: { id, role: Role.AGENT, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundError("Agent not found");
    }

    return prisma.user.update({
      where: { id },
      data: {
        isActive: !user.isActive,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });
  }

  /**
   * Soft Delete Agent (sets deletedAt)
   */
  public async softDeleteAgent(id: string) {
    const user = await prisma.user.findFirst({
      where: { id, role: Role.AGENT, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundError("Agent not found");
    }

    return prisma.$transaction(async (tx) => {
      const deletedAt = new Date();

      // 1. Agent profile
      await tx.agentProfile.updateMany({
        where: { userId: id, deletedAt: null },
        data: { deletedAt },
      });

      // 2. Disability cycles
      await tx.disabilityCycle.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 3. Financial help & installments
      await tx.financialHelpInstallment.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });
      await tx.financialHelp.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 4. General applications & installments
      await tx.generalApplicationInstallment.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });
      await tx.generalApplication.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 5. Insurance applications, installments & suraksha bima
      const insApps = await tx.insuranceApplication.findMany({
        where: { addedById: id },
        select: { id: true },
      });
      const insIds = insApps.map((app) => app.id);
      await tx.insuranceApplicationInstallment.updateMany({
        where: {
          OR: [
            { addedById: id },
            { applicationInsuranceId: { in: insIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.surakshaBimaYojana.updateMany({
        where: {
          insuranceApplicationId: { in: insIds },
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.insuranceApplication.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 6. Loan applications & installments
      const loans = await tx.loanApplication.findMany({
        where: { addedById: id },
        select: { id: true },
      });
      const loanIds = loans.map((l) => l.id);
      await tx.loanApplicationInstallment.updateMany({
        where: {
          OR: [
            { addedById: id },
            { loanApplicationId: { in: loanIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.loanApplication.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 6b. Financial help & installments
      const financialHelps = await tx.financialHelp.findMany({
        where: { addedById: id },
        select: { id: true },
      });
      const helpIds = financialHelps.map((h) => h.id);
      await tx.financialHelpInstallment.updateMany({
        where: {
          OR: [
            { addedById: id },
            { financialHelpId: { in: helpIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.financialHelp.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 6c. Disability cycles
      await tx.disabilityCycle.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 6d. Agent profile
      await tx.agentProfile.updateMany({
        where: { userId: id, deletedAt: null },
        data: { deletedAt },
      });

      // 7. Marriage congratulations, payments & sewing machines
      const marriageCongrats = await tx.marriageCongratulations.findMany({
        where: { addedById: id },
        select: { id: true },
      });
      const marriageIds = marriageCongrats.map((m) => m.id);
      await tx.marriageCongratulationsPayment.updateMany({
        where: {
          OR: [
            { addedById: id },
            { marriageCongratulationsId: { in: marriageIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.marriageSewingMachine.updateMany({
        where: {
          OR: [
            { addedById: id },
            { marriageCongratulationsId: { in: marriageIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.marriageCongratulations.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 8. Mayra registrations, congratulations, payments & installments
      const mayraRegs = await tx.mayraRegistration.findMany({
        where: { addedById: id },
        select: { id: true },
      });
      const mayraIds = mayraRegs.map((r) => r.id);
      await tx.mayraInstallment.updateMany({
        where: {
          OR: [
            { addedById: id },
            { mayraRegistrationId: { in: mayraIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      const mayraCongrats = await tx.mayraCongratulations.findMany({
        where: {
          OR: [
            { addedById: id },
            { mayraRegistrationId: { in: mayraIds } }
          ]
        },
        select: { id: true }
      });
      const congratsIds = mayraCongrats.map((c) => c.id);
      await tx.mayraCongratulationsPayment.updateMany({
        where: {
          OR: [
            { addedById: id },
            { mayraCongratulationsId: { in: congratsIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.mayraCongratulations.updateMany({
        where: {
          OR: [
            { addedById: id },
            { mayraRegistrationId: { in: mayraIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.mayraRegistration.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 9. Pension yojanas & payments
      const pensions = await tx.pensionYojana.findMany({
        where: { addedById: id },
        select: { id: true },
      });
      const pensionIds = pensions.map((p) => p.id);
      await tx.pensionYojanaPayment.updateMany({
        where: {
          OR: [
            { addedById: id },
            { pensionYojanaId: { in: pensionIds } }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });
      await tx.pensionYojana.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 10. Sewing machine camps
      await tx.sewingMachineCamp.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 11. Payments (cash)
      await tx.payment.updateMany({
        where: { addedById: id, deletedAt: null },
        data: { deletedAt },
      });

      // 12. Agent payments (payouts)
      await tx.agentPayment.updateMany({
        where: {
          OR: [
            { agentId: id },
            { addedById: id }
          ],
          deletedAt: null,
        },
        data: { deletedAt },
      });

      return tx.user.update({
        where: { id },
        data: {
          deletedAt,
          isActive: false,
          mobile: `del-${Date.now().toString().slice(-11)}`,
        },
        select: {
          id: true,
          name: true,
          deletedAt: true,
        },
      });
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * Retrieve configured Permissions for a specific Agent
   */
  public async getAgentPermissions(id: string) {
    const agent = await prisma.user.findFirst({
      where: { id, role: Role.AGENT, deletedAt: null },
    });

    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    return prisma.agentPermission.findMany({
      where: { userId: id },
    });
  }

  /**
   * Bulk updates Permissions for a specific Agent
   */
  public async updateAgentPermissions(id: string, permissions: any[]) {
    const agent = await prisma.user.findFirst({
      where: { id, role: Role.AGENT, deletedAt: null },
    });

    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    return prisma.$transaction(async (tx) => {
      const updatePromises = permissions.map((perm) =>
        tx.agentPermission.upsert({
          where: {
            userId_module: {
              userId: id,
              module: perm.module,
            },
          },
          update: {
            canView: perm.canView,
            canCreate: perm.canCreate,
            canUpdate: perm.canUpdate,
            canDelete: perm.canDelete,
          },
          create: {
            userId: id,
            module: perm.module,
            canView: perm.canView,
            canCreate: perm.canCreate,
            canUpdate: perm.canUpdate,
            canDelete: perm.canDelete,
          },
        }),
      );

      await Promise.all(updatePromises);
      return tx.agentPermission.findMany({
        where: { userId: id },
      });
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * Agent-wise report: count of records each agent added, broken down by
   * scheme, for a given date range. Covers every table an agent can write to
   * (registrations and the installments/payments collected against them).
   */
  public async getAgentRecordsReport(startDate: Date, endDate: Date) {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    const range = { gte: startDate, lte: endOfDay };

    const agents = await prisma.user.findMany({
      where: { role: Role.AGENT, deletedAt: null },
      include: { agentProfile: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const grouped = await Promise.all(
      AGENT_RECORD_CATEGORIES.map((cat) =>
        (prisma as any)[cat.model].groupBy({
          by: ["addedById"],
          where: { [cat.dateField]: range, deletedAt: null },
          _count: { _all: true },
        }),
      ),
    );

    const report = agents.map((agent) => {
      const breakdown: Record<string, number> = {};
      let registrations = 0;
      let collections = 0;

      AGENT_RECORD_CATEGORIES.forEach((cat, index) => {
        const row = grouped[index].find((r: any) => r.addedById === agent.id);
        const count = row?._count?._all ?? 0;
        breakdown[cat.key] = count;
        if (cat.kind === "registration") registrations += count;
        else collections += count;
      });

      return {
        agentId: agent.id,
        name: agent.name,
        mobile: agent.mobile,
        employeeId: agent.agentProfile?.employeeId || "",
        village: agent.agentProfile?.village || "",
        registrations,
        collections,
        total: registrations + collections,
        breakdown,
      };
    });

    report.sort((a, b) => b.total - a.total);

    return {
      categories: AGENT_RECORD_CATEGORIES.map(({ key, label, kind }) => ({ key, label, kind })),
      agents: report,
    };
  }
}
