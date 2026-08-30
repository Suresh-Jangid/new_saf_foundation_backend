import bcrypt from "bcryptjs";
import { prisma } from "../../config/db";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import { UnauthorizedError, BadRequestError } from "../../utils/errors";

export class AuthService {
  /**
   * Login Admin User
   */
  public async loginAdmin(mobile: string, passwordPlain: string) {
    const user = await prisma.user.findFirst({
      where: { mobile, deletedAt: null },
    });

    if (!user || user.role !== "ADMIN" || user.deletedAt) {
      throw new UnauthorizedError("Invalid mobile number or password");
    }

    if (!user.isActive) {
      throw new UnauthorizedError("Account is inactive. Please contact the administrator.");
    }

    // Verify Password
    const isPasswordMatch = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isPasswordMatch) {
      throw new UnauthorizedError("Invalid mobile number or password");
    }

    // Generate Tokens
    const accessToken = generateAccessToken({ userId: user.id, role: "ADMIN" });
    const refreshToken = generateRefreshToken({ userId: user.id, role: "ADMIN" });

    // Remove sensitive data
    const { passwordHash: _, ...safeUser } = user;

    return {
      user: safeUser,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Login Agent User
   */
  public async loginAgent(mobile: string, passwordPlain: string) {
    const user = await prisma.user.findFirst({
      where: { mobile, deletedAt: null },
      include: {
        agentProfile: true,
        permissions: true,
      },
    });

    if (!user || user.role !== "AGENT" || user.deletedAt) {
      throw new UnauthorizedError("Invalid mobile number or password");
    }

    if (!user.isActive) {
      throw new UnauthorizedError("Your agent account is deactivated. Please contact support.");
    }

    // Verify Password
    const isPasswordMatch = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isPasswordMatch) {
      throw new UnauthorizedError("Invalid mobile number or password");
    }

    // Generate Tokens
    const accessToken = generateAccessToken({ userId: user.id, role: "AGENT" });
    const refreshToken = generateRefreshToken({ userId: user.id, role: "AGENT" });

    // Format agent data to mimic existing frontend expect structure
    const formattedPermissions: Record<string, string[]> = {};
    user.permissions.forEach((permission) => {
      const actions: string[] = [];
      if (permission.canView) actions.push("view");
      if (permission.canCreate) actions.push("create");
      if (permission.canUpdate) actions.push("update");
      if (permission.canDelete) actions.push("delete");
      formattedPermissions[permission.module] = actions;
    });

    const agentData = {
      id: user.id,
      name: user.name,
      mobile: user.mobile,
      email: user.email,
      employeeId: user.agentProfile?.employeeId || "",
      permissions: formattedPermissions,
      profile: user.agentProfile,
    };

    return {
      agent: agentData,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refresh Access & Refresh Tokens
   */
  public async rotateTokens(oldRefreshToken: string) {
    if (!oldRefreshToken) {
      throw new BadRequestError("Refresh token is required");
    }

    try {
      const decoded = verifyRefreshToken(oldRefreshToken);
      
      // Check user exists and is active
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || !user.isActive || user.deletedAt) {
        throw new UnauthorizedError("User session is invalid or inactive");
      }

      // Generate new tokens
      const accessToken = generateAccessToken({ userId: user.id, role: user.role });
      const refreshToken = generateRefreshToken({ userId: user.id, role: user.role });

      return {
        accessToken,
        refreshToken,
      };
    } catch (err) {
      throw new UnauthorizedError("Invalid or expired session. Please log in again.");
    }
  }
}
