import { prisma } from "../../config/db";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import {
  AppConfigData,
  ModuleRegistryItem,
  SchemeMasterItem,
  SchemeTypeItem,
  AgeSlabItem,
  AgeSlabResolutionResult,
  PoolConfigItem,
} from "./configuration.types";

export const DEFAULT_APP_CONFIG: AppConfigData = {
  appName: "SAF Foundation",
  mobile: "9950730637",
  contactEmail: "info@saffoundation.org",
  address: "Jasol, Balotra, Rajasthan",
  defaultDeductionPercent: 15.0,
  status: "ACTIVE",
};

export const INITIAL_MODULE_REGISTRY: ModuleRegistryItem[] = [
  // 16 ACTIVE REQUIRED MODULES
  { code: "GENERAL_MARRIAGE", name: "General Marriage", displayName: "General Marriage Application & Congratulation Payment", isEnabled: true, sortOrder: 1, status: "ACTIVE" },
  { code: "MAYRA", name: "Mayra Scheme", displayName: "Mayra General Application & Congratulation Payment", isEnabled: true, sortOrder: 2, status: "ACTIVE" },
  { code: "INSURANCE_BIMA", name: "Insurance Bima", displayName: "Insurance Bima Application & Congratulation Payment", isEnabled: true, sortOrder: 3, status: "ACTIVE" },
  { code: "JANNI_DELIVERY", name: "Janni Delivery", displayName: "Janni Delivery Registration Application & Congratulation Payment", isEnabled: true, sortOrder: 4, status: "ACTIVE" },
  { code: "AAWAS", name: "Aawas (Home)", displayName: "Aawas(Home) Registration Application & Congratulation Payment", isEnabled: true, sortOrder: 5, status: "ACTIVE" },
  { code: "LADO_BAHIN", name: "Lado Bahin", displayName: "Lado Bahin Registration Application & Congratulation Payment", isEnabled: true, sortOrder: 6, status: "ACTIVE" },
  { code: "DHUNDHOTSAV", name: "Dhundhotsav", displayName: "Dhundhotsav Registration Application & Congratulation Payment", isEnabled: true, sortOrder: 7, status: "ACTIVE" },
  { code: "SHUBHLAXMI", name: "ShubhLaxmi (Deepawali)", displayName: "ShubhLaxmi(Deepawali) Registration Application & Congratulation Payment", isEnabled: true, sortOrder: 8, status: "ACTIVE" },
  { code: "AGENT", name: "Agent Management", displayName: "Agent Registration & Permissions", isEnabled: true, sortOrder: 9, status: "ACTIVE" },
  { code: "AGENT_COMMISSION", name: "Agent Commission", displayName: "Agent Commission Payment", isEnabled: true, sortOrder: 10, status: "ACTIVE" },
  { code: "AGENT_COMMISSION_REPORT", name: "Agent Commission Report", displayName: "Agent Commission Report", isEnabled: true, sortOrder: 11, status: "ACTIVE" },
  { code: "AGENT_WISE_REPORT", name: "Agent Wise Report", displayName: "Agent Wise Performance Report", isEnabled: true, sortOrder: 12, status: "ACTIVE" },
  { code: "BULK_MARRIAGE_EMI", name: "Bulk Marriage EMI", displayName: "Bulk Marriage EMI Collection", isEnabled: true, sortOrder: 13, status: "ACTIVE" },
  { code: "BULK_MAYRA_EMI", name: "Bulk Mayra EMI", displayName: "Bulk Mayra EMI Collection", isEnabled: true, sortOrder: 14, status: "ACTIVE" },
  { code: "BULK_INSURANCE_EMI", name: "Bulk Insurance Bima EMI", displayName: "Bulk Insurance Bima EMI Collection", isEnabled: true, sortOrder: 15, status: "ACTIVE" },
  { code: "PAYMENT_MANAGEMENT", name: "Payment Management", displayName: "Payment Management & Cashbook", isEnabled: true, sortOrder: 16, status: "ACTIVE" },
  { code: "FINANCIAL_HELP", name: "Financial Help", displayName: "Financial Help (Dan Rashi)", isEnabled: true, sortOrder: 17, status: "ACTIVE" },

  // 5 DISABLED MODULES (PRESERVED IN DB, DISABLED AT RUNTIME)
  { code: "MARRIAGE_SEWING_MACHINE", name: "Marriage Sewing Machine", displayName: "Marriage Sewing Machine Distribution Applications", isEnabled: false, sortOrder: 18, status: "DISABLED" },
  { code: "SEWING_MACHINE_CAMP", name: "Sewing Machine Camp", displayName: "Sewing Machine Camp Applications", isEnabled: false, sortOrder: 19, status: "DISABLED" },
  { code: "DISABILITY_CYCLE", name: "Disability Cycle", displayName: "Disability Cycle Distribution", isEnabled: false, sortOrder: 20, status: "DISABLED" },
  { code: "PENSION_YOJANA", name: "Pension Yojana", displayName: "Pension Yojana Application Payment", isEnabled: false, sortOrder: 21, status: "DISABLED" },
  { code: "LOAN_APPLICATION", name: "Loan Application List", displayName: "Loan Application List & Repayments", isEnabled: false, sortOrder: 22, status: "DISABLED" },
];

