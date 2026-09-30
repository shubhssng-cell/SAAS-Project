import { startAttempt } from "@ipmat/attempt";
import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { InMemoryAttemptRepository } from "../../src/repositories/inMemoryAttemptRepository.js";
import { PersistenceError } from "../../src/repositories/errors.js";
import { PrismaAttemptRepository } from "../../src/repositories/prismaAttemptRepository.js";

/**
 * Product Phase 2 Unit 7 -- the "one open attempt per student/question/enrollment" guarantee (migration
 * 0010) and how the repositories report it. The REAL database behavior is proven by
 * apps/api/test/prismaPersistence.integration.test.ts (needs IPMAT_TEST_DATABASE_URL); this file covers
 * the mapping logic and the in-memory mirror WITHOUT a database.
 */

const at = (s: number) => new Date(Date.parse("2026-09-30T10:00:00.000Z") + s * 1000).toISOString();
const mk = (id: string, s = 0, over: Record<string, string> = {}) => startAttempt({ id, studentId: "s1", questionId: "q1", enrollmentId: "e1", now: at(s), ...over });

describe("InMemoryAttemptRepository -- enforceSingleOpenAttempt mirrors the database index", () => {
  it("off by default: two open attempts for the same key are allowed (pre-Unit-7 behavior)", async () => {
    const repo = new InMemoryAttemptRepository();
    await repo.save(mk("a"));
    await expect(repo.save(mk("b", 1))).resolves.toBeDefined();
  });

  it("on: a second open attempt for the same student+question+enrollment is a typed conflict and writes nothing", async () => {
    const repo = new InMemoryAttemptRepository({ enforceSingleOpenAttempt: true });
    await repo.save(mk("a"));
    await expect(repo.save(mk("b", 1))).rejects.toMatchObject({ name: "PersistenceError", code: "conflict" });
    expect(await repo.findById("b")).toBeNull();
  });

  it("on: other students / questions / enrollments are unaffected, and finalized attempts do not block a new open one", async () => {
    const repo = new InMemoryAttemptRepository({ enforceSingleOpenAttempt: true });
    await repo.save(mk("a"));
    await expect(repo.save(mk("other-student", 1, { studentId: "s2" }))).resolves.toBeDefined();
    await expect(repo.save(mk("other-question", 1, { questionId: "q2" }))).resolves.toBeDefined();
    await expect(repo.save(mk("other-enrollment", 1, { enrollmentId: "e2" }))).resolves.toBeDefined();
    await repo.save({ ...mk("a"), status: "abandoned", finalizedAt: at(5), timeSpentSeconds: 5 });
    await expect(repo.save(mk("again", 9))).resolves.toBeDefined();
  });

  it("on: updating the SAME open attempt (e.g. recording events) is not a conflict", async () => {
    const repo = new InMemoryAttemptRepository({ enforceSingleOpenAttempt: true });
    const a = mk("a");
    await repo.save(a);
    await expect(repo.save(a)).resolves.toBeDefined();
  });
});

describe("PrismaAttemptRepository.save -- unique violation is a typed conflict (fake client; NOT a live database)", () => {
  it("maps P2002 from the transaction to PersistenceError conflict, without leaking driver detail", async () => {
    const violation = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`student_id`,`question_id`,`enrollment_id`)", { code: "P2002", clientVersion: "test" });
    const prisma = {
      $transaction: async () => {
        throw violation;
      }
    } as unknown as PrismaClient;
    const error = await new PrismaAttemptRepository(prisma).save(mk("a")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PersistenceError);
    expect((error as PersistenceError).code).toBe("conflict");
    expect((error as Error).message).not.toMatch(/student_id|P2002/);
  });

  it("any other database error propagates unchanged (never disguised as a conflict)", async () => {
    const other = new Prisma.PrismaClientKnownRequestError("boom", { code: "P2003", clientVersion: "test" });
    const prisma = {
      $transaction: async () => {
        throw other;
      }
    } as unknown as PrismaClient;
    await expect(new PrismaAttemptRepository(prisma).save(mk("a"))).rejects.toBe(other);
  });
});

describe("createPrismaClient", () => {
  it("requires an explicit, non-empty URL (never relies on implicit .env discovery)", () => {
    expect(() => createPrismaClient("")).toThrow(/non-empty/);
    expect(() => createPrismaClient("   ")).toThrow(/non-empty/);
    expect(() => createPrismaClient(undefined as unknown as string)).toThrow(/non-empty/);
  });
});
