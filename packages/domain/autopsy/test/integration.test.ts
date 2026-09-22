import { describe, expect, it } from "vitest";
import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt, toAutopsyEvidence, type AttemptQuestionContext } from "@ipmat/attempt";
import { buildAutopsyOutput } from "../src/autopsyOutput.js";
import { buildRepairContext } from "../src/repairContext.js";
import { errorTaxonomyFixture } from "../fixtures/errorTaxonomy.js";
import { percentagesQuestionContext } from "../fixtures/questionContext.js";

/**
 * Proves this package against a REAL `@ipmat/attempt` lifecycle end to
 * end — not just the hand-built `buildEvidence()` fixture used elsewhere
 * in this test suite for speed. This is the actual integration the whole
 * package exists to support (Phase 5A §14: "compatible with @ipmat/attempt").
 */
describe("integration — real @ipmat/attempt lifecycle -> toAutopsyEvidence() -> buildAutopsyOutput()", () => {
  const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

  const attemptQuestionContext: AttemptQuestionContext = {
    questionId: percentagesQuestionContext.questionId,
    conceptId: "concept-percentages",
    answerFormat: "multiple_choice",
    options: ["420", "450", "480", "500"],
    correctAnswer: "480",
    expectedTimeSeconds: 90
  };
  const claim = { studentId: "student-1", questionId: percentagesQuestionContext.questionId };

  it("a real multi-change wrong answer flows through to a candidate error and preserves the full sequence", () => {
    let attempt = startAttempt({
      id: "attempt-real-1",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      now: t(0)
    });
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(2), selectedAnswer: "420" }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(3), selectedAnswer: "450" }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(4), selectedAnswer: "500" }, claim);
    attempt = submitAttempt(attempt, claim, attemptQuestionContext, { now: t(50) });

    const evidence = toAutopsyEvidence(attempt, attemptQuestionContext);
    const output = buildAutopsyOutput({ evidence, question: percentagesQuestionContext, errorTaxonomy: errorTaxonomyFixture });

    expect(output.attemptFacts.isCorrect).toBe(false);
    expect(output.attemptFacts.answerChangeHistory.sequence.map((p) => p.answer)).toEqual(["420", "450", "500"]);
    expect(output.behaviorSignals.multipleAnswerChanges).toBe(true);
    expect(output.candidateErrorEvidence?.proposedErrorTaxonomyCode).toBe("base_confusion");

    const repair = buildRepairContext(output);
    expect(repair.targetConceptName).toBe("Percentages");
    expect(repair.priority).toBe("medium");
  });

  it("a real skip produces noAnswer=true, skipped=true, and null candidate error evidence", () => {
    let attempt = startAttempt({
      id: "attempt-real-2",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      now: t(0)
    });
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, claim);
    attempt = skipAttempt(attempt, claim, { now: t(10) });

    const evidence = toAutopsyEvidence(attempt, attemptQuestionContext);
    const output = buildAutopsyOutput({ evidence, question: percentagesQuestionContext, errorTaxonomy: errorTaxonomyFixture });

    expect(output.behaviorSignals.skipped).toBe(true);
    expect(output.behaviorSignals.noAnswer).toBe(true);
    expect(output.candidateErrorEvidence).toBeNull();
  });

  it("a real correct-but-slow attempt (3x expected time) remains correct AND slow through the whole pipeline", () => {
    let attempt = startAttempt({
      id: "attempt-real-3",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      now: t(0)
    });
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, attemptQuestionContext, { now: t(270) }); // 270s vs 90s expected = 3x

    const evidence = toAutopsyEvidence(attempt, attemptQuestionContext);
    const output = buildAutopsyOutput({ evidence, question: percentagesQuestionContext, errorTaxonomy: errorTaxonomyFixture });

    expect(output.attemptFacts.isCorrect).toBe(true);
    expect(output.behaviorSignals.correctSlow).toBe(true);
    expect(output.behaviorSignals.speedRatio).toBeCloseTo(3, 5);
  });
});
