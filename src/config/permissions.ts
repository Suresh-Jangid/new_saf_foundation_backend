export type PermissionAction = "view" | "create" | "update" | "delete";

export const VALID_ACTIONS: PermissionAction[] = ["view", "create", "update", "delete"];

export interface CanonicalPermissionDefinition {
  module: string;
  displayName: { en: string; hi: string };
  allowedActions: PermissionAction[];
  enabled: boolean;
  agentManageable: boolean;
  category: "ADMINISTRATION" | "SCHEME" | "FINANCIAL" | "REPORT";
  aliases?: string[];
}

/**
 * SAF FOUNDATION CANONICAL PERMISSION CATALOG
 * Single authoritative source of truth for modules, actions, and roles across backend & frontend.
 */
export const CANONICAL_PERMISSION_CATALOG: CanonicalPermissionDefinition[] = [
  // 1. Dashboard
  {
    module: "dashboard",
    displayName: { en: "Dashboard", hi: "????????" },
    allowedActions: ["view"],
    enabled: true,
    agentManageable: true,
    category: "ADMINISTRATION",
  },

  // 2. General Marriage Application
  {
    module: "applicant_registration",
    displayName: { en: "General Marriage Application", hi: "??????? ????? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
  },

  // 3. General Marriage Congratulation Payment
  {
    module: "marriage_congratulations",
    displayName: { en: "General Marriage Congratulation Payment", hi: "????? ???? ????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
    aliases: ["marriage_congratulations_payment"],
  },

  // 4. Mayra General Application
  {
    module: "mayra_registration",
    displayName: { en: "Mayra General Application", hi: "????? ??????? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
  },

  // 5. Insurance Bima Application
  {
    module: "security_application",
    displayName: { en: "Insurance Bima Application", hi: "??????? ???? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
  },

  // 6. Insurance Bima Payment
  {
    module: "suraksha_bima_yojana",
    displayName: { en: "Insurance Bima Payment", hi: "??????? ???? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
    aliases: ["suraksha_bima_yojana_payment"],
  },

  // 7. Janni Delivery Registration
  {
    module: "janni_delivery",
    displayName: { en: "Janni Delivery Registration", hi: "???? ??????? ???????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
  },

  // 8. Aawas (Home) Registration
  {
    module: "aawas_home",
    displayName: { en: "Aawas (Home) Registration", hi: "???? ????? ???????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
    aliases: ["aawas"],
  },

  // 9. Lado Bahin Registration
  {
    module: "lado_bahin",
    displayName: { en: "Lado Bahin Registration", hi: "???? ???? ???????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
  },

  // 10. Dhundhotsav Registration
  {
    module: "dhundhotsav",
    displayName: { en: "Dhundhotsav Registration", hi: "????????? ???????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
  },

  // 11. ShubhLaxmi Registration
  {
    module: "shubh_laxmi",
    displayName: { en: "ShubhLaxmi (Deepawali) Registration", hi: "?????????? ???????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "SCHEME",
    aliases: ["shubhlaxmi"],
  },

  // 12. Agent Registration (hierarchical downline creation by agents)
  {
    module: "agent_registration",
    displayName: { en: "Agent Registration", hi: "????? ???????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "ADMINISTRATION",
  },

  // 13. Agent Commission Report
  {
    module: "agent_commission_report",
    displayName: { en: "Agent Commission Report", hi: "????? ????? ???????" },
    allowedActions: ["view"],
    enabled: true,
    agentManageable: true,
    category: "REPORT",
  },

  // 14. Bulk Marriage EMI
  {
    module: "bulk_marriage_emi",
    displayName: { en: "Bulk Marriage EMI", hi: "???? ????? ?????" },
    allowedActions: ["view", "update"],
    enabled: true,
    agentManageable: true,
    category: "FINANCIAL",
  },

  // 15. Bulk Suraksha Bima EMI
  {
    module: "bulk_suraksha_bima_emi",
    displayName: { en: "Bulk Insurance Bima EMI", hi: "???? ??????? ???? ?????" },
    allowedActions: ["view", "update"],
    enabled: true,
    agentManageable: true,
    category: "FINANCIAL",
  },

  // 16. Bulk Mayra EMI
  {
    module: "bulk_mayra_emi",
    displayName: { en: "Bulk Mayra EMI", hi: "???? ????? ?????" },
    allowedActions: ["view", "update"],
    enabled: true,
    agentManageable: true,
    category: "FINANCIAL",
  },

  // 17. Payment Management
  {
    module: "payment_management",
    displayName: { en: "Payment Management", hi: "?????? ???????" },
    allowedActions: ["view"],
    enabled: true,
    agentManageable: true,
    category: "FINANCIAL",
  },

  // 18. General Application Payment
  {
    module: "general_application_payment",
    displayName: { en: "Payment Management - General Marriage Application", hi: "??????? ????? ????? ??????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "FINANCIAL",
  },

  // 19. Insurance Application Payment
  {
    module: "insurance_application_payment",
    displayName: { en: "Payment Management - Insurance Bima Application", hi: "??????? ???? ????? ??????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "FINANCIAL",
  },

  // 20. Balika Loan Application
  {
    module: "balika_loan_application",
    displayName: { en: "Balika Loan Application", hi: "?????? ?? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "FINANCIAL",
  },

  // 21. Financial Help
  {
    module: "financial_help",
    displayName: { en: "Financial Application Payment", hi: "????? ?????? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: true,
    agentManageable: true,
    category: "FINANCIAL",
  },

  // 22. E-PIN Management
  {
    module: "epin_management",
    displayName: { en: "E-PIN Operational Management", hi: "?-??? ???????" },
    allowedActions: ["view"],
    enabled: true,
    agentManageable: true,
    category: "ADMINISTRATION",
  },

  // 23. Agent Commission Payment (Admin Only)
  {
    module: "agent_commission",
    displayName: { en: "Agent Commission Payment", hi: "????? ????? ??????" },
    allowedActions: ["view", "update"],
    enabled: true,
    agentManageable: false, // ADMIN ONLY
    category: "FINANCIAL",
  },

  // 24. Agent Permission Management (Admin Only)
  {
    module: "agent_permission",
    displayName: { en: "Agent Permission Management", hi: "????? ?????? ???????" },
    allowedActions: ["view", "update"],
    enabled: true,
    agentManageable: false, // ADMIN ONLY
    category: "ADMINISTRATION",
  },

  // 25. System Settings (Admin Only)
  {
    module: "system_settings",
    displayName: { en: "Configuration & System Settings", hi: "?????? ???????? ??? ????????????" },
    allowedActions: ["view", "update"],
    enabled: true,
    agentManageable: false, // ADMIN ONLY
    category: "ADMINISTRATION",
  },

  // 26. Marriage Sewing Machine Distribution (Disabled)
  {
    module: "marriage_sewing_machine_distribution",
    displayName: { en: "Marriage Sewing Machine Distribution", hi: "????? ????? ???? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: false,
    agentManageable: false,
    category: "SCHEME",
  },

  // 27. Disability Cycle Distribution (Disabled)
  {
    module: "disability_cycle_distribution",
    displayName: { en: "Disability Cycle Distribution", hi: "??????? ?????? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: false,
    agentManageable: false,
    category: "SCHEME",
  },

  // 28. Sewing Machine Camp (Disabled)
  {
    module: "sewing_machine_camp",
    displayName: { en: "Sewing Machine Camp", hi: "??????? ????? ???? ????? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: false,
    agentManageable: false,
    category: "SCHEME",
  },

  // 29. Pension Yojana Application Payment (Disabled)
  {
    module: "salakar_pension_yojana",
    displayName: { en: "Pension Yojana Application Payment", hi: "?????? ????? ?????" },
    allowedActions: ["view", "create", "update", "delete"],
    enabled: false,
    agentManageable: false,
    category: "SCHEME",
  },
];

// Lookup maps
const CATALOG_MAP = new Map<string, CanonicalPermissionDefinition>(
  CANONICAL_PERMISSION_CATALOG.map((def) => [def.module, def])
);

// Map of alias -> canonical module key
export const MODULE_ALIASES: Record<string, string> = {};
CANONICAL_PERMISSION_CATALOG.forEach((def) => {
  if (def.aliases) {
    def.aliases.forEach((alias) => {
      MODULE_ALIASES[alias] = def.module;
    });
  }
});

// All valid module keys (canonical + aliases)
const ALL_VALID_MODULE_KEYS = new Set<string>([
  ...CANONICAL_PERMISSION_CATALOG.map((m) => m.module),
  ...Object.keys(MODULE_ALIASES),
]);

// All agent manageable module keys (canonical + aliases)
const AGENT_MANAGEABLE_MODULE_KEYS = new Set<string>([
  ...CANONICAL_PERMISSION_CATALOG.filter((m) => m.enabled && m.agentManageable).map((m) => m.module),
]);
// Add aliases of agent-manageable modules
Object.entries(MODULE_ALIASES).forEach(([alias, canonical]) => {
  const def = CATALOG_MAP.get(canonical);
  if (def && def.enabled && def.agentManageable) {
    AGENT_MANAGEABLE_MODULE_KEYS.add(alias);
  }
});

/**
 * Resolves any module string (canonical or alias) to its canonical key.
 */
export function resolveCanonicalModule(moduleName: string): string {
  if (!moduleName) return moduleName;
  const trimmed = moduleName.trim();
  return MODULE_ALIASES[trimmed] || trimmed;
}

/**
 * Returns an array containing the canonical module key and all of its aliases.
 * Useful for querying DB records that may have been stored under legacy alias names.
 */
export function getModuleWithAliases(moduleName: string): string[] {
  const canonical = resolveCanonicalModule(moduleName);
  const def = CATALOG_MAP.get(canonical);
  const aliases = def?.aliases || [];
  return Array.from(new Set([canonical, ...aliases, moduleName]));
}

/**
 * Checks if a module key is a known canonical or alias module in the catalog.
 */
export function isValidModule(moduleName: string): boolean {
  if (!moduleName) return false;
  return ALL_VALID_MODULE_KEYS.has(moduleName.trim());
}

/**
 * Checks if a module key is assignable to agents (active and agent-manageable).
 */
export function isAgentManageableModule(moduleName: string): boolean {
  if (!moduleName) return false;
  return AGENT_MANAGEABLE_MODULE_KEYS.has(moduleName.trim());
}

/**
 * Checks if an action is one of the strictly allowed actions: view, create, update, delete.
 */
export function isValidAction(action: string): action is PermissionAction {
  return VALID_ACTIONS.includes(action as PermissionAction);
}

/**
 * Checks if an action is allowed for a specific module.
 */
export function isAllowedActionForModule(moduleName: string, action: string): boolean {
  if (!isValidAction(action)) return false;
  const canonical = resolveCanonicalModule(moduleName);
  const def = CATALOG_MAP.get(canonical);
  if (!def) return false;
  return def.allowedActions.includes(action);
}

/**
 * Returns all active agent-manageable modules for rendering in the permission matrix.
 */
export function getAgentManageableCatalog(): CanonicalPermissionDefinition[] {
  return CANONICAL_PERMISSION_CATALOG.filter((m) => m.enabled && m.agentManageable);
}
