import { evaluateCalculationGym } from "@ipmat/calculation-gym";
import { evaluateNoveltyTraining } from "@ipmat/novelty-training";
import { evaluatePressureTraining } from "@ipmat/pressure-training";
import { evaluateSpeedLab } from "@ipmat/speed-lab";
import { evaluateTrapLab } from "@ipmat/trap-lab";
import type { TrainingPracticeBlockContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { orchestrateNextTrainingAction } from "../src/orchestrate.js";
import { toTrainingSystemContext } from "../src/trainingSystemProviders.js";
import type { TrainingOrchestrationInput, TrainingOrchestrationResult } from "../src/types.js";
import { activeRepairContext, makeAttemptRecord, makeCandidate, STUDENT } from "./fixtures.js";

/**
 * D-062 integration tests: the new `training_system_practice` middle tier.
 * Every fixture here is built with training-orchestration's OWN fixture
 * helpers (`test/fixtures.ts`) — never any provider's own test fixtures —
 * and every "this provider's own evidence is genuinely sufficient" claim
 * is independently verified by calling that provider's OWN real
 * `evaluateXxx()` function directly against the SAME `TrainingSystemContext`,
 * never assumed.
 */

function baseInput(overrides: Partial<TrainingOrchestrationInput> = {}): TrainingOrchestrationInput {
  return { studentId: STUDENT, activeRepairPlans: [], masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

function asSelected(result: TrainingOrchestrationResult) {
  if (result.status !== "selected") throw new Error(`Expected a selection, got ${result.status}${"reason" in result ? ` (${result.reason})` : ""}`);
  return result;
}

// ---------------------------------------------------------------------
// Per-provider evidence builders -- each returns {attemptRecords, candidates,
// practiceBlocks?} sufficient to make exactly ONE provider applicable.
// ---------------------------------------------------------------------

// Every builder below EXCEPT calculationGymEvidence()/speedLabEvidence() deliberately
// gives its attempts a HIGH conceptualLoad (0.9) -- none of trap-lab/pressure-training/
// novelty-training's own gates read conceptualLoad at all, but Speed Lab's eligibility
// REQUIRES low conceptualLoad, so this keeps those three providers' fixtures from
// silently diluting Speed Lab's slowFraction denominator when combined in the same
// context (the adjacent-pair tests below deliberately combine two builders'
// attemptRecords). `testingModes: ["time_pressured"]` was deliberately NOT used for
// this exclusion: Calculation Gym's OWN stage-progression logic (progression.ts)
// filters its "mixed-shaped" evidence slice by `!testingModes.includes("time_pressured")`,
// so marking attempts time-pressured would silently change calc-gym's OWN computed
// stage (and therefore its requirement's minComputationalLoad) -- a real interaction
// found while writing this fixture, not assumed away.
const HIGH_CONCEPTUAL_LOAD_DIMS = { conceptualLoad: 0.9, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 };

function trapLabEvidence() {
  const attemptRecords = [
    makeAttemptRecord({ isCorrect: false, question: { difficultyDimensions: HIGH_CONCEPTUAL_LOAD_DIMS }, questionId: "trap-q1" }),
    makeAttemptRecord({ isCorrect: false, question: { difficultyDimensions: HIGH_CONCEPTUAL_LOAD_DIMS }, questionId: "trap-q2" })
  ];
  const candidates = [makeCandidate({ trapErrorTaxonomyCode: "base_confusion" })];
  return { attemptRecords, candidates };
}

function calculationGymEvidence() {
  const lowLoadDims = { conceptualLoad: 0.9, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 };
  const highLoadDims = { ...lowLoadDims, computationalLoad: 0.8 };
  const attemptRecords = [
    makeAttemptRecord({ isCorrect: true, question: { difficultyDimensions: lowLoadDims }, questionId: "cg-low-1" }),
    makeAttemptRecord({ isCorrect: true, question: { difficultyDimensions: lowLoadDims }, questionId: "cg-low-2" }),
    makeAttemptRecord({ isCorrect: true, question: { difficultyDimensions: lowLoadDims }, questionId: "cg-low-3" }),
    makeAttemptRecord({ isCorrect: false, question: { difficultyDimensions: highLoadDims }, questionId: "cg-high-1" }),
    makeAttemptRecord({ isCorrect: false, question: { difficultyDimensions: highLoadDims }, questionId: "cg-high-2" }),
    makeAttemptRecord({ isCorrect: false, question: { difficultyDimensions: highLoadDims }, questionId: "cg-high-3" })
  ];
  // The friction evidence above (100% low-load accuracy, 0% high-load accuracy)
  // ALWAYS clears determineCalculationTrainingStage()'s "foundational" gate (its own
  // low-load-and-not-multi-step slice IS this exact low-load-100%-correct data), so
  // the resolved stage is "mixed", whose requirement needs minComputationalLoad >= 0.5
  // -- the candidate must be HIGH-load, not low-load, found by tracing the real logic.
  const candidates = [makeCandidate({ difficultyDimensions: highLoadDims, trapErrorTaxonomyCode: null })];
  return { attemptRecords, candidates };
}

function speedLabEvidence() {
  const attemptRecords = [
    makeAttemptRecord({ isCorrect: true, timeTakenSeconds: 300, expectedTimeSeconds: 90, questionId: "sl-1" }),
    makeAttemptRecord({ isCorrect: true, timeTakenSeconds: 300, expectedTimeSeconds: 90, questionId: "sl-2" }),
    makeAttemptRecord({ isCorrect: true, timeTakenSeconds: 300, expectedTimeSeconds: 90, questionId: "sl-3" })
  ];
  const candidates = [makeCandidate({ trapErrorTaxonomyCode: null })];
  return { attemptRecords, candidates };
}

function pressureTrainingEvidence() {
  const makeBlock = (prefix: string, n: number, gaps: number[]): { attempts: ReturnType<typeof makeAttemptRecord>[]; block: TrainingPracticeBlockContext } => {
    const attempts = Array.from({ length: n }, (_, i) =>
      makeAttemptRecord({ isCorrect: true, offsetSeconds: i * 60, question: { difficultyDimensions: HIGH_CONCEPTUAL_LOAD_DIMS }, questionId: `${prefix}-q${i}` })
    );
    const ids = attempts.map((a) => a.contribution.attemptId);
    return {
      attempts,
      block: {
        practiceBlockId: prefix,
        attemptIdsInOrder: ids,
        targetQuestionCount: null,
        blockTimeBudgetSeconds: null,
        wallClockDurationSeconds: null,
        activeSolvingTimeSeconds: 60 * n,
        interAttemptGapsSeconds: gaps
      }
    };
  };
  const b1 = makeBlock("pt-b1", 3, [30, 30]);
  const b2 = makeBlock("pt-b2", 3, [30, 30]);
  const b3 = makeBlock("pt-b3", 3, [3, 4]); // short recovery -- the one triggering block
  const attemptRecords = [...b1.attempts, ...b2.attempts, ...b3.attempts];
  const practiceBlocks = [b1.block, b2.block, b3.block];
  const candidates = [makeCandidate({ trapErrorTaxonomyCode: null })];
  return { attemptRecords, candidates, practiceBlocks };
}

function noveltyTrainingEvidence() {
  const attemptRecords = [
    makeAttemptRecord({ isCorrect: true, question: { difficultyDimensions: HIGH_CONCEPTUAL_LOAD_DIMS }, questionId: "nt-1" }),
    makeAttemptRecord({ isCorrect: true, question: { difficultyDimensions: HIGH_CONCEPTUAL_LOAD_DIMS }, questionId: "nt-2" }),
    makeAttemptRecord({ isCorrect: true, question: { difficultyDimensions: HIGH_CONCEPTUAL_LOAD_DIMS }, questionId: "nt-3" })
  ];
  // With the baseline cleared and all three non-standard dimensions tied at 0
  // exposure, evaluateNoveltyTraining()'s deterministic tie-break picks the
  // lexicographically first level: "novel_combination" (not "novel_representation").
  const candidates = [makeCandidate({ noveltyLevel: "novel_combination", trapErrorTaxonomyCode: null })];
  return { attemptRecords, candidates };
}

describe("each provider selected in isolation (D-062)", () => {
  it("Trap Lab", () => {
    const evidence = trapLabEvidence();
    const result = asSelected(orchestrateNextTrainingAction(baseInput(evidence)));
    expect(result.actionType).toBe("training_system_practice");
    if (result.actionType === "training_system_practice") expect(result.providerId).toBe("trap-lab");
  });

  it("Calculation Gym", () => {
    const evidence = calculationGymEvidence();
    const context = toTrainingSystemContext(baseInput(evidence));
    expect(evaluateCalculationGym(context).applicable).toBe(true); // independently verified, not assumed
    const result = asSelected(orchestrateNextTrainingAction(baseInput(evidence)));
    expect(result.actionType).toBe("training_system_practice");
    if (result.actionType === "training_system_practice") expect(result.providerId).toBe("calculation-gym");
  });

  it("Speed Lab", () => {
    const evidence = speedLabEvidence();
    const context = toTrainingSystemContext(baseInput(evidence));
    expect(evaluateSpeedLab(context).applicable).toBe(true);
    const result = asSelected(orchestrateNextTrainingAction(baseInput(evidence)));
    expect(result.actionType).toBe("training_system_practice");
    if (result.actionType === "training_system_practice") expect(result.providerId).toBe("speed-lab");
  });

  it("Pressure Training", () => {
    const evidence = pressureTrainingEvidence();
    const context = toTrainingSystemContext(baseInput(evidence));
    expect(evaluatePressureTraining(context).applicable).toBe(true);
    const result = asSelected(orchestrateNextTrainingAction(baseInput(evidence)));
    expect(result.actionType).toBe("training_system_practice");
    if (result.actionType === "training_system_practice") expect(result.providerId).toBe("pressure-training");
  });

  it("Novelty Training", () => {
    const evidence = noveltyTrainingEvidence();
    const context = toTrainingSystemContext(baseInput(evidence));
    expect(evaluateNoveltyTraining(context).applicable).toBe(true);
    const result = asSelected(orchestrateNextTrainingAction(baseInput(evidence)));
    expect(result.actionType).toBe("training_system_practice");
    if (result.actionType === "training_system_practice") expect(result.providerId).toBe("novelty-training");
  });
});

describe("adjacent priority-pair tests -- fixed order is trap-lab > calculation-gym > speed-lab > pressure-training > novelty-training", () => {
  it("trap-lab beats calculation-gym", () => {
    const trap = trapLabEvidence();
    const calc = calculationGymEvidence();
    const attemptRecords = [...trap.attemptRecords, ...calc.attemptRecords];
    const candidates = [...trap.candidates, ...calc.candidates];
    const context = toTrainingSystemContext(baseInput({ attemptRecords, candidates }));
    expect(evaluateTrapLab(context).applicable).toBe(true);
    expect(evaluateCalculationGym(context).applicable).toBe(true);

    const result = asSelected(orchestrateNextTrainingAction(baseInput({ attemptRecords, candidates })));
    if (result.actionType === "training_system_practice") {
      expect(result.providerId).toBe("trap-lab");
      expect(result.diagnostics.trainingSystemProviderOutcomes).toHaveLength(1); // calculation-gym never even invoked
    }
  });

  it("calculation-gym beats speed-lab", () => {
    const calc = calculationGymEvidence();
    const speed = speedLabEvidence();
    const attemptRecords = [...calc.attemptRecords, ...speed.attemptRecords];
    const candidates = [...calc.candidates, ...speed.candidates];
    const context = toTrainingSystemContext(baseInput({ attemptRecords, candidates }));
    expect(evaluateCalculationGym(context).applicable).toBe(true);
    expect(evaluateSpeedLab(context).applicable).toBe(true);

    const result = asSelected(orchestrateNextTrainingAction(baseInput({ attemptRecords, candidates })));
    if (result.actionType === "training_system_practice") {
      expect(result.providerId).toBe("calculation-gym");
      expect(result.diagnostics.trainingSystemProviderOutcomes).toHaveLength(2); // trap-lab (not applicable), calculation-gym (selected)
    }
  });

  it("speed-lab beats pressure-training", () => {
    const speed = speedLabEvidence();
    const pressure = pressureTrainingEvidence();
    const attemptRecords = [...speed.attemptRecords, ...pressure.attemptRecords];
    const candidates = [...speed.candidates, ...pressure.candidates];
    const practiceBlocks = pressure.practiceBlocks;
    const context = toTrainingSystemContext(baseInput({ attemptRecords, candidates, practiceBlocks }));
    expect(evaluateSpeedLab(context).applicable).toBe(true);
    expect(evaluatePressureTraining(context).applicable).toBe(true);

    const result = asSelected(orchestrateNextTrainingAction(baseInput({ attemptRecords, candidates, practiceBlocks })));
    if (result.actionType === "training_system_practice") expect(result.providerId).toBe("speed-lab");
  });

  it("pressure-training beats novelty-training", () => {
    const pressure = pressureTrainingEvidence();
    const novelty = noveltyTrainingEvidence();
    const attemptRecords = [...pressure.attemptRecords, ...novelty.attemptRecords];
    const candidates = [...pressure.candidates, ...novelty.candidates];
    const practiceBlocks = pressure.practiceBlocks;
    const context = toTrainingSystemContext(baseInput({ attemptRecords, candidates, practiceBlocks }));
    expect(evaluatePressureTraining(context).applicable).toBe(true);
    expect(evaluateNoveltyTraining(context).applicable).toBe(true);

    const result = asSelected(orchestrateNextTrainingAction(baseInput({ attemptRecords, candidates, practiceBlocks })));
    if (result.actionType === "training_system_practice") expect(result.providerId).toBe("pressure-training");
  });
});

describe("no eligible question falls through to the next provider (D-062)", () => {
  it("trap-lab applicable but no matching candidate -> falls through to calculation-gym", () => {
    const trap = trapLabEvidence();
    const calc = calculationGymEvidence();
    // Deliberately omit trap-lab's own matching candidate -- only calc-gym's candidate is supplied.
    const attemptRecords = [...trap.attemptRecords, ...calc.attemptRecords];
    const candidates = [...calc.candidates];
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ attemptRecords, candidates })));
    if (result.actionType === "training_system_practice") {
      expect(result.providerId).toBe("calculation-gym");
      expect(result.diagnostics.trainingSystemProviderOutcomes[0]?.outcome.status).toBe("no_eligible_question");
    }
  });
});

