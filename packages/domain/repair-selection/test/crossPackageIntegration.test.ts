import { recordAttemptEvent, startAttempt, submitAttempt, toAutopsyEvidence, type AttemptQuestionContext } from "@ipmat/attempt";
import { buildAutopsyOutput, buildRepairPlan, confirmHypothesis, generateHypothesis, type AutopsyQuestionContext } from "@ipmat/autopsy";
import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import { selectRepairQuestion } from "../src/selectRepairQuestion.js";
import { makeCandidate } from "./fixtures.js";

/**
 * Proves the full Phase 5C-2 chain end to end, through REAL functions, not
 * just types (mirroring `@ipmat/mastery`'s own cross-package integration
 * test, Phase 5B):
 *
 *   Attempt -> AutopsyOutput -> AI hypothesis (FixtureProvider) ->
 *   student confirmation -> confirmed RepairPlan -> deterministic repair
 *   selection -> selected Question DNA.
 *
 * The final assertions specifically prove the selected question is
 * EXPLAINABLY connected to the confirmed diagnosis, not merely "a
 * question was returned" — its pattern family, trap code, and taxonomy
 * cell must trace back to what the confirmed hypothesis actually targeted.
 */
describe("cross-package integration — Attempt -> AutopsyOutput -> hypothesis -> confirmation -> RepairPlan -> repair selection -> Question DNA", () => {
  const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();
  const claim = { studentId: "student-integration-1", questionId: "question-integration-repair-1" };

  const attemptQuestionContext: AttemptQuestionContext = {
    questionId: claim.questionId,
    conceptId: "concept-percentages",
    answerFormat: "multiple_choice",
    options: ["420", "450", "480", "500"],
    correctAnswer: "480",
    expectedTimeSeconds: 90
  };

  const diagnosedQuestionContext: AutopsyQuestionContext = {
    questionId: claim.questionId,
    examCode: "IPMAT_INDORE",
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: "Percentages",
    patternFamilyName: "Reverse Percentage",
    patternTaxonomyCellId: "cell-integration-repair-1",
    difficultyTier: "advanced",
    difficultyDimensions: { conceptualLoad: 0.4, computationalLoad: 0.3, trapDensity: 0.5, representationNovelty: 0.2, timePressure: 0.3, multiStepDepth: 0.4 },
    noveltyLevel: "standard",
    examRelevance: "core",
    testingModes: ["reverse"],
    trapErrorTaxonomyCode: "base_confusion",
    combinesWithConcepts: ["Ratio"]
  };

  const errorTaxonomy = [{ code: "base_confusion", label: "Base confusion", description: "Applied a percentage change to the wrong base quantity.", category: "misconception" as const }];

  it("runs the full chain and proves the selected question is explainably connected to the confirmed diagnosis", async () => {
    // 1. @ipmat/attempt: a real, finalized, incorrect attempt
    let attempt = startAttempt({ id: "attempt-integration-repair-1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-1", now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, claim);
    attempt = submitAttempt(attempt, claim, attemptQuestionContext, { now: t(30) });
    expect(attempt.isCorrect).toBe(false);

    // 2. @ipmat/autopsy: OBSERVATION -> EVIDENCE
    const evidence = toAutopsyEvidence(attempt, attemptQuestionContext);
    const autopsyOutput = buildAutopsyOutput({ evidence, question: diagnosedQuestionContext, errorTaxonomy });
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
    expect(plan.targetErrorTaxonomyCode).toBe("base_confusion");
    expect(plan.confirmationSource.attemptId).toBe(attempt.id);

    // 6. Repair selection (Phase 5C-2) — deterministic, from real Question DNA candidates
    const directMatch = makeCandidate({
      patternTaxonomyCellId: plan.targetTaxonomyCellId,
      patternFamilyName: plan.targetPatternFamilyName,
      trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode
    });
    const unrelated = makeCandidate({ patternFamilyName: "Successive Percentage Change", trapErrorTaxonomyCode: "successive_change_error" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [unrelated, directMatch] });

    expect(outcome.status).toBe("selected");
    if (outcome.status !== "selected") return;

    // 7. The selected Question DNA is EXPLAINABLY connected to the confirmed diagnosis:
    // same taxonomy cell, same pattern family, same confirmed error-taxonomy code — never the unrelated candidate.
    expect(outcome.result.question.questionId).toBe(directMatch.question.questionId);
    expect(outcome.result.question.patternTaxonomyCellId).toBe(plan.targetTaxonomyCellId);
    expect(outcome.result.question.patternFamilyName).toBe(plan.targetPatternFamilyName);
    expect(outcome.result.question.trapErrorTaxonomyCode).toBe(plan.targetErrorTaxonomyCode);
    expect(outcome.result.matchTier).toBe("direct_cell_and_trap");
    expect(outcome.result.isFallback).toBe(false);
    expect(outcome.result.explanation).toContain(plan.targetTaxonomyCellId);
    expect(outcome.result.coverageGapAddressed).toContain(plan.targetTaxonomyCellId);
  });
});
