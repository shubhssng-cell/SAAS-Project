import { Prisma, type PrismaClient } from "@prisma/client";
import { SerializationFailureError } from "./errors.js";

/**
 * Runs `fn` inside a Prisma interactive transaction at `Serializable`
 * isolation, mapping a genuine Postgres serialization failure (SQLSTATE
 * 40001 — surfaced by Prisma as `PrismaClientKnownRequestError` code
 * `P2034`, "Transaction failed due to a write conflict") to ONE named,
 * deterministic `SerializationFailureError`. Deliberately does NOT retry —
 * the caller owns that decision (docs/DECISIONS.md D-060, grounded in
 * D-049's `decidePublication()` Serializable-isolation precedent, which
 * established "isolation prevents the anomaly" without ever adding a retry
 * loop). Any other error propagates unchanged.
 */
export async function runSerializableTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new SerializationFailureError(
        "Concurrent write conflict detected under Serializable isolation (Postgres SQLSTATE 40001) — the caller must retry the whole operation; no automatic retry happens here (docs/DECISIONS.md D-060)."
      );
    }
    throw error;
  }
}