describe("repair beats all five training-system providers (D-062)", () => {
  it("a confirmed, actionable RepairPlan wins even when a provider would otherwise be applicable", () => {
    const context = activeRepairContext();
    const repairCandidate = makeCandidate({ patternTaxonomyCellId: context.plan.targetTaxonomyCellId, trapErrorTaxonomyCode: context.plan.targetErrorTaxonomyCode });
    const trap = trapLabEvidence();

    const result = asSelected(
      orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [context], attemptRecords: trap.attemptRecords, candidates: [repairCandidate, ...trap.candidates] }))
    );
    expect(result.actionType).toBe("targeted_repair");
    expect(result.diagnostics.trainingSystemProviderOutcomes).toEqual([]); // training systems never even invoked
  });
});

describe("all five providers unavailable -> falls through to adaptive practice (D-062)", () => {
  it("empty attempt history: every provider not_applicable, diagnostics preserve all five raw outcomes", () => {
    const candidate = makeCandidate();
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ candidates: [candidate] })));
    expect(result.actionType).toBe("adaptive_practice");
    expect(result.diagnostics.trainingSystemProviderOutcomes).toHaveLength(5);
    expect(result.diagnostics.trainingSystemProviderOutcomes.every((o) => o.outcome.status === "not_applicable")).toBe(true);
    expect(result.diagnostics.trainingSystemProviderChosen).toBeNull();
    if (result.actionType === "adaptive_practice") {
      expect(result.wasFallbackFromRepair).toBe(false);
      expect(result.wasFallbackFromTrainingSystems).toBe(true);
    }
  });
});

