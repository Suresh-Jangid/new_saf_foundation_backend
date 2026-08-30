import { Router } from "express";
import { PaymentsController } from "./payments.controller";
import { authenticate, authorizeRoles } from "../../middlewares/auth";
import { checkPermission } from "../../middlewares/rbac";
import { validateRequest } from "../../middlewares/validation";
import {
  createPaymentSchema,
  createAgentPayoutSchema,
  createRazorpayOrderSchema,
  verifyRazorpayPaymentSchema,
} from "./payments.schema";

const router = Router();
const controller = new PaymentsController();

// All payment/financial routes require authentication
router.use(authenticate as any);

// ── CASH BOOK (CASH FLOWS) ──────────────────────────
router.post(
  "/",
  checkPermission("payment_management", "create") as any,
  validateRequest(createPaymentSchema),
  controller.createPayment.bind(controller)
);
router.get(
  "/",
  checkPermission("payment_management", "view") as any,
  controller.getAllPayments.bind(controller)
);

// ── AGENT COMMISSION MANAGEMENT ──────────────────────

// Fetch commission report metrics (Admin or authorized agent)
router.get(
  "/commission/report",
  checkPermission("payment_management", "view") as any,
  controller.getAgentCommissionReport.bind(controller)
);

// Pay Agent Commission (Admin only or high privilege)
router.post(
  "/commission/payout",
  authorizeRoles("ADMIN") as any,
  validateRequest(createAgentPayoutSchema),
  controller.payAgentCommission.bind(controller)
);

// ── ONLINE PAYMENTS (RAZORPAY GATEWAY) ────────────────

router.post(
  "/razorpay/create-order",
  validateRequest(createRazorpayOrderSchema),
  controller.createRazorpayOrder.bind(controller)
);

router.post(
  "/razorpay/verify-payment",
  validateRequest(verifyRazorpayPaymentSchema),
  controller.verifyRazorpayPayment.bind(controller)
);

export default router;