export const INITIAL_AGE_SLABS: AgeSlabItem[] = [
  { slabCode: "SLAB_A", slabName: "Slab A (1–5 Years)", minAge: 1, maxAge: 5, joiningFee: 1500, installment: 100, schemeType: "GENERAL", status: "Active", displayOrder: 1 },
  { slabCode: "SLAB_B", slabName: "Slab B (6–10 Years)", minAge: 6, maxAge: 10, joiningFee: 3100, installment: 200, schemeType: "GENERAL", status: "Active", displayOrder: 2 },
  { slabCode: "SLAB_C", slabName: "Slab C (11–15 Years)", minAge: 11, maxAge: 15, joiningFee: 5100, installment: 300, schemeType: "GENERAL", status: "Active", displayOrder: 3 },
  { slabCode: "SLAB_D", slabName: "Slab D (16–18 Years)", minAge: 16, maxAge: 18, joiningFee: 8100, installment: 300, schemeType: "GENERAL", status: "Active", displayOrder: 4 },
  { slabCode: "SLAB_E", slabName: "Slab E (19–21 Years)", minAge: 19, maxAge: 21, joiningFee: 10000, installment: 300, schemeType: "GENERAL", status: "Active", displayOrder: 5 },
  { slabCode: "SLAB_F", slabName: "Slab F (22+ Years)", minAge: 22, maxAge: null, joiningFee: 11000, installment: 300, schemeType: "GENERAL", status: "Active", displayOrder: 6 },
];

export const INITIAL_SCHEME_TYPES: SchemeTypeItem[] = [
  { code: "SCHEME_300", name: "Scheme ₹300", amount: 300, description: "Monthly/Installment ₹300 Scheme", status: "ACTIVE" },
  { code: "SCHEME_500", name: "Scheme ₹500", amount: 500, description: "Monthly/Installment ₹500 Scheme", status: "ACTIVE" },
  { code: "SCHEME_1000", name: "Scheme ₹1000", amount: 1000, description: "Monthly/Installment ₹1000 Scheme", status: "ACTIVE" },
  { code: "SCHEME_1500", name: "Scheme ₹1500", amount: 1500, description: "Monthly/Installment ₹1500 Scheme", status: "ACTIVE" },
];

