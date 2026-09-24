import bcrypt from "bcryptjs";
import { prisma, PRISMA_TX_OPTIONS } from "../../config/db";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { Role, Gender } from "@prisma/client";
import { parseOptionalDateInput } from "../../utils/parse-date";
import { lockFormNumberSequence } from "../../utils/sequence-lock";
import { resolveAgentSeniorHierarchyBatch, isValidUuid } from "../../utils/compat-helpers";

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

  const offlineFormNumber = data.offlineFormNumber ?? data.offline_form_number;
  if (offlineFormNumber !== undefined && offlineFormNumber !== null && String(offlineFormNumber).trim() !== "") {
    extras.offlineFormNumber = String(offlineFormNumber).trim();
  }

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

function enrichAgentWithHierarchy(agent: any, h: any) {
  const level = h?.level || "LEVEL_1";
  const parentAgentId = h?.parentAgentId || null;
  const parentEmployeeId = h?.parentEmployeeId || (level === "LEVEL_2" ? h?.seniorCode : null) || null;
  const parentOfflineFormNumber = h?.parentOfflineFormNumber || h?.seniorOfflineFormNumber || null;
  const parentName = h?.parentName || (level === "LEVEL_2" ? h?.seniorName : null) || null;
  const seniorCode = h?.seniorCode || parentOfflineFormNumber || (level === "LEVEL_2" ? parentEmployeeId : "ADMIN") || "ADMIN";
  const seniorName = h?.seniorName || (level === "LEVEL_2" ? (parentName || "Senior Agent") : "Super Admin");
  const canCreateSubAgent = h?.canCreateSubAgent ?? (level === "LEVEL_1");

  const hierarchy = {
    level,
    parentAgentId,
    parentEmployeeId,
    parentOfflineFormNumber,
    parentName,
    seniorCode,
    seniorName,
    canCreateSubAgent,
  };

  const offlineFormNumber =
    agent.agentProfile?.offlineFormNumber ??
    agent.agentProfile?.offline_form_number ??
    agent.offlineFormNumber ??
    agent.offline_form_number ??
    null;

  const agentProfile = agent.agentProfile
    ? {
        ...agent.agentProfile,
        offlineFormNumber,
        offline_form_number: offlineFormNumber,
        parentAgentId,
        parent_agent_id: parentAgentId,
        seniorId: parentAgentId,
        senior_id: parentAgentId,
        seniorEmployeeId: parentEmployeeId,
        senior_employee_id: parentEmployeeId,
        seniorOfflineFormNumber: parentOfflineFormNumber,
        senior_offline_form_number: parentOfflineFormNumber,
        seniorCode,
        seniorName,
        level,
        hierarchy,
      }
    : agent.agentProfile;

  return {
    ...agent,
    agentProfile,
    offlineFormNumber,
    offline_form_number: offlineFormNumber,
    level,
    seniorCode,
    seniorName,
    parentAgentId,
    parent_agent_id: parentAgentId,
    seniorId: parentAgentId,
    senior_id: parentAgentId,
    seniorEmployeeId: parentEmployeeId,
    senior_employee_id: parentEmployeeId,
    seniorOfflineFormNumber: parentOfflineFormNumber,
    senior_offline_form_number: parentOfflineFormNumber,
    parentEmployeeId,
    parentOfflineFormNumber,
    parentName,
    hierarchy,
  };
}

