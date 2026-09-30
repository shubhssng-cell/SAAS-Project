import { describe, expect, it } from "vitest";
import { orchestrateNextTrainingAction } from "../src/orchestrate.js";
import type { TrainingOrchestrationInput, TrainingOrchestrationResult } from "../src/types.js";
import { activeRepairContext, makeAttemptRecord, makeCandidate, STUDENT } from "./fixtures.js";

/**
 * Phase 3 Unit 4 -- no immediate repeat across EVERY tier. Repair and the training-system providers choose by their own rules and know
 * nothing about what was just attempted; the orchestrator withholds the just-attempted question from them whenever another candidate
 * exists. A tier left with no match falls through like any other no-match; adaptive practice owns the sole-candidate fallback.
 */

const baseInput = (o: Partial<TrainingOrchestrationInput> = {}): TrainingOrchestrationInput => ({ studentId: STUDENT, activeRepairPlans: [], masteryByConcept: [], attemptRecords: [], candidates: [], ...o });
const asSelected = (r: TrainingOrchestrationResult) => {
  if (r.status !== "selected") throw new Error(`expected a selection, got ${r.status}`);
  return r;
};

describe("repair tier", () => {
  it("a confirmed repair plan still wins over everything, but never re-serves the question just attempted when another repair match exists", () => {
    const context = activeRepairContext();
    const first = makeCandidate({ patternTaxonomyCellId: context.plan.targetTaxonomyCellId, trapErrorTaxonomyCode: context.plan.targetErrorTaxonomyCode });
    const second = makeCandidate({ patternTaxonomyCellId: context.plan.targetTaxonomyCellId, trapErrorTaxonomyCode: context.plan.targetErrorTaxonomyCode });
    const justAttempted = makeAttemptRecord({ isCorrect: false, questionId: first.question.questionId, question: { patternTaxonomyCellId: context.plan.targetTaxonomyCellId }, offsetSeconds: 10 });

    const before = asSelected(orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [context], candidates: [first, second] })));
    expect(before.actionType).toBe("targeted_repair");
    expect(before.question.questionId).toBe(first.question.questionId); // tie-break order, with no history

    const after = asSelected(orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [context], candidates: [first, second], attemptRecords: [justAttempted] })));
    expect(after.actionType).toBe("targeted_repair"); // repair priority is untouched
    expect(after.question.questionId).toBe(second.question.questionId);
  });

  it("when the just-attempted question is the ONLY candidate it is still served (documented sole-candidate fallback)", () => {
    const context = activeRepairContext();
    const only = makeCandidate({ patternTaxonomyCellId: context.plan.targetTaxonomyCellId, trapErrorTaxonomyCode: context.plan.targetErrorTaxonomyCode });
    const justAttempted = makeAttemptRecord({ isCorrect: false, questionId: only.question.questionId, offsetSeconds: 10 });
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [context], candidates: [only], attemptRecords: [justAttempted] })));
    expect(result.question.questionId).toBe(only.question.questionId);
  });
});

describe("training-system tier", () => {
  const DIMS = { conceptualLoad: 0.9, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 };

  it("Trap Lab (two incorrect answers on distinct questions with the same trap) never re-serves the just-attempted question when another trap match exists", () => {
    const a = makeCandidate({ trapErrorTaxonomyCode: "base_confusion", difficultyDimensions: DIMS });
    const b = makeCandidate({ trapErrorTaxonomyCode: "base_confusion", difficultyDimensions: DIMS });
    const records = [
      makeAttemptRecord({ isCorrect: false, questionId: "trap-q1", question: { difficultyDimensions: DIMS }, offsetSeconds: 10 }),
      makeAttemptRecord({ isCorrect: false, questionId: a.question.questionId, question: { difficultyDimensions: DIMS }, offsetSeconds: 20 })
    ];
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ attemptRecords: records, candidates: [a, b] })));
    expect(result.question.questionId).not.toBe(a.question.questionId);
    expect(result.question.questionId).toBe(b.question.questionId);
  });

  it("when the only question a provider could pick is the one just attempted and another candidate exists, the tier falls through (adaptive then serves a different question)", () => {
    const only = makeCandidate({ trapErrorTaxonomyCode: "base_confusion", difficultyDimensions: DIMS });
    const other = makeCandidate({ trapErrorTaxonomyCode: "careless_arithmetic", patternFamilyName: "Other", patternTaxonomyCellId: "cell-other", difficultyDimensions: DIMS });
    const records = [
      makeAttemptRecord({ isCorrect: false, questionId: "trap-q1", question: { difficultyDimensions: DIMS }, offsetSeconds: 10 }),
      makeAttemptRecord({ isCorrect: false, questionId: only.question.questionId, question: { difficultyDimensions: DIMS }, offsetSeconds: 20 })
    ];
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ attemptRecords: records, candidates: [only, other] })));
    expect(result.question.questionId).toBe(other.question.questionId);
  });
});
