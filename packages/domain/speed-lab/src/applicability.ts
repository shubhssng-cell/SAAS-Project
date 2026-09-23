import type { TrainingSystemApplicability, TrainingSystemContext } from "@ipmat/training-systems";
import { SPEED_LAB_CONSTANTS } from "./constants.js";
import { determineSpeedLabStage } from "./progression.js";
import { computeSpeedEvidence } from "./speedEvidence.js";
import type { SpeedEvidenceSlice, SpeedLabRequirement, SpeedLabStage } from "./types.js";

export const SPEED_LAB_NOT_APPLICABLE_REASONS = ["insufficient_evidence", "no_speed_inefficiency_detected"] as const;
export type SpeedLabNotApplicableReason = (typeof SPEED_LAB_NOT_APPLICABLE_REASONS)[number];

interface ConceptEvidence {
  conceptName: string;
  evidence: SpeedEvidenceSlice;
}

function pickTargetConcept(candidates: ConceptEvidence[]): ConceptEvidence {
  return [...candidates].sort((a, b) => (b.evidence.slowFraction as number) - (a.evidence.slowFraction as number) || a.conceptName.localeCompare(b.conceptName))[0]!;
}

function describeFraction(value: number | null): string {
  return value === null ? "insufficient data" : `${Math.round(value * 100)}%`;
}

function buildRequirement(target: ConceptEvidence, stage: SpeedLabStage): SpeedLabRequirement {
  const targetConceptName = target.conceptName;
  const notes = [
    `Targeting concept "${targetConceptName}": ${describeFraction(target.evidence.slowFraction)} of eligible graded attempts (submitted, hint-free, non-time-pressured, low-conceptual-load) were correct-and-slow. This reflects observed timing relative to expected time, not a measured "speed ability" score.`
  ];
  if (target.evidence.incorrectSlowCount > 0) {
    notes.push(
      `${target.evidence.incorrectSlowCount} incorrect-and-slow attempt(s) were also observed in the same eligible population but are NOT used to trigger or strengthen this decision -- wrongness may reflect a conceptual or calculation difficulty this provider cannot distinguish from observable data alone.`
    );
  }

  switch (stage) {
    case "steady_pace":
      return { targetConceptName, stage, maxConceptualLoad: SPEED_LAB_CONSTANTS.LOW_CONCEPTUAL_LOAD_THRESHOLD, requireTimePressured: false, notes };
    case "mixed_pace":
      return { targetConceptName, stage, maxConceptualLoad: null, requireTimePressured: false, notes };
    case "time_constrained":
      return { targetConceptName, stage, maxConceptualLoad: null, requireTimePressured: true, notes };
  }
}

/**
 * The ONE authoritative applicability decision for Speed Lab
 * (docs/DECISIONS.md D-053 adjustment 2). Evaluates every concept present
 * in the supplied candidate pool, deterministically. Fails closed to
 * `not_applicable` whenever evidence is insufficient -- a single slow
 * attempt can never trigger this, since `slowFraction` is `null` below
 * `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` eligible attempts.
 */
export function evaluateSpeedLab(context: TrainingSystemContext): TrainingSystemApplicability {
  const conceptNames = Array.from(new Set(context.candidates.map((c) => c.question.conceptName))).sort((a, b) => a.localeCompare(b));

  const evidenceByConcept: ConceptEvidence[] = conceptNames.map((name) => ({ conceptName: name, evidence: computeSpeedEvidence(name, context.studentId, context.attemptRecords) }));

  const withSufficientEvidence = evidenceByConcept.filter((e) => e.evidence.slowFraction !== null);
  if (withSufficientEvidence.length === 0) {
    return {
      applicable: false,
      reason: "insufficient_evidence",
      explanation: "No concept in the candidate pool has enough eligible graded attempts (submitted, hint-free, non-time-pressured, low-conceptual-load, validly timed) to compute a reliable correct-and-slow fraction."
    };
  }

  const withInefficiency = withSufficientEvidence.filter((e) => (e.evidence.slowFraction as number) >= SPEED_LAB_CONSTANTS.SLOW_FRACTION_THRESHOLD);
  if (withInefficiency.length === 0) {
    return {
      applicable: false,
      reason: "no_speed_inefficiency_detected",
      explanation: "Sufficient evidence exists, but no concept shows a correct-and-slow fraction meeting the provisional threshold -- this does not look like a speed-efficiency problem."
    };
  }

  const target = pickTargetConcept(withInefficiency);
  const stage = determineSpeedLabStage(target.conceptName, context.studentId, context.attemptRecords);
  const requirement = buildRequirement(target, stage);

  return {
    applicable: true,
    requirement,
    explanation: `Speed inefficiency detected for concept "${target.conceptName}" (observed timing relative to expected time, conditioned on low conceptual load and excluding hint-assisted/time-pressured attempts). Recommending stage "${stage}".`
  };
}