export const INITIAL_SCHEMES: SchemeMasterItem[] = [
  { code: "GENERAL_MARRIAGE", name: "General Marriage Scheme", moduleCode: "GENERAL_MARRIAGE", description: "Marriage Grant Administrative Deduction (15%)", poolType: "FEMALE_POOL", deductionPercent: 15.0, status: "ACTIVE" },
  { code: "MAYRA", name: "Mayra Scheme", moduleCode: "MAYRA", poolType: "FEMALE_POOL", deductionPercent: 15.0, status: "ACTIVE" },
  { code: "INSURANCE_BIMA", name: "Insurance Suraksha Bima Yojana", moduleCode: "INSURANCE_BIMA", poolType: "FEMALE_POOL", deductionPercent: 10.0, status: "ACTIVE" },
  { code: "JANNI_DELIVERY", name: "Janni Delivery Registration", moduleCode: "JANNI_DELIVERY", poolType: "FEMALE_POOL", deductionPercent: 15.0, status: "ACTIVE" },
  { code: "AAWAS", name: "Aawas (Home) Scheme", moduleCode: "AAWAS", poolType: "UNIFIED_POOL", deductionPercent: 15.0, status: "ACTIVE" },
  { code: "LADO_BAHIN", name: "Lado Bahin Scheme", moduleCode: "LADO_BAHIN", poolType: "FEMALE_POOL", deductionPercent: 15.0, status: "ACTIVE" },
  { code: "DHUNDHOTSAV", name: "Dhundhotsav Scheme", moduleCode: "DHUNDHOTSAV", poolType: "UNIFIED_POOL", deductionPercent: 15.0, status: "ACTIVE" },
  { code: "SHUBHLAXMI", name: "ShubhLaxmi (Deepawali) Scheme", moduleCode: "SHUBHLAXMI", poolType: "UNIFIED_POOL", deductionPercent: 15.0, status: "ACTIVE" },
];

export const INITIAL_POOLS: PoolConfigItem[] = [
  { code: "FEMALE_POOL", name: "Female Pool", gender: "Female", description: "Female applicant pool for scheme contributions and grants", status: "ACTIVE" },
  { code: "MALE_POOL", name: "Male Pool", gender: "Male", description: "Male applicant pool for scheme contributions and grants", status: "ACTIVE" },
  { code: "UNIFIED_POOL", name: "Unified Pool", gender: null, description: "Unified applicant pool across all genders", status: "ACTIVE" },
];

export class ConfigurationService {
  // ============================================================
  // 1. APPLICATION CONFIGURATION
  // ============================================================

  public async getAppConfig(): Promise<AppConfigData> {
    try {
      const config = await prisma.applicationConfig.findFirst({
        orderBy: { createdAt: "asc" },
      });
      if (config) {
        return {
          appName: config.appName,
          mobile: config.mobile,
          contactEmail: config.contactEmail,
          address: config.address,
          defaultDeductionPercent: Number(config.defaultDeductionPercent),
          status: config.status,
        };
      }
    } catch {
      // Fallback if table not populated
    }
    return DEFAULT_APP_CONFIG;
  }

  public async updateAppConfig(data: Partial<AppConfigData>): Promise<AppConfigData> {
    const existing = await prisma.applicationConfig.findFirst();
    if (existing) {
      const updated = await prisma.applicationConfig.update({
        where: { id: existing.id },
        data: {
          ...(data.appName !== undefined ? { appName: data.appName } : {}),
          ...(data.mobile !== undefined ? { mobile: data.mobile } : {}),
          ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail } : {}),
          ...(data.address !== undefined ? { address: data.address } : {}),
          ...(data.defaultDeductionPercent !== undefined ? { defaultDeductionPercent: data.defaultDeductionPercent } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });
      return {
        appName: updated.appName,
        mobile: updated.mobile,
        contactEmail: updated.contactEmail,
        address: updated.address,
        defaultDeductionPercent: Number(updated.defaultDeductionPercent),
        status: updated.status,
      };
    } else {
      const created = await prisma.applicationConfig.create({
        data: {
          appName: data.appName || DEFAULT_APP_CONFIG.appName,
          mobile: data.mobile || DEFAULT_APP_CONFIG.mobile,
          contactEmail: data.contactEmail ?? DEFAULT_APP_CONFIG.contactEmail,
          address: data.address ?? DEFAULT_APP_CONFIG.address,
          defaultDeductionPercent: data.defaultDeductionPercent ?? DEFAULT_APP_CONFIG.defaultDeductionPercent,
          status: data.status || DEFAULT_APP_CONFIG.status,
        },
      });
      return {
        appName: created.appName,
        mobile: created.mobile,
        contactEmail: created.contactEmail,
        address: created.address,
        defaultDeductionPercent: Number(created.defaultDeductionPercent),
        status: created.status,
      };
    }
  }

