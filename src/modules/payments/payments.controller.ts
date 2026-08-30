import { Request, Response, NextFunction } from "express";
import { PaymentsService } from "./payments.service";
import { AuthenticatedRequest } from "../../middlewares/auth";

const service = new PaymentsService();

export class PaymentsController {
  
  // ── CASH BOOK FLOW ──────────────────────────────────

  public async createPayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const addedById = req.user?.userId || "";
      const result = await service.createPayment(req.body, addedById);
      res.status(201).json({
        success: true,
        message: "Payment entry created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async getAllPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await service.getAllPayments(req.query);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── AGENT COMMISSION REPORTS ───────────────────────

  public async getAgentCommissionReport(req: Request, res: Response, next: NextFunction) {
    try {
      // Expecting query parameters: agentId, startDate, endDate
      const { agentId, startDate, endDate } = req.query;
      
      if (!agentId || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "agentId, startDate, and endDate are required query parameters",
        });
      }

      const result = await service.getAgentCommissionReport(
        agentId as string,
        new Date(startDate as string),
        new Date(endDate as string)
      );

      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  public async payAgentCommission(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Expecting body: agentId, amount, startDate, endDate
      const { agentId, amount, startDate, endDate } = req.body;
      const adminId = req.user?.userId || "";

      if (!agentId || !amount || !startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "agentId, amount, startDate, and endDate are required body properties",
        });
      }

      const result = await service.payAgentCommission(
        agentId,
        Number(amount),
        new Date(startDate),
        new Date(endDate),
        adminId
      );

      return res.status(201).json({
        success: true,
        message: "Agent commission payment processed successfully",
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  }

  // ── RAZORPAY GATEWAY ───────────────────────────────

  public async createRazorpayOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { amount, receipt } = req.body;
      const order = await service.createRazorpayOrder(amount, receipt);
      
      res.status(201).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  }

  public async verifyRazorpayPayment(req: Request, res: Response, next: NextFunction) {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
      const result = await service.verifyRazorpayPayment(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
