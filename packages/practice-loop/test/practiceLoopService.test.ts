import { AttemptLifecycleError, type AttemptState } from "@ipmat/attempt";
import { InMemoryAttemptRepository, InMemoryQuestionReader, type AttemptRepository, type CanonicalQuestion } from "@ipmat/db";
import { describe, expect, it } from "vitest";
import { PracticeLoopService } from "../src/practiceLoopService.js";
import { PracticeLoopError } from "../src/types.js";

/**
 * TEST-ONLY fixture content (Phase 4B-2 §"Content prerequisite" — Phase
 * 3.5 currently has zero PUBLISHED questions, so this is never presented
 * as real, servable production content; it exists solely to exercise
 * `PracticeLoopService` deterministically). Mirrors the SAME Reverse
 * Percentage / base_confusion scenario used throughout this codebase's
 * other fixtures, marked `validationState: "published"` here ONLY for
 * test purposes — no code path in this package ever marks a real Question
 * row published.
 *
 * These are seeded into an `InMemoryQuestionReader`, never passed as a
 * method parameter — `PracticeLoopService` resolves ALL question content
 * (including `correctAnswer`/`validationState`) itself, via the injected
 * reader, exactly the way a real caller (a future HTTP/API layer) would
 * have no way to influence it either (docs/DECISIONS.md D-048).
 */
const claim = { studentId: "student-1", questionId: "question-1" };

const publishedQuestion: CanonicalQuestion = {
  id: "question-1",
  conceptId: "concept-percentages",
  options: ["420", "450", "480", "500"],
  correctAnswer: "480",
  expectedTimeSeconds: 90,
  validationState: "published"
};

/** A second, unrelated published question — used to prove grading/lookup never accidentally (or maliciously) crosses over to another question's answer key. */
const decoyQuestion: CanonicalQuestion = {
  id: "question-attacker",
  conceptId: "concept-percentages",
  options: ["100", "200", "420", "999"],
  correctAnswer: "420",
  expectedTimeSeconds: 30,
  validationState: "published"
};

const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

function newService(questions: CanonicalQuestion[] = [publishedQuestion]): {
  service: PracticeLoopService;
  repository: InMemoryAttemptRepository;
  questionReader: InMemoryQuestionReader;
} {
  const repository = new InMemoryAttemptRepository();
  const questionReader = new InMemoryQuestionReader(questions);
  return { service: new PracticeLoopService(repository, questionReader), repository, questionReader };
}

describe("PracticeLoopService — starting an attempt (Phase 4B-2 foundation)", () => {
  it("starts and persists a new in_progress attempt for a published question", async () => {
    const { service, repository } = newService();
    const attempt = await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-1" });

    expect(attempt.status).toBe("in_progress");
    expect(attempt.studentId).toBe(claim.studentId);
    expect(attempt.questionId).toBe(publishedQuestion.id);

    const persisted = await repository.findById("attempt-1");
    expect(persisted).toEqual(attempt);
  });

  it("generates a fresh id when the caller doesn't supply one", async () => {
    const { service } = newService();
    const a = await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0) });
    const b = await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0) });
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThan(0);
  });

  it("refuses to start a practice attempt against a non-published question (draft) -- decided entirely by the canonical QuestionReader, not any caller input", async () => {
    const { service } = newService([{ ...publishedQuestion, validationState: "draft" }]);
    await expect(service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0) })).rejects.toThrow(PracticeLoopError);
    await expect(service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0) })).rejects.toThrow(/not "published"/);
  });

  it("refuses to start against a human_reviewed question", async () => {
    const { service } = newService([{ ...publishedQuestion, validationState: "human_reviewed" }]);
    // human_reviewed is not "published" either -- only the literal "published" state is accepted.
    await expect(service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0) })).rejects.toThrow(PracticeLoopError);
  });

  it("refuses to start against a rejected question", async () => {
    const { service } = newService([{ ...publishedQuestion, validationState: "rejected" }]);
    await expect(service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0) })).rejects.toThrow(PracticeLoopError);
  });

  it("refuses with question_not_found when questionId doesn't resolve to any canonical question", async () => {
    const { service } = newService();
    await expect(
      service.startAttempt({ studentId: claim.studentId, questionId: "does-not-exist", enrollmentId: "enrollment-1", now: t(0) })
    ).rejects.toThrow(PracticeLoopError);
    await expect(
      service.startAttempt({ studentId: claim.studentId, questionId: "does-not-exist", enrollmentId: "enrollment-1", now: t(0) })
    ).rejects.toThrow(/No question found/);
  });
});

