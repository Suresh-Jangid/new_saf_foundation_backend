import { Request, Response, NextFunction } from "express";
import { ConfigurationService } from "./configuration.service";
import { ForbiddenError } from "../../utils/errors";

const configService = new ConfigurationService();

/**
 * Express middleware to enforce that a module is currently active in the Module Registry.
 * If disabled, blocks the request with HTTP 403 and a descriptive error message.
 */
export function requireModuleEnabled(moduleCode: string) {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      const isEnabled = await configService.isModuleEnabled(moduleCode);
      if (!isEnabled) {
        throw new ForbiddenError(
          `Module '${moduleCode.toUpperCase()}' is currently disabled/decommissioned in SAF Foundation configuration.`
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
