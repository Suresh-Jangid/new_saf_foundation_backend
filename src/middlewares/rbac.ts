import { Response, NextFunction } from "express";
import { prisma } from "../config/db";
import { AuthenticatedRequest } from "./auth";
import { ForbiddenError } from "../utils/errors";
import { getModuleWithAliases } from "../config/permissions";

export const checkPermission = (
  module: string,
  action: "view" | "create" | "update" | "delete"
) => {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized: User info not found in request",
        });
      }

      // Admins bypass all module permission checks
      if (req.user.role === "ADMIN") {
        return next();
      }

      const agentId = req.user.userId;
      const allModuleKeys = getModuleWithAliases(module);

      // Query database for agent permission record across canonical and alias keys
      const permission = await prisma.agentPermission.findFirst({
        where: {
          userId: agentId,
          module: { in: allModuleKeys },
          OR: [
            { canView: true },
            { canCreate: true },
            { canUpdate: true },
            { canDelete: true },
          ],
        },
      });

      if (!permission) {
        throw new ForbiddenError(
          `Access Denied: You do not have permissions configured for module: ${module}`
        );
      }

      let hasAccess = false;
      switch (action) {
        case "view":
          hasAccess = permission.canView;
          break;
        case "create":
          hasAccess = permission.canCreate;
          break;
        case "update":
          hasAccess = permission.canUpdate;
          break;
        case "delete":
          hasAccess = permission.canDelete;
          break;
        default:
          hasAccess = false;
      }

      if (!hasAccess) {
        throw new ForbiddenError(
          `Access Denied: You do not have '${action}' permission for module: ${module}`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
