/**
 * Serializable transaction helper with retry on serialization failure.
 *
 * Postgres SERIALIZABLE isolation can abort a transaction with SQLSTATE 40001
 * ("could not serialize access due to concurrent update") when concurrent
 * snapshots conflict. The contract of SERIALIZABLE is that the application
 * MUST retry such failures — the database guarantees that, on retry, the
 * conflicting transaction will have committed and become visible.
 *
 * Use for write paths where READ COMMITTED would let two concurrent callers
 * both miss each other's pending insert (e.g. idempotency windows on
 * renewal/comp). For simple compare-and-swap (e.g. cheque status flip),
 * prefer an atomic updateMany — cheaper and doesn't need this helper.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export async function withSerializableRetry<T>(
  fn: (tx: TxClient) => Promise<T>,
  opts: { maxAttempts?: number; timeoutMs?: number; maxWaitMs?: number } = {}
): Promise<T> {
  const max = opts.maxAttempts ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: opts.maxWaitMs ?? 5_000,
        timeout: opts.timeoutMs ?? 15_000,
      });
    } catch (err) {
      lastErr = err;
      if (!isSerializationFailure(err) || attempt === max - 1) throw err;
      // Exponential backoff: 25ms, 50ms, 100ms
      await new Promise((r) => setTimeout(r, 25 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

function isSerializationFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // Prisma surfaces Postgres errors via PrismaClientKnownRequestError with meta.code
  // OR via PrismaClientUnknownRequestError preserving the raw message.
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  if (e.code === "40001" || e.meta?.code === "40001") return true;
  if (typeof e.message === "string") {
    return /could not serialize access|serialization failure|deadlock detected/i.test(
      e.message
    );
  }
  return false;
}