export class AgentsService {
  /**
   * Resolves and validates senior selection for Agent Hierarchy.
   * Strict 2-Level Depth Rule:
   * Level 1 = Senior Agent (reports to Admin, parent_agent_id is null)
   * Level 2 = Sub-Agent (reports to Level 1 Senior)
   * A Level-2 Agent can NEVER be a Senior and can NEVER have child agents.
   */
  private async resolveAndValidateSenior(
    tx: any,
    rawSenior: unknown,
    currentAgentId?: string
  ): Promise<{ id: string; employeeId: string; name: string } | null> {
    if (rawSenior === undefined || rawSenior === null) {
      return null;
    }

    const str = String(rawSenior).trim();
    if (
      !str ||
      str.toLowerCase() === "null" ||
      str.toLowerCase() === "undefined" ||
      str.toUpperCase() === "ADMIN" ||
      str.toUpperCase() === "DIRECT" ||
      str.toUpperCase() === "NONE" ||
      str === "0" ||
      str === "-"
    ) {
      return null;
    }

    // Find Senior User in users table
    let seniorUser: any = null;
    if (isValidUuid(str)) {
      seniorUser = await tx.user.findFirst({
        where: { id: str, role: Role.AGENT, deletedAt: null },
        include: { agentProfile: true },
      });
    }

    if (!seniorUser) {
      seniorUser = await tx.user.findFirst({
        where: {
          role: Role.AGENT,
          deletedAt: null,
          agentProfile: { employeeId: { equals: str, mode: "insensitive" }, deletedAt: null },
        },
        include: { agentProfile: true },
      });
    }

    if (!seniorUser) {
      seniorUser = await tx.user.findFirst({
        where: { mobile: str, role: Role.AGENT, deletedAt: null },
        include: { agentProfile: true },
      });
    }

    if (!seniorUser) {
      throw new BadRequestError("Selected Senior Agent was not found or is deleted.");
    }

    if (!seniorUser.isActive) {
      throw new BadRequestError("Selected Senior Agent is inactive and cannot be assigned as a Senior.");
    }

    if (currentAgentId && seniorUser.id === currentAgentId) {
      throw new BadRequestError("An agent cannot be assigned as their own Senior.");
    }

    // Check if the selected Senior is already a Level-2 Agent (Maximum Depth = 2 Rule)
    const seniorHierarchy = (await tx.$queryRawUnsafe(
      `SELECT level::text as level, parent_agent_id FROM agent_hierarchies WHERE agent_id = $1::uuid`,
      seniorUser.id
    )) as Array<{ level: string; parent_agent_id: string | null }>;

    if (seniorHierarchy.length > 0) {
      const sh = seniorHierarchy[0];
      if (sh.level === "LEVEL_2" || sh.parent_agent_id !== null) {
        throw new BadRequestError(
          "केवल Senior Agent के नीचे Agent जोड़ा जा सकता है। Agent के नीचे दूसरा Agent नहीं जोड़ा जा सकता। (An agent can only be added under a Senior Agent. A Level-2 Agent cannot have another Agent under them.)"
        );
      }
    }

    return {
      id: seniorUser.id,
      employeeId: seniorUser.agentProfile?.employeeId || "",
      name: seniorUser.name,
    };
  }

  /**
   * Retrieve list of eligible Level-1 Senior Agents for dropdown selection.
   * Only active, non-deleted, LEVEL-1 agents (parent_agent_id = null) are returned.
   */
  public async getEligibleSeniors(excludeAgentId?: string) {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        mobile: string;
        employee_id: string;
        village: string;
        district: string;
        work_area: string;
        father_name: string;
      }>
    >(
      `SELECT 
         u.id,
         u.name,
         u.mobile,
         ap.employee_id,
         ap.village,
         ap.district,
         ap.work_area,
         ap.father_name
       FROM users u
       JOIN agent_profiles ap ON ap.user_id = u.id AND ap.deleted_at IS NULL
       LEFT JOIN agent_hierarchies ah ON ah.agent_id = u.id
       WHERE u.role = 'AGENT'
         AND u.is_active = true
         AND u.deleted_at IS NULL
         AND (ah.id IS NULL OR (ah.level = 'LEVEL_1' AND ah.parent_agent_id IS NULL))
         ${excludeAgentId && isValidUuid(excludeAgentId) ? `AND u.id != '${excludeAgentId}'::uuid` : ""}
       ORDER BY u.name ASC`
    );

