import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SerializationFailureError } from "../../src/repositories/errors.js";
import { runSerializableTransaction } from "../../src/repositories/serializable.js";

/**
 * D-060's "no automatic retry" contract, isolated from any real Prisma
 * connection: a fake `PrismaClient` whose `$transaction` throws exactly
 * the error shape Prisma surfaces for a genuine Postgres serialization
 * failure (SQLSTATE 40001 -> `PrismaClientKnownRequestError` code
 * `P2034`). No live database has ever been reachable in this environment
 * (see docs/MASTER_PLAN.md "Current state"), so this is the closest
 * honest proof available: the MAPPING and the NO-RETRY behavior are both
 * real and tested; the underlying Postgres detection itself is not.
 */
function fakePrisma(onCall: () => Promise<unknown>): PrismaClient {
  return { $transaction: vi.fn(onCall) } as unknown as PrismaClient;
}

describe("runSerializableTransaction", () => {
  it("returns the callback's result on success, called exactly once", async () => {
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _options?: unknown) => fn({}));
    const prisma = { $transaction } as unknown as PrismaClient;

    const result = await runSerializableTransaction(prisma, async () => "ok");

    expect(result).toBe("ok");
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it("maps a P2034 serialization failure to SerializationFailureError, without retrying", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", { code: "P2034", clientVersion: "5.22.0" });
    const $transaction = vi.fn(async () => {
      throw conflict;
    });
    const prisma = { $transaction } as unknown as PrismaClient;

    await expect(runSerializableTransaction(prisma, async () => "unreachable")).rejects.toThrow(SerializationFailureError);
    // Exactly one attempt -- this file's own point: no automatic retry loop anywhere in this layer (docs/DECISIONS.md D-060).
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("propagates any OTHER error unchanged (not mapped to SerializationFailureError)", async () => {
    const other = new Error("some unrelated database error");
    const prisma = fakePrisma(async () => {
      throw other;
    });

    await expect(runSerializableTransaction(prisma, async () => "unreachable")).rejects.toBe(other);
  });
});
