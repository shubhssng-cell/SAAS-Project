import type { AutopsyQuestionContext, BehaviorSignals, ErrorTaxonomyEntry, RepairPlan, RepairPriority } from "@ipmat/autopsy";
import type { MasteryAttemptRecord, MasteryStateResult } from "@ipmat/mastery";
import type { PrepPhaseResult } from "@ipmat/prep-phase";
import type { DifficultyTier, ValidationState } from "@ipmat/question-engine";
import type { RepairSelectionOutcome, RepairSelectionResult } from "@ipmat/repair-selection";
import type { AdaptiveSelectionOutcome, AdaptiveSelectionResult } from "@ipmat/adaptive-selection";
import type { TrainingPracticeBlockContext, TrainingSystemOutcome } from "@ipmat/training-systems";

export type {
  AutopsyQuestionContext,
  BehaviorSignals,
  DifficultyTier,
  ErrorTaxonomyEntry,
  MasteryAttemptRecord,
  MasteryStateResult,
  PrepPhaseResult,
  RepairPlan,
  RepairPriority,
  RepairSelectionOutcome,
  RepairSelectionResult,
  AdaptiveSelectionOutcome,
  AdaptiveSelectionResult,
  TrainingPracticeBlockContext,
  TrainingSystemOutcome,
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

export const TRAINING_ACTION_TYPES = ["targeted_repair", "training_system_practice", "adaptive_practice"] as const;
/**
 * A DELIBERATELY small, closed vocabulary — the same "grows deliberately,
 * never invents a capability that doesn't exist yet" discipline
 * `RecommendedTrainingMode` already established (D-037). `training_system_practice`
 * (docs/DECISIONS.md D-062) is deliberately ONE generic value covering all
 * five concrete `TrainingSystemProvider`s (Calculation Gym, Speed Lab, Trap
 * Lab, Novelty Training, Pressure Training) — the concrete provider that
 * actually fired is identified by `TrainingOrchestrationSelectedTrainingSystem.providerId`,
 * never a separate action-type literal per provider. This is a deliberate,
 * reasoned departure from D-052/D-053's own doc-comment wording (which
 * anticipated one literal per provider) — chosen so a future 6th provider
 * (Mock Simulation, Revision) never requires touching this union again,
 * consistent with `attemptTargetedRepair()`'s own stated extension shape
 * ("a future additional provider... would slot into the sequence without
 * this function's own logic changing at all"). Mock Simulation and
 * Revision remain named only in documentation as future, still-undesigned
 * work — not implemented, not pretended to exist by this type.
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
  /**
   * Optional (docs/DECISIONS.md D-062) — forwarded, unmodified, to every
   * `TrainingSystemContext` a training-system provider receives (Trap
   * Lab's own optional enrichment; never changes any provider's
   * applicability decision by itself).
   */
  errorTaxonomy?: ErrorTaxonomyEntry[];
  /**
   * Optional (docs/DECISIONS.md D-062) — forwarded, unmodified, to every
   * `TrainingSystemContext`. Required for Pressure Training to ever be
   * anything but `insufficient_evidence`; absence is never an error, it
   * simply means block-grouped evidence is unavailable to every provider
   * this call reaches (no real caller assembles this from persisted data
   * yet — see docs/DECISIONS.md D-062's own "what remains unavailable"
   * disclosure).
   */
  practiceBlocks?: TrainingPracticeBlockContext[];
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
/** One provider's RAW, unmodified outcome from `runTrainingSystemProvider()` (docs/DECISIONS.md D-062) — recorded for every provider actually invoked, in priority-tried order, regardless of whether it ended up selected. */
export interface TrainingSystemProviderOutcomeRecord {
  providerId: string;
  outcome: TrainingSystemOutcome;
}

export interface TrainingOrchestrationDiagnostics {
  repairPlansSupplied: number;
  /** Plans excluded BEFORE ever calling `@ipmat/repair-selection`, because they lacked a genuine `confirmationSource.hypothesisConfirmedAt` — the SAME invariant `assertRepairPlanConfirmed()` checks inside that package, re-verified at this boundary too (the same defense-in-depth discipline D-043/D-048/D-049/D-050 already established). */
  repairPlansExcludedAsUnconfirmed: number;
  /** Which plan (if any) was actually chosen for orchestration, by the fixed priority policy — `null` if no eligible plan existed. */
  repairPlanChosen: { targetConceptName: string; targetPatternFamilyName: string; priority: RepairPriority; confirmedAt: string } | null;
  repairAttempted: boolean;
  /** The RAW outcome from `selectRepairQuestion()` — `null` only when `repairAttempted` is false. */
  repairOutcome: RepairSelectionOutcome | null;
  /**
   * (docs/DECISIONS.md D-062) Every training-system provider actually
   * invoked, in `TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER` order, with its
   * RAW outcome — empty when the repair tier already produced a
   * selection (training systems were never reached at all).
   */
  trainingSystemProviderOutcomes: TrainingSystemProviderOutcomeRecord[];
  /** (docs/DECISIONS.md D-062) Which provider (if any) was actually selected — `targetConceptName` is `null` when the winning provider's own requirement doesn't carry one (e.g. Trap Lab's is optional, D-056). `null` when no provider was invoked or none selected. */
  trainingSystemProviderChosen: { providerId: string; targetConceptName: string | null } | null;
  adaptiveAttempted: boolean;
  /** The RAW outcome from `selectNextQuestion()` — `null` only when `adaptiveAttempted` is false. */
  adaptiveOutcome: AdaptiveSelectionOutcome | null;
  /** Whether policy WOULD permit falling back to adaptive practice after a repair no_match — always inspectable, even when the fallback wasn't actually needed. */
  fallbackPermittedByPolicy: boolean;
  /** Whether a fallback from repair to adaptive actually happened on this call. */
  fallbackOccurred: boolean;
  /** (docs/DECISIONS.md D-062) Whether policy WOULD permit trying the training-system tier after a repair no_match — always inspectable. Reuses the SAME `ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH` constant that used to gate the repair->adaptive step directly, now relocated to gate repair->training-systems (the new immediate next tier). */
  fallbackPermittedToTrainingSystemsPolicy: boolean;
  /** (docs/DECISIONS.md D-062) Whether policy WOULD permit falling back to adaptive practice after every training-system provider failed to select — always inspectable, independent of whether that fallback was actually needed. */
  fallbackPermittedToAdaptiveAfterTrainingSystemsPolicy: boolean;
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

/**
 * (docs/DECISIONS.md D-062) The ONE result shape for ALL FIVE concrete
 * `TrainingSystemProvider`s — `actionType` is always the single generic
 * `"training_system_practice"` value; `providerId` (e.g. `"trap-lab"`,
 * `"pressure-training"`) is the only way to tell which concrete provider
 * actually fired. This is deliberate: a 6th provider never requires a new
 * `TrainingActionType` literal or a new result interface, only a new
 * registry entry in `trainingSystemProviders.ts`.
 */
export interface TrainingOrchestrationSelectedTrainingSystem {
  status: "selected";
  actionType: "training_system_practice";
  providerId: string;
  question: AutopsyQuestionContext;
  explanation: string;
  /** The full, unmodified "selected" outcome from `runTrainingSystemProvider()` — never re-derived or summarized. */
  providerResult: Extract<TrainingSystemOutcome, { status: "selected" }>;
  /** True when this action was chosen because targeted repair was attempted and did not produce a selection — see `diagnostics.repairOutcome` for the preserved detail. */
  wasFallbackFromRepair: boolean;
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
  /** (docs/DECISIONS.md D-062) True when at least one training-system provider was tried (repair did not already select) before adaptive practice ultimately won — independent of `wasFallbackFromRepair`; both can be true simultaneously. */
  wasFallbackFromTrainingSystems: boolean;
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
 * `AutopsyQuestionContext` (`@ipmat/autopsy`) and the underlying engines'
 * own result types directly, none of which has ever carried
 * `correctAnswer`/`options`/any answer-bearing field — safe for a later
 * API/UI layer to consume as-is.
 */
export type TrainingOrchestrationResult =
  | TrainingOrchestrationSelectedRepair
  | TrainingOrchestrationSelectedTrainingSystem
  | TrainingOrchestrationSelectedAdaptive
  | TrainingOrchestrationNoAction;
