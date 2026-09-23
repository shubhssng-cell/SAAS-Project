import type { AutopsyQuestionContext, BehaviorSignals, RepairPlan, RepairPriority } from "@ipmat/autopsy";
import type { MasteryAttemptRecord, MasteryStateResult } from "@ipmat/mastery";
import type { PrepPhaseResult } from "@ipmat/prep-phase";
import type { DifficultyTier, ValidationState } from "@ipmat/question-engine";
import type { RepairSelectionOutcome, RepairSelectionResult } from "@ipmat/repair-selection";
import type { AdaptiveSelectionOutcome, AdaptiveSelectionResult } from "@ipmat/adaptive-selection";

export type {
  AutopsyQuestionContext,
  BehaviorSignals,
  DifficultyTier,
  MasteryAttemptRecord,
  MasteryStateResult,
  PrepPhaseResult,
  RepairPlan,
  RepairPriority,
  RepairSelectionOutcome,
  RepairSelectionResult,
  AdaptiveSelectionOutcome,
  AdaptiveSelectionResult,
  ValidationState
};

/**
 * Phase 5D — TRAINING ORCHESTRATION CORE (docs/DECISIONS.md D-052).
 * Answers "what training mode/action should happen next for this student"
 * by COORDINATING the two existing deterministic selection engines —
 * `@ipmat/repair-selection` (Phase 5C-2, TARGETED repair from a confirmed
 * diagnosis) and `@ipmat/adaptive-selection` (Phase 5C-3, GLOBAL adaptive
 * practice) — never reimplementing either one's internal matching/ranking
 * algorithm, and never merging them into a single scoring function.
 *
 * The candidate type below is DELIBERATELY structurally identical to both
 * `RepairCandidateQuestion` and `AdaptiveCandidateQuestion` (both compose
 * `AutopsyQuestionContext` + `expectedTimeSeconds` + `validationState`) —
 * the SAME array is passed to both engines unchanged, no conversion
 * function, because there is nothing to convert.
 */
export interface TrainingCandidateQuestion {
  question: AutopsyQuestionContext;
  expectedTimeSeconds: number;
  validationState: ValidationState;
}

/**
 * ONE confirmed `RepairPlan`, bundled with the OPTIONAL contextual data
 * `@ipmat/repair-selection`'s own tie-break needs (`behaviorSignals` for
 * its speed-problem preference, `targetDifficultyTier` for its
 * difficulty-proximity preference) — reused directly from whatever
 * `@ipmat/autopsy` already produced for the ORIGINAL diagnosed attempt,
 * never recomputed here.
 */
export interface ActiveRepairPlanContext {
  plan: RepairPlan;
  behaviorSignals?: BehaviorSignals | null;
  targetDifficultyTier?: DifficultyTier | null;
}

export const TRAINING_ACTION_TYPES = ["targeted_repair", "adaptive_practice"] as const;
/**
 * A DELIBERATELY small, closed vocabulary for V1 — the same "grows
 * deliberately, never invents a capability that doesn't exist yet"
 * discipline `RecommendedTrainingMode` already established (D-037).
 * Calculation Gym, Speed Lab, Trap Lab, Novelty Lab, Pressure Training,
 * Mock Simulation, and Revision are named ONLY in documentation as future
 * values this union would grow to include — none is implemented, and
 * none is pretended to exist by this type.
 */
export type TrainingActionType = (typeof TRAINING_ACTION_TYPES)[number];

export interface TrainingOrchestrationInput {
  studentId: string;
  /** Confirmed RepairPlans currently active for this student, if any. */
  activeRepairPlans: ActiveRepairPlanContext[];
  /** Already-computed mastery, reused directly for `@ipmat/adaptive-selection` — never recomputed here. */
  masteryByConcept: MasteryStateResult[];
  /** The SAME attempt records `@ipmat/mastery`/`@ipmat/adaptive-selection` already consume. */
  attemptRecords: MasteryAttemptRecord[];
  prepPhase?: PrepPhaseResult | null;
  candidates: TrainingCandidateQuestion[];
}

