import { Router } from "express";
import { ShubhLaxmiController } from "./shubh-laxmi.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createShubhLaxmiSchema,
  updateShubhLaxmiSchema,
  addShubhLaxmiInstallmentSchema,
  verifyEPinSchema,
} from "./shubh-laxmi.validation";
import { SHUBH_LAXMI_PERMISSION_KEY } from "./shubh-laxmi.types";

const router = Router();
const controller = new ShubhLaxmiController();

// Authentication required for all ShubhLaxmi endpoints
router.use(authenticate as any);

// 1. List Registrations
router.get(
  "/",
  checkPermission(SHUBH_LAXMI_PERMISSION_KEY, "view") as any,
  controller.getAllRegistrations.bind(controller)
);

// 2. Verify E-PIN
router.post(
  "/verify-epin",
  checkPermission(SHUBH_LAXMI_PERMISSION_KEY, "view") as any,
  validateRequest(verifyEPinSchema),
  controller.verifyEPin.bind(controller)
);

// 3. Get Single Registration By ID
router.get(
  "/:id",
  checkPermission(SHUBH_LAXMI_PERMISSION_KEY, "view") as any,
  controller.getRegistrationById.bind(controller)
);

// 4. Create Registration Application
router.post(
  "/",
  checkPermission(SHUBH_LAXMI_PERMISSION_KEY, "create") as any,
  validateRequest(createShubhLaxmiSchema),
  controller.createRegistration.bind(controller)
);

// 5. Update Registration (PUT and PATCH)
router.put(
  "/:id",
  checkPermission(SHUBH_LAXMI_PERMISSION_KEY, "update") as any,
  validateRequest(updateShubhLaxmiSchema),
  controller.updateRegistration.bind(controller)
);

router.patch(
  "/:id",
  checkPermission(SHUBH_LAXMI_PERMISSION_KEY, "update") as any,
  validateRequest(updateShubhLaxmiSchema),
  controller.updateRegistration.bind(controller)
);

// 6. Soft Delete Registration
router.delete(
  "/:id",
  checkPermission(SHUBH_LAXMI_PERMISSION_KEY, "delete") as any,
  controller.softDeleteRegistration.bind(controller)
);

// 7. Add Installment Payment
router.post(
  "/:id/installments",
  checkPermission(SHUBH_LAXMI_PERMISSION_KEY, "create") as any,
  validateRequest(addShubhLaxmiInstallmentSchema),
  controller.addInstallment.bind(controller)
);

export default router;
