import type { TrainingSystemApplicability, TrainingSystemContext } from "@ipmat/training-systems";
import { CALCULATION_GYM_CONSTANTS } from "./constants.js";
import { computeCalculationFrictionEvidence } from "./frictionEvidence.js";
import { determineCalculationTrainingStage } from "./progression.js";
import type { CalculationFrictionEvidence, CalculationGymRequirement, CalculationTrainingStage } from "./types.js";

export const CALCULATION_GYM_NOT_APPLICABLE_REASONS = ["insufficient_evidence", "no_calculation_friction_detected"] as const;
export type CalculationGymNotApplicableReason = (typeof CALCULATION_GYM_NOT_APPLICABLE_REASONS)[number];

function hasSufficientEvidence(evidence: CalculationFrictionEvidence): boolean {
  return evidence.highLoad.accuracy !== null && evidence.lowLoad.accuracy !== null;
}

function accuracyGap(evidence: CalculationFrictionEvidence): number {
  // Only called on evidence that already passed hasSufficientEvidence(), so both are non-null.
  return (evidence.lowLoad.accuracy as number) - (evidence.highLoad.accuracy as number);
}

/**
 * Deterministic tie-break among concepts that both have sufficient
 * evidence AND show friction: largest accuracy gap first, then
 * lexicographic concept name. This is a single, directly-observed
 * comparison (the gap itself) — not a weighted/composite score.
 */
function pickTargetConcept(candidates: CalculationFrictionEvidence[]): CalculationFrictionEvidence {
  return [...candidates].sort((a, b) => accuracyGap(b) - accuracyGap(a) || a.conceptName.localeCompare(b.conceptName))[0]!;
}

function buildRequirement(evidence: CalculationFrictionEvidence, stage: CalculationTrainingStage): CalculationGymRequirement {
  const targetConceptName = evidence.conceptName;
  const note = `Targeting concept "${targetConceptName}": observed accuracy on low-computational-load attempts (${describeAccuracy(evidence.lowLoad.accuracy)}) exceeds accuracy on high-computational-load attempts (${describeAccuracy(evidence.highLoad.accuracy)}) by at least the provisional friction-gap threshold. This reflects performance CONDITIONED ON Question DNA's provisional computationalLoad metadata, not a measured calculation-ability score.`;

  switch (stage) {
    case "foundational":
      return { targetConceptName, stage, minComputationalLoad: 0, requireMultiStep: false, requireTimePressured: false, notes: [note] };
    case "mixed":
      return {
        targetConceptName,
        stage,
        minComputationalLoad: CALCULATION_GYM_CONSTANTS.HIGH_COMPUTATIONAL_LOAD_THRESHOLD,
        requireMultiStep: false,
        requireTimePressured: false,
        notes: [note]
      };
    case "time_pressured":
      return {
        targetConceptName,
        stage,
        minComputationalLoad: CALCULATION_GYM_CONSTANTS.HIGH_COMPUTATIONAL_LOAD_THRESHOLD,
        requireMultiStep: false,
        requireTimePressured: true,
        notes: [note]
      };
  }
}

function describeAccuracy(value: number | null): string {
  return value === null ? "insufficient data" : `${Math.round(value * 100)}%`;
}

/**
 * The ONE authoritative applicability decision for Calculation Gym
 * (docs/DECISIONS.md D-053 adjustment 2). Evaluates every concept present
 * in the supplied candidate pool, deterministically. Fails closed to
 * `not_applicable` whenever evidence is insufficient — never guesses.
 */
export function evaluateCalculationGym(context: TrainingSystemContext): TrainingSystemApplicability {
  const conceptNames = Array.from(new Set(context.candidates.map((c) => c.question.conceptName))).sort((a, b) => a.localeCompare(b));

  const evidenceByConcept = conceptNames.map((name) => computeCalculationFrictionEvidence(name, context.studentId, context.attemptRecords));

  const withSufficientEvidence = evidenceByConcept.filter(hasSufficientEvidence);
  if (withSufficientEvidence.length === 0) {
    return {
      applicable: false,
      reason: "insufficient_evidence",
      explanation: "No concept in the candidate pool has enough graded attempts in BOTH a high- and a low-computational-load slice to compare accuracy conditioned on Question DNA's provisional computationalLoad metadata."
    };
  }

  const withFriction = withSufficientEvidence.filter((e) => e.frictionDetected);
  if (withFriction.length === 0) {
    return {
      applicable: false,
      reason: "no_calculation_friction_detected",
      explanation: "Sufficient evidence exists, but no concept shows accuracy meaningfully lower on high-computational-load attempts than on low-computational-load attempts — this does not look like calculation-specific friction."
    };
  }

  const target = pickTargetConcept(withFriction);
  const stage = determineCalculationTrainingStage(target.conceptName, context.studentId, context.attemptRecords);
  const requirement = buildRequirement(target, stage);

  return {
    applicable: true,
    requirement,
    explanation: `Calculation-specific friction detected for concept "${target.conceptName}" (accuracy conditioned on provisional computationalLoad metadata is lower on high-load attempts than low-load attempts). Recommending stage "${stage}".`
  };
}