describe("PracticeLoopService — the submitted flow, correctness/timing from @ipmat/attempt + the canonical QuestionReader only", () => {
  it("full flow: start -> select -> change -> submit, correct answer", async () => {
    const { service, repository } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-2" });
    await service.recordEvent({ attemptId: "attempt-2", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: "420" } });
    await service.recordEvent({ attemptId: "attempt-2", claim, event: { type: "answer_changed", occurredAt: t(10), selectedAnswer: "480" } });
    const result = await service.submitAttempt({ attemptId: "attempt-2", claim, now: t(30) });

    expect(result.attempt.status).toBe("submitted");
    expect(result.attempt.chosenAnswer).toBe("480");
    expect(result.attempt.isCorrect).toBe(true);
    expect(result.correctAnswer).toBe("480");
    expect(result.attempt.timeSpentSeconds).toBe(30);

    const persisted = await repository.findById("attempt-2");
    expect(persisted).toEqual(result.attempt);
  });

  it("a WRONG final answer is reported as incorrect -- correctness is computed from the canonical question, never assumed or caller-suppliable", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-3" });
    await service.recordEvent({ attemptId: "attempt-3", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: "420" } });
    const result = await service.submitAttempt({ attemptId: "attempt-3", claim, now: t(20) });

    expect(result.attempt.chosenAnswer).toBe("420");
    expect(result.attempt.isCorrect).toBe(false);
    // There is structurally no parameter anywhere in this call through which a caller
    // could have supplied isCorrect/chosenAnswer/correctAnswer directly -- see submitAttempt()'s signature.
  });

  it("timing is derived from real elapsed time (finalizedAt - startedAt), not a caller-supplied duration", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-4" });
    await service.recordEvent({ attemptId: "attempt-4", claim, event: { type: "answer_selected", occurredAt: t(2), selectedAnswer: "480" } });
    const result = await service.submitAttempt({ attemptId: "attempt-4", claim, now: t(75) });

    expect(result.attempt.timeSpentSeconds).toBe(75);
  });

  it("records hint_opened and solution_opened events, reflected in the persisted attempt", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-5" });
    await service.recordEvent({ attemptId: "attempt-5", claim, event: { type: "hint_opened", occurredAt: t(5) } });
    await service.recordEvent({ attemptId: "attempt-5", claim, event: { type: "solution_opened", occurredAt: t(10) } });
    const attempt = await service.getAttempt("attempt-5");

    expect(attempt?.hintsUsed).toBe(1);
    expect(attempt?.solutionOpenedAt).toBe(t(10));
  });

  it("throws AttemptLifecycleError (missing_answer) when submitting with no answer ever recorded -- propagated from @ipmat/attempt, not swallowed", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-6" });
    await expect(service.submitAttempt({ attemptId: "attempt-6", claim, now: t(10) })).rejects.toThrow(AttemptLifecycleError);
  });
});

