import { Router } from "express";
import { ConfigurationController } from "./configuration.controller";
import { authenticate, authorizeRoles } from "../../middlewares/auth";
import { validateRequest } from "../../middlewares/validation";
import {
  updateAppConfigSchema,
  updateModuleConfigSchema,
  createSchemeMasterSchema,
  createSchemeTypeSchema,
  createAgeSlabSchema,
  generateEPinSchema,
  assignEPinSchema,
  useEPinSchema,
  burnEPinSchema,
} from "./configuration.schema";

const router = Router();
const controller = new ConfigurationController();

// ── PUBLIC & AUTHENTICATED READ CONFIG APIS ─────────────
router.get("/application", controller.getAppConfig.bind(controller));
router.get("/modules", controller.getModules.bind(controller));
router.get("/schemes", controller.getSchemes.bind(controller));
router.get("/scheme-types", controller.getSchemeTypes.bind(controller));
router.get("/age-slabs", controller.getAgeSlabs.bind(controller));
router.get("/age-slabs/resolve", controller.resolveAgeSlab.bind(controller));
router.get("/pools", controller.getPools.bind(controller));
router.get("/deductions", controller.getDeductions.bind(controller));
router.get("/epin/:pinCode", controller.getEPinDetails.bind(controller));

// ── ADMIN-ONLY CONFIGURATION MUTATIONS ──────────────────
router.put(
  "/application",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(updateAppConfigSchema),
  controller.updateAppConfig.bind(controller)
);

router.put(
  "/modules/:code/status",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(updateModuleConfigSchema),
  controller.setModuleStatus.bind(controller)
);

router.post(
  "/schemes",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(createSchemeMasterSchema),
  controller.upsertScheme.bind(controller)
);

router.post(
  "/scheme-types",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(createSchemeTypeSchema),
  controller.upsertSchemeType.bind(controller)
);

router.post(
  "/age-slabs",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(createAgeSlabSchema),
  controller.upsertAgeSlab.bind(controller)
);

// ── E-PIN LIFECYCLE MUTATIONS ───────────────────────────
router.post(
  "/epin/generate",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(generateEPinSchema),
  controller.generateEPins.bind(controller)
);

router.post(
  "/epin/assign",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(assignEPinSchema),
  controller.assignEPins.bind(controller)
);

router.post(
  "/epin/use",
  authenticate as any,
  validateRequest(useEPinSchema),
  controller.useEPin.bind(controller)
);

router.post(
  "/epin/burn",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(burnEPinSchema),
  controller.burnEPins.bind(controller)
);

export default router;