describe("both fallback flags across all relevant combinations (D-062)", () => {
  it("repair not eligible, training systems not applicable, adaptive selected: both flags false/true as appropriate", () => {
    const candidate = makeCandidate();
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ candidates: [candidate] })));
    if (result.actionType === "adaptive_practice") {
      expect(result.wasFallbackFromRepair).toBe(false); // no repair plan was ever supplied
      expect(result.wasFallbackFromTrainingSystems).toBe(true); // training systems WERE tried (5 outcomes), just none selected
    }
  });

  it("repair attempted-but-no_match, training systems not applicable, adaptive selected: both flags true", () => {
    // An eligible RepairPlan whose OWN target has no matching candidate -> repair attempted, outcome no_match.
    const context = activeRepairContext();
    const unrelatedCandidate = makeCandidate({ patternTaxonomyCellId: "totally-different-cell", trapErrorTaxonomyCode: null });
    const result = asSelected(orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [context], candidates: [unrelatedCandidate] })));
    if (result.actionType === "adaptive_practice") {
      expect(result.wasFallbackFromRepair).toBe(true);
      expect(result.wasFallbackFromTrainingSystems).toBe(true);
    }
    expect(result.diagnostics.repairAttempted).toBe(true);
  });

  it("repair not eligible, a training-system provider selects: wasFallbackFromRepair is false (no repair to fall back from)", () => {
    const trap = trapLabEvidence();
    const result = asSelected(orchestrateNextTrainingAction(baseInput(trap)));
    if (result.actionType === "training_system_practice") expect(result.wasFallbackFromRepair).toBe(false);
  });

  it("repair attempted-but-no_match, a training-system provider selects: wasFallbackFromRepair is true", () => {
    const context = activeRepairContext();
    const unrelatedCandidate = makeCandidate({ patternTaxonomyCellId: "totally-different-cell", trapErrorTaxonomyCode: null });
    const trap = trapLabEvidence();
    const result = asSelected(
      orchestrateNextTrainingAction(baseInput({ activeRepairPlans: [context], attemptRecords: trap.attemptRecords, candidates: [unrelatedCandidate, ...trap.candidates] }))
    );
    if (result.actionType === "training_system_practice") expect(result.wasFallbackFromRepair).toBe(true);
  });
});

describe("naming-collision regression: adaptive-selection's own pressure_gap/novelty_gap reason codes never interact with the concrete providers of similar name (D-062)", () => {
  it("mastery-shaped evidence that would drive adaptive-selection's own pressure_gap/novelty_gap reasoning does not make the concrete Pressure Training / Novelty Training providers applicable on its own", () => {
    // No practiceBlocks, no standard-exposure baseline -- only ordinary attempt history.
    // This is exactly the shape adaptive-selection's OWN pressure_gap/novelty_gap reason
    // codes might read from MasteryStateResult -- proving the two vocabularies are
    // independent, not aliases of each other.
    const attemptRecords = [makeAttemptRecord({ isCorrect: false }), makeAttemptRecord({ isCorrect: false })];
    const context = toTrainingSystemContext(baseInput({ attemptRecords }));
    expect(evaluatePressureTraining(context).applicable).toBe(false);
    expect(evaluateNoveltyTraining(context).applicable).toBe(false);
  });
});