describe("PracticeLoopService — security: canonical question authority (Phase 4B-2 security fix, D-048)", () => {
  it("submitAttempt grades using ONLY the canonical QuestionReader answer -- a chosen answer matching a DIFFERENT question's correctAnswer is still graded incorrect", async () => {
    const { service } = newService([publishedQuestion, decoyQuestion]);
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-security-1" });
    // "420" is decoyQuestion's correctAnswer, not publishedQuestion's ("480") -- selecting it must
    // not be graded correct merely because SOME question in the system considers it correct.
    await service.recordEvent({ attemptId: "attempt-security-1", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: "420" } });
    const result = await service.submitAttempt({ attemptId: "attempt-security-1", claim, now: t(20) });

    expect(result.correctAnswer).toBe(publishedQuestion.correctAnswer);
    expect(result.attempt.isCorrect).toBe(false);
  });

  it("submitAttempt's input has no question-bearing parameter -- the graded question is resolved strictly from the attempt's own persisted questionId, never substitutable at submit time", async () => {
    const { service } = newService([publishedQuestion, decoyQuestion]);
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-security-2" });
    await service.recordEvent({ attemptId: "attempt-security-2", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: publishedQuestion.correctAnswer } });

    const result = await service.submitAttempt({ attemptId: "attempt-security-2", claim, now: t(15) });

    // Confirms the canonical data used for grading was publishedQuestion's, never decoyQuestion's,
    // even though both exist in the same QuestionReader -- there is no way for a caller to have
    // pointed submitAttempt at decoyQuestion's answer key instead, since submitAttempt() accepts
    // no question identity or content parameter at all.
    expect(result.correctAnswer).toBe(publishedQuestion.correctAnswer);
    expect(result.attempt.isCorrect).toBe(true);
  });

  it("an answer outside the canonical question's real options is rejected as invalid_answer_option -- proving @ipmat/attempt validated against the QuestionReader's options, never anything a caller could have supplied", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-security-3" });
    await service.recordEvent({ attemptId: "attempt-security-3", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: "not-a-real-option" } });

    await expect(service.submitAttempt({ attemptId: "attempt-security-3", claim, now: t(10) })).rejects.toThrow(AttemptLifecycleError);
  });

  it("submitAttempt refuses with question_not_found if the attempt's own questionId no longer resolves to a canonical question (never falls back to trusting anything else)", async () => {
    const repository = new InMemoryAttemptRepository();
    const service = new PracticeLoopService(repository, new InMemoryQuestionReader([publishedQuestion]));

    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-security-4" });
    await service.recordEvent({ attemptId: "attempt-security-4", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: publishedQuestion.correctAnswer } });

    // Simulate the canonical question becoming unresolvable between start and submit (e.g. deleted) --
    // a fresh service sharing the SAME repository but an EMPTY reader must refuse, never fall back to
    // trusting anything else about the already-persisted attempt.
    const serviceWithEmptyReader = new PracticeLoopService(repository, new InMemoryQuestionReader([]));

    await expect(serviceWithEmptyReader.submitAttempt({ attemptId: "attempt-security-4", claim, now: t(10) })).rejects.toThrow(PracticeLoopError);
    await expect(serviceWithEmptyReader.submitAttempt({ attemptId: "attempt-security-4", claim, now: t(10) })).rejects.toThrow(/No canonical question found/);
  });
});

describe("PracticeLoopService — skip and abandon flows", () => {
  it("skips an in-progress attempt: chosenAnswer/isCorrect stay null, status becomes skipped", async () => {
    const { service, repository } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-7" });
    const attempt = await service.skipAttempt({ attemptId: "attempt-7", claim, now: t(15) });

    expect(attempt.status).toBe("skipped");
    expect(attempt.chosenAnswer).toBeNull();
    expect(attempt.isCorrect).toBeNull();
    expect(await repository.findById("attempt-7")).toEqual(attempt);
  });

  it("abandons an in-progress attempt via finalizeAttempt('abandoned')", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-8" });
    const attempt = await service.abandonAttempt({ attemptId: "attempt-8", claim, now: t(600) });

    expect(attempt.status).toBe("abandoned");
    expect(attempt.timeSpentSeconds).toBe(600);
    expect(attempt.chosenAnswer).toBeNull();
  });

  it("a retry after a skip: startAttempt with retryOfAttemptId links to the original", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-9" });
    await service.skipAttempt({ attemptId: "attempt-9", claim, now: t(5) });

    const retry = await service.startAttempt({
      studentId: claim.studentId,
      questionId: publishedQuestion.id,
      enrollmentId: "enrollment-1",
      retryOfAttemptId: "attempt-9",
      now: t(60),
      id: "attempt-9-retry"
    });

    expect(retry.retryOfAttemptId).toBe("attempt-9");
  });
});

