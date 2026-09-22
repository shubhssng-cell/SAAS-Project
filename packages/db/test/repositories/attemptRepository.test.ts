import { finalizeAttempt, recordAttemptEvent, skipAttempt, startAttempt, submitAttempt, type AttemptQuestionContext, type AttemptState } from "@ipmat/attempt";
import { describe, expect, it } from "vitest";
import { InMemoryAttemptRepository } from "../fixtures/inMemoryRepositories.js";

/**
 * Phase 4B-1: proves the persistence boundary against `InMemoryAttemptRepository`
 * — the same interface `PrismaAttemptRepository` implements — since no live
 * database has ever been reachable in this environment (see docs/MASTER_PLAN.md
 * "Current state"). Every `AttemptState` used here is built via the REAL
 * `@ipmat/attempt` lifecycle functions, never a hand-constructed object
 * pretending to be one, except in the dedicated "invalid state" tests where
 * that is exactly the point (proving the repository's own defense-in-depth
 * checks, not just trusting the domain layer already caught it).
 */

const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();
const claim = { studentId: "student-1", questionId: "question-1" };

const question: AttemptQuestionContext = {
  questionId: "question-1",
  conceptId: "concept-percentages",
  answerFormat: "multiple_choice",
  options: ["420", "450", "480", "500"],
  correctAnswer: "480",
  expectedTimeSeconds: 90
};

function newRepo(): InMemoryAttemptRepository {
  return new InMemoryAttemptRepository();
}

