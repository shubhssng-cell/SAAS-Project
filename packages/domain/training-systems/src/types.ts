import type { AutopsyQuestionContext, ErrorTaxonomyEntry } from "@ipmat/autopsy";
import type { MasteryAttemptRecord, MasteryStateResult } from "@ipmat/mastery";
import type { PrepPhaseResult } from "@ipmat/prep-phase";
import type { DifficultyTier, NoveltyLevel, TestingMode, ValidationState } from "@ipmat/question-engine";

export type {
  AutopsyQuestionContext,
  DifficultyTier,
  ErrorTaxonomyEntry,
  MasteryAttemptRecord,
  MasteryStateResult,
  NoveltyLevel,
  PrepPhaseResult,
  TestingMode,
  ValidationState
};

/**
 * Phase 5E-1 — TRAINING SYSTEMS CORE CONTRACT (docs/DECISIONS.md D-053).
 * The common abstraction every future training-mode provider (Calculation
 * Gym, Speed Lab, Trap Lab, Novelty Training, Pressure Training,
 * Overtraining exposure, Revision, Mock Simulation — NONE implemented
 * here) will conform to. This package ships ONLY types and two small,
 * genuinely-shared helpers (`buildTrainingSystemDiagnostics()`,
 * `runTrainingSystemProvider()`) — deliberately NO ranking/filtering
 * utility of any kind, so "recreate adaptive-selection or repair-selection
 * semantics inside a provider" is structurally unavailable from the
 * contract itself, not merely discouraged by convention.
 *
 * A Training System provider is NOT a second adaptive-selection engine.
 * It never asks "what is globally best for this student" (that stays
 * `@ipmat/adaptive-selection`'s job) or "which question repairs this one
 * confirmed diagnosis" (`@ipmat/repair-selection`'s job) — it asks only
 * "is my one specific, narrow training mode appropriate right now, and if
 * so, what does a qualifying question look like." `@ipmat/training-orchestration`
 * (Phase 5D) decides WHICH provider (if any) to consult; this contract
 * says nothing about that decision and is not imported by, or a
 * dependency of, that package (avoiding any future circularity — Phase 5D
 * would depend on a concrete PROVIDER package later, not on this shared
 * contract directly, though it may end up doing both).
 */

// ---------------------------------------------------------------------
// Candidate / context — restated, not imported, from the SAME shape
// @ipmat/repair-selection / @ipmat/adaptive-selection / @ipmat/training-orchestration
// already independently restate (siblings restate small shared shapes
// from their common upstream rather than depending on each other).
// ---------------------------------------------------------------------

export interface TrainingCandidateQuestion {
  question: AutopsyQuestionContext;
  expectedTimeSeconds: number;
  validationState: ValidationState;
}

export interface TrainingSystemContext {
  studentId: string;
  /** Already-computed mastery, reused directly — never recomputed by a provider. */
  masteryByConcept: MasteryStateResult[];
  /** The SAME attempt records `@ipmat/mastery`/`@ipmat/adaptive-selection`/`@ipmat/training-orchestration` already consume. */
  attemptRecords: MasteryAttemptRecord[];
  /** The existing ErrorTaxonomy, for trap-specific modes — every entry the caller has available, never a subset this contract curates (same convention `@ipmat/autopsy`'s own `AutopsyInput.errorTaxonomy` already uses). */
  errorTaxonomy?: ErrorTaxonomyEntry[];
  prepPhase?: PrepPhaseResult | null;
  candidates: TrainingCandidateQuestion[];
}

// ---------------------------------------------------------------------
// Requirement — small, all-optional, named dimensions. A provider
// populates only what its own mode cares about; unset fields impose no
// constraint. Deliberately NOT a rigid one-size-fits-all structure, and
// deliberately NOT a scoring/weighting object of any kind.
// ---------------------------------------------------------------------