describe("PracticeLoopService — reload / retrieval", () => {
  it("getAttempt reconstructs an in-progress attempt's current state (simulating a page reload mid-attempt)", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-10" });
    await service.recordEvent({ attemptId: "attempt-10", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: "450" } });

    const reloaded = await service.getAttempt("attempt-10");
    expect(reloaded?.status).toBe("in_progress");
    expect(reloaded?.events.map((e) => e.type)).toEqual(["answer_selected"]);
  });

  it("getAttempt returns null for an attempt that was never started", async () => {
    const { service } = newService();
    expect(await service.getAttempt("nonexistent")).toBeNull();
  });
});

describe("PracticeLoopService — errors propagate, never silently reported as success", () => {
  it("recordEvent on a nonexistent attempt throws AttemptLifecycleError, never resolves", async () => {
    const { service } = newService();
    await expect(
      service.recordEvent({ attemptId: "nonexistent", claim, event: { type: "answer_selected", occurredAt: t(0), selectedAnswer: "480" } })
    ).rejects.toThrow(AttemptLifecycleError);
  });

  it("submitAttempt with a mismatched ownership claim throws AttemptLifecycleError", async () => {
    const { service } = newService();
    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-11" });
    await service.recordEvent({ attemptId: "attempt-11", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: "480" } });

    await expect(
      service.submitAttempt({ attemptId: "attempt-11", claim: { studentId: "someone-else", questionId: claim.questionId }, now: t(10) })
    ).rejects.toThrow(AttemptLifecycleError);
  });

  it("submitAttempt on a nonexistent attempt throws AttemptLifecycleError(attempt_not_found) before any question lookup", async () => {
    const { service } = newService();
    await expect(service.submitAttempt({ attemptId: "nonexistent", claim, now: t(0) })).rejects.toThrow(AttemptLifecycleError);
  });

  it("a repository persistence failure on save() propagates from startAttempt, never silently reported as a successful start", async () => {
    const failingRepository: AttemptRepository = {
      async save(): Promise<AttemptState> {
        throw new Error("simulated persistence failure");
      },
      async findById(): Promise<AttemptState | null> {
        return null;
      }
    };
    const service = new PracticeLoopService(failingRepository, new InMemoryQuestionReader([publishedQuestion]));

    await expect(service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-12" })).rejects.toThrow(
      "simulated persistence failure"
    );
  });

  it("a repository persistence failure on save() propagates from submitAttempt, never silently reported as a successful submission", async () => {
    const realRepo = new InMemoryAttemptRepository();
    let saveCallCount = 0;
    const flakyRepository: AttemptRepository = {
      async save(state: AttemptState) {
        saveCallCount += 1;
        // Let the first two saves (startAttempt, then recordEvent) succeed, then fail the
        // third (submitAttempt's save) -- simulating a real outage that begins mid-flow
        // rather than from the very first call.
        if (saveCallCount > 2) throw new Error("simulated persistence failure on submit");
        return realRepo.save(state);
      },
      async findById(id: string) {
        return realRepo.findById(id);
      }
    };
    const service = new PracticeLoopService(flakyRepository, new InMemoryQuestionReader([publishedQuestion]));

    await service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-1", now: t(0), id: "attempt-13" });
    await service.recordEvent({ attemptId: "attempt-13", claim, event: { type: "answer_selected", occurredAt: t(5), selectedAnswer: "480" } });
    await expect(service.submitAttempt({ attemptId: "attempt-13", claim, now: t(10) })).rejects.toThrow("simulated persistence failure on submit");

    // The failed submit must not have silently persisted a "submitted" state via some other path.
    const persisted = await realRepo.findById("attempt-13");
    expect(persisted?.status).toBe("in_progress");
  });

  it("a missing_reference persistence error (unknown enrollment) propagates from startAttempt", async () => {
    const strictRepository = new InMemoryAttemptRepository({
      knownStudentIds: new Set([claim.studentId]),
      knownQuestionIds: new Set([publishedQuestion.id]),
      knownEnrollmentIds: new Set(["enrollment-real"])
    });
    const service = new PracticeLoopService(strictRepository, new InMemoryQuestionReader([publishedQuestion]));

    await expect(
      service.startAttempt({ studentId: claim.studentId, questionId: publishedQuestion.id, enrollmentId: "enrollment-does-not-exist", now: t(0), id: "attempt-14" })
    ).rejects.toThrow(/No Enrollment found/);
  });
});
