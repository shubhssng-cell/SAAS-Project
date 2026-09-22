import type { AutopsyQuestionContext } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { selectRepairQuestion } from "../src/selectRepairQuestion.js";
import { buildConfirmedRepairPlan, historicalRecord, makeCandidate, percentagesQuestionContext } from "./fixtures.js";

const novelPressureQuestion: AutopsyQuestionContext = {
  ...percentagesQuestionContext,
  questionId: "question-novel-pressure-current",
  noveltyLevel: "novel_representation",
  testingModes: ["reverse", "time_pressured"]
};

const novelOnlyQuestion: AutopsyQuestionContext = {
  ...percentagesQuestionContext,
  questionId: "question-novel-only-current",
  noveltyLevel: "novel_representation",
  testingModes: ["reverse"]
};

describe("selectRepairQuestion — targeted repair, deterministic, explainable (Phase 5C-2)", () => {
  it("A. direct matching repair question is preferred over broader alternatives", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const direct = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode });
    const familyOnly = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion" });
    const conceptOnly = makeCandidate({ patternFamilyName: "Successive Percentage Change", trapErrorTaxonomyCode: "successive_change_error" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [conceptOnly, familyOnly, direct] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(direct.question.questionId);
      expect(outcome.result.matchTier).toBe("direct_cell_and_trap");
      expect(outcome.result.isFallback).toBe(false);
    }
  });

  it("B. concept-only repair: no family/cell/trap match anywhere in the pool", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const conceptOnly = makeCandidate({ patternFamilyName: "Successive Percentage Change", trapErrorTaxonomyCode: "successive_change_error" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [conceptOnly] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.matchTier).toBe("concept_fallback");
      expect(outcome.result.isFallback).toBe(true);
    }
  });

  it("C. pattern-family repair: same family, different cell, no trap match", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const familyOnly = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion" });
    const conceptOnly = makeCandidate({ patternFamilyName: "Successive Percentage Change", trapErrorTaxonomyCode: "successive_change_error" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [conceptOnly, familyOnly] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(familyOnly.question.questionId);
      expect(outcome.result.matchTier).toBe("pattern_family");
    }
  });

  it("D. taxonomy-cell repair: exact cell match wins even without a trap match", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const cellOnly = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion" });
    const familyOnly = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [familyOnly, cellOnly] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(cellOnly.question.questionId);
      expect(outcome.result.matchTier).toBe("direct_cell");
    }
  });

  it("E. repeated error-category repair: same confirmed trap in a DIFFERENT pattern family, ranked above a bare family match", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const trapOnly = makeCandidate({ patternFamilyName: "Percentage Share in Data Interpretation", trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode });
    const familyOnly = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [familyOnly, trapOnly] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(trapOnly.question.questionId);
      expect(outcome.result.matchTier).toBe("trap_only");
    }
  });

  it("F. speed-focused repair: a detected speed weakness prefers the candidate with the shorter expected time, within the same tier", async () => {
    const { plan, output } = await buildConfirmedRepairPlan({ currentEvidenceOverrides: { timeTakenSeconds: 250, expectedTimeSeconds: 90 } });
    expect(output.behaviorSignals.incorrectSlow).toBe(true);

    const slow = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion", expectedTimeSeconds: 150 });
    const fast = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion", expectedTimeSeconds: 45 });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [slow, fast], behaviorSignals: output.behaviorSignals });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(fast.question.questionId);
    }
  });

  it("G. novelty exposure requirement: only a non-standard-novelty candidate qualifies, even though a standard one matches the family/trap more closely", async () => {
    const prior = [historicalRecord({ isCorrect: false }, novelOnlyQuestion)];
    const { plan } = await buildConfirmedRepairPlan({ currentQuestion: novelOnlyQuestion, priorAttempts: prior });
    expect(plan.recommendedTrainingMode).toBe("novelty_exposure");

    const standardDirect = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode, noveltyLevel: "standard" });
    const novelFamily = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion", noveltyLevel: "novel_representation" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [standardDirect, novelFamily] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(novelFamily.question.questionId);
      expect(outcome.result.question.noveltyLevel).not.toBe("standard");
    }
  });

  it("H. pressure-training requirement: only a time_pressured candidate qualifies", async () => {
    const prior = [historicalRecord({ isCorrect: false }, novelPressureQuestion)];
    const { plan } = await buildConfirmedRepairPlan({ currentQuestion: novelPressureQuestion, priorAttempts: prior });
    expect(plan.recommendedTrainingMode).toBe("timed_pressure_drill");

    const noPressureDirect = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode, testingModes: ["reverse"] });
    const pressureFamily = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion", testingModes: ["reverse", "time_pressured"] });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [noPressureDirect, pressureFamily] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(pressureFamily.question.questionId);
      expect(outcome.result.question.testingModes).toContain("time_pressured");
    }
  });

  it("I. unavailable direct repair produces an EXPLICIT, labeled fallback, not a silent unrelated substitution", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const conceptOnly = makeCandidate({ patternFamilyName: "Successive Percentage Change", trapErrorTaxonomyCode: "successive_change_error" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [conceptOnly] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.isFallback).toBe(true);
      expect(outcome.result.explanation.toLowerCase()).toContain("fallback");
      expect(outcome.result.explanation.toLowerCase()).toContain("direct repair unavailable");
    }
  });

  it("J. no suitable question at all -> explicit no-match, never a silent fallback to an unrelated concept", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const wrongConcept = makeCandidate({ conceptName: "Ratio", patternFamilyName: "Ratio Simplification" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [wrongConcept] });

    expect(outcome.status).toBe("no_match");
    if (outcome.status === "no_match") {
      expect(outcome.reason).toBe("no_candidates_for_concept");
    }
  });

  it("J variant: only non-published candidates exist for the concept -> no-match, never serves a draft question", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const draftOnly = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode, validationState: "draft" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [draftOnly] });

    expect(outcome.status).toBe("no_match");
    if (outcome.status === "no_match") {
      expect(outcome.reason).toBe("no_candidates_for_concept");
    }
  });

  it("J variant: candidates exist for the concept but none satisfy the required training-mode constraint -> explicit no-match, not a silent downgrade", async () => {
    const prior = [historicalRecord({ isCorrect: false }, novelPressureQuestion)];
    const { plan } = await buildConfirmedRepairPlan({ currentQuestion: novelPressureQuestion, priorAttempts: prior });
    expect(plan.recommendedTrainingMode).toBe("timed_pressure_drill");

    const noPressureCandidate = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode, testingModes: ["reverse"] });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [noPressureCandidate] });

    expect(outcome.status).toBe("no_match");
    if (outcome.status === "no_match") {
      expect(outcome.reason).toBe("training_mode_constraint_unsatisfied");
    }
  });

  it("N. deterministic tie-breaking: the same input always produces the same output", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const candidates = [makeCandidate({ patternFamilyName: plan.targetPatternFamilyName }), makeCandidate({ patternFamilyName: plan.targetPatternFamilyName })];

    const first = selectRepairQuestion({ repairPlan: plan, candidateQuestions: candidates });
    const second = selectRepairQuestion({ repairPlan: plan, candidateQuestions: candidates });

    expect(second).toEqual(first);
  });

  it("O. an overused candidate is avoided when a fresh alternative exists in the same tier", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const overused = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode });
    const fresh = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode });

    const outcome = selectRepairQuestion({
      repairPlan: plan,
      candidateQuestions: [overused, fresh],
      priorExposure: [{ questionId: overused.question.questionId, attemptCount: 2 }]
    });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(fresh.question.questionId);
    }
  });

  it("O variant: an overused candidate is still selected when it is the only one available in the tier", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const onlyOption = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: plan.targetErrorTaxonomyCode });

    const outcome = selectRepairQuestion({
      repairPlan: plan,
      candidateQuestions: [onlyOption],
      priorExposure: [{ questionId: onlyOption.question.questionId, attemptCount: 10 }]
    });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(onlyOption.question.questionId);
    }
  });

  it("P. malformed candidates are excluded and counted, never silently treated as complete", async () => {
    const { plan } = await buildConfirmedRepairPlan();
    const malformed = makeCandidate({ patternTaxonomyCellId: plan.targetTaxonomyCellId, patternFamilyName: plan.targetPatternFamilyName, testingModes: [] });
    const valid = makeCandidate({ patternFamilyName: plan.targetPatternFamilyName, trapErrorTaxonomyCode: "percentage_point_confusion" });

    const outcome = selectRepairQuestion({ repairPlan: plan, candidateQuestions: [malformed, valid] });

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.result.question.questionId).toBe(valid.question.questionId);
      expect(outcome.result.excludedMalformedCount).toBe(1);
    }
  });
});
