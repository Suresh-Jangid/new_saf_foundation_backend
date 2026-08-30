import { Router } from "express";
import { EpinsController } from "./epins.controller";
import { authenticate, authorizeRoles } from "../../middlewares/auth";
import { validateRequest } from "../../middlewares/validation";
import {
  epinInventoryQuerySchema,
  epinGenerateSchema,
  epinAssignSchema,
  epinValidateSchema,
  epinConsumeSchema,
  epinBurnSchema,
  epinAuditQuerySchema,
} from "./epins.schema";

const router = Router();
const controller = new EpinsController();

// 1. GET /api/v1/epins - Inventory with summary counts
router.get(
  "/",
  authenticate as any,
  validateRequest(epinInventoryQuerySchema),
  controller.getInventory.bind(controller)
);

// 2. POST /api/v1/epins/generate - Batch generation (Admin only)
router.post(
  "/generate",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(epinGenerateSchema),
  controller.generateEPins.bind(controller)
);

// 3. POST /api/v1/epins/assign - Agent assignment (Admin only)
router.post(
  "/assign",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(epinAssignSchema),
  controller.assignEPins.bind(controller)
);

// 4. POST /api/v1/epins/validate - Validation without state mutation (Admin & Agent)
router.post(
  "/validate",
  authenticate as any,
  validateRequest(epinValidateSchema),
  controller.validateEPin.bind(controller)
);

// 5. POST /api/v1/epins/consume - Atomic consumption (Admin & Agent)
router.post(
  "/consume",
  authenticate as any,
  validateRequest(epinConsumeSchema),
  controller.consumeEPin.bind(controller)
);

// 6. POST /api/v1/epins/burn - Irreversible burning/revocation (Admin only)
router.post(
  "/burn",
  authenticate as any,
  authorizeRoles("ADMIN") as any,
  validateRequest(epinBurnSchema),
  controller.burnEPin.bind(controller)
);

// 7. GET /api/v1/epins/audit - Audit history (Admin & Agent)
router.get(
  "/audit",
  authenticate as any,
  validateRequest(epinAuditQuerySchema),
  controller.getAuditHistory.bind(controller)
);

export default router;