  // ============================================================
  // 2. MODULE REGISTRY
  // ============================================================

  public async getModules(): Promise<ModuleRegistryItem[]> {
    try {
      const dbModules = await prisma.moduleConfig.findMany({
        orderBy: { sortOrder: "asc" },
      });
      if (dbModules.length > 0) {
        return dbModules.map((m) => ({
          code: m.code,
          name: m.name,
          displayName: m.displayName,
          description: m.description,
          isEnabled: m.isEnabled,
          sortOrder: m.sortOrder,
          parentModule: m.parentModule,
          permissions: (m.permissions as string[]) || ["view", "create", "update", "delete"],
          status: m.status,
        }));
      }
    } catch {
      // Fallback
    }
    return INITIAL_MODULE_REGISTRY;
  }

  public async isModuleEnabled(moduleCode: string): Promise<boolean> {
    const code = moduleCode.toUpperCase().trim();
    try {
      const mod = await prisma.moduleConfig.findUnique({
        where: { code },
        select: { isEnabled: true },
      });
      if (mod) return mod.isEnabled;
    } catch {
      // Fallback to static registry
    }
    const staticMod = INITIAL_MODULE_REGISTRY.find((m) => m.code === code);
    return staticMod ? staticMod.isEnabled : true;
  }

  public async setModuleStatus(code: string, isEnabled: boolean): Promise<ModuleRegistryItem> {
    const uppercaseCode = code.toUpperCase().trim();
    const existing = await prisma.moduleConfig.findUnique({ where: { code: uppercaseCode } });

    if (existing) {
      const updated = await prisma.moduleConfig.update({
        where: { code: uppercaseCode },
        data: {
          isEnabled,
          status: isEnabled ? "ACTIVE" : "DISABLED",
        },
      });
      return {
        code: updated.code,
        name: updated.name,
        displayName: updated.displayName,
        description: updated.description,
        isEnabled: updated.isEnabled,
        sortOrder: updated.sortOrder,
        parentModule: updated.parentModule,
        status: updated.status,
      };
    }

    const staticTemplate = INITIAL_MODULE_REGISTRY.find((m) => m.code === uppercaseCode);
    if (!staticTemplate) {
      throw new NotFoundError(`Module ${uppercaseCode} not found in registry`);
    }

    const created = await prisma.moduleConfig.create({
      data: {
        code: staticTemplate.code,
        name: staticTemplate.name,
        displayName: staticTemplate.displayName,
        description: staticTemplate.description,
        isEnabled,
        sortOrder: staticTemplate.sortOrder,
        status: isEnabled ? "ACTIVE" : "DISABLED",
      },
    });

    return {
      code: created.code,
      name: created.name,
      displayName: created.displayName,
      description: created.description,
      isEnabled: created.isEnabled,
      sortOrder: created.sortOrder,
      status: created.status,
    };
  }

  // ============================================================
  // 3. SCHEME MASTER
  // ============================================================

  public async getSchemes(): Promise<SchemeMasterItem[]> {
    try {
      const schemes = await prisma.schemeMaster.findMany({
        orderBy: { createdAt: "asc" },
      });
      return schemes.map((s) => ({
        code: s.code,
        name: s.name,
        moduleCode: s.moduleCode,
        description: s.description,
        poolType: s.poolType,
        deductionPercent: Number(s.deductionPercent),
        status: s.status,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
      }));
    } catch {
      return INITIAL_SCHEMES;
    }
  }

