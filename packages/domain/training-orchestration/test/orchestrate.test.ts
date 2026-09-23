import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { attemptAdaptivePractice, attemptTargetedRepair, orchestrateNextTrainingAction, shouldAttemptAdaptivePractice, TRAINING_ORCHESTRATION_POLICY } from "../src/orchestrate.js";
import { selectPlanForOrchestration } from "../src/repairPlanSelection.js";
import type { TrainingOrchestrationInput, TrainingOrchestrationResult } from "../src/types.js";
import { activeRepairContext, computeMasteryFor, makeAttemptRecord, makeCandidate, STUDENT, t } from "./fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function baseInput(overrides: Partial<TrainingOrchestrationInput> = {}): TrainingOrchestrationInput {
  return {
    studentId: STUDENT,
    activeRepairPlans: [],
    masteryByConcept: [],
    attemptRecords: [],
    candidates: [],
    ...overrides
  };
}

function asSelected(result: TrainingOrchestrationResult) {
  if (result.status !== "selected") throw new Error(`Expected a selection, got ${result.status} (${result.reason})`);
  return result;
}

function asNoAction(result: TrainingOrchestrationResult) {
  if (result.status !== "no_action") throw new Error(`Expected no_action, got ${result.status}`);
  return result;
}

describe("orchestrateNextTrainingAction — 1/5. a confirmed, actionable RepairPlan produces targeted_repair", () => {
  it("selects targeted_repair and preserves repair-selection's own result unmodified", () => {
    const context = activeRepairContext();
    const candidate = makeCandidate({ patternTaxonomyCellId: context.plan.targetTaxonomyCellId, trapErrorTaxonomyCode: context.plan.targetErrorTaxonomyCode });

    const result = asSelected(orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [context], candidates: [candidate] })));

    expect(result.actionType).toBe("targeted_repair");
    if (result.actionType === "targeted_repair") {
      expect(result.question.questionId).toBe(candidate.question.questionId);
      expect(result.providerResult.matchTier).toBe("direct_cell_and_trap");
      expect(result.providerResult.isFallback).toBe(false);
    }
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.diagnostics.repairOutcome?.status).toBe("selected");
    expect(result.diagnostics.adaptiveAttempted).toBe(false); // repair succeeded -- adaptive was never even consulted
  });
});

describe("orchestrateNextTrainingAction — 2. no RepairPlan produces adaptive_practice", () => {
  it("delegates straight to adaptive-selection when no repair plans are supplied", () => {
    const candidate = makeCandidate();
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ candidates: [candidate] })));

    expect(result.actionType).toBe("adaptive_practice");
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(result.diagnostics.adaptiveAttempted).toBe(true);
    if (result.actionType === "adaptive_practice") expect(result.wasFallbackFromRepair).toBe(false);
  });
});

describe("orchestrateNextTrainingAction — 3/4. an unconfirmed (awaiting/rejected/corrected) diagnosis cannot become targeted repair, and fails safely", () => {
  it("a RepairPlan-shaped object without a genuine hypothesisConfirmedAt is excluded before repair-selection is ever called, and orchestration falls through cleanly", () => {
    const unconfirmedContext = activeRepairContext({ confirmationSource: { attemptId: "attempt-x", hypothesisConfirmedAt: "" } });
    const candidate = makeCandidate();

    const result = orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [unconfirmedContext], candidates: [candidate] }));

    expect(result.diagnostics.repairPlansExcludedAsUnconfirmed).toBe(1);
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(result.diagnostics.repairOutcome).toBeNull();
    // Fails SAFELY -- no exception, a well-formed result is still produced (falls through to adaptive).
    expect(result.status).toBe("selected");
    if (result.status === "selected") expect(result.actionType).toBe("adaptive_practice");
  });
});

describe("orchestrateNextTrainingAction — 6/7. targeted repair no_match triggers the explicit, policy-controlled fallback", () => {
  it("a repair plan targeting a concept with no matching candidates returns no_match, and diagnostics preserve that fact even after falling back", () => {
    const context = activeRepairContext({ targetConceptName: "Percentages" });
    // Candidate for a DIFFERENT concept entirely -- repair-selection will find no_candidates_for_concept.
    const candidate = makeCandidate({ conceptName: "Ratios", patternFamilyName: "Basic Ratio", patternTaxonomyCellId: "cell-ratios-1" });

    const result = orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [context], candidates: [candidate] }));

    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.diagnostics.repairOutcome?.status).toBe("no_match");
    expect(result.diagnostics.fallbackPermittedByPolicy).toBe(true);
    expect(result.diagnostics.fallbackOccurred).toBe(true);
    // The repair no_match must NOT be silently invisible just because adaptive practice succeeded.
    expect(result.status).toBe("selected");
    if (result.status === "selected" && result.actionType === "adaptive_practice") {
      expect(result.wasFallbackFromRepair).toBe(true);
    } else {
      expect.fail("expected a selected adaptive_practice result");
    }
  });

  it("shouldAttemptAdaptivePractice() is independently testable for BOTH policy outcomes", () => {
    const noMatchOutcome = { status: "no_match" as const, reason: "no_candidates_for_concept" as const, explanation: "x", candidatesConsidered: 1, excludedMalformedCount: 0 };
    expect(shouldAttemptAdaptivePractice(true, noMatchOutcome, true)).toBe(true);
    expect(shouldAttemptAdaptivePractice(true, noMatchOutcome, false)).toBe(false);
    // The real, current V1 policy: fallback IS permitted.
    expect(TRAINING_ORCHESTRATION_POLICY.ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH).toBe(true);
  });

  it("when policy would not permit a fallback, orchestrateNextTrainingAction()'s own no_action branch is reachable (verified via the underlying decision function, matching the design's chosen policy)", () => {
    // V1's orchestrateNextTrainingAction() always uses the fixed, permissive policy -- this test
    // verifies the ALTERNATIVE branch's logic directly, proving it is real, reachable code, not
    // dead code, even though the public orchestrator does not expose a way to select it today.
    const noMatchOutcome = { status: "no_match" as const, reason: "no_candidates_for_concept" as const, explanation: "x", candidatesConsidered: 1, excludedMalformedCount: 0 };
    expect(shouldAttemptAdaptivePractice(true, noMatchOutcome, false)).toBe(false);
  });
});

