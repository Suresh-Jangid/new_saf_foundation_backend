import { Router } from "express";
import { JanniDeliveryController } from "./janni-delivery.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createJanniDeliverySchema,
  updateJanniDeliverySchema,
  addJanniInstallmentSchema,
} from "./janni-delivery.validation";

const router = Router();
const controller = new JanniDeliveryController();

// Authentication required for all Janni Delivery endpoints
router.use(authenticate as any);

// 1. List Registrations
router.get(
  "/",
  checkPermission("janni_delivery", "view") as any,
  controller.getAllRegistrations.bind(controller)
);

// 2. Verify E-PIN
router.post(
  "/verify-epin",
  checkPermission("janni_delivery", "view") as any,
  controller.verifyEPin.bind(controller)
);

// 3. Get Single Registration
router.get(
  "/:id",
  checkPermission("janni_delivery", "view") as any,
  controller.getRegistrationById.bind(controller)
);

// 4. Create Registration
router.post(
  "/",
  checkPermission("janni_delivery", "create") as any,
  validateRequest(createJanniDeliverySchema),
  controller.createRegistration.bind(controller)
);

// 5. Update Registration
router.put(
  "/:id",
  checkPermission("janni_delivery", "update") as any,
  validateRequest(updateJanniDeliverySchema),
  controller.updateRegistration.bind(controller)
);

// 6. Soft Delete Registration
router.delete(
  "/:id",
  checkPermission("janni_delivery", "delete") as any,
  controller.softDeleteRegistration.bind(controller)
);

// 7. Add Installment Payment
router.post(
  "/:id/installments",
  checkPermission("janni_delivery", "create") as any,
  validateRequest(addJanniInstallmentSchema),
  controller.addInstallment.bind(controller)
);

export default router;
