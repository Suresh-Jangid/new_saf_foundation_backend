import { Router } from "express";
import { SchemesController } from "./schemes.controller";
import { authenticate } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createLoanSchema,
  createLoanInstallmentSchema,
  createFinancialHelpSchema,
  createDisabilityCycleSchema,
  createMarriageCongratsSchema,
  createMarriageCongratsPaymentSchema,
  createMarriageSewingMachineSchema,
  createPensionSchema,
  createPensionPaymentSchema,
  createSewingCampSchema,
} from "./schemes.schema";

const router = Router();
const controller = new SchemesController();

// All scheme routes require authentication
router.use(authenticate as any);

// ── LOANS ──────────────────────────────────────────
router.post(
  "/loans",
  checkPermission("applicant_registration", "create") as any,
  validateRequest(createLoanSchema),
  controller.createLoan.bind(controller)
);
router.get(
  "/loans",
  checkPermission("applicant_registration", "view") as any,
  controller.getAllLoans.bind(controller)
);
router.get(
  "/loans/:id",
  checkPermission("applicant_registration", "view") as any,
  controller.getLoanById.bind(controller)
);
router.post(
  "/loans/:id/installments",
  checkPermission("applicant_registration", "create") as any,
  validateRequest(createLoanInstallmentSchema),
  controller.addLoanInstallment.bind(controller)
);

// ── FINANCIAL HELP (DAN RASHI) ──────────────────────
router.post(
  "/financial-help",
  checkPermission("payment_management", "create") as any,
  validateRequest(createFinancialHelpSchema),
  controller.createFinancialHelp.bind(controller)
);
router.get(
  "/financial-help",
  checkPermission("payment_management", "view") as any,
  controller.getAllFinancialHelps.bind(controller)
);

// ── DISABILITY CYCLE ──────────────────────────────
router.post(
  "/disability-cycles",
  checkPermission("applicant_registration", "create") as any,
  validateRequest(createDisabilityCycleSchema),
  controller.createDisabilityCycle.bind(controller)
);
router.get(
  "/disability-cycles",
  checkPermission("applicant_registration", "view") as any,
  controller.getAllDisabilityCycles.bind(controller)
);

// ── MARRIAGE CONGRATULATIONS & SEWING ────────────────
router.post(
  "/marriage-congratulations",
  checkPermission("marriage_congratulations_payment", "create") as any,
  validateRequest(createMarriageCongratsSchema),
  controller.createMarriageCongratulations.bind(controller)
);
router.get(
  "/marriage-congratulations",
  checkPermission("marriage_congratulations_payment", "view") as any,
  controller.getAllMarriageCongratulations.bind(controller)
);
router.get(
  "/marriage-congratulations/:id",
  checkPermission("marriage_congratulations_payment", "view") as any,
  controller.getMarriageCongratulationsById.bind(controller)
);
router.post(
  "/marriage-congratulations/:id/payments",
  checkPermission("marriage_congratulations_payment", "create") as any,
  validateRequest(createMarriageCongratsPaymentSchema),
  controller.addMarriageCongratulationsPayment.bind(controller)
);
router.post(
  "/marriage-congratulations/:id/sewing-machines",
  checkPermission("marriage_congratulations_payment", "create") as any,
  validateRequest(createMarriageSewingMachineSchema),
  controller.addMarriageSewingMachine.bind(controller)
);
router.get(
  "/marriage-congratulations/:id/members",
  checkPermission("marriage_congratulations_payment", "view") as any,
  controller.getMarriageCongratulationsMembers.bind(controller)
);
router.get(
  "/marriage-congratulations/:id/payments",
  checkPermission("marriage_congratulations_payment", "view") as any,
  controller.getMarriageCongratulationsPayments.bind(controller)
);
router.delete(
  "/marriage-congratulations/payments/:paymentId",
  checkPermission("marriage_congratulations_payment", "delete") as any,
  controller.deleteMarriageCongratulationsPayment.bind(controller)
);

// ── PENSION YOJANA ─────────────────────────────────
router.post(
  "/pension",
  checkPermission("payment_management", "create") as any,
  validateRequest(createPensionSchema),
  controller.createPensionYojana.bind(controller)
);
router.get(
  "/pension",
  checkPermission("payment_management", "view") as any,
  controller.getAllPensionYojanas.bind(controller)
);
router.get(
  "/pension/:id",
  checkPermission("payment_management", "view") as any,
  controller.getPensionYojanaById.bind(controller)
);
router.post(
  "/pension/:id/payments",
  checkPermission("payment_management", "create") as any,
  validateRequest(createPensionPaymentSchema),
  controller.addPensionPayment.bind(controller)
);

// ── SEWING MACHINE CAMPS ──────────────────────────
router.post(
  "/sewing-camps",
  checkPermission("applicant_registration", "create") as any,
  validateRequest(createSewingCampSchema),
  controller.createSewingMachineCamp.bind(controller)
);
router.get(
  "/sewing-camps",
  checkPermission("applicant_registration", "view") as any,
  controller.getAllSewingMachineCamps.bind(controller)
);

// ── MARRIAGE CONGRATULATIONS BULK & DETAILS ───────
router.get(
  "/marriage-congratulations/:id/details",
  checkPermission("marriage_congratulations_payment", "view") as any,
  controller.getMarriageCongratulationsDetails.bind(controller)
);

router.get(
  "/marriage-congratulations/bulk/data",
  checkPermission("marriage_congratulations_payment", "view") as any,
  controller.getMarriageCongratulationsBulkData.bind(controller)
);

router.post(
  "/marriage-congratulations/bulk/payments",
  checkPermission("marriage_congratulations_payment", "create") as any,
  controller.updateMarriageCongratulationsBulkPayments.bind(controller)
);

router.post(
  "/marriage-congratulations/bulk/pdf-status",
  checkPermission("marriage_congratulations_payment", "create") as any,
  controller.updateMarriageCongratulationsPdfStatus.bind(controller)
);

export default router;
