import { describe, expect, it } from "vitest";
import { toAutopsyEvidence } from "../src/autopsyContract.js";
import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt } from "../src/lifecycle.js";
import { AttemptLifecycleError } from "../src/types.js";
import { ENROLLMENT_ID, mcqQuestionContext, otherQuestionContext, STUDENT_ID } from "../fixtures/questionContext.js";

const BASE = Date.parse("2026-09-22T10:00:00.000Z");
const t = (offsetSeconds: number): string => new Date(BASE + offsetSeconds * 1000).toISOString();
const claim = { studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId };

function newAttempt(id = "a1") {
  return startAttempt({ id, studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId, enrollmentId: ENROLLMENT_ID, now: t(0) });
}

describe("toAutopsyEvidence — observable facts only, contract only (Phase 4A §9)", () => {
  it("builds full evidence for a finalized, incorrect submitted attempt", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "hint_opened", occurredAt: t(1) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(2), selectedAnswer: "420" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(5) });

    const evidence = toAutopsyEvidence(attempt, mcqQuestionContext);
    expect(evidence.status).toBe("submitted");
    expect(evidence.isCorrect).toBe(false);
    expect(evidence.correctAnswer).toBe("480");
    expect(evidence.finalAnswer).toBe("420");
    expect(evidence.hintsUsed).toBe(1);
    expect(evidence.timeTakenSeconds).toBe(5);
    expect(evidence.expectedTimeSeconds).toBe(90);
    expect(evidence.skipped).toBe(false);
    expect(evidence.eventTimeline.length).toBeGreaterThan(0);
  });

  it("marks skipped evidence distinctly, with a null answer/correctness", () => {
    let attempt = newAttempt();
    attempt = skipAttempt(attempt, claim, { now: t(3) });
    const evidence = toAutopsyEvidence(attempt, mcqQuestionContext);
    expect(evidence.status).toBe("skipped");
    expect(evidence.skipped).toBe(true);
    expect(evidence.finalAnswer).toBeNull();
    expect(evidence.isCorrect).toBeNull();
  });

  it("computes solutionOpenedBeforeFinalization as an observable fact, never guessing at intent", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "solution_opened", occurredAt: t(1) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(2), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(3) });
    const evidence = toAutopsyEvidence(attempt, mcqQuestionContext);
    expect(evidence.solutionOpenedBeforeFinalization).toBe(true);
  });

  it("solutionOpenedBeforeFinalization is null when the solution was never opened", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });
    const evidence = toAutopsyEvidence(attempt, mcqQuestionContext);
    expect(evidence.solutionOpenedBeforeFinalization).toBeNull();
  });

  it("refuses to build evidence for an in_progress attempt", () => {
    const attempt = newAttempt();
    expect(() => toAutopsyEvidence(attempt, mcqQuestionContext)).toThrow(AttemptLifecycleError);
  });

  it("refuses a mismatched question context", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });
    expect(() => toAutopsyEvidence(attempt, otherQuestionContext)).toThrow(AttemptLifecycleError);
  });

  it("the evidence type has no confidence/motivation/emotion field — a structural, not just behavioral, guarantee", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });
    const evidence = toAutopsyEvidence(attempt, mcqQuestionContext);
    const forbiddenKeys = ["confidence", "motivation", "intelligence", "emotion", "mood", "sentiment"];
    for (const key of forbiddenKeys) {
      expect(Object.keys(evidence)).not.toContain(key);
    }
  });
});
