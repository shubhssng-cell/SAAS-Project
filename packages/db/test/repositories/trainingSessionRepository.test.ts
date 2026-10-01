import { describe, expect, it } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { InMemoryTrainingSessionRepository } from "../../src/repositories/inMemoryTrainingSessionRepository.js";

const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:05:00.000Z";
const OWNERS: Record<string, string> = { e1: "s1", e2: "s2" };

function repo() {
  return new InMemoryTrainingSessionRepository({ resolveStudentId: async (enrollmentId) => OWNERS[enrollmentId] ?? null });
}

let n = 0;
function input(enrollmentId: string, overrides: Record<string, unknown> = {}) {
  n += 1;
  return {
    id: `ts-${n}`,
    practiceSessionId: `ps-${n}`,
    practiceBlockId: `pb-${n}`,
    enrollmentId,
    systemId: "novelty-training",
    objective: { statement: "x" },
    config: { completion: { kind: "fixed_question_count", questionCount: 3 } },
    blockSettings: { targetQuestionCount: 3, blockTimeBudgetSeconds: null },
    now: T0,
    ...overrides
  };
}

describe("TrainingSessionRepository (in-memory double of the Prisma implementation)", () => {
  it("creates a session layered on a real active PracticeSession + PracticeBlock, with ownership resolved through the chain", async () => {
    const r = repo();
    const created = await r.create(input("e1"));
    expect(created).toMatchObject({ systemId: "novelty-training", enrollmentId: "e1", studentId: "s1", block: { status: "active", sequenceNumber: 1, targetQuestionCount: 3, blockTimeBudgetSeconds: null, endedAt: null } });
    expect((await r.practiceSessions.findActiveByEnrollmentId("e1"))?.id).toBe(created.block.practiceSessionId);
    expect(await r.findById(created.id)).toEqual(created);
  });

  it("reuses the enrollment's single active practice session for the next block", async () => {
    const r = repo();
    const first = await r.create(input("e1"));
    await r.complete(first.id, { now: T1 });
    const second = await r.create(input("e1"));
    expect(second.block.practiceSessionId).toBe(first.block.practiceSessionId);
    expect(second.block.sequenceNumber).toBe(2);
  });

  it("refuses a second ACTIVE training session for the same enrollment (conflict) and an unknown enrollment (missing_reference)", async () => {
    const r = repo();
    await r.create(input("e1"));
    await expect(r.create(input("e1"))).rejects.toMatchObject({ code: "conflict" });
    await expect(r.create(input("nope"))).rejects.toMatchObject({ code: "missing_reference" });
    await expect(r.create(input("e2"))).resolves.toBeTruthy(); // another enrollment is independent
  });

  it("concurrent creates for one enrollment produce exactly one session", async () => {
    const r = repo();
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => r.create(input("e1"))));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    for (const failed of results.filter((x) => x.status === "rejected")) expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(PersistenceError);
  });

  it("findActiveByEnrollmentId sees only that enrollment's active session", async () => {
    const r = repo();
    const a = await r.create(input("e1"));
    expect((await r.findActiveByEnrollmentId("e1"))?.id).toBe(a.id);
    expect(await r.findActiveByEnrollmentId("e2")).toBeNull();
    await r.complete(a.id, { now: T1 });
    expect(await r.findActiveByEnrollmentId("e1")).toBeNull();
  });

  it("complete and abandon are final: the block's own lifecycle refuses any second transition", async () => {
    const r = repo();
    const a = await r.create(input("e1"));
    const done = await r.complete(a.id, { now: T1 });
    expect(done.block).toMatchObject({ status: "completed", endedAt: T1 });
    await expect(r.complete(a.id, { now: T1 })).rejects.toMatchObject({ code: "already_finalized" });
    await expect(r.abandon(a.id, { now: T1 })).rejects.toMatchObject({ code: "already_finalized" });
    expect(r.blockOwnership.get(a.block.id)?.status).toBe("completed"); // the shared live view the attempt repository consults
  });

  it("an unknown session id is a missing_reference, never a guess", async () => {
    await expect(repo().complete("nope", { now: T1 })).rejects.toMatchObject({ code: "missing_reference" });
    expect(await repo().findById("nope")).toBeNull();
  });
});
