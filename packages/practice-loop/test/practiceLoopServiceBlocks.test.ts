import { InMemoryAttemptRepository, InMemoryPracticeBlockReader, InMemoryPracticeBlockRepository, InMemoryQuestionReader, type CanonicalQuestion } from "@ipmat/db";
import { describe, expect, it } from "vitest";
import { PracticeLoopService } from "../src/practiceLoopService.js";
import { PracticeLoopError } from "../src/types.js";

/**
 * D-060: `PracticeLoopService.startAttempt({ practiceBlockId })`'s fast,
 * non-transactional ownership pre-check, and its handoff to
 * `AttemptRepository.save()`'s authoritative allocation. TEST-ONLY fixture
 * content — see `practiceLoopService.test.ts`'s own header for why.
 */
const publishedQuestion: CanonicalQuestion = {
  id: "question-1",
  conceptId: "concept-percentages",
  options: ["420", "450", "480", "500"],
  correctAnswer: "480",
  expectedTimeSeconds: 90,
  validationState: "published"
};

const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

const OWNING_ENROLLMENT = "enrollment-owner";
const OWNING_STUDENT = "student-owner";

/**
 * `session-1`'s real ownership chain (`PracticeSession -> Enrollment ->
 * Student`) — every `PracticeBlock` created under `session-1` in this file
 * resolves to `{ OWNING_ENROLLMENT, OWNING_STUDENT }` via
 * `resolveSessionOwnership`, the SAME structure `PrismaPracticeBlockReader`
 * resolves from a real join (docs/DECISIONS.md D-060 security-fix
 * addendum).
 */
function newService(): {
  service: PracticeLoopService;
  repository: InMemoryAttemptRepository;
  blockRepository: InMemoryPracticeBlockRepository;
} {
  const repository = new InMemoryAttemptRepository();
  const questionReader = new InMemoryQuestionReader([publishedQuestion]);
  const blockRepository = new InMemoryPracticeBlockRepository({
    isSessionActive: () => true,
    resolveSessionOwnership: (sessionId) => (sessionId === "session-1" ? { enrollmentId: OWNING_ENROLLMENT, studentId: OWNING_STUDENT } : undefined)
  });
  const blockReader = new InMemoryPracticeBlockReader(blockRepository);
  return { service: new PracticeLoopService(repository, questionReader, blockReader), repository, blockRepository };
}

describe("PracticeLoopService.startAttempt() — practiceBlockId (D-060)", () => {
  it("H. starting an attempt with no practiceBlockId is unaffected -- blockMembership stays null (ordinary, ungrouped practice regression)", async () => {
    const { service } = newService();
    const attempt = await service.startAttempt({ studentId: "student-1", questionId: "question-1", enrollmentId: "enrollment-1", now: t(0), id: "a1" });
    expect(attempt.blockMembership).toBeNull();
  });

  it("A. matching student + matching enrollment -> starting an attempt with a valid, active, correctly-owned practiceBlockId allocates real block membership", async () => {
    const { service, blockRepository } = newService();
    await blockRepository.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });

    const attempt = await service.startAttempt({
      studentId: OWNING_STUDENT,
      questionId: "question-1",
      enrollmentId: OWNING_ENROLLMENT,
      now: t(1),
      id: "a1",
      practiceBlockId: "block-1"
    });

    expect(attempt.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 1 });
  });

  it("two attempts started in the same, correctly-owned block get sequential blockSequenceNumbers", async () => {
    const { service, blockRepository } = newService();
    await blockRepository.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });

    const first = await service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(1), id: "a1", practiceBlockId: "block-1" });
    const second = await service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(2), id: "a2", practiceBlockId: "block-1" });

    expect(first.blockMembership?.blockSequenceNumber).toBe(1);
    expect(second.blockMembership?.blockSequenceNumber).toBe(2);
  });

  it("rejects starting an attempt against a nonexistent practiceBlockId", async () => {
    const { service } = newService();
    await expect(
      service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(0), id: "a1", practiceBlockId: "does-not-exist" })
    ).rejects.toThrow(PracticeLoopError);
    try {
      await service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(0), id: "a2", practiceBlockId: "does-not-exist" });
    } catch (error) {
      expect((error as PracticeLoopError).code).toBe("practice_block_not_found");
    }
  });

  it("rejects starting an attempt against a non-active (terminal) practiceBlockId", async () => {
    const { service, blockRepository } = newService();
    await blockRepository.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });
    await blockRepository.complete("block-1", { now: t(1) });

    await expect(
      service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(2), id: "a1", practiceBlockId: "block-1" })
    ).rejects.toThrow(PracticeLoopError);
    try {
      await service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(2), id: "a2", practiceBlockId: "block-1" });
    } catch (error) {
      expect((error as PracticeLoopError).code).toBe("practice_block_not_active");
    }
  });

  it("throws a plain Error when practiceBlockId is supplied but the service has no PracticeBlockReader configured", async () => {
    const repository = new InMemoryAttemptRepository();
    const questionReader = new InMemoryQuestionReader([publishedQuestion]);
    const service = new PracticeLoopService(repository, questionReader); // no third arg
    await expect(
      service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(0), id: "a1", practiceBlockId: "block-1" })
    ).rejects.toThrow(/PracticeBlockReader/);
  });
});