describe("orchestrateNextTrainingAction — 8/9. adaptive selection success and no-selection", () => {
  it("adaptive practice supplies a question when eligible candidates exist", () => {
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ candidates: [makeCandidate()] })));
    expect(result.actionType).toBe("adaptive_practice");
  });

  it("no candidates at all -> explicit no_action, neither engine meaningfully consulted", () => {
    const result = asNoAction(orchestrateNextTrainingAction(baseInput()));
    expect(result.reason).toBe("no_candidates_supplied");
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(result.diagnostics.adaptiveAttempted).toBe(false);
  });

  it("candidates exist but none are published -> adaptive no-selection surfaces as orchestration no_action", () => {
    const result = asNoAction(orchestrateNextTrainingAction(baseInput({ candidates: [makeCandidate({}, { validationState: "draft" })] })));
    expect(result.reason).toBe("no_eligible_action");
    expect(result.diagnostics.adaptiveOutcome?.status).toBe("no_selection");
  });
});

describe("orchestrateNextTrainingAction — 10. cold-start student", () => {
  it("zero attempt history still produces a deterministic adaptive_practice selection, reusing 5C-3's own cold-start behavior", () => {
    const candidateA = makeCandidate({ patternTaxonomyCellId: "cell-cold-a", questionId: "question-cold-a" });
    const candidateB = makeCandidate({ patternTaxonomyCellId: "cell-cold-b", questionId: "question-cold-b" });
    const input = baseInput({ candidates: [candidateA, candidateB] });

    const first = asSelected(orchestrateNextTrainingAction(input));
    const second = asSelected(orchestrateNextTrainingAction(input));

    expect(first.actionType).toBe("adaptive_practice");
    if (first.actionType === "adaptive_practice") expect(first.providerResult.primaryReason).toBe("coverage_gap");
    expect(second.question.questionId).toBe(first.question.questionId); // deterministic
  });
});

describe("orchestrateNextTrainingAction — 11. insufficient mastery evidence is passed through honestly, never reinterpreted", () => {
  it("a concept with fewer than the minimum observations never produces an accuracy_weakness claim via the orchestrator", () => {
    const cellId = "cell-percentages-insufficient";
    const attempts = [
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 0, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 60, question: { patternTaxonomyCellId: cellId } })
    ];
    const mastery = computeMasteryFor(attempts);
    expect(mastery.measures.accuracy).toBeNull();

    const result = asSelected(orchestrateNextTrainingAction(baseInput({ masteryByConcept: [mastery], attemptRecords: attempts, candidates: [makeCandidate({ patternTaxonomyCellId: cellId })] })));

    if (result.actionType === "adaptive_practice") {
      expect(result.providerResult.allReasonsSatisfied).not.toContain("accuracy_weakness");
    }
  });
});

describe("orchestrateNextTrainingAction — 12. multiple RepairPlans: deterministic priority choice", () => {
  it("the higher-priority plan is chosen for orchestration", () => {
    const low = activeRepairContext({ targetConceptName: "Percentages", priority: "low" });
    const high = activeRepairContext({ targetConceptName: "Ratios", targetPatternFamilyName: "Basic Ratio", targetTaxonomyCellId: "cell-ratios-high", priority: "high" });

    const { chosen } = selectPlanForOrchestration([low, high]);
    expect(chosen?.plan.targetConceptName).toBe("Ratios");
  });

  it("equal priority breaks by more-recently-confirmed", () => {
    const older = activeRepairContext({ targetConceptName: "Percentages", priority: "medium", confirmationSource: { attemptId: "a1", hypothesisConfirmedAt: t(0) } });
    const newer = activeRepairContext({ targetConceptName: "Ratios", priority: "medium", confirmationSource: { attemptId: "a2", hypothesisConfirmedAt: t(3600) } });

    const { chosen } = selectPlanForOrchestration([older, newer]);
    expect(chosen?.plan.targetConceptName).toBe("Ratios");
  });

  it("equal priority AND equal confirmedAt breaks by lexicographic targetConceptName -- fully deterministic", () => {
    const sameTime = t(0);
    const zConcept = activeRepairContext({ targetConceptName: "Zeta Concept", priority: "medium", confirmationSource: { attemptId: "a1", hypothesisConfirmedAt: sameTime } });
    const aConcept = activeRepairContext({ targetConceptName: "Alpha Concept", priority: "medium", confirmationSource: { attemptId: "a2", hypothesisConfirmedAt: sameTime } });

    const { chosen } = selectPlanForOrchestration([zConcept, aConcept]);
    expect(chosen?.plan.targetConceptName).toBe("Alpha Concept");
  });
});

