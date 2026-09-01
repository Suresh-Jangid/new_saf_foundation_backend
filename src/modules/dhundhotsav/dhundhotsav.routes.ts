import { Router } from "express";
import { DhundhotsavController } from "./dhundhotsav.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createDhundhotsavSchema,
  updateDhundhotsavSchema,
  addDhundhotsavInstallmentSchema,
  verifyEPinSchema,
} from "./dhundhotsav.validation";

const router = Router();
const controller = new DhundhotsavController();

// Authentication required for all Dhundhotsav endpoints
router.use(authenticate as any);

// 1. List Registrations
router.get(
  "/",
  checkPermission("dhundhotsav", "view") as any,
  controller.getAllRegistrations.bind(controller)
);

// 2. Verify E-PIN
router.post(
  "/verify-epin",
  checkPermission("dhundhotsav", "view") as any,
  validateRequest(verifyEPinSchema),
  controller.verifyEPin.bind(controller)
);

// 3. Get Single Registration By ID
router.get(
  "/:id",
  checkPermission("dhundhotsav", "view") as any,
  controller.getRegistrationById.bind(controller)
);

// 4. Create Registration Application
router.post(
  "/",
  checkPermission("dhundhotsav", "create") as any,
  validateRequest(createDhundhotsavSchema),
  controller.createRegistration.bind(controller)
);

// 5. Update Registration (PUT and PATCH)
router.put(
  "/:id",
  checkPermission("dhundhotsav", "update") as any,
  validateRequest(updateDhundhotsavSchema),
  controller.updateRegistration.bind(controller)
);

router.patch(
  "/:id",
  checkPermission("dhundhotsav", "update") as any,
  validateRequest(updateDhundhotsavSchema),
  controller.updateRegistration.bind(controller)
);

// 6. Soft Delete Registration
router.delete(
  "/:id",
  checkPermission("dhundhotsav", "delete") as any,
  controller.softDeleteRegistration.bind(controller)
);

// 7. Add Installment Payment
router.post(
  "/:id/installments",
  checkPermission("dhundhotsav", "create") as any,
  validateRequest(addDhundhotsavInstallmentSchema),
  controller.addInstallment.bind(controller)
);

export default router;
