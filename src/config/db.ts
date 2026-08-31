import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: ReturnType<typeof createPrismaClient> | undefined;
}

export const PRISMA_TX_OPTIONS = {
  maxWait: 15000,
  timeout: 30000,
} as const;

export function validateDatabaseEnvironment() {
  const appEnv = (process.env.APP_ENV || "").toLowerCase().trim();
  const nodeEnv = (process.env.NODE_ENV || "").toLowerCase().trim();
  const dbUrl = process.env.DATABASE_URL || "";

  // Fail-fast if staging environment is active but DATABASE_URL is missing
  if ((appEnv === "staging" || nodeEnv === "staging") && !dbUrl) {
    throw new Error(
      "Configuration Error: Staging environment requires a dedicated DATABASE_URL."
    );
  }

  // Fail-fast if staging receives a known production database identifier
  if (
    (appEnv === "staging" || nodeEnv === "staging") &&
    dbUrl.toLowerCase().includes("ep-cool-butterfly")
  ) {
    throw new Error(
      "Configuration Error: Production database target detected in staging environment. Aborting startup for safety."
    );
  }
}

function createPrismaClient() {
  validateDatabaseEnvironment();
  return new PrismaClient().$extends({
    query: {
      $allModels: {
        async delete({ model }) {
          throw new Error(
            `Hard delete is disabled on ${String(model)}. Use soft delete (deletedAt) instead.`
          );
        },
        async deleteMany({ model }) {
          throw new Error(
            `Hard delete is disabled on ${String(model)}. Use soft delete (deletedAt) instead.`
          );
        },
      },
    },
  });
}

export const prisma = globalThis.prisma ?? createPrismaClient();

// prisma.$extends(...) returns a client whose transaction callback type no longer
// structurally matches @prisma/client's plain Prisma.TransactionClient, so every
// function taking a `tx` param (e.g. for advisory-lock-guarded number generation)
// must be typed against this derived alias instead.
export type PrismaTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
