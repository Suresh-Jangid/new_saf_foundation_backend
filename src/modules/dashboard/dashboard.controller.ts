import { Response, NextFunction } from "express";
import { DashboardService } from "./dashboard.service";
import { AuthenticatedRequest } from "../../middlewares/auth";

const dashboardService = new DashboardService();

export class DashboardController {
  public async getCounts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const dashboard = await dashboardService.getCounts({
        userId: req.user?.userId,
        role: req.user?.role,
      });

      res.status(200).json({
        success: true,
        status: true,
        error: false,
        dashboard,
      });
    } catch (error) {
      next(error);
    }
  }
}