  public async getSchemeByCode(code: string): Promise<SchemeMasterItem | null> {
    const uppercaseCode = code.toUpperCase().trim();
    try {
      const s = await prisma.schemeMaster.findUnique({
        where: { code: uppercaseCode },
      });
      if (s) {
        return {
          code: s.code,
          name: s.name,
          moduleCode: s.moduleCode,
          description: s.description,
          poolType: s.poolType,
          deductionPercent: Number(s.deductionPercent),
          status: s.status,
          effectiveFrom: s.effectiveFrom,
          effectiveTo: s.effectiveTo,
        };
      }
    } catch {
      // Fallback
    }

    const staticMatch = INITIAL_SCHEMES.find((s) => s.code === uppercaseCode);
    return staticMatch || null;
  }

  public async upsertScheme(data: SchemeMasterItem): Promise<SchemeMasterItem> {
    const code = data.code.toUpperCase().trim();
    const result = await prisma.schemeMaster.upsert({
      where: { code },
      update: {
        name: data.name,
        moduleCode: data.moduleCode.toUpperCase(),
        description: data.description,
        poolType: data.poolType,
        deductionPercent: data.deductionPercent,
        status: data.status,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
      },
      create: {
        code,
        name: data.name,
        moduleCode: data.moduleCode.toUpperCase(),
        description: data.description,
        poolType: data.poolType,
        deductionPercent: data.deductionPercent,
        status: data.status,
        effectiveFrom: data.effectiveFrom || new Date(),
        effectiveTo: data.effectiveTo,
      },
    });

    return {
      code: result.code,
      name: result.name,
      moduleCode: result.moduleCode,
      description: result.description,
      poolType: result.poolType,
      deductionPercent: Number(result.deductionPercent),
      status: result.status,
      effectiveFrom: result.effectiveFrom,
      effectiveTo: result.effectiveTo,
    };
  }

  // ============================================================
  // 4. SCHEME TYPES (₹300, ₹500, ₹1000, ₹1500, etc.)
  // ============================================================

  public async getSchemeTypes(): Promise<SchemeTypeItem[]> {
    try {
      const types = await prisma.schemeTypeConfig.findMany({
        orderBy: { amount: "asc" },
      });
      if (types.length > 0) {
        return types.map((t) => ({
          code: t.code,
          name: t.name,
          amount: Number(t.amount),
          description: t.description,
          status: t.status,
          effectiveFrom: t.effectiveFrom,
          effectiveTo: t.effectiveTo,
        }));
      }
    } catch {
      // Fallback
    }
    return INITIAL_SCHEME_TYPES;
  }

  public async upsertSchemeType(data: SchemeTypeItem): Promise<SchemeTypeItem> {
    const code = data.code.toUpperCase().trim();
    const result = await prisma.schemeTypeConfig.upsert({
      where: { code },
      update: {
        name: data.name,
        amount: data.amount,
        description: data.description,
        status: data.status,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
      },
      create: {
        code,
        name: data.name,
        amount: data.amount,
        description: data.description,
        status: data.status,
        effectiveFrom: data.effectiveFrom || new Date(),
        effectiveTo: data.effectiveTo,
      },
    });

    return {
      code: result.code,
      name: result.name,
      amount: Number(result.amount),
      description: result.description,
      status: result.status,
      effectiveFrom: result.effectiveFrom,
      effectiveTo: result.effectiveTo,
    };
  }

  // ============================================================
  // 5. A–F AGE SLAB RESOLUTION
  // ============================================================

