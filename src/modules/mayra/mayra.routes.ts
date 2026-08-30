import { Router } from "express";
import { MayraController } from "./mayra.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createMayraRegistrationSchema,
  createMayraCongratsSchema,
  createMayraCongratsPaymentSchema,
} from "./mayra.schema";
import { createInstallmentSchema } from "../applications/applications.schema";

const router = Router();
const controller = new MayraController();

// Authentication required for all Mayra routes
router.use(authenticate as any);

// List Mayra Registrations
router.get(
  "/",
  checkPermission("mayra_registration", "view") as any,
  controller.getAllMayraRegistrations.bind(controller)
);

// Get single Mayra registration details
router.get(
  "/:id",
  checkPermission("mayra_registration", "view") as any,
  controller.getMayraRegistrationById.bind(controller)
);

// Create Mayra Registration
router.post(
  "/",
  checkPermission("mayra_registration", "create") as any,
  validateRequest(createMayraRegistrationSchema),
  controller.createMayraRegistration.bind(controller)
);

// Update Mayra Registration details
router.put(
  "/:id",
  checkPermission("mayra_registration", "update") as any,
  controller.updateMayraRegistration.bind(controller)
);

// Soft Delete Mayra Registration
router.delete(
  "/:id",
  checkPermission("mayra_registration", "delete") as any,
  controller.softDeleteMayraRegistration.bind(controller)
);

// Add installment payment to Mayra registration
router.post(
  "/:id/installments",
  checkPermission("mayra_registration", "create") as any,
  validateRequest(createInstallmentSchema),
  controller.addMayraInstallment.bind(controller)
);

// Bind congratulations details to Mayra Registration
router.post(
  "/:id/congratulations",
  checkPermission("mayra_registration", "create") as any,
  validateRequest(createMayraCongratsSchema),
  controller.createMayraCongratulations.bind(controller)
);

// Add payout payment to Congratulations record
router.post(
  "/congratulations/:id/payments",
  checkPermission("mayra_registration", "create") as any,
  validateRequest(createMayraCongratsPaymentSchema),
  controller.addMayraCongratulationsPayment.bind(controller)
);

// Get members list for Mayra Congratulations
router.get(
  "/:id/members",
  checkPermission("mayra_registration", "view") as any,
  controller.getMayraCongratulationsMembers.bind(controller)
);

// Get payments list for Mayra Congratulations
router.get(
  "/:id/payments",
  checkPermission("mayra_registration", "view") as any,
  controller.getMayraCongratulationsPayments.bind(controller)
);

// Delete payment for Mayra Congratulations
router.delete(
  "/congratulations/payments/:paymentId",
  checkPermission("mayra_registration", "delete") as any,
  controller.deleteMayraCongratulationsPayment.bind(controller)
);

// Get congratulations details for a registration (includes active member count & total EMI calculation)
router.get(
  "/:id/congratulations/details",
  checkPermission("mayra_registration", "view") as any,
  controller.getMayraCongratulationsDetails.bind(controller)
);

// Get bulk congratulations list for payment mapping
router.get(
  "/bulk/data",
  checkPermission("mayra_registration", "view") as any,
  controller.getMayraBulkData.bind(controller)
);

// Process bulk payments for Mayra congratulations
router.post(
  "/bulk/payments",
  checkPermission("mayra_registration", "create") as any,
  controller.updateMayraBulkPayments.bind(controller)
);

// Update PDF status for Mayra congratulations
router.post(
  "/bulk/pdf-status",
  checkPermission("mayra_registration", "create") as any,
  controller.updateMayraPdfStatus.bind(controller)
);

export default router;
