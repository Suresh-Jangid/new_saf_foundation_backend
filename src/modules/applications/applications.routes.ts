import { Router } from "express";
import { ApplicationsController } from "./applications.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createGeneralApplicationSchema,
  updateGeneralApplicationSchema,
  createInstallmentSchema,
  createInsuranceApplicationSchema,
  updateInsuranceApplicationSchema,
  createSurakshaBimaSchema,
} from "./applications.schema";

const router = Router();
const controller = new ApplicationsController();

// Authentication required for all application routes
router.use(authenticate as any);

// ── GENERAL APPLICATION ROUTES ──────────────────────────

// List General Applications
router.get(
  "/general",
  checkPermission("applicant_registration", "view") as any,
  controller.getAllGeneralApplications.bind(controller)
);

// Get General Application details
router.get(
  "/general/:id",
  checkPermission("applicant_registration", "view") as any,
  controller.getGeneralApplicationById.bind(controller)
);

// Create General Application
router.post(
  "/general",
  checkPermission("applicant_registration", "create") as any,
  validateRequest(createGeneralApplicationSchema),
  controller.createGeneralApplication.bind(controller)
);

// Bulk Import General Applications
router.post(
  "/general/bulk-import",
  checkPermission("applicant_registration", "create") as any,
  controller.bulkImportGeneralApplications.bind(controller)
);


// Update General Application details
router.put(
  "/general/:id",
  checkPermission("applicant_registration", "update") as any,
  validateRequest(updateGeneralApplicationSchema),
  controller.updateGeneralApplication.bind(controller)
);

// Delete General Application
router.delete(
  "/general/:id",
  checkPermission("applicant_registration", "delete") as any,
  controller.softDeleteGeneralApplication.bind(controller)
);

// Record general installment payment
router.post(
  "/general/:id/installments",
  checkPermission("general_application_payment", "create") as any,
  validateRequest(createInstallmentSchema),
  controller.addGeneralInstallment.bind(controller)
);

// ── INSURANCE APPLICATION & SURAKSHA BIMA ROUTES ────────────────

// List Insurance Applications
router.get(
  "/insurance",
  checkPermission("security_application", "view") as any,
  controller.getAllInsuranceApplications.bind(controller)
);

// Get Insurance Application details
router.get(
  "/insurance/:id",
  checkPermission("security_application", "view") as any,
  controller.getInsuranceApplicationById.bind(controller)
);

// Create Insurance Application
router.post(
  "/insurance",
  checkPermission("security_application", "create") as any,
  validateRequest(createInsuranceApplicationSchema),
  controller.createInsuranceApplication.bind(controller)
);

// Update Insurance Application details
router.put(
  "/insurance/:id",
  checkPermission("security_application", "update") as any,
  validateRequest(updateInsuranceApplicationSchema),
  controller.updateInsuranceApplication.bind(controller)
);

// Delete Insurance Application
router.delete(
  "/insurance/:id",
  checkPermission("security_application", "delete") as any,
  controller.softDeleteInsuranceApplication.bind(controller)
);

// Record insurance installment payment
router.post(
  "/insurance/:id/installments",
  checkPermission("insurance_application_payment", "create") as any,
  validateRequest(createInstallmentSchema),
  controller.addInsuranceInstallment.bind(controller)
);

// Bind Suraksha Bima Yojana details to Insurance Application
router.post(
  "/insurance/:id/suraksha-bima",
  checkPermission("suraksha_bima_yojana", "create") as any,
  validateRequest(createSurakshaBimaSchema),
  controller.createSurakshaBima.bind(controller)
);

// ── BULK SURAKSHA BIMA YOJANA ENDPOINTS ──────────────
router.get(
  "/insurance/bulk/data",
  checkPermission("bulk_suraksha_bima_emi", "view") as any,
  controller.getInsuranceBulkData.bind(controller)
);

router.post(
  "/insurance/bulk/payments",
  checkPermission("bulk_suraksha_bima_emi", "update") as any,
  controller.updateBimaPaymentStatus.bind(controller)
);

router.post(
  "/insurance/bulk/pdf-status",
  checkPermission("bulk_suraksha_bima_emi", "update") as any,
  controller.updateInsurancePdfStatus.bind(controller)
);

export default router;
