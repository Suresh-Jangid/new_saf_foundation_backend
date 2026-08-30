import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: ReturnType<typeof createPrismaClient> | undefined;
}

export const PRISMA_TX_OPTIONS = {
  maxWait: 15000,
  timeout: 30000,
} as const;

function createPrismaClient() {
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