/**
 * Always present on every `TrainingOrchestrationResult`, REGARDLESS of
 * the final `status` — the full record of what was attempted. This is
 * what makes "a repair no_match must not silently become adaptive
 * success" a structural guarantee rather than a convention: even when
 * `status: "selected"` reports `actionType: "adaptive_practice"`, this
 * record still shows `repairOutcome.status === "no_match"` if that is
 * what actually happened.
 */
export interface TrainingOrchestrationDiagnostics {
  repairPlansSupplied: number;
  /** Plans excluded BEFORE ever calling `@ipmat/repair-selection`, because they lacked a genuine `confirmationSource.hypothesisConfirmedAt` — the SAME invariant `assertRepairPlanConfirmed()` checks inside that package, re-verified at this boundary too (the same defense-in-depth discipline D-043/D-048/D-049/D-050 already established). */
  repairPlansExcludedAsUnconfirmed: number;
  /** Which plan (if any) was actually chosen for orchestration, by the fixed priority policy — `null` if no eligible plan existed. */
  repairPlanChosen: { targetConceptName: string; targetPatternFamilyName: string; priority: RepairPriority; confirmedAt: string } | null;
  repairAttempted: boolean;
  /** The RAW outcome from `selectRepairQuestion()` — `null` only when `repairAttempted` is false. */
  repairOutcome: RepairSelectionOutcome | null;
  adaptiveAttempted: boolean;
  /** The RAW outcome from `selectNextQuestion()` — `null` only when `adaptiveAttempted` is false. */
  adaptiveOutcome: AdaptiveSelectionOutcome | null;
  /** Whether policy WOULD permit falling back to adaptive practice after a repair no_match — always inspectable, even when the fallback wasn't actually needed. */
  fallbackPermittedByPolicy: boolean;
  /** Whether a fallback from repair to adaptive actually happened on this call. */
  fallbackOccurred: boolean;
}

export interface TrainingOrchestrationSelectedRepair {
  status: "selected";
  actionType: "targeted_repair";
  question: AutopsyQuestionContext;
  explanation: string;
  /** The full, unmodified result from `@ipmat/repair-selection` — never re-derived or summarized. */
  providerResult: RepairSelectionResult;
  diagnostics: TrainingOrchestrationDiagnostics;
}

export interface TrainingOrchestrationSelectedAdaptive {
  status: "selected";
  actionType: "adaptive_practice";
  question: AutopsyQuestionContext;
  explanation: string;
  /** The full, unmodified result from `@ipmat/adaptive-selection` — never re-derived or summarized. */
  providerResult: AdaptiveSelectionResult;
  /** True when this action was chosen because targeted repair was attempted and returned `no_match` — see `diagnostics.repairOutcome` for the preserved detail. */
  wasFallbackFromRepair: boolean;
  diagnostics: TrainingOrchestrationDiagnostics;
}

export const TRAINING_ORCHESTRATION_NO_ACTION_REASONS = ["no_candidates_supplied", "no_eligible_action"] as const;
export type TrainingOrchestrationNoActionReason = (typeof TRAINING_ORCHESTRATION_NO_ACTION_REASONS)[number];

export interface TrainingOrchestrationNoAction {
  status: "no_action";
  reason: TrainingOrchestrationNoActionReason;
  explanation: string;
  diagnostics: TrainingOrchestrationDiagnostics;
}

/**
 * Never leaks a correct answer or an internal database object: reuses
 * `AutopsyQuestionContext` (`@ipmat/autopsy`) and the two engines' own
 * result types directly, neither of which has ever carried
 * `correctAnswer`/`options`/any answer-bearing field — safe for a later
 * API/UI layer to consume as-is.
 */
export type TrainingOrchestrationResult = TrainingOrchestrationSelectedRepair | TrainingOrchestrationSelectedAdaptive | TrainingOrchestrationNoAction;