    return rows.map((r) => ({
      id: r.id,
      userId: r.id,
      name: r.name,
      employeeId: r.employee_id,
      mobile: r.mobile,
      level: "LEVEL_1" as const,
      village: r.village,
      district: r.district,
      workArea: r.work_area,
      fatherName: r.father_name,
    }));
  }

  /**
   * Register a new Agent
   */
  public async createAgent(data: any, creatorId?: string) {
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

    const rawSenior =
      data.seniorEmployeeId ??
      data.senior_employee_id ??
      data.seniorId ??
      data.senior_id ??
      data.parentAgentId ??
      data.parent_agent_id;

    const rawOffline = data.offlineFormNumber ?? data.offline_form_number;
    const cleanOffline =
      rawOffline !== undefined && rawOffline !== null && String(rawOffline).trim() !== ""
        ? String(rawOffline).trim()
        : null;

    return prisma.$transaction(async (tx) => {
      // Validate Senior Agent selection before creating
      const selectedSenior = await this.resolveAndValidateSenior(tx, rawSenior);

      // Duplicate check for offlineFormNumber among active non-deleted agents
      if (cleanOffline) {
        const existingOffline = await tx.agentProfile.findFirst({
          where: {
            offlineFormNumber: { equals: cleanOffline, mode: "insensitive" },
            deletedAt: null,
          },
        });
        if (existingOffline) {
          throw new BadRequestError(`Offline form number '${cleanOffline}' is already registered with another agent.`);
        }
      }

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

      const profile = await tx.agentProfile.create({
        data: {
          userId: user.id,
          employeeId,
          fatherName: String(data.fatherName || data.father_name || "").trim(),
          gotra: data.gotra || "Prajapat",
          age,
          gender: normalizeGender(data.gender),
          village: data.village || "",
          address: data.address || "",
          tehsil: data.tehsil || "",
          district: data.district || "",
          workArea: String(data.workArea || data.work_area || "").trim(),
          bankName: String(data.bankName || data.bank_name || "").trim(),
          accountNumber: String(data.accountNumber || data.account_number || "").trim(),
          ifscCode: String(data.ifscCode || data.ifsc || data.ifsc_code || "").trim(),
          nomineeName: String(data.nomineeName || data.nominee_name || "").trim(),
          nomineeMobile: String(data.nomineeMobile || data.nominee_mobile || "").trim(),
          nomineeRelation: String(data.nomineeRelation || data.nominee_relation || "").trim(),
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

      // Strict 2-Level Hierarchy Creation:
      // If no Senior is selected -> LEVEL_1 (parent_agent_id = NULL, can_create_sub_agent = true)
      // If Level-1 Senior is selected -> LEVEL_2 (parent_agent_id = Senior userId, can_create_sub_agent = false)
      const targetLevel = selectedSenior ? "LEVEL_2" : "LEVEL_1";
      const parentAgentId = selectedSenior ? selectedSenior.id : null;
      const canCreateSubAgent = targetLevel === "LEVEL_1";

      const resolvedCreatorId = creatorId && isValidUuid(creatorId) ? creatorId : user.id;

      await tx.$executeRawUnsafe(
        `INSERT INTO agent_hierarchies (id, agent_id, parent_agent_id, level, can_create_sub_agent, created_by_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::"AgentHierarchyLevel", $4, $5::uuid, NOW(), NOW())
         ON CONFLICT (agent_id) DO UPDATE SET
           parent_agent_id = EXCLUDED.parent_agent_id,
           level = EXCLUDED.level,
           can_create_sub_agent = EXCLUDED.can_create_sub_agent,
           updated_at = NOW()`,
        user.id,
        parentAgentId,
        targetLevel,
        canCreateSubAgent,
        resolvedCreatorId
      );

      const seniorCode = selectedSenior ? selectedSenior.employeeId : "ADMIN";
      const seniorName = selectedSenior ? selectedSenior.name : "Super Admin";

      const createdUser = {
        ...user,
        agentProfile: profile,
      };

      return enrichAgentWithHierarchy(createdUser, {
        level: targetLevel,
        parentAgentId,
        parentEmployeeId: selectedSenior ? selectedSenior.employeeId : null,
        parentName: selectedSenior ? selectedSenior.name : null,
        seniorCode,
        seniorName,
        canCreateSubAgent,
      });
    }, PRISMA_TX_OPTIONS);
  }

  /**
   * Retrieve all Active & Inactive Agents (ignoring soft deleted ones)
   */
  public async getAllAgents(filters?: { gender?: string; village?: string; search?: string }) {
    const profileWhere: Record<string, any> = {};
    if (filters?.gender && filters.gender !== "all") {
      profileWhere.gender = normalizeGender(filters.gender);
    }
    if (filters?.village && filters.village !== "all") {
      profileWhere.village = filters.village;
    }

    const where: Record<string, any> = {
      role: Role.AGENT,
      deletedAt: null,
      ...(Object.keys(profileWhere).length > 0 ? { agentProfile: profileWhere } : {}),
    };

    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q } },
        { agentProfile: { employeeId: { contains: q, mode: "insensitive" } } },
        { agentProfile: { offlineFormNumber: { contains: q, mode: "insensitive" } } },
        { agentProfile: { village: { contains: q, mode: "insensitive" } } },
      ];
    }

    const agents = await prisma.user.findMany({
      where,
      include: {
        agentProfile: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const agentIds = agents.map((a) => a.id);
    const hierarchyMap = await resolveAgentSeniorHierarchyBatch(agentIds);

    return agents.map((agent) => enrichAgentWithHierarchy(agent, hierarchyMap.get(agent.id)));
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

    const hierarchyMap = await resolveAgentSeniorHierarchyBatch([id]);
    return enrichAgentWithHierarchy(user, hierarchyMap.get(id));
  }

  /**
   * Update Agent Profile details and Hierarchy
   */
  public async updateAgent(id: string, data: any, modifierId?: string) {
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

    const rawOffline = data.offlineFormNumber !== undefined ? data.offlineFormNumber : data.offline_form_number;
    let cleanOfflineForUpdate: string | null | undefined = undefined;
    if (rawOffline !== undefined) {
      if (rawOffline === null || String(rawOffline).trim() === "") {
        cleanOfflineForUpdate = null;
        profileUpdates.offlineFormNumber = null;
      } else {
        cleanOfflineForUpdate = String(rawOffline).trim();
        profileUpdates.offlineFormNumber = cleanOfflineForUpdate;
      }
    }

    // Ensure system employeeId is immutable and never overwritten
    delete profileUpdates.employeeId;
    delete profileUpdates.employee_id;

    const hasSeniorUpdate =
      data.seniorEmployeeId !== undefined ||
      data.senior_employee_id !== undefined ||
      data.seniorId !== undefined ||
      data.senior_id !== undefined ||
      data.parentAgentId !== undefined ||
      data.parent_agent_id !== undefined;

    const rawSenior =
      data.seniorEmployeeId ??
      data.senior_employee_id ??
      data.seniorId ??
      data.senior_id ??
      data.parentAgentId ??
      data.parent_agent_id;

    const updatedUser = await prisma.$transaction(async (tx) => {
      // Duplicate check for offlineFormNumber if being updated
      if (cleanOfflineForUpdate) {
        const existingOffline = await tx.agentProfile.findFirst({
          where: {
            offlineFormNumber: { equals: cleanOfflineForUpdate, mode: "insensitive" },
            deletedAt: null,
            userId: { not: id },
          },
        });
        if (existingOffline) {
          throw new BadRequestError(`Offline form number '${cleanOfflineForUpdate}' is already registered with another agent.`);
        }
      }

      let selectedSenior: { id: string; employeeId: string; name: string } | null = null;
      let shouldUpdateHierarchy = false;

      if (hasSeniorUpdate) {
        shouldUpdateHierarchy = true;
        selectedSenior = await this.resolveAndValidateSenior(tx, rawSenior, id);

        // If placing this agent under another agent (Level-2), verify they don't have sub-agents
        if (selectedSenior) {
          const childCountResult = (await tx.$queryRawUnsafe(
            `SELECT count(*) as count FROM agent_hierarchies WHERE parent_agent_id = $1::uuid`,
            id
          )) as Array<{ count: bigint }>;
          const childCount = Number(childCountResult[0]?.count || 0);
          if (childCount > 0) {
            throw new BadRequestError(
              "A Level-1 Senior cannot be placed under another Agent because they already have sub-agents. This would violate the maximum depth rule of 2 levels."
            );
          }
        }
      }

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

      if (shouldUpdateHierarchy) {
        const targetLevel = selectedSenior ? "LEVEL_2" : "LEVEL_1";
        const parentAgentId = selectedSenior ? selectedSenior.id : null;
        const canCreateSubAgent = targetLevel === "LEVEL_1";
        const resolvedCreatorId = modifierId && isValidUuid(modifierId) ? modifierId : id;

        await tx.$executeRawUnsafe(
          `INSERT INTO agent_hierarchies (id, agent_id, parent_agent_id, level, can_create_sub_agent, created_by_id, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::"AgentHierarchyLevel", $4, $5::uuid, NOW(), NOW())
           ON CONFLICT (agent_id) DO UPDATE SET
             parent_agent_id = EXCLUDED.parent_agent_id,
             level = EXCLUDED.level,
             can_create_sub_agent = EXCLUDED.can_create_sub_agent,
             updated_at = NOW()`,
          id,
          parentAgentId,
          targetLevel,
          canCreateSubAgent,
          resolvedCreatorId
        );
      }

      return tx.user.findFirst({
        where: { id },
        include: { agentProfile: true },
      });
    });

    const hierarchyMap = await resolveAgentSeniorHierarchyBatch([id]);
    return enrichAgentWithHierarchy(updatedUser, hierarchyMap.get(id));
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