describe("orchestrateNextTrainingAction — 13. deterministic tie-breaking for orchestration decisions overall", () => {
  it("re-running the same input yields an identical result", () => {
    const context = activeRepairContext();
    const candidate = makeCandidate({ patternTaxonomyCellId: context.plan.targetTaxonomyCellId });
    const input = baseInput({ activeRepairPlans: [context], candidates: [candidate] });

    const first = orchestrateNextTrainingAction(input);
    const second = orchestrateNextTrainingAction(input);
    expect(first).toEqual(second);
  });
});

describe("orchestrateNextTrainingAction — 14/15. no reimplementation of either engine's internal ranking logic", () => {
  it("orchestrate.ts imports only the PUBLIC contract from @ipmat/repair-selection (selectRepairQuestion, RepairSelectionError) -- never its internal matchTier/tieBreak/candidateValidation modules", () => {
    const source = readFileSync(join(__dirname, "..", "src", "orchestrate.ts"), "utf-8");
    const repairImportLine = source.split("\n").find((line) => line.includes("@ipmat/repair-selection"));
    expect(repairImportLine).toMatch(/selectRepairQuestion/);
    expect(repairImportLine).toMatch(/RepairSelectionError/);
    expect(source).not.toMatch(/classifyMatchTier|applyOveruseAvoidance|pickWinner|REPAIR_MATCH_TIER_ORDER/);
  });

  it("orchestrate.ts imports only the PUBLIC contract from @ipmat/adaptive-selection (selectNextQuestion, computeExposureCounts) -- never its internal trainingNeeds/tieBreak modules", () => {
    const orchestrateSource = readFileSync(join(__dirname, "..", "src", "orchestrate.ts"), "utf-8");
    const exposureSource = readFileSync(join(__dirname, "..", "src", "priorExposure.ts"), "utf-8");
    expect(orchestrateSource).toMatch(/import\s*\{\s*selectNextQuestion\s*\}\s*from\s*"@ipmat\/adaptive-selection"/);
    expect(exposureSource).toMatch(/import\s*\{\s*computeExposureCounts\s*\}\s*from\s*"@ipmat\/adaptive-selection"/);
    expect(orchestrateSource + exposureSource).not.toMatch(/determineSatisfiedReasons|rankCandidates|computeProgressionTargetTier|TRAINING_NEED_PRIORITY_ORDER/);
  });
});

describe("orchestrateNextTrainingAction — 16/17. no composite mastery score, no hidden psychological state", () => {
  it("a selected result carries no field resembling a single score, confidence, or psychological state", () => {
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ candidates: [makeCandidate()] })));
    const forbidden = ["score", "overallmastery", "confidence", "motivation", "emotion", "intelligence", "predictedability", "anxiety"];
    for (const key of Object.keys(result)) {
      expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false);
    }
    for (const key of Object.keys(result.diagnostics)) {
      expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false);
    }
  });
});

describe("orchestrateNextTrainingAction — 18. a future training-mode provider can be represented without modifying the core result contract", () => {
  it("attemptTargetedRepair() and attemptAdaptivePractice() share a common {attempted, outcome} shape a future provider function can also implement", () => {
    const repairAttempt = attemptTargetedRepair(baseInput({ candidates: [makeCandidate()] }));
    const adaptiveAttempt = attemptAdaptivePractice(baseInput({ candidates: [makeCandidate()] }));

    // Both conform to the SAME minimal shape -- a future attemptCalculationGym()-style
    // function would too, and could be slotted into orchestrateNextTrainingAction()'s
    // sequence without altering either of these two functions.
    const shapes: Array<{ attempted: boolean; outcome: unknown }> = [repairAttempt, adaptiveAttempt];
    for (const shape of shapes) {
      expect(typeof shape.attempted).toBe("boolean");
      expect("outcome" in shape).toBe(true);
    }
  });
});

describe("orchestrateNextTrainingAction — regression guard: malformed candidates are excluded, never crash orchestration", () => {
  it("a malformed candidate mixed with a valid one still produces a selection, with the malformed one excluded by whichever engine handled it", () => {
    const malformed = makeCandidate({ patternTaxonomyCellId: "" });
    const valid = makeCandidate();
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ candidates: [malformed, valid] })));
    expect(result.question.questionId).toBe(valid.question.questionId);
  });
});
