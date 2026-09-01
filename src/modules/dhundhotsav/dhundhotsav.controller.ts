import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { DhundhotsavService } from "./dhundhotsav.service";

const dhundhotsavService = new DhundhotsavService();

export class DhundhotsavController {
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

      const result = await dhundhotsavService.createRegistration(
        req.body,
        addedById,
        actor
      );

      res.status(201).json({
        success: true,
        message: "Dhundhotsav registration created successfully",
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

      const result = await dhundhotsavService.getRegistrations(req.query, actor);
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

      const result = await dhundhotsavService.getRegistrationById(
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

      const result = await dhundhotsavService.updateRegistration(
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

      const result = await dhundhotsavService.softDeleteRegistration(
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

      const result = await dhundhotsavService.addInstallment(
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

      const result = await dhundhotsavService.verifyEPin(
        req.body.pinCode,
        actor
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