  /**
   * Resolve exact A-F Age Slab for an applicant based on age and schemeType.
   * Enforces exact boundary criteria:
   * Age 1-5   -> Slab A (₹1,500)
   * Age 6-10  -> Slab B (₹3,100)
   * Age 11-15 -> Slab C (₹5,100)
   * Age 16-18 -> Slab D (₹8,100)
   * Age 19-21 -> Slab E (₹10,000)
   * Age 22+   -> Slab F (₹11,000)
   */
  public async resolveAgeSlab(age: number, schemeType: string = "GENERAL"): Promise<AgeSlabResolutionResult> {
    if (age < 0 || !Number.isFinite(age)) {
      throw new BadRequestError(`Invalid age provided: ${age}`);
    }

    const normalizedScheme = schemeType.toUpperCase().trim();

    try {
      // 1. Try scheme-specific active slabs
      let activeSlabs = await prisma.schemeAgeSlab.findMany({
        where: {
          schemeType: normalizedScheme,
          status: "Active",
        },
        orderBy: { minAge: "asc" },
      });

      // 2. Fallback to GENERAL / GLOBAL if scheme-specific slabs are empty
      if (activeSlabs.length === 0 && normalizedScheme !== "GENERAL") {
        activeSlabs = await prisma.schemeAgeSlab.findMany({
          where: {
            schemeType: "GENERAL",
            status: "Active",
          },
          orderBy: { minAge: "asc" },
        });
      }

      if (activeSlabs.length > 0) {
        const matched = activeSlabs.find((slab) => age >= slab.minAge && (slab.maxAge === null || age <= slab.maxAge));
        if (matched) {
          return {
            slabCode: matched.slabCode,
            slabName: matched.slabName,
            minAge: matched.minAge,
            maxAge: matched.maxAge,
            joiningFee: Number(matched.joiningFee),
            installment: Number(matched.installment),
            schemeType: matched.schemeType,
          };
        }
      }
    } catch {
      // Database query failed, use static A-F resolver fallback
    }

    // Static fallback matching the exact A-F specification
    const staticMatch = INITIAL_AGE_SLABS.find((s) => age >= s.minAge && (s.maxAge === null || age <= s.maxAge));
    if (!staticMatch) {
      throw new BadRequestError(`No age slab defined for age ${age} in scheme ${normalizedScheme}`);
    }

    return {
      slabCode: staticMatch.slabCode,
      slabName: staticMatch.slabName,
      minAge: staticMatch.minAge,
      maxAge: staticMatch.maxAge,
      joiningFee: staticMatch.joiningFee,
      installment: staticMatch.installment,
      schemeType: staticMatch.schemeType,
    };
  }

  public async getAllAgeSlabs(schemeType?: string): Promise<AgeSlabItem[]> {
    try {
      const where: any = {};
      if (schemeType && schemeType !== "ALL") {
        where.schemeType = schemeType.toUpperCase().trim();
      }
      const slabs = await prisma.schemeAgeSlab.findMany({
        where,
        orderBy: [{ schemeType: "asc" }, { displayOrder: "asc" }, { minAge: "asc" }],
      });
      if (slabs.length > 0) {
        return slabs.map((s) => ({
          slabCode: s.slabCode,
          slabName: s.slabName,
          minAge: s.minAge,
          maxAge: s.maxAge,
          joiningFee: Number(s.joiningFee),
          installment: Number(s.installment),
          schemeType: s.schemeType,
          status: s.status,
          displayOrder: s.displayOrder,
        }));
      }
    } catch {
      // Fallback
    }
    return INITIAL_AGE_SLABS;
  }

