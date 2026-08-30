import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { UnauthorizedError } from "../utils/errors";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    role: "ADMIN" | "AGENT";
  };
}
export const authenticate = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    let token = "";

    // 1. Check Authorization Header (Bearer Token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    // 2. Check Cookie (Fallback)
    if (!token && req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw new UnauthorizedError("Authentication token is missing");
    }

    // Verify token
    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
      return next();
    } catch (err) {
      throw new UnauthorizedError("Invalid or expired access token");
    }
  } catch (error) {
    return next(error);
  }
};

// Middleware to authorize specific role(s)
export const authorizeRoles = (...roles: Array<"ADMIN" | "AGENT">) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not have permission to perform this action",
      });
    }
    return next();
  };
};