/**
 * D-060 SECURITY FIX: proves the FAST `PracticeBlockReader` pre-check
 * (`PracticeLoopService.startAttempt()`) rejects an ownership mismatch
 * before ever reaching `AttemptRepository.save()`. Test F (the
 * AUTHORITATIVE persistence-layer check surviving even when this pre-check
 * is bypassed entirely) lives in `packages/db/test/repositories/
 * attemptRepositoryBlockMembership.test.ts`, since proving "safe even
 * without the fast path" specifically requires calling the repository
 * directly, without going through this service at all.
 */
describe("PracticeLoopService.startAttempt() — practiceBlockId ownership verification (D-060 security fix)", () => {
  it("B. wrong student + matching enrollment -> fast pre-check rejects (E)", async () => {
    const { service, blockRepository } = newService();
    await blockRepository.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });

    await expect(
      service.startAttempt({ studentId: "student-attacker", questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(1), id: "a1", practiceBlockId: "block-1" })
    ).rejects.toThrow(PracticeLoopError);
    try {
      await service.startAttempt({ studentId: "student-attacker", questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(1), id: "a2", practiceBlockId: "block-1" });
    } catch (error) {
      expect((error as PracticeLoopError).code).toBe("practice_block_ownership_mismatch");
    }
  });

  it("C. matching student + wrong enrollment -> fast pre-check rejects (E)", async () => {
    const { service, blockRepository } = newService();
    await blockRepository.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });

    await expect(
      service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: "enrollment-attacker", now: t(1), id: "a1", practiceBlockId: "block-1" })
    ).rejects.toThrow(PracticeLoopError);
    try {
      await service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: "enrollment-attacker", now: t(1), id: "a2", practiceBlockId: "block-1" });
    } catch (error) {
      expect((error as PracticeLoopError).code).toBe("practice_block_ownership_mismatch");
    }
  });

  it("D. wrong student + wrong enrollment -> fast pre-check rejects (E)", async () => {
    const { service, blockRepository } = newService();
    await blockRepository.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });

    await expect(
      service.startAttempt({ studentId: "student-attacker", questionId: "question-1", enrollmentId: "enrollment-attacker", now: t(1), id: "a1", practiceBlockId: "block-1" })
    ).rejects.toThrow(PracticeLoopError);
    try {
      await service.startAttempt({ studentId: "student-attacker", questionId: "question-1", enrollmentId: "enrollment-attacker", now: t(1), id: "a2", practiceBlockId: "block-1" });
    } catch (error) {
      expect((error as PracticeLoopError).code).toBe("practice_block_ownership_mismatch");
    }
  });

  it("G. retry inheritance still works end-to-end for a correctly-owned block", async () => {
    const { service, blockRepository } = newService();
    await blockRepository.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });

    const original = await service.startAttempt({ studentId: OWNING_STUDENT, questionId: "question-1", enrollmentId: OWNING_ENROLLMENT, now: t(0), id: "original", practiceBlockId: "block-1" });
    expect(original.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 1 });

    const retry = await service.startAttempt({
      studentId: OWNING_STUDENT,
      questionId: "question-1",
      enrollmentId: OWNING_ENROLLMENT,
      now: t(60),
      id: "retry",
      retryOfAttemptId: "original",
      practiceBlockId: "block-1"
    });
    expect(retry.blockMembership).toEqual({ practiceBlockId: "block-1", blockSequenceNumber: 2 });
  });
});