export interface TrainingRequirement {
  /** If present, a qualifying question's `testingModes` must include ALL of these (AND semantics, not "any of"). */
  testingModes?: TestingMode[];
  noveltyLevel?: NoveltyLevel;
  /** `null` explicitly means "must have NO trap code" (distinct from "don't care," which is simply omitting this field). */
  errorTaxonomyCode?: string | null;
  difficultyTierPreference?: DifficultyTier;
  /** Free-form, human-readable elaboration for a requirement dimension no structured field fits — deliberately a last resort, never the primary mechanism a provider uses to express its rule. */
  notes?: string[];
}

// ---------------------------------------------------------------------
// Diagnostics — present on every outcome EXCEPT "error" (requirement:
// "every non-error result must retain diagnostics"). Reuses
// `AutopsyQuestionContext` elsewhere in the outcome (no answer-bearing
// field), so the whole result is already safe for a later API/UI layer.
// ---------------------------------------------------------------------

export interface TrainingSystemDiagnostics {
  providerId: string;
  studentId: string;
  /** Mirrors the outcome's own applicability fact — redundant with `status`, but always inspectable uniformly from `diagnostics` alone. */
  eligible: boolean;
  candidatesConsidered: number;
  excludedMalformedCount: number;
  excludedIneligibleCount: number;
  notes: string[];
}

// ---------------------------------------------------------------------
// Applicability — the ONE authoritative decision. See TrainingSystemProvider.
// ---------------------------------------------------------------------

export type TrainingSystemApplicability =
  | { applicable: false; reason: string; explanation: string }
  | { applicable: true; requirement: TrainingRequirement; explanation: string };

// ---------------------------------------------------------------------
// Outcome — strict "error" semantics: reserved for invalid/impossible
// execution conditions ONLY, never for "no candidate matched" (that is
// `no_eligible_question`) and never for "mode doesn't apply" (that is
// `not_applicable`, produced only by `evaluate()`/`runTrainingSystemProvider()`,
// never by `select()` — see the type below, which structurally excludes it).
// ---------------------------------------------------------------------

export const TRAINING_SYSTEM_ERROR_CODES = ["invalid_context", "provider_invariant_violation"] as const;
export type TrainingSystemErrorCode = (typeof TRAINING_SYSTEM_ERROR_CODES)[number];

export type TrainingSystemSelectionOutcome =
  | { status: "no_eligible_question"; requirement: TrainingRequirement; explanation: string; diagnostics: TrainingSystemDiagnostics }
  | { status: "selected"; question: AutopsyQuestionContext; requirement: TrainingRequirement; explanation: string; diagnostics: TrainingSystemDiagnostics }
  | { status: "error"; code: TrainingSystemErrorCode; explanation: string };

export type TrainingSystemOutcome =
  | { status: "not_applicable"; reason: string; explanation: string; diagnostics: TrainingSystemDiagnostics }
  | TrainingSystemSelectionOutcome;

// ---------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------

export interface TrainingSystemProvider {
  readonly providerId: string;
  /**
   * The ONE authoritative applicability decision for this provider's
   * training mode. Never re-decided elsewhere — `select()` below cannot
   * express `not_applicable` at all, and `runTrainingSystemProvider()`
   * (the canonical entry point) only ever calls `select()` after this
   * returned `applicable: true`, passing it the SAME evaluation.
   */
  evaluate(context: TrainingSystemContext): TrainingSystemApplicability;
  /**
   * Called ONLY with an `applicable: true` evaluation already produced by
   * `evaluate()` — never re-derives or second-guesses applicability.
   * Provider-local selection here is legitimate ONLY when genuinely
   * intrinsic to this one narrow training mode, deterministic, explicitly
   * bounded (e.g. a simple filter-by-requirement + a documented, fixed
   * tie-break), and tested — NEVER a recreation of
   * `@ipmat/adaptive-selection`'s or `@ipmat/repair-selection`'s own
   * multi-dimension ranking. A provider MAY instead delegate entirely to
   * either engine's public entry point (`selectNextQuestion()`/
   * `selectRepairQuestion()`) over a requirement-filtered candidate pool.
   */
  select(context: TrainingSystemContext, applicability: { requirement: TrainingRequirement; explanation: string }): TrainingSystemSelectionOutcome;
}
