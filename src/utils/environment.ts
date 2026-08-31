/**
 * Canonical Environment & Health Metadata Resolver
 * Ensures deterministic, safe environment identification without exposing secrets.
 */

export interface EnvironmentMetadata {
  environment: string;
  isStaging: boolean;
  isProduction: boolean;
}

export interface HealthResponsePayload extends EnvironmentMetadata {
  status: "healthy";
  timestamp: string;
  uptime: number;
}

/**
 * Resolves safe environment status based on APP_ENV and NODE_ENV signals.
 * Rules:
 * - Staging: Explicit APP_ENV/NODE_ENV === "staging" or "test"
 * - Production: Explicit APP_ENV/NODE_ENV === "production" (and not staging)
 * - Development: Default fallback when unconfigured or development
 */
export function resolveEnvironmentMetadata(
  appEnv = process.env.APP_ENV,
  nodeEnv = process.env.NODE_ENV
): EnvironmentMetadata {
  const normAppEnv = (appEnv || "").toLowerCase().trim();
  const normNodeEnv = (nodeEnv || "").toLowerCase().trim();

  // 1. Explicit staging / test signal
  if (normAppEnv === "staging" || normAppEnv === "test" || normNodeEnv === "staging" || normNodeEnv === "test") {
    return {
      environment: normAppEnv === "test" || normNodeEnv === "test" ? "test" : "staging",
      isStaging: true,
      isProduction: false,
    };
  }

  // 2. Explicit production signal
  if (normAppEnv === "production" || normNodeEnv === "production") {
    return {
      environment: "production",
      isStaging: false,
      isProduction: true,
    };
  }

  // 3. Safe fallback (development or custom non-production)
  const fallback = normAppEnv || normNodeEnv || "development";
  return {
    environment: fallback,
    isStaging: false,
    isProduction: false,
  };
}

/**
 * Constructs the canonical public health payload.
 * Strictly omits all secrets, credentials, tokens, and connection strings.
 */
export function getHealthPayload(
  appEnv = process.env.APP_ENV,
  nodeEnv = process.env.NODE_ENV
): HealthResponsePayload {
  const envMeta = resolveEnvironmentMetadata(appEnv, nodeEnv);
  return {
    status: "healthy",
    ...envMeta,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
}
