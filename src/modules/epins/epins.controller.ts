import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../middlewares/auth";
import { EpinsService } from "./epins.service";
import { UnauthorizedError } from "../../utils/errors";

const epinsService = new EpinsService();

export class EpinsController {
  /**
   * 1. GET /api/v1/epins - Inventory with summary counts
   */
  public async getInventory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }
      const result = await epinsService.getInventory(req.query as any, req.user);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * 2. POST /api/v1/epins/generate - Batch generation (Admin only)
   */
  public async generateEPins(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }
      const result = await epinsService.generateEPins({
        ...req.body,
        generatedById: req.user.userId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * 3. POST /api/v1/epins/assign - Assign to Agent (Admin only)
   */
  public async assignEPins(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }
      const result = await epinsService.assignEPins({
        ...req.body,
        performedById: req.user.userId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * 4. POST /api/v1/epins/validate - Validate PIN status & access without mutation
   */
  public async validateEPin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }
      const result = await epinsService.validateEPin(req.body, req.user);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * 5. POST /api/v1/epins/consume - Atomically consume E-PIN
   */
  public async consumeEPin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }
      const result = await epinsService.consumeEPin(req.body, req.user);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * 6. POST /api/v1/epins/burn - Irreversibly burn/revoke E-PIN (Admin only)
   */
  public async burnEPin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }
      const result = await epinsService.burnEPin(req.body, req.user);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * 7. GET /api/v1/epins/audit - Chronological audit history
   */
  public async getAuditHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }
      const result = await epinsService.getAuditHistory(req.query as any, req.user);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }
}
