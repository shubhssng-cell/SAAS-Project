import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import type { TrainingSystemApplicability, TrainingSystemContext } from "@ipmat/training-systems";
import { computeNoveltyExposureEvidence, distinctConceptNames } from "./noveltyEvidence.js";
import type { NonStandardNoveltyLevel, NoveltyTrainingRequirement } from "./types.js";

export const NOVELTY_TRAINING_NOT_APPLICABLE_REASONS = ["insufficient_evidence", "sufficient_novelty_exposure"] as const;
export type NoveltyTrainingNotApplicableReason = (typeof NOVELTY_TRAINING_NOT_APPLICABLE_REASONS)[number];

/** Cumulative-history disclosure (docs/DECISIONS.md D-058), same pattern as D-056: no recency/decay model exists. */
const CUMULATIVE_HISTORY_NOTE =
  "This evidence is cumulative over the entire supplied attempt history and is never decayed or aged out. Recency-aware behavior is deferred to a future Revision/Overtraining/Exposure-control system.";

interface QualifyingTarget {
  conceptName: string;
  noveltyLevel: NonStandardNoveltyLevel;
  distinctCount: number;
}

/** The three exposure labels (docs/DECISIONS.md D-058), all keyed off the SAME reused gate -- never a second threshold. */
function describeExposure(count: number): string {
  if (count === 0) return "limited prior exposure";
  if (count < MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT) return "underexposed";
  return "sufficient exposure";
}

function pickTarget(qualifying: QualifyingTarget[]): QualifyingTarget {
  return [...qualifying].sort(
    (a, b) => a.distinctCount - b.distinctCount || a.conceptName.localeCompare(b.conceptName) || a.noveltyLevel.localeCompare(b.noveltyLevel)
  )[0]!;
}

function buildRequirement(target: QualifyingTarget): NoveltyTrainingRequirement {
  return {
    targetConceptName: target.conceptName,
    targetNoveltyLevel: target.noveltyLevel,
    notes: [
      `Concept "${target.conceptName}", novelty level "${target.noveltyLevel}": ${describeExposure(target.distinctCount)} -- ${target.distinctCount} distinct question(s) observed. This is an exposure count, never a weighted or composite score.`,
      CUMULATIVE_HISTORY_NOTE
    ]
  };
}

/**
 * The ONE authoritative applicability decision for Novelty Training (docs/
 * DECISIONS.md D-053 adjustment 2 / D-058). Reads ONLY
 * `context.studentId` and `context.attemptRecords` -- `context.candidates`
 * is NEVER read here. Candidate composition has zero effect on this
 * decision or the resulting requirement; candidates only ever matter in
 * `selection.ts`.
 */
export function evaluateNoveltyTraining(context: TrainingSystemContext): TrainingSystemApplicability {
  const concepts = distinctConceptNames(context.studentId, context.attemptRecords);
  const evidenceByConcept = concepts.map((conceptName) => computeNoveltyExposureEvidence(context.studentId, conceptName, context.attemptRecords));

  const clearedBaseline = evidenceByConcept.filter((e) => e.standardExposureCount >= MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT);
  if (clearedBaseline.length === 0) {
    return {
      applicable: false,
      reason: "insufficient_evidence",
      explanation: "No concept in this student's attempt history has enough standard-noveltyLevel attempts yet to evaluate novelty exposure for that concept."
    };
  }

  const qualifying: QualifyingTarget[] = [];
  for (const evidence of clearedBaseline) {
    for (const dimension of evidence.dimensions) {
      if (dimension.distinctQuestionIds.length < MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT) {
        qualifying.push({ conceptName: evidence.conceptName, noveltyLevel: dimension.noveltyLevel, distinctCount: dimension.distinctQuestionIds.length });
      }
    }
  }

  if (qualifying.length === 0) {
    return {
      applicable: false,
      reason: "sufficient_novelty_exposure",
      explanation: "At least one concept has enough standard-noveltyLevel activity to evaluate, but every novelty dimension already has sufficient exposure -- deliberate novelty training is not currently useful."
    };
  }

  const target = pickTarget(qualifying);
  const requirement = buildRequirement(target);

  return {
    applicable: true,
    requirement,
    explanation: `Deliberate novelty exposure recommended for concept "${target.conceptName}", novelty level "${target.noveltyLevel}" -- ${describeExposure(target.distinctCount)} (${target.distinctCount} distinct question(s) observed).`
  };
}
