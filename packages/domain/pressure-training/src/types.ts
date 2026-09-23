import type { TrainingRequirement } from "@ipmat/training-systems";

/**
 * Fixed dimension precedence (docs/DECISIONS.md D-061), most direct
 * behavioral proof first: `within_block_degradation` > `reduced_recovery`
 * > `budget_consumption`. A concept triggering multiple dimensions is
 * classified ONLY by its single best (lowest-index) tier here — never a
 * list, never a blend (D-051's "reason codes, never a numeric score"
 * discipline).
 */
export const PRESSURE_DIMENSIONS = ["within_block_degradation", "reduced_recovery", "budget_consumption"] as const;
export type PressureDimension = (typeof PRESSURE_DIMENSIONS)[number];

/**
 * Provider-specific extension of the shared `TrainingRequirement` (docs/
 * DECISIONS.md D-053 item 3, D-061). Deliberately NO numeric target
 * fields — the evidenced dimension is a fact about past block-grouped
 * attempts, not a filterable property of an unattempted candidate question
 * (mirrors Speed Lab's own exclusion of a "target speed ratio").
 */
export interface PressureTrainingRequirement extends TrainingRequirement {
  targetConceptName: string;
  evidencedDimension: PressureDimension;
}

/**
 * Per-block derived evidence (`blockEvidence.ts`) for ONE qualifying
 * `TrainingPracticeBlockContext`. Only ever produced for a block that has
 * passed Block Evidence Validation, has an attributable concept, and meets
 * the minimum-attempt-count floor — a non-qualifying block never produces
 * one of these at all (docs/DECISIONS.md D-061). `null` fields mean "not
 * computable for this block" (e.g. zero qualifying/graded attempts in a
 * half), never a coerced `0`/`false`.
 */
export interface BlockPressureEvidence {
  practiceBlockId: string;
  conceptName: string;
  medianGapSeconds: number | null;
  firstHalfAccuracy: number | null;
  secondHalfAccuracy: number | null;
  /** Every dimension THIS block triggered, in no particular order — precedence across dimensions/concepts is resolved later, in `applicability.ts`, never here. */
  triggeredDimensions: PressureDimension[];
}
