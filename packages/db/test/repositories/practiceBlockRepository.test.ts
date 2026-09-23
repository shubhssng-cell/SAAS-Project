import { PracticeBlockLifecycleError } from "@ipmat/practice-block";
import { describe, expect, it } from "vitest";
import { InMemoryPracticeBlockReader, InMemoryPracticeBlockRepository } from "../../src/repositories/inMemoryPracticeBlockRepository.js";
import { PersistenceError } from "../../src/repositories/errors.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:30:00.000Z";

describe("PracticeBlockRepository (InMemory)", () => {
  it("creates a block under an active session with sequenceNumber 1", async () => {
    const repo = new InMemoryPracticeBlockRepository({ isSessionActive: () => true });
    const block = await repo.create({ id: "b1", practiceSessionId: "s1", now: T0 });
    expect(block).toEqual({
      id: "b1",
      practiceSessionId: "s1",
      sequenceNumber: 1,
      status: "active",
      startedAt: T0,
      endedAt: null,
      targetQuestionCount: null,
      blockTimeBudgetSeconds: null
    });
  });

  it("rejects creation under a terminal session", async () => {
    const repo = new InMemoryPracticeBlockRepository({ isSessionActive: () => false });
    await expect(repo.create({ id: "b1", practiceSessionId: "s1", now: T0 })).rejects.toThrow(PracticeBlockLifecycleError);
    try {
      await repo.create({ id: "b1", practiceSessionId: "s1", now: T0 });
    } catch (error) {
      expect((error as PracticeBlockLifecycleError).code).toBe("session_not_active");
    }
  });

  it("rejects creation for an unresolvable practiceSessionId when knownPracticeSessionIds is supplied", async () => {
    const repo = new InMemoryPracticeBlockRepository({ knownPracticeSessionIds: new Set(["s1"]), isSessionActive: () => true });
    await expect(repo.create({ id: "b1", practiceSessionId: "does-not-exist", now: T0 })).rejects.toThrow(PersistenceError);
  });

  it("sequence numbers increment per session, independently across different sessions", async () => {
    const repo = new InMemoryPracticeBlockRepository({ isSessionActive: () => true });
    const b1 = await repo.create({ id: "b1", practiceSessionId: "s1", now: T0 });
    const b2 = await repo.create({ id: "b2", practiceSessionId: "s1", now: T0 });
    const b3 = await repo.create({ id: "b3", practiceSessionId: "s2", now: T0 });
    expect(b1.sequenceNumber).toBe(1);
    expect(b2.sequenceNumber).toBe(2);
    expect(b3.sequenceNumber).toBe(1); // a different session -- its own independent sequence
  });

  it("findBySessionId returns blocks ordered by sequenceNumber", async () => {
    const repo = new InMemoryPracticeBlockRepository({ isSessionActive: () => true });
    await repo.create({ id: "b1", practiceSessionId: "s1", now: T0 });
    await repo.create({ id: "b2", practiceSessionId: "s1", now: T0 });
    const blocks = await repo.findBySessionId("s1");
    expect(blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("completes and abandons blocks", async () => {
    const repo = new InMemoryPracticeBlockRepository({ isSessionActive: () => true });
    await repo.create({ id: "b1", practiceSessionId: "s1", now: T0 });
    const completed = await repo.complete("b1", { now: T1 });
    expect(completed.status).toBe("completed");

    await repo.create({ id: "b2", practiceSessionId: "s1", now: T0 });
    const abandoned = await repo.abandon("b2", { now: T1 });
    expect(abandoned.status).toBe("abandoned");
  });

  it("rejects completing/abandoning an already-terminal block", async () => {
    const repo = new InMemoryPracticeBlockRepository({ isSessionActive: () => true });
    await repo.create({ id: "b1", practiceSessionId: "s1", now: T0 });
    await repo.complete("b1", { now: T1 });
    await expect(repo.complete("b1", { now: T1 })).rejects.toThrow(PracticeBlockLifecycleError);
  });

  it("PracticeBlockReader (via InMemoryPracticeBlockReader) exposes id/status/enrollmentId/studentId, for a fast ownership pre-check", async () => {
    const repo = new InMemoryPracticeBlockRepository({
      isSessionActive: () => true,
      resolveSessionOwnership: (sessionId) => (sessionId === "s1" ? { enrollmentId: "e1", studentId: "student-1" } : undefined)
    });
    const reader = new InMemoryPracticeBlockReader(repo);
    await repo.create({ id: "b1", practiceSessionId: "s1", now: T0 });

    expect(await reader.findById("b1")).toEqual({ id: "b1", status: "active", enrollmentId: "e1", studentId: "student-1" });
    expect(await reader.findById("nope")).toBeNull();

    await repo.complete("b1", { now: T1 });
    expect(await reader.findById("b1")).toEqual({ id: "b1", status: "completed", enrollmentId: "e1", studentId: "student-1" });
  });

  it("PracticeBlockReader resolves enrollmentId/studentId as empty strings when resolveSessionOwnership is not configured (tests that don't care about ownership)", async () => {
    const repo = new InMemoryPracticeBlockRepository({ isSessionActive: () => true });
    const reader = new InMemoryPracticeBlockReader(repo);
    await repo.create({ id: "b1", practiceSessionId: "s1", now: T0 });

    expect(await reader.findById("b1")).toEqual({ id: "b1", status: "active", enrollmentId: "", studentId: "" });
  });
});
