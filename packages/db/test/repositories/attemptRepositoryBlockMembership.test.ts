import { startAttempt, type AttemptState } from "@ipmat/attempt";
import { PracticeBlockLifecycleError } from "@ipmat/practice-block";
import { describe, expect, it } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { InMemoryAttemptRepository } from "../../src/repositories/inMemoryAttemptRepository.js";

/**
 * D-060's `AttemptRepository.save(state, blockAllocationRequest?)` extension
 * — proved against `InMemoryAttemptRepository`, the same interface
 * `PrismaAttemptRepository` implements, since no live database has ever
 * been reachable in this environment (see docs/MASTER_PLAN.md "Current
 * state"). Every `AttemptState` here is built via the real `startAttempt()`
 * (which always sets `blockMembership: null`) — `blockAllocationRequest`
 * is the ONLY way a non-null value is ever produced.
 */

const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();
const claim = { studentId: "student-1", questionId: "question-1" };

type PracticeBlockFixtureRecord = { status: "active" | "completed" | "abandoned"; enrollmentId: string; studentId: string };

function newRepo(practiceBlocks?: Map<string, PracticeBlockFixtureRecord>): InMemoryAttemptRepository {
  return new InMemoryAttemptRepository({ practiceBlocks });
}

describe("AttemptRepository.save() — block membership allocation (D-060)", () => {
  it("allocates blockSequenceNumber 1, 2, 3... in creation order for the same block", async () => {
    const repo = newRepo();
    const a1 = startAttempt({ id: "a1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const a2 = startAttempt({ id: "a2", studentId: claim.studentId, questionId: "question-2", enrollmentId: "enrollment-1", now: t(10) });
    const a3 = startAttempt({ id: "a3", studentId: claim.studentId, questionId: "question-3", enrollmentId: "enrollment-1", now: t(20) });

    const saved1 = await repo.save(a1, { practiceBlockId: "block-1" });
    const saved2 = await repo.save(a2, { practiceBlockId: "block-1" });
    const saved3 = await repo.save(a3, { practiceBlockId: "block-1" });

    expect(saved1.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 1 });
    expect(saved2.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 2 });
    expect(saved3.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 3 });
  });

  it("allocates independent sequences per block", async () => {
    const repo = newRepo();
    const a1 = startAttempt({ id: "a1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const a2 = startAttempt({ id: "a2", studentId: claim.studentId, questionId: "question-2", enrollmentId: "enrollment-1", now: t(10) });

    const saved1 = await repo.save(a1, { practiceBlockId: "block-1" });
    const saved2 = await repo.save(a2, { practiceBlockId: "block-2" });

    expect(saved1.blockMembership?.blockSequenceNumber).toBe(1);
    expect(saved2.blockMembership?.blockSequenceNumber).toBe(1);
  });

  it("an ordinary attempt (no blockAllocationRequest) keeps blockMembership null — regression", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "a1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const saved = await repo.save(attempt);
    expect(saved.blockMembership).toBeNull();
  });

  it("rejects allocation against a non-active block", async () => {
    const repo = newRepo(new Map([["block-1", { status: "completed", enrollmentId: "enrollment-1", studentId: claim.studentId }]]));
    const attempt = startAttempt({ id: "a1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await expect(repo.save(attempt, { practiceBlockId: "block-1" })).rejects.toThrow(PracticeBlockLifecycleError);
  });

  it("rejects allocation against an unresolvable block when practiceBlocks is supplied", async () => {
    const repo = newRepo(new Map());
    const attempt = startAttempt({ id: "a1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await expect(repo.save(attempt, { practiceBlockId: "does-not-exist" })).rejects.toThrow(PersistenceError);
  });

  it("a retry inherits its retried attempt's practiceBlockId — matching block accepted", async () => {
    const repo = newRepo();
    const original = startAttempt({ id: "original", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(original, { practiceBlockId: "block-1" });

    const retry = startAttempt({
      id: "retry",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      retryOfAttemptId: "original",
      now: t(60)
    });
    const savedRetry = await repo.save(retry, { practiceBlockId: "block-1" });
    expect(savedRetry.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 2 });
  });

  it("a retry targeting a DIFFERENT block than its original is rejected", async () => {
    const repo = newRepo();
    const original = startAttempt({ id: "original", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(original, { practiceBlockId: "block-1" });

    const retry = startAttempt({
      id: "retry",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      retryOfAttemptId: "original",
      now: t(60)
    });
    await expect(repo.save(retry, { practiceBlockId: "block-2" })).rejects.toThrow(PersistenceError);
  });

  it("a retry of a BLOCK attempt saved as an ORDINARY (no-block) attempt is rejected", async () => {
    const repo = newRepo();
    const original = startAttempt({ id: "original", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(original, { practiceBlockId: "block-1" });

    const retry = startAttempt({
      id: "retry",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      retryOfAttemptId: "original",
      now: t(60)
    });
    await expect(repo.save(retry)).rejects.toThrow(PersistenceError);
  });

  it("a retry of an ORDINARY attempt saved WITH a block is rejected (inheritance is symmetric)", async () => {
    const repo = newRepo();
    const original = startAttempt({ id: "original", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(original);

    const retry = startAttempt({
      id: "retry",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      retryOfAttemptId: "original",
      now: t(60)
    });
    await expect(repo.save(retry, { practiceBlockId: "block-1" })).rejects.toThrow(PersistenceError);
  });

  it("rejects a hand-constructed AttemptState with a pre-populated blockMembership but no blockAllocationRequest", async () => {
    const repo = newRepo();
    const attempt: AttemptState = {
      ...startAttempt({ id: "a1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) }),
      blockMembership: { practiceBlockId: "block-1", blockSequenceNumber: 1 }
    };
    await expect(repo.save(attempt)).rejects.toThrow(PersistenceError);
  });

  it("block membership is immutable: a second save() cannot pass blockAllocationRequest for an already-existing attempt", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "a1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    await repo.save(attempt); // ordinary, no block

    await expect(repo.save(attempt, { practiceBlockId: "block-1" })).rejects.toThrow(PersistenceError);
  });

  it("block membership is preserved unchanged across an ordinary re-save (e.g. recordEvent/submit)", async () => {
    const repo = newRepo();
    const attempt = startAttempt({ id: "a1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    const saved = await repo.save(attempt, { practiceBlockId: "block-1" });

    // Simulate a later lifecycle call: load, mutate something unrelated (here just re-save the identical state), save again without blockAllocationRequest.
    const resaved = await repo.save(saved);
    expect(resaved.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 1 });
  });
});

/**
 * D-060 SECURITY FIX: `AttemptRepository.save()`'s AUTHORITATIVE ownership
 * check — re-derived from scratch, inside the same allocation path, from
 * the block's OWN resolved `{enrollmentId, studentId}` (mirroring the real
 * `PracticeBlock -> PracticeSession -> Enrollment -> Student` join
 * `PrismaAttemptRepository` performs), never trusting the caller's
 * `state.enrollmentId`/`state.studentId` claim. Test F is the single most
 * important test in this file: it proves this repository-layer check is
 * NOT dependent on `PracticeBlockReader`'s own fast pre-check ever having
 * run — the persistence transaction is the final authority, exactly as the
 * fix required.
 */
describe("AttemptRepository.save() — authoritative block ownership verification (D-060 security fix)", () => {
  const OWNING_ENROLLMENT = "enrollment-owner";
  const OWNING_STUDENT = "student-owner";
  const blockOwnedByOwner = new Map<string, PracticeBlockFixtureRecord>([
    ["block-1", { status: "active", enrollmentId: OWNING_ENROLLMENT, studentId: OWNING_STUDENT }]
  ]);

  it("A. matching student + matching enrollment -> block-scoped attempt succeeds", async () => {
    const repo = newRepo(blockOwnedByOwner);
    const attempt = startAttempt({ id: "a1", studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(0) });
    const saved = await repo.save(attempt, { practiceBlockId: "block-1" });
    expect(saved.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 1 });
  });

  it("B. wrong student + matching enrollment -> rejected", async () => {
    const repo = newRepo(blockOwnedByOwner);
    const attempt = startAttempt({ id: "a1", studentId: "student-attacker", questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(0) });
    await expect(repo.save(attempt, { practiceBlockId: "block-1" })).rejects.toThrow(PersistenceError);
    try {
      await repo.save(attempt, { practiceBlockId: "block-1" });
    } catch (error) {
      expect((error as PersistenceError).code).toBe("ownership_mismatch");
    }
  });

  it("C. matching student + wrong enrollment -> rejected", async () => {
    const repo = newRepo(blockOwnedByOwner);
    const attempt = startAttempt({ id: "a1", studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: "enrollment-attacker", now: t(0) });
    await expect(repo.save(attempt, { practiceBlockId: "block-1" })).rejects.toThrow(PersistenceError);
    try {
      await repo.save(attempt, { practiceBlockId: "block-1" });
    } catch (error) {
      expect((error as PersistenceError).code).toBe("ownership_mismatch");
    }
  });

  it("D. wrong student + wrong enrollment -> rejected", async () => {
    const repo = newRepo(blockOwnedByOwner);
    const attempt = startAttempt({ id: "a1", studentId: "student-attacker", questionId: "question-1", enrollmentId: "enrollment-attacker", now: t(0) });
    await expect(repo.save(attempt, { practiceBlockId: "block-1" })).rejects.toThrow(PersistenceError);
    try {
      await repo.save(attempt, { practiceBlockId: "block-1" });
    } catch (error) {
      expect((error as PersistenceError).code).toBe("ownership_mismatch");
    }
  });

  it("F. authoritative save() rejects an ownership mismatch EVEN IF no fast pre-check ever ran (repository called directly)", async () => {
    // No PracticeBlockReader, no PracticeLoopService anywhere in this test -- proves the persistence
    // transaction itself is the final authority, not merely a defense-in-depth backing up a pre-check
    // that a future HTTP/API caller could bypass or never call at all.
    const repo = newRepo(blockOwnedByOwner);
    const attackerAttempt = startAttempt({
      id: "attacker-attempt",
      studentId: "student-attacker",
      questionId: "question-1",
      enrollmentId: "enrollment-attacker",
      now: t(0)
    });
    await expect(repo.save(attackerAttempt, { practiceBlockId: "block-1" })).rejects.toThrow(PersistenceError);
    // And the block's own sequence is untouched by the rejected attempt -- no partial allocation leaked through.
    const legitimateAttempt = startAttempt({ id: "legit-attempt", studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(1) });
    const saved = await repo.save(legitimateAttempt, { practiceBlockId: "block-1" });
    expect(saved.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 1 });
  });

  it("G. retry inheritance still works for a correctly-owned block", async () => {
    const repo = newRepo(blockOwnedByOwner);
    const original = startAttempt({ id: "original", studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(0) });
    await repo.save(original, { practiceBlockId: "block-1" });

    const retry = startAttempt({
      id: "retry",
      studentId: OWNING_STUDENT,
      questionId: "question-1",
      enrollmentId: OWNING_ENROLLMENT,
      retryOfAttemptId: "original",
      now: t(60)
    });
    const savedRetry = await repo.save(retry, { practiceBlockId: "block-1" });
    expect(savedRetry.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 2 });
  });

  it("H. an ordinary, ungrouped attempt (no blockAllocationRequest) is entirely unaffected by ownership verification", async () => {
    const repo = newRepo(blockOwnedByOwner);
    const attempt = startAttempt({ id: "a1", studentId: "student-anyone", questionId: "question-1", enrollmentId: "enrollment-anyone", now: t(0) });
    const saved = await repo.save(attempt);
    expect(saved.blockMembership).toBeNull();
  });
});
