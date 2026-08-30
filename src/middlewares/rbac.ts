import { Response, NextFunction } from "express";
import { prisma } from "../config/db";
import { AuthenticatedRequest } from "./auth";
import { ForbiddenError } from "../utils/errors";

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

      // Query database for agent permission record
      const permission = await prisma.agentPermission.findUnique({
        where: {
          userId_module: {
            userId: agentId,
            module: module,
          },
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
