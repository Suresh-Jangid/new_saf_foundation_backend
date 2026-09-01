import { Router } from "express";
import { LadoBahinController } from "./lado-bahin.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createLadoBahinSchema,
  updateLadoBahinSchema,
  addLadoBahinInstallmentSchema,
  verifyEPinSchema,
} from "./lado-bahin.validation";

const router = Router();
const controller = new LadoBahinController();

// Authentication required for all Lado Bahin endpoints
router.use(authenticate as any);

// 1. List Registrations
router.get(
  "/",
  checkPermission("lado_bahin", "view") as any,
  controller.getAllRegistrations.bind(controller)
);

// 2. Verify E-PIN
router.post(
  "/verify-epin",
  checkPermission("lado_bahin", "view") as any,
  validateRequest(verifyEPinSchema),
  controller.verifyEPin.bind(controller)
);

// 3. Get Single Registration By ID
router.get(
  "/:id",
  checkPermission("lado_bahin", "view") as any,
  controller.getRegistrationById.bind(controller)
);

// 4. Create Registration Application
router.post(
  "/",
  checkPermission("lado_bahin", "create") as any,
  validateRequest(createLadoBahinSchema),
  controller.createRegistration.bind(controller)
);

// 5. Update Registration (PUT and PATCH)
router.put(
  "/:id",
  checkPermission("lado_bahin", "update") as any,
  validateRequest(updateLadoBahinSchema),
  controller.updateRegistration.bind(controller)
);

router.patch(
  "/:id",
  checkPermission("lado_bahin", "update") as any,
  validateRequest(updateLadoBahinSchema),
  controller.updateRegistration.bind(controller)
);

// 6. Soft Delete Registration
router.delete(
  "/:id",
  checkPermission("lado_bahin", "delete") as any,
  controller.softDeleteRegistration.bind(controller)
);

// 7. Add Installment Payment
router.post(
  "/:id/installments",
  checkPermission("lado_bahin", "create") as any,
  validateRequest(addLadoBahinInstallmentSchema),
  controller.addInstallment.bind(controller)
);

export default router;
