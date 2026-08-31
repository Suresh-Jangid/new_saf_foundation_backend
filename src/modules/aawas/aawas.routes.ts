import { Router } from "express";
import { AawasController } from "./aawas.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createAawasSchema,
  updateAawasSchema,
  addAawasInstallmentSchema,
} from "./aawas.validation";

const router = Router();
const controller = new AawasController();

// Authentication required for all Aawas endpoints
router.use(authenticate as any);

// 1. List Registrations
router.get(
  "/",
  checkPermission("aawas", "view") as any,
  controller.getAllRegistrations.bind(controller)
);

// 2. Verify E-PIN
router.post(
  "/verify-epin",
  checkPermission("aawas", "view") as any,
  controller.verifyEPin.bind(controller)
);

// 3. Get Single Registration
router.get(
  "/:id",
  checkPermission("aawas", "view") as any,
  controller.getRegistrationById.bind(controller)
);

// 4. Create Registration
router.post(
  "/",
  checkPermission("aawas", "create") as any,
  validateRequest(createAawasSchema),
  controller.createRegistration.bind(controller)
);

// 5. Update Registration
router.put(
  "/:id",
  checkPermission("aawas", "update") as any,
  validateRequest(updateAawasSchema),
  controller.updateRegistration.bind(controller)
);

// Also support PATCH /:id
router.patch(
  "/:id",
  checkPermission("aawas", "update") as any,
  validateRequest(updateAawasSchema),
  controller.updateRegistration.bind(controller)
);

// 6. Soft Delete Registration
router.delete(
  "/:id",
  checkPermission("aawas", "delete") as any,
  controller.softDeleteRegistration.bind(controller)
);

// 7. Add Installment Payment
router.post(
  "/:id/installments",
  checkPermission("aawas", "create") as any,
  validateRequest(addAawasInstallmentSchema),
  controller.addInstallment.bind(controller)
);

export default router;
