import type { AutopsyQuestionContext, BehaviorSignals, RecommendedTrainingMode, RepairPlan, RepairPriority } from "@ipmat/autopsy";
import type { ErrorCategory } from "@ipmat/examiner-lens";
import type { DifficultyTier, ValidationState } from "@ipmat/question-engine";

export type { AutopsyQuestionContext, BehaviorSignals, DifficultyTier, ErrorCategory, RecommendedTrainingMode, RepairPlan, RepairPriority, ValidationState };

/**
 * 5C-2 is TARGETED REPAIR selection: given a CONFIRMED `RepairPlan`
 * (`@ipmat/autopsy`, Phase 5B) and the available Question DNA, deterministically
 * select ONE question that repairs the diagnosed weakness — or fail
 * clearly when no suitable question exists. This is explicitly NOT the
 * adaptive engine (5C-3, not started): there is no global "what should
 * this student practice next" logic here, no mastery-driven queue, no
 * scoring across the whole question bank — only "given this one confirmed
 * diagnosis, which of the available questions actually repairs it."
 *
 * The confirmed diagnosis says WHAT needs repair (`RepairPlan`, already
 * built and gated by `@ipmat/autopsy`'s `buildRepairPlan()`); this package
 * says WHICH of the available questions can provide that repair. It never
 * mutates or re-derives anything from `AutopsyHypothesis` — `RepairPlan`
 * is its only input from the diagnosis side.
 */

export const REPAIR_SELECTION_CONSTANTS = {
  /**
   * PROVISIONAL, same style as `@ipmat/mastery`'s `MASTERY_CONSTANTS` and
   * `@ipmat/autopsy`'s `AUTOPSY_THRESHOLDS` — not calibrated against real
   * usage data. A candidate the student has already attempted at least
   * this many times is treated as "overused" and avoided IN FAVOR of an
   * alternative within the same match tier — but only when at least one
   * non-overused alternative exists in that tier; it is never allowed to
   * empty a tier down to zero candidates (point O, Phase 5C-2 §7).
   */
  OVERUSE_MIN_ATTEMPT_COUNT: 2
} as const;

/**
 * One available question's DNA, shaped for repair selection. Composed
 * from TWO existing, already-real shapes rather than inventing a third
 * parallel metadata model: `AutopsyQuestionContext` (`@ipmat/autopsy`,
 * Phase 5A — questionId, patternTaxonomyCellId, patternFamilyName,
 * conceptName, difficulty/novelty/testingModes/trap) plus
 * `expectedTimeSeconds`/`validationState`, the two fields that type
 * deliberately omits (the first because `@ipmat/attempt`'s evidence
 * already carries it for the ORIGINAL diagnosed attempt; the second
 * because Phase 5A had no reason to know about question lifecycle) but
 * which THIS package genuinely needs — to judge speed suitability and to
 * refuse ever selecting a non-published question.
 */
export interface RepairCandidateQuestion {
  question: AutopsyQuestionContext;
  expectedTimeSeconds: number;
  validationState: ValidationState;
}

export interface RepairPriorExposureRecord {
  questionId: string;
  attemptCount: number;
}

export interface RepairSelectionInput {
  /** Must have been built via `buildRepairPlan()` (`@ipmat/autopsy`) from a confirmed hypothesis — re-checked defensively at this boundary too (see `assertRepairPlanConfirmed()` in `selectRepairQuestion.ts`), the same "never trust a value merely typed as X" discipline `@ipmat/db`'s repository layer already applies. */
  repairPlan: RepairPlan;
  /** The available Question Universe for this concept (and beyond — the selector itself filters to the target concept). */
  candidateQuestions: RepairCandidateQuestion[];
  /** Reused directly from the SAME `AutopsyOutput.behaviorSignals` the `RepairPlan` was built from — lets the selector recognize a speed-specific weakness (via `AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO`, the SAME threshold `@ipmat/autopsy` itself uses) without re-deriving a second one. Omit when unavailable; speed then plays no role in tie-breaking. */
  behaviorSignals?: BehaviorSignals | null;
  /** The originally diagnosed question's own `difficultyTier` (from the same `AutopsyOutput.questionFacts`) — used ONLY as a tie-breaking "difficulty suitability" preference, never a hard eligibility gate. */
  targetDifficultyTier?: DifficultyTier | null;
  /** This student's prior exposure to each candidate `questionId` — used only for overuse avoidance (point O), never a hard eligibility gate. */
  priorExposure?: RepairPriorExposureRecord[];
}

/**
 * Explicit, named, ORDERED tiers (most to least specific) — a deterministic
 * classification, never a black-box numeric score (Phase 5C-2 §5). See
 * `matchTier.ts` for how a candidate is classified and
 * `REPAIR_MATCH_TIER_ORDER` for the fixed preference order.
 */
export type RepairMatchTier =
  | "direct_cell_and_trap"
  | "direct_cell"
  | "pattern_family_and_trap"
  | "trap_only"
  | "pattern_family"
  | "concept_fallback";

export type RepairNoMatchReason = "no_candidates_for_concept" | "training_mode_constraint_unsatisfied" | "no_structurally_valid_candidates";

export interface RepairSelectionResult {
  question: AutopsyQuestionContext;
  matchTier: RepairMatchTier;
  /** True only for `concept_fallback` — the ONE tier that is a deliberate, explicitly-labeled fallback rather than a direct match (Phase 5C-2 §4). */
  isFallback: boolean;
  targetConceptName: string;
  targetPatternFamilyName: string;
  targetTaxonomyCellId: string;
  targetErrorCategory: ErrorCategory;
  targetErrorTaxonomyCode: string | null;
  recommendedTrainingMode: RecommendedTrainingMode;
  priority: RepairPriority;
  /** Why THIS question was selected — deterministically generated from the match tier, never free text from an AI call. */
  explanation: string;
  /** What coverage gap or observed weakness this selection is repairing. */
  coverageGapAddressed: string;
  candidatesConsidered: number;
  excludedMalformedCount: number;
}

export type RepairSelectionOutcome =
  | { status: "selected"; result: RepairSelectionResult }
  | { status: "no_match"; reason: RepairNoMatchReason; explanation: string; candidatesConsidered: number; excludedMalformedCount: number };

export const REPAIR_SELECTION_ERROR_CODES = ["not_confirmed"] as const;
export type RepairSelectionErrorCode = (typeof REPAIR_SELECTION_ERROR_CODES)[number];

/** Mirrors `@ipmat/autopsy`'s `HypothesisError`/`@ipmat/attempt`'s `AttemptLifecycleError` — a typed, fail-closed error for a caller-supplied `RepairPlan` that does not carry a genuine confirmation, as opposed to `RepairSelectionOutcome`'s `"no_match"`, which is an ordinary, expected BUSINESS outcome ("no suitable question exists today"), not a caller error. */
export class RepairSelectionError extends Error {
  readonly code: RepairSelectionErrorCode;

  constructor(code: RepairSelectionErrorCode, message: string) {
    super(message);
    this.name = "RepairSelectionError";
    this.code = code;
  }
}

export interface CandidateValidationIssue {
  field: string;
  message: string;
}

export interface CandidateValidationResult {
  valid: boolean;
  issues: CandidateValidationIssue[];
}
