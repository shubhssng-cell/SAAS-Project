import { recordAttemptEvent, startAttempt, submitAttempt, toAutopsyEvidence, toMasteryContribution, type AttemptQuestionContext } from "@ipmat/attempt";
import {
  buildAutopsyOutput,
  buildRepairPlan,
  confirmHypothesis,
  generateHypothesis,
  type AutopsyQuestionContext
} from "@ipmat/autopsy";
import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import { computeMasteryState } from "../src/masteryState.js";
import type { MasteryAttemptRecord } from "../src/types.js";

/**
 * Proves the full Phase 5B chain end to end, through REAL functions, not
 * just types (Phase 5B §18): @ipmat/attempt -> @ipmat/autopsy ->
 * hypothesis -> confirmation -> RepairPlan -> MasteryState. No duplicated
 * attempt-evidence model, Question DNA, or ErrorTaxonomy — every step
 * reuses the SAME `AutopsyQuestionContext` and `AttemptAutopsyEvidence`
 * objects the earlier step produced.
 */
describe("cross-package integration — @ipmat/attempt -> @ipmat/autopsy -> hypothesis -> confirmation -> RepairPlan -> MasteryState", () => {
  const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

  const attemptQuestionContext: AttemptQuestionContext = {
    questionId: "question-integration-1",
    conceptId: "concept-percentages",
    answerFormat: "multiple_choice",
    options: ["420", "450", "480", "500"],
    correctAnswer: "480",
    expectedTimeSeconds: 90
  };
  const autopsyQuestionContext: AutopsyQuestionContext = {
    questionId: attemptQuestionContext.questionId,
    examCode: "IPMAT_INDORE",
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: "Percentages",
    patternFamilyName: "Reverse Percentage",
    patternTaxonomyCellId: "cell-integration-1",
    difficultyTier: "advanced",
    difficultyDimensions: {
      conceptualLoad: 0.4,
      computationalLoad: 0.3,
      trapDensity: 0.5,
      representationNovelty: 0.2,
      timePressure: 0.3,
      multiStepDepth: 0.4
    },
    noveltyLevel: "standard",
    examRelevance: "core",
    testingModes: ["reverse"],
    trapErrorTaxonomyCode: "base_confusion",
    combinesWithConcepts: ["Ratio"]
  };
  const errorTaxonomy = [
    { code: "base_confusion", label: "Base confusion", description: "Applied a percentage change to the wrong base quantity.", category: "misconception" as const }
  ];
  const claim = { studentId: "student-1", questionId: attemptQuestionContext.questionId };

  it("runs the full chain and produces a coherent RepairPlan and a mastery contribution", async () => {
    // 1. @ipmat/attempt: a real, finalized, incorrect attempt
    let attempt = startAttempt({
      id: "attempt-integration-1",
      studentId: claim.studentId,
      questionId: claim.questionId,
      enrollmentId: "enrollment-1",
      now: t(0)
    });
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, claim);
    attempt = submitAttempt(attempt, claim, attemptQuestionContext, { now: t(30) });
    expect(attempt.isCorrect).toBe(false);

    // 2. @ipmat/autopsy: OBSERVATION -> EVIDENCE
    const evidence = toAutopsyEvidence(attempt, attemptQuestionContext);
    const autopsyOutput = buildAutopsyOutput({ evidence, question: autopsyQuestionContext, errorTaxonomy });
    expect(autopsyOutput.candidateErrorEvidence?.proposedErrorTaxonomyCode).toBe("base_confusion");

    // 3. HYPOTHESIS (FixtureProvider — no real AI call)
    const aiHypothesis: AutopsyHypothesisAiOutput = {
      proposedErrorCategory: "misconception",
      proposedExplanation: "This pattern is consistent with applying the percentage change to the wrong base quantity.",
      supportingEvidence: ["Matched the question's designated trap (base_confusion)."],
      contradictoryEvidence: [],
      missingEvidence: [],
      modelConfidence: 0.7
    };
    const provider = new FixtureProvider([JSON.stringify(aiHypothesis)]);
    const hypothesis = await generateHypothesis(provider, { autopsyOutput });
    expect(hypothesis.confirmationStatus).toBe("awaiting_confirmation");

    // 4. CONFIRMATION — explicit student action
    const confirmed = confirmHypothesis(hypothesis, { now: t(60) });
    expect(confirmed.confirmationStatus).toBe("confirmed");

    // 5. RepairPlan — built only because the hypothesis is confirmed
    const plan = buildRepairPlan(confirmed, autopsyOutput);
    expect(plan.targetConceptName).toBe("Percentages");
    expect(plan.targetErrorCategory).toBe("misconception");
    expect(plan.confirmationSource.attemptId).toBe(attempt.id);

    // 6. MasteryState — the SAME finalized attempt also contributes to mastery,
    //    via @ipmat/attempt's own toMasteryContribution(), no re-derivation.
    const contribution = toMasteryContribution(attempt, attemptQuestionContext);
    const records: MasteryAttemptRecord[] = [
      { contribution, question: autopsyQuestionContext },
      // pad with more attempts so the concept-level measures aren't all "insufficient data"
      {
        contribution: { ...contribution, attemptId: "attempt-integration-2", isCorrect: true, timeTakenSeconds: 60 },
        question: autopsyQuestionContext
      },
      {
        contribution: { ...contribution, attemptId: "attempt-integration-3", isCorrect: true, timeTakenSeconds: 60 },
        question: autopsyQuestionContext
      }
    ];
    const masteryResult = computeMasteryState(records, {
      studentId: claim.studentId,
      conceptId: attemptQuestionContext.conceptId,
      conceptName: "Percentages",
      now: t(120)
    });

    expect(masteryResult.measures.accuracy).toBeCloseTo(2 / 3, 5);
    expect(masteryResult.detail.errorRecurrence.incorrectCount).toBe(1);
    // the one incorrect attempt that drove the whole hypothesis/repair chain is traceable here too:
    expect(masteryResult.detail.contributingAttemptIds).toContain(attempt.id);
  });
});
