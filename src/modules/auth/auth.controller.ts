import { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";

const authService = new AuthService();

const REFRESH_COOKIE_NAME = "refreshToken";

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 Days in ms
});

export class AuthController {
  /**
   * Admin Login Controller
   */
  public async loginAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile, password } = req.body;
      const result = await authService.loginAdmin(mobile, password);

      // Set Refresh Token in secure HttpOnly Cookie
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());

      res.status(200).json({
        success: true,
        message: "Admin logged in successfully",
        data: {
          user: result.user,
          accessToken: result.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Agent Login Controller
   */
  public async loginAgent(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile, password } = req.body;
      const result = await authService.loginAgent(mobile, password);

      // Set Refresh Token in secure HttpOnly Cookie
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());

      res.status(200).json({
        success: true,
        message: "Agent logged in successfully",
        data: {
          agent: result.agent,
          accessToken: result.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Refresh Access & Session Token Controller
   */
  public async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      // Extract refresh token from cookie or request body
      const oldRefreshToken = req.cookies[REFRESH_COOKIE_NAME] || req.body.refreshToken;

      const result = await authService.rotateTokens(oldRefreshToken);

      // Reset new Refresh Token in Cookie
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getCookieOptions());

      res.status(200).json({
        success: true,
        message: "Session token refreshed successfully",
        data: {
          accessToken: result.accessToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout User Controller
   */
  public async logout(_req: Request, res: Response, next: NextFunction) {
    try {
      res.clearCookie(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      next(error);
    }
  }
}
