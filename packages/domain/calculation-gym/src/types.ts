import type { TrainingRequirement } from "@ipmat/training-systems";

/**
 * Deliberately small, closed, PROVISIONAL vocabulary (grows deliberately,
 * the same discipline `@ipmat/autopsy`'s `RecommendedTrainingMode` and
 * `@ipmat/training-orchestration`'s `TrainingActionType` already follow).
 * Each stage is defined ENTIRELY by existing, observable Question DNA
 * (`difficultyDimensions.computationalLoad`, `testingModes`) — never a
 * hidden score.
 */
export const CALCULATION_TRAINING_STAGES = ["foundational", "mixed", "time_pressured"] as const;
export type CalculationTrainingStage = (typeof CALCULATION_TRAINING_STAGES)[number];

/**
 * Provider-specific extension of the shared `TrainingRequirement`
 * (docs/DECISIONS.md D-053 item 3: use the common shape only where it
 * genuinely fits, provider-specific metadata for what doesn't). A
 * structural superset, so it still satisfies `TrainingSystemSelectionOutcome.requirement:
 * TrainingRequirement` with no cast.
 */
export interface CalculationGymRequirement extends TrainingRequirement {
  targetConceptName: string;
  stage: CalculationTrainingStage;
  /** Provisional DNA-level floor (`difficultyDimensions.computationalLoad >=`), never a caller-facing "difficulty" claim. */
  minComputationalLoad: number;
  requireMultiStep: boolean;
  requireTimePressured: boolean;
  /**
   * Phase 5 Unit 2 (docs/DECISIONS.md D-076) -- the stage's SHAPE, restated from `progression.ts`'s own evidence definitions so that
   * what a stage SERVES is exactly what counts as that stage's progression evidence. Without these, a "foundational" session could be
   * served a heavy question (the exposure tie-break ranks before load proximity) and a "mixed" session a time-pressured one -- neither
   * counts toward the stage it was served at, so progression could stall. All optional: absent means no such constraint (the original
   * D-054 behavior), so a requirement built without them still selects exactly as before.
   */
  /** Exclusive ceiling: a qualifying question's `computationalLoad` must be strictly below this. */
  maxComputationalLoad?: number;
  excludeMultiStep?: boolean;
  excludeTimePressured?: boolean;
}

export interface ComputationalLoadSlice {
  attempts: number;
  correct: number;
  /**
   * `null` below `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` graded
   * attempts in this slice — insufficient data, never a fake ratio from too
   * few observations.
   */
  accuracy: number | null;
}

/**
 * The core derived signal this provider introduces: a per-concept,
 * per-student comparison of accuracy conditioned on Question DNA's
 * provisional `computationalLoad` metadata — NOT a measured "calculation
 * ability". `@ipmat/mastery`'s own `MasteryComponentDetail` does not slice
 * by this dimension at all, so this is genuinely new, narrow logic, not a
 * duplicate of anything mastery already computes.
 */
export interface CalculationFrictionEvidence {
  conceptName: string;
  highLoad: ComputationalLoadSlice;
  lowLoad: ComputationalLoadSlice;
  /** true only when BOTH slices independently meet the minimum-observation gate AND the accuracy-gap condition holds. */
  frictionDetected: boolean;
}
