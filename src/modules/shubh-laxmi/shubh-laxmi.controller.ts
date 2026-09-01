import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { ShubhLaxmiService } from "./shubh-laxmi.service";

const shubhLaxmiService = new ShubhLaxmiService();

export class ShubhLaxmiController {
  public async createRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const addedById = req.user!.userId;
      const actor = {
        userId: req.user!.userId,
        role: req.user!.role as "ADMIN" | "AGENT",
      };

      const result = await shubhLaxmiService.createRegistration(
        req.body,
        addedById,
        actor
      );

      res.status(201).json({
        success: true,
        message: "ShubhLaxmi registration created successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  public async getAllRegistrations(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actor = {
        userId: req.user!.userId,
        role: req.user!.role as "ADMIN" | "AGENT",
      };

      const result = await shubhLaxmiService.getRegistrations(req.query, actor);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async getRegistrationById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actor = {
        userId: req.user!.userId,
        role: req.user!.role as "ADMIN" | "AGENT",
      };

      const result = await shubhLaxmiService.getRegistrationById(
        req.params.id,
        actor
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async updateRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actor = {
        userId: req.user!.userId,
        role: req.user!.role as "ADMIN" | "AGENT",
      };

      const result = await shubhLaxmiService.updateRegistration(
        req.params.id,
        req.body,
        actor
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async softDeleteRegistration(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actor = {
        userId: req.user!.userId,
        role: req.user!.role as "ADMIN" | "AGENT",
      };

      const result = await shubhLaxmiService.softDeleteRegistration(
        req.params.id,
        actor
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async addInstallment(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actor = {
        userId: req.user!.userId,
        role: req.user!.role as "ADMIN" | "AGENT",
      };

      const result = await shubhLaxmiService.addInstallment(
        req.params.id,
        req.body,
        actor
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async verifyEPin(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const actor = {
        userId: req.user!.userId,
        role: req.user!.role as "ADMIN" | "AGENT",
      };

      const result = await shubhLaxmiService.verifyEPin(
        req.body.pinCode,
        actor
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