  public async upsertAgeSlab(data: AgeSlabItem): Promise<AgeSlabItem> {
    const slabCode = data.slabCode.toUpperCase().trim();
    const schemeType = (data.schemeType || "GENERAL").toUpperCase().trim();

    // Check for range overlap with other active slabs in same scheme
    const otherSlabs = await prisma.schemeAgeSlab.findMany({
      where: {
        schemeType,
        slabCode: { not: slabCode },
        status: "Active",
      },
    });

    for (const other of otherSlabs) {
      const isOverlap =
        (data.maxAge === null && other.maxAge === null) ||
        (data.maxAge === null && other.maxAge !== null && other.maxAge >= data.minAge) ||
        (data.maxAge !== null && other.maxAge === null && data.maxAge >= other.minAge) ||
        (data.maxAge !== null && other.maxAge !== null && data.minAge <= other.maxAge && data.maxAge >= other.minAge);

      if (isOverlap) {
        throw new BadRequestError(
          `Age range ${data.minAge}-${data.maxAge ?? "∞"} overlaps with existing slab ${other.slabCode} (${other.minAge}-${other.maxAge ?? "∞"})`
        );
      }
    }

    const result = await prisma.schemeAgeSlab.upsert({
      where: { slabCode },
      update: {
        slabName: data.slabName,
        minAge: data.minAge,
        maxAge: data.maxAge,
        joiningFee: data.joiningFee,
        installment: data.installment,
        schemeType,
        status: data.status || "Active",
        displayOrder: data.displayOrder ?? 0,
      },
      create: {
        slabCode,
        slabName: data.slabName,
        minAge: data.minAge,
        maxAge: data.maxAge,
        joiningFee: data.joiningFee,
        installment: data.installment,
        schemeType,
        status: data.status || "Active",
        displayOrder: data.displayOrder ?? 0,
      },
    });

    return {
      slabCode: result.slabCode,
      slabName: result.slabName,
      minAge: result.minAge,
      maxAge: result.maxAge,
      joiningFee: Number(result.joiningFee),
      installment: Number(result.installment),
      schemeType: result.schemeType,
      status: result.status,
      displayOrder: result.displayOrder,
    };
  }

  // ============================================================
  // 6. POOL CONFIGURATION & RESOLUTION
  // ============================================================

  public async getPools(): Promise<PoolConfigItem[]> {
    try {
      const pools = await prisma.poolConfig.findMany({
        orderBy: { createdAt: "asc" },
      });
      if (pools.length > 0) {
        return pools.map((p) => ({
          code: p.code,
          name: p.name,
          gender: p.gender as any,
          description: p.description,
          status: p.status,
        }));
      }
    } catch {
      // Fallback
    }
    return INITIAL_POOLS;
  }

  public resolvePoolForGender(gender: string): string {
    const raw = String(gender || "").toLowerCase().trim();
    if (raw === "female" || raw === "f") return "FEMALE_POOL";
    if (raw === "male" || raw === "m") return "MALE_POOL";
    return "UNIFIED_POOL";
  }

  // ============================================================
  // 7. ADMINISTRATIVE DEDUCTION RESOLVER
  // ============================================================

  /**
   * Resolves the exact administrative deduction percentage.
   * Default: 15%
   * Supports scheme-specific overrides (e.g. Suraksha Bima 10%, Marriage 15%).
   */
  public async resolveAdministrativeDeduction(
    schemeCode?: string,
    _transactionType?: string,
    _effectiveDate?: Date
  ): Promise<{ deductionPercent: number; isOverridden: boolean; schemeCode: string }> {
    const defaultApp = await this.getAppConfig();
    const defaultPercent = defaultApp.defaultDeductionPercent || 15.0;

    if (!schemeCode) {
      return { deductionPercent: defaultPercent, isOverridden: false, schemeCode: "GLOBAL" };
    }

    const normalizedCode = schemeCode.toUpperCase().trim();
    const scheme = await this.getSchemeByCode(normalizedCode);

    if (scheme && scheme.deductionPercent !== undefined && Number(scheme.deductionPercent) >= 0) {
      return {
        deductionPercent: Number(scheme.deductionPercent),
        isOverridden: Number(scheme.deductionPercent) !== defaultPercent,
        schemeCode: normalizedCode,
      };
    }

    return {
      deductionPercent: defaultPercent,
      isOverridden: false,
      schemeCode: normalizedCode,
    };
  }
}
