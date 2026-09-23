import type { TrainingRequirement } from "@ipmat/training-systems";

/**
 * Deliberately small, closed, PROVISIONAL vocabulary (grows deliberately,
 * same discipline as `CalculationTrainingStage`/`TrainingActionType`).
 * "time_constrained" (renamed from an earlier "exam_pressure" during
 * design review) is deliberately narrow: it means ONLY "this question
 * carries Question DNA's existing `time_pressured` testingMode." It is
 * NOT the future, broader Pressure Training system (which will own
 * exam-condition pressure such as sustained sequences, section
 * constraints, switching between question types, etc.) — Speed Lab's job
 * stays scoped to increasingly constrained SOLVING SPEED on individual
 * questions, never sequence- or section-level pressure. See
 * docs/DECISIONS.md D-055.
 */
export const SPEED_LAB_STAGES = ["steady_pace", "mixed_pace", "time_constrained"] as const;
export type SpeedLabStage = (typeof SPEED_LAB_STAGES)[number];

/**
 * Provider-specific extension of the shared `TrainingRequirement`
 * (docs/DECISIONS.md D-053 item 3) — a structural superset, so it still
 * satisfies `TrainingSystemSelectionOutcome.requirement: TrainingRequirement`
 * with no cast. Deliberately has NO "target speed ratio" field: speed
 * ratio is an ATTEMPT OUTCOME, not a static property of an unattempted
 * candidate question, so it cannot be a selection filter.
 */
export interface SpeedLabRequirement extends TrainingRequirement {
  targetConceptName: string;
  stage: SpeedLabStage;
  /** DNA-level ceiling (`difficultyDimensions.conceptualLoad <`), `null` = no ceiling. Never a caller-facing "difficulty" claim. */
  maxConceptualLoad: number | null;
  requireTimePressured: boolean;
}

/**
 * The core derived signal this provider introduces. `eligibleGradedCount`
 * is the EXACT, immutable denominator (docs/DECISIONS.md D-055 adjustment
 * 3) — submitted, graded, validly-timed, hint-free, non-time-pressured,
 * low-conceptual-load attempts, regardless of correctness.
 * `correctSlowCount` (the numerator) and `incorrectSlowCount`
 * (diagnostic-only, NEVER drives applicability — wrongness may reflect a
 * conceptual or calculation difficulty this provider cannot distinguish
 * from observable data alone) are both drawn from that SAME population.
 */
export interface SpeedEvidenceSlice {
  eligibleGradedCount: number;
  correctSlowCount: number;
  incorrectSlowCount: number;
  /** `null` below `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` eligible-graded attempts — insufficient data, never a fake ratio. */
  slowFraction: number | null;
}
