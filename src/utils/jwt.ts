import jwt, { SignOptions } from "jsonwebtoken";

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET || "purabiya_access_secret";
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || "purabiya_refresh_secret";
const ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_EXPIRATION || "365d";
const REFRESH_TOKEN_EXPIRATION = process.env.JWT_REFRESH_EXPIRATION || "365d";
// The ERP (admin panel) should stay logged in for a long time; only the mobile
// app's (agent) session should time out on the shorter shared expiry. Admin
// tokens therefore use their own, long-lived expiry that ignores the shared
// JWT_ACCESS_EXPIRATION override.
const ADMIN_ACCESS_TOKEN_EXPIRATION =
  process.env.JWT_ADMIN_ACCESS_EXPIRATION || "365d";

export interface TokenPayload {
  userId: string;
  role: "ADMIN" | "AGENT";
}

export const generateAccessToken = (
  payload: TokenPayload,
  expiresIn?: string
): string => {
  const resolvedExpiry =
    expiresIn ??
    (payload.role === "ADMIN"
      ? ADMIN_ACCESS_TOKEN_EXPIRATION
      : ACCESS_TOKEN_EXPIRATION);
  const options: SignOptions = {
    expiresIn: resolvedExpiry as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, options);
};

export const generateRefreshToken = (payload: TokenPayload): string => {
  const options: SignOptions = {
    expiresIn: REFRESH_TOKEN_EXPIRATION as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, options);
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as TokenPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as TokenPayload;
};

// Customer-facing tokens (backend/src/modules/customer) are a separate
// payload shape from admin/agent TokenPayload above — a customer isn't a
// `User` row, they're a mobile number authenticated against CustomerAuth.
// Signed with the same access-token secret for operational consistency, but
// kept as a distinct type so a customer token can never be mistaken for an
// admin/agent one by verifyAccessToken's ADMIN|AGENT role check.
const CUSTOMER_ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_EXPIRATION || "30d";

export interface CustomerTokenPayload {
  customer_auth_id: string;
  application_id: string;
  mobile: string;
  type: "customer";
}

export const generateCustomerAccessToken = (payload: CustomerTokenPayload): string => {
  const options: SignOptions = { expiresIn: CUSTOMER_ACCESS_TOKEN_EXPIRATION as SignOptions["expiresIn"] };
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, options);
};

export const verifyCustomerAccessToken = (token: string): CustomerTokenPayload => {
  const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as CustomerTokenPayload;
  if (decoded.type !== "customer") {
    throw new Error("Not a customer token");
  }
  return decoded;
};
