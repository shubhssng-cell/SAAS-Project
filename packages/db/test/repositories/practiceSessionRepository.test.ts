import { PracticeSessionLifecycleError } from "@ipmat/practice-session";
import { describe, expect, it } from "vitest";
import { InMemoryPracticeBlockRepository } from "../../src/repositories/inMemoryPracticeBlockRepository.js";
import { InMemoryPracticeSessionRepository } from "../../src/repositories/inMemoryPracticeSessionRepository.js";
import { PersistenceError } from "../../src/repositories/errors.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:30:00.000Z";

describe("PracticeSessionRepository (InMemory)", () => {
  it("creates and finds a session", async () => {
    const repo = new InMemoryPracticeSessionRepository();
    const created = await repo.create({ id: "s1", enrollmentId: "e1", now: T0 });
    expect(created).toEqual({ id: "s1", enrollmentId: "e1", status: "active", startedAt: T0, endedAt: null, sessionTimeBudgetSeconds: null });
    expect(await repo.findById("s1")).toEqual(created);
  });

  it("findById returns null for an unknown id", async () => {
    const repo = new InMemoryPracticeSessionRepository();
    expect(await repo.findById("nope")).toBeNull();
  });

  it("rejects creation for an unresolvable enrollmentId when knownEnrollmentIds is supplied", async () => {
    const repo = new InMemoryPracticeSessionRepository({ knownEnrollmentIds: new Set(["e1"]) });
    await expect(repo.create({ id: "s1", enrollmentId: "does-not-exist", now: T0 })).rejects.toThrow(PersistenceError);
  });

  it("completes a session with no blocks", async () => {
    const repo = new InMemoryPracticeSessionRepository();
    await repo.create({ id: "s1", enrollmentId: "e1", now: T0 });
    const completed = await repo.complete("s1", { now: T1 });
    expect(completed.status).toBe("completed");
    expect(completed.endedAt).toBe(T1);
  });

  it("abandons a session with no blocks", async () => {
    const repo = new InMemoryPracticeSessionRepository();
    await repo.create({ id: "s1", enrollmentId: "e1", now: T0 });
    const abandoned = await repo.abandon("s1", { now: T1 });
    expect(abandoned.status).toBe("abandoned");
  });

  it("completion re-checks against the LIVE block store: rejected while a shared block is active, succeeds once it is completed", async () => {
    const blocks = new InMemoryPracticeBlockRepository({ isSessionActive: () => true });
    const sessions = new InMemoryPracticeSessionRepository({ blockRepository: blocks });

    await sessions.create({ id: "s1", enrollmentId: "e1", now: T0 });
    await blocks.create({ id: "b1", practiceSessionId: "s1", now: T0 });

    await expect(sessions.complete("s1", { now: T1 })).rejects.toThrow(PracticeSessionLifecycleError);
    try {
      await sessions.complete("s1", { now: T1 });
    } catch (error) {
      expect((error as PracticeSessionLifecycleError).code).toBe("has_active_block");
    }

    await blocks.complete("b1", { now: T1 });
    const completed = await sessions.complete("s1", { now: T1 });
    expect(completed.status).toBe("completed");
  });

  it("rejects completing/abandoning an already-terminal session", async () => {
    const repo = new InMemoryPracticeSessionRepository();
    await repo.create({ id: "s1", enrollmentId: "e1", now: T0 });
    await repo.complete("s1", { now: T1 });
    await expect(repo.complete("s1", { now: T1 })).rejects.toThrow(PracticeSessionLifecycleError);
    await expect(repo.abandon("s1", { now: T1 })).rejects.toThrow(PracticeSessionLifecycleError);
  });

  it("throws session_not_found for an unknown session id", async () => {
    const repo = new InMemoryPracticeSessionRepository();
    await expect(repo.complete("nope", { now: T1 })).rejects.toThrow(PracticeSessionLifecycleError);
  });
});
