import type { PrismaTransactionClient } from "../config/db";

/**
 * Serializes form-number/employee-ID generation against concurrent transactions
 * using the same lockKey, closing the read-then-write race that count()/max()-based
 * numbering has under concurrent requests. pg_advisory_xact_lock auto-releases at
 * commit/rollback, so this must be the first statement inside the SAME
 * prisma.$transaction that also reads the count/max and performs the create() —
 * calling it outside that transaction (or in a separate one) is a no-op.
 */
export async function lockFormNumberSequence(
  tx: PrismaTransactionClient,
  lockKey: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
}