describe("AttemptRepository — round-trip fidelity (Phase 4B-1)", () => {
  it("a submitted attempt persists and reconstructs a byte-for-byte faithful AttemptState", async () => {
    const repo = newRepo();
    let attempt = startAttempt({ id: "attempt-1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(0) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(5), selectedAnswer: "420" }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(10), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, question, { now: t(30) });

    const saved = await repo.save(attempt);
    expect(saved).toEqual(attempt);

    const found = await repo.findById("attempt-1");
    expect(found).toEqual(attempt);
    expect(found?.status).toBe("submitted");
    expect(found?.isCorrect).toBe(true);
    expect(found?.chosenAnswer).toBe("480");
    expect(found?.events.map((e) => e.type)).toEqual(["question_opened", "answer_selected", "answer_changed", "answer_submitted"]);
  });

  it("a skipped attempt persists and reconstructs with null chosenAnswer/isCorrect", async () => {
    const repo = newRepo();
    let attempt = startAttempt({ id: "attempt-2", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    attempt = skipAttempt(attempt, claim, { now: t(15) });

    await repo.save(attempt);
    const found = await repo.findById("attempt-2");
    expect(found).toEqual(attempt);
    expect(found?.status).toBe("skipped");
    expect(found?.chosenAnswer).toBeNull();
    expect(found?.isCorrect).toBeNull();
  });

  it("an abandoned attempt persists and reconstructs correctly", async () => {
    const repo = newRepo();
    let attempt = startAttempt({ id: "attempt-3", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    attempt = finalizeAttempt(attempt, claim, "abandoned", { now: t(600) });

    await repo.save(attempt);
    const found = await repo.findById("attempt-3");
    expect(found).toEqual(attempt);
    expect(found?.status).toBe("abandoned");
    expect(found?.timeSpentSeconds).toBe(600);
  });

  it("an in_progress attempt with hint/solution events persists and reconstructs the derived hintsUsed/solutionOpenedAt", async () => {
    const repo = newRepo();
    let attempt = startAttempt({ id: "attempt-4", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "hint_opened", occurredAt: t(5) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "hint_opened", occurredAt: t(10) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "solution_opened", occurredAt: t(20) }, claim);

    await repo.save(attempt);
    const found = await repo.findById("attempt-4");
    expect(found).toEqual(attempt);
    expect(found?.hintsUsed).toBe(2);
    expect(found?.solutionOpenedAt).toBe(t(20));
    expect(found?.status).toBe("in_progress");
  });

  it("findById returns null for an attempt that was never saved", async () => {
    const repo = newRepo();
    expect(await repo.findById("nonexistent")).toBeNull();
  });

  it("incremental saves: a later save with more events supersedes an earlier save, never losing prior events", async () => {
    const repo = newRepo();
    let attempt = startAttempt({ id: "attempt-5", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(attempt);

    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(5), selectedAnswer: "420" }, claim);
    await repo.save(attempt);

    attempt = submitAttempt(attempt, claim, question, { now: t(30) });
    const finalSaved = await repo.save(attempt);

    expect(finalSaved.events.map((e) => e.type)).toEqual(["answer_selected", "answer_submitted"]);
    const found = await repo.findById("attempt-5");
    expect(found?.events.length).toBe(2);
    expect(found?.status).toBe("submitted");
  });

  it("retryOfAttemptId round-trips when the referenced attempt already exists", async () => {
    const repo = newRepo();
    const original = startAttempt({ id: "attempt-original", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(skipAttempt(original, claim, { now: t(5) }));

    const retry = startAttempt({ id: "attempt-retry", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", retryOfAttemptId: "attempt-original", now: t(60) });
    await repo.save(retry);

    const found = await repo.findById("attempt-retry");
    expect(found?.retryOfAttemptId).toBe("attempt-original");
  });
});

describe("AttemptRepository — ownership/linkage enforcement at the persistence boundary (Phase 4B-1)", () => {
  it("rejects a save whose studentId/questionId/enrollmentId would change from what was already persisted", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-6", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(attempt);

    const tampered: AttemptState = { ...attempt, studentId: "student-2" };
    await expect(repo.save(tampered)).rejects.toThrow(/identity is immutable/);
  });

  it("rejects a save that changes enrollmentId between saves", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-7", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(attempt);

    const tampered: AttemptState = { ...attempt, enrollmentId: "enrollment-2" };
    await expect(repo.save(tampered)).rejects.toThrow(/identity is immutable/);
  });

  it("rejects a save that changes retryOfAttemptId from null to a value between saves (review finding: this was previously silently ignored, not rejected)", async () => {
    const repo = newRepo();
    const original = startAttempt({ id: "attempt-original-2", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(skipAttempt(original, claim, { now: t(5) }));

    const attempt = startAttempt({ id: "attempt-7b", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(attempt);

    const tampered: AttemptState = { ...attempt, retryOfAttemptId: "attempt-original-2" };
    await expect(repo.save(tampered)).rejects.toThrow(/identity is immutable/);
  });

  it("rejects a save that changes retryOfAttemptId from one attempt to a different one between saves", async () => {
    const repo = newRepo();
    const firstOriginal = startAttempt({ id: "attempt-original-a", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(skipAttempt(firstOriginal, claim, { now: t(5) }));
    const secondOriginal = startAttempt({ id: "attempt-original-b", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(10) });
    await repo.save(skipAttempt(secondOriginal, claim, { now: t(15) }));

    const retry = startAttempt({
      id: "attempt-7c",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      retryOfAttemptId: "attempt-original-a",
      now: t(20)
    });
    await repo.save(retry);

    const tampered: AttemptState = { ...retry, retryOfAttemptId: "attempt-original-b" };
    await expect(repo.save(tampered)).rejects.toThrow(/identity is immutable/);
  });

  it("rejects self-retry: an attempt whose retryOfAttemptId is its own id (it cannot exist yet at the moment the reference is checked)", async () => {
    const repo = newRepo();
    const selfRetrying = startAttempt({
      id: "attempt-self-retry",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      retryOfAttemptId: "attempt-self-retry",
      now: t(0)
    });
    await expect(repo.save(selfRetrying)).rejects.toThrow(/No Attempt found with id "attempt-self-retry"/);
  });

  it("rejects a save when a referenced Student/Question/Enrollment id is unknown (repository configured to check)", async () => {
    const repo = new InMemoryAttemptRepository({
      knownStudentIds: new Set(["student-1"]),
      knownQuestionIds: new Set(["question-1"]),
      knownEnrollmentIds: new Set(["enrollment-1"])
    });
    const attempt = startAttempt({ id: "attempt-8", studentId: "student-1", questionId: "question-1", enrollmentId: "enrollment-does-not-exist", now: t(0) });
    await expect(repo.save(attempt)).rejects.toThrow(/No Enrollment found/);
  });

  it("rejects a save whose retryOfAttemptId references a nonexistent attempt", async () => {
    const repo = newRepo();
    const attempt = startAttempt({
      id: "attempt-9",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      retryOfAttemptId: "attempt-does-not-exist",
      now: t(0)
    });
    await expect(repo.save(attempt)).rejects.toThrow(/No Attempt found with id "attempt-does-not-exist"/);
  });
});

describe("AttemptRepository — lifecycle/finalization invariants at the persistence boundary (Phase 4B-1)", () => {
  it("rejects re-persisting an already-finalized attempt under a DIFFERENT terminal status", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-10", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const submitted = submitAttempt(recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim), claim, question, { now: t(10) });
    await repo.save(submitted);

    const rewritten: AttemptState = { ...submitted, status: "skipped", submittedAt: null, chosenAnswer: null, isCorrect: null };
    await expect(repo.save(rewritten)).rejects.toThrow(/already finalized/);
  });

  it("allows an idempotent resave of the exact same terminal status", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-11", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const skipped = skipAttempt(attempt, claim, { now: t(5) });
    await repo.save(skipped);
    const resaved = await repo.save(skipped);
    expect(resaved).toEqual(skipped);
  });

  it("rejects a hand-tampered state claiming in_progress with a non-null chosenAnswer", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-12", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const tampered: AttemptState = { ...attempt, chosenAnswer: "480" };
    await expect(repo.save(tampered)).rejects.toThrow(/in_progress Attempt must have a null chosenAnswer/);
  });

  it("rejects a hand-tampered state claiming submitted with a null isCorrect", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-13", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const tampered: AttemptState = {
      ...attempt,
      status: "submitted",
      finalizedAt: t(10),
      submittedAt: t(10),
      timeSpentSeconds: 10,
      chosenAnswer: "480",
      isCorrect: null
    };
    await expect(repo.save(tampered)).rejects.toThrow(/must have a non-null isCorrect/);
  });

  it("rejects a hand-tampered state claiming skipped with a non-null chosenAnswer", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-14", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const tampered: AttemptState = { ...attempt, status: "skipped", finalizedAt: t(5), timeSpentSeconds: 5, chosenAnswer: "480" };
    await expect(repo.save(tampered)).rejects.toThrow(/must have a null chosenAnswer/);
  });

  it("rejects a hand-tampered state with a negative hintsUsed", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-15", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const tampered: AttemptState = { ...attempt, hintsUsed: -1 };
    await expect(repo.save(tampered)).rejects.toThrow(/hintsUsed must be a non-negative integer/);
  });

  it("rejects a state with an empty id/studentId/questionId/enrollmentId", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-16", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await expect(repo.save({ ...attempt, studentId: "" })).rejects.toThrow(/studentId/);
  });
});

describe("AttemptRepository — event ordering fidelity (Phase 4B-1)", () => {
  it("always persists and reconstructs events in canonical timeline order, even if the input array is out of order", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "attempt-17", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    // Deliberately hand-construct an out-of-order events array — something the real domain
    // functions could never produce (they enforce monotonic timestamps on append), but the
    // repository must not simply trust the array's given order regardless.
    const outOfOrder: AttemptState = {
      ...attempt,
      events: [
        { type: "hint_opened", occurredAt: t(20), payload: null },
        { type: "question_opened", occurredAt: t(0), payload: null },
        { type: "answer_selected", occurredAt: t(10), payload: { selectedAnswer: "480" } }
      ]
    };

    await repo.save(outOfOrder);
    const found = await repo.findById("attempt-17");
    expect(found?.events.map((e) => e.type)).toEqual(["question_opened", "answer_selected", "hint_opened"]);
  });
});
