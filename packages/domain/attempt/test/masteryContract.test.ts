import { describe, expect, it } from "vitest";
import { toMasteryContribution } from "../src/masteryContract.js";
import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt } from "../src/lifecycle.js";
import { AttemptLifecycleError } from "../src/types.js";
import { ENROLLMENT_ID, mcqQuestionContext, STUDENT_ID } from "../fixtures/questionContext.js";

const BASE = Date.parse("2026-09-22T10:00:00.000Z");
const t = (offsetSeconds: number): string => new Date(BASE + offsetSeconds * 1000).toISOString();
const claim = { studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId };

function newAttempt() {
  return startAttempt({ id: "a1", studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId, enrollmentId: ENROLLMENT_ID, now: t(0) });
}

describe("toMasteryContribution — per-attempt facts only, no mastery score computed here (Phase 4A §10)", () => {
  it("carries conceptId, correctness, and timing for a submitted attempt", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(9) });

    const contribution = toMasteryContribution(attempt, mcqQuestionContext);
    expect(contribution.conceptId).toBe("concept-percentages");
    expect(contribution.isCorrect).toBe(true);
    expect(contribution.timeTakenSeconds).toBe(9);
    expect(contribution.expectedTimeSeconds).toBe(90);
    expect(contribution.skipped).toBe(false);
  });

  it("marks a skip distinctly, with isCorrect null (not false)", () => {
    let attempt = newAttempt();
    attempt = skipAttempt(attempt, claim, { now: t(4) });
    const contribution = toMasteryContribution(attempt, mcqQuestionContext);
    expect(contribution.skipped).toBe(true);
    expect(contribution.isCorrect).toBeNull();
  });

  it("refuses an in_progress attempt — nothing to contribute yet", () => {
    const attempt = newAttempt();
    expect(() => toMasteryContribution(attempt, mcqQuestionContext)).toThrow(AttemptLifecycleError);
  });

  it("does not compute or expose accuracy/speedRatio/noveltyHandling/etc — that is Phase 5's job, not this contract's", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });
    const contribution = toMasteryContribution(attempt, mcqQuestionContext);
    for (const forbidden of ["accuracy", "speedRatio", "noveltyHandling", "pressurePerformance", "patternCoverage"]) {
      expect(Object.keys(contribution)).not.toContain(forbidden);
    }
  });
});
