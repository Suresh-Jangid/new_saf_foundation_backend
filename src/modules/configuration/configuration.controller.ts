import { Request, Response, NextFunction } from "express";
import { ConfigurationService } from "./configuration.service";
import { EPinService } from "./epin.service";
import { AuthenticatedRequest } from "../../middlewares/auth";

const configService = new ConfigurationService();
const epinService = new EPinService();

export class ConfigurationController {
  // ── 1. APPLICATION CONFIG ─────────────────────────────
  public async getAppConfig(_req: Request, res: Response, next: NextFunction) {
    try {
      const config = await configService.getAppConfig();
      res.status(200).json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  }

  public async updateAppConfig(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const config = await configService.updateAppConfig(req.body);
      res.status(200).json({ success: true, message: "Application configuration updated", data: config });
    } catch (error) {
      next(error);
    }
  }

  // ── 2. MODULE REGISTRY ────────────────────────────────
  public async getModules(_req: Request, res: Response, next: NextFunction) {
    try {
      const modules = await configService.getModules();
      res.status(200).json({ success: true, data: modules });
    } catch (error) {
      next(error);
    }
  }

  public async setModuleStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { code } = req.params;
      const { isEnabled } = req.body;
      const updated = await configService.setModuleStatus(code, Boolean(isEnabled));
      res.status(200).json({ success: true, message: `Module status updated to ${updated.status}`, data: updated });
    } catch (error) {
      next(error);
    }
  }

  // ── 3. SCHEME MASTER ──────────────────────────────────
  public async getSchemes(_req: Request, res: Response, next: NextFunction) {
    try {
      const schemes = await configService.getSchemes();
      res.status(200).json({ success: true, data: schemes });
    } catch (error) {
      next(error);
    }
  }

  public async upsertScheme(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const scheme = await configService.upsertScheme(req.body);
      res.status(200).json({ success: true, message: "Scheme master saved", data: scheme });
    } catch (error) {
      next(error);
    }
  }

  // ── 4. SCHEME TYPES ───────────────────────────────────
  public async getSchemeTypes(_req: Request, res: Response, next: NextFunction) {
    try {
      const schemeTypes = await configService.getSchemeTypes();
      res.status(200).json({ success: true, data: schemeTypes });
    } catch (error) {
      next(error);
    }
  }

  public async upsertSchemeType(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const schemeType = await configService.upsertSchemeType(req.body);
      res.status(200).json({ success: true, message: "Scheme type saved", data: schemeType });
    } catch (error) {
      next(error);
    }
  }

  // ── 5. AGE SLABS ──────────────────────────────────────
  public async getAgeSlabs(req: Request, res: Response, next: NextFunction) {
    try {
      const schemeType = (req.query.schemeType as string) || "ALL";
      const slabs = await configService.getAllAgeSlabs(schemeType);
      res.status(200).json({ success: true, data: slabs });
    } catch (error) {
      next(error);
    }
  }

  public async resolveAgeSlab(req: Request, res: Response, next: NextFunction) {
    try {
      const age = Number(req.query.age);
      const schemeType = (req.query.schemeType as string) || "GENERAL";
      const resolved = await configService.resolveAgeSlab(age, schemeType);
      res.status(200).json({ success: true, data: resolved });
    } catch (error) {
      next(error);
    }
  }

  public async upsertAgeSlab(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const slab = await configService.upsertAgeSlab(req.body);
      res.status(200).json({ success: true, message: "Age slab saved", data: slab });
    } catch (error) {
      next(error);
    }
  }

  // ── 6. POOLS ──────────────────────────────────────────
  public async getPools(_req: Request, res: Response, next: NextFunction) {
    try {
      const pools = await configService.getPools();
      res.status(200).json({ success: true, data: pools });
    } catch (error) {
      next(error);
    }
  }

  // ── 7. DEDUCTIONS ─────────────────────────────────────
  public async getDeductions(req: Request, res: Response, next: NextFunction) {
    try {
      const scheme = req.query.scheme as string | undefined;
      const deduction = await configService.resolveAdministrativeDeduction(scheme);
      res.status(200).json({ success: true, data: deduction });
    } catch (error) {
      next(error);
    }
  }

  // ── 8. E-PIN STATE MACHINE ENDPOINTS ──────────────────
  public async generateEPins(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const adminId = req.user?.userId || "";
      const result = await epinService.generateEPins({
        ...req.body,
        generatedById: adminId,
      });
      res.status(201).json({ success: true, message: "E-PINs generated successfully", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async assignEPins(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const adminId = req.user?.userId || "";
      const result = await epinService.assignEPins({
        ...req.body,
        performedById: adminId,
      });
      res.status(200).json({ success: true, message: "E-PINs assigned successfully", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async useEPin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId || "";
      const result = await epinService.useEPin({
        ...req.body,
        usedById: userId,
      });
      res.status(200).json({ success: true, message: "E-PIN verified and consumed successfully", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async burnEPins(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const adminId = req.user?.userId || "";
      const result = await epinService.burnEPins({
        ...req.body,
        burntById: adminId,
      });
      res.status(200).json({ success: true, message: "E-PINs revoked/burnt successfully", data: result });
    } catch (error) {
      next(error);
    }
  }

  public async getEPinDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const { pinCode } = req.params;
      const result = await epinService.getEPinDetails(pinCode);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}
