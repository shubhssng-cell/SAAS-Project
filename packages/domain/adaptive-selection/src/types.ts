import type { AutopsyQuestionContext, RepairPlan } from "@ipmat/autopsy";
import type { MasteryAttemptRecord, MasteryStateResult, PatternTaxonomyCellData } from "@ipmat/mastery";
import type { PrepPhaseResult } from "@ipmat/prep-phase";
import type { DifficultyTier, NoveltyLevel, ValidationState } from "@ipmat/question-engine";

export type {
  AutopsyQuestionContext,
  DifficultyTier,
  MasteryAttemptRecord,
  MasteryStateResult,
  NoveltyLevel,
  PatternTaxonomyCellData,
  PrepPhaseResult,
  RepairPlan,
  ValidationState
};

/**
 * Phase 5C-3 — GLOBAL ADAPTIVE SELECTION, deterministic core only (docs/
 * DECISIONS.md D-051). Answers "what should this student practice next,"
 * across every concept the caller supplies — the genuinely global sibling
 * to `@ipmat/repair-selection`'s Phase 5C-2, which answers a narrower
 * question ("given THIS ONE confirmed diagnosis, which question repairs
 * it") and is never imported or called here (`RepairPlan` is consumed
 * directly as ONE input signal instead — see `trainingNeeds.ts`).
 *
 * Every signal this package reads is REUSED from an existing, already-real
 * contract — `MasteryStateResult` (`@ipmat/mastery`, Phase 5B, itself
 * NEVER a composite score, D-040/D-041), `RepairPlan` (`@ipmat/autopsy`,
 * Phase 5B), `PrepPhaseResult` (`@ipmat/prep-phase`, Phase 1),
 * `PatternTaxonomyCellData`/coverage (`@ipmat/question-engine`). Nothing
 * here invents a second mastery model, a second coverage model, or a
 * confidence/motivation/emotion/intelligence signal of any kind.
 */

// ---------------------------------------------------------------------
// Centralized, provisional constants — same discipline as
// MASTERY_CONSTANTS/AUTOPSY_THRESHOLDS/REPAIR_SELECTION_CONSTANTS: never
// scatter magic numbers, never claim a calibrated weight that doesn't
// exist. These are AUTHORED POLICY, not learned facts (requirement 12).
// ---------------------------------------------------------------------

export const ADAPTIVE_SELECTION_CONSTANTS = {
  /** Mean accuracy strictly below this, WHEN MEASURED (not null), counts as an accuracy weakness. */
  ACCURACY_WEAKNESS_THRESHOLD: 0.6,
  /** Mean speedRatio at or above this counts as a speed weakness — reuses `@ipmat/autopsy`'s `AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO` VALUE for consistency (both measure actual/expected time as a ratio), even though it is now applied to a MEAN across attempts rather than one attempt's ratio. */
  SPEED_WEAKNESS_RATIO: 1.3,
  /** Novelty-handling / pressure-performance accuracy strictly below this, WHEN MEASURED, counts as a training gap. */
  NOVELTY_WEAKNESS_THRESHOLD: 0.6,
  PRESSURE_WEAKNESS_THRESHOLD: 0.6,
  /** A tier is "mastered enough to progress" once accuracy on it is at or above this, given sufficient observations. */
  PROGRESSION_ACCURACY_THRESHOLD: 0.8,
  /** `MasteryComponentDetail.errorRecurrence.longestIncorrectStreak` at or above this counts as a repeated-error signal. Mirrors `@ipmat/autopsy`'s `AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT` (2) in spirit ("a single occurrence is never repeated"), declared locally since it thresholds a different, package-local statistic. */
  REPEATED_ERROR_MIN_STREAK: 2,
  /** A candidate the student has already attempted at least this many times is deprioritized within its bucket, mirroring `@ipmat/repair-selection`'s `REPAIR_SELECTION_CONSTANTS.OVERUSE_MIN_ATTEMPT_COUNT` — the same policy, independently declared (siblings do not depend on each other). */
  OVERUSE_MIN_ATTEMPT_COUNT: 2,
  /** A pattern family with fewer than this many total attempts (across all its cells) by this student, while the student DOES have some attempt history overall, counts as underexposed. */
  UNDEREXPOSURE_MAX_FAMILY_ATTEMPT_COUNT: 2
} as const;

/**
 * A deliberate, explicit rank order for difficulty-progression reasoning
 * only — the SAME caveat `@ipmat/repair-selection`'s `DIFFICULTY_RANK`
 * already carries (docs/DECISIONS.md D-021): not a claim that tiers are
 * calibrated or linearly "harder," only a fixed direction to reason
 * "one step up/down" in.
 */
export const DIFFICULTY_TIER_ORDER: DifficultyTier[] = ["standard", "advanced", "hard", "extreme", "novel"];

/**
 * One available question's DNA, shaped for adaptive selection — composed
 * from the SAME two existing shapes `@ipmat/repair-selection`'s
 * `RepairCandidateQuestion` composes from (`AutopsyQuestionContext` +
 * `expectedTimeSeconds`/`validationState`), independently declared here
 * rather than imported from that sibling package (adaptive-selection and
 * repair-selection are siblings, not a hierarchy — both restate this
 * small shape from their shared upstream rather than depending on each
 * other, the same pattern `@ipmat/ai`'s own restated vocabularies use,
 * D-017).
 */
export interface AdaptiveCandidateQuestion {
  question: AutopsyQuestionContext;
  expectedTimeSeconds: number;
  validationState: ValidationState;
}

export interface CandidateValidationIssue {
  field: string;
  message: string;
}

export interface CandidateValidationResult {
  valid: boolean;
  issues: CandidateValidationIssue[];
}

/**
 * Explicit, named, ORDERED reason codes (most to least urgent) — a
 * deterministic priority system, never a black-box numeric score
 * (requirement 12). `difficulty_progression` is the deliberate FALLBACK
 * tier: it is the only reason that can fire with no specific weakness at
 * all (a "student is doing fine here, offer the next logical step"
 * signal), and the only one `AdaptiveSelectionResult.isFallback` reports
 * `true` for.
 */
export const TRAINING_NEED_REASON_CODES = [
  "repair_priority",
  "repeated_error",
  "prerequisite_weakness",
  "accuracy_weakness",
  "speed_weakness",
  "coverage_gap",
  "underexposure",
  "pressure_gap",
  "novelty_gap",
  "difficulty_progression"
] as const;
export type TrainingNeedReasonCode = (typeof TRAINING_NEED_REASON_CODES)[number];

/** The fixed priority order itself — iterated top to bottom; the first non-empty bucket wins. Exported as its own array (not just derived from the const above) so a test can assert on the ORDER directly, the same way `@ipmat/repair-selection` exports `REPAIR_MATCH_TIER_ORDER`. */
export const TRAINING_NEED_PRIORITY_ORDER: TrainingNeedReasonCode[] = [...TRAINING_NEED_REASON_CODES];

export interface AdaptiveSelectionInput {
  studentId: string;
  /** Already-computed mastery, one entry per concept — reused directly, never re-aggregated into anything coarser. */
  masteryByConcept: MasteryStateResult[];
  /** The SAME attempt records `@ipmat/mastery` consumes — used here only to derive per-question/per-family exposure counts (overuse/underexposure), never a second mastery computation. */
  attemptRecords: MasteryAttemptRecord[];
  /** Confirmed diagnoses currently active for this student, if any — ONE input signal among ten, never delegated to (see the package doc comment). */
  activeRepairPlans?: RepairPlan[];
  /** This student's current calendar phase, if computed — reserved for phase-appropriate weighting; the deterministic core in this pass does not yet use it for ranking (see `selectNextQuestion.ts`'s own doc comment). */
  prepPhase?: PrepPhaseResult | null;
  /** The full known taxonomy-cell universe, for family-level coverage context. Optional — omitting it only narrows `coverage_gap`/`underexposure` to what can be derived from `attemptRecords` alone, it never causes a crash or a guessed value. */
  taxonomyCells?: PatternTaxonomyCellData[];
  candidates: AdaptiveCandidateQuestion[];
}

export interface AdaptiveCandidateExplanation {
  questionId: string;
  primaryReason: TrainingNeedReasonCode;
  allReasonsSatisfied: TrainingNeedReasonCode[];
}

export interface AdaptiveSelectionResult {
  question: AutopsyQuestionContext;
  /** The single highest-priority reason code this candidate satisfies — what actually decided the bucket it won in. */
  primaryReason: TrainingNeedReasonCode;
  /** Every reason code this candidate happens to satisfy, not just the winning one — e.g. a candidate can be both an accuracy_weakness AND a coverage_gap simultaneously. */
  allReasonsSatisfied: TrainingNeedReasonCode[];
  targetConceptName: string;
  /** True ONLY in the genuine last-resort case: no candidate satisfied ANY named reason, so every eligible candidate was treated as `difficulty_progression`. A candidate that genuinely satisfies difficulty_progression's own predicate (its tier IS the right next step) reports `false` here — that is a real, if low-priority, need, not a fallback. Mirrors `@ipmat/repair-selection`'s `isFallback` semantics for `concept_fallback`. */
  isFallback: boolean;
  /** Deterministically generated from the reason code and candidate DNA — never free text from an AI call. */
  explanation: string;
  /** What coverage/exposure gap this selection fills, when the primary reason is `coverage_gap`/`underexposure` — `null` for every other reason (there is no coverage gap being addressed by, say, an accuracy-weakness pick). */
  coverageGapAddressed: string | null;
  /** Ranked runners-up from the SAME winning bucket (tie-break order), excluding the winner — for explainability/testing, never a hidden internal detail. */
  rankedAlternatives: AdaptiveCandidateExplanation[];
  candidatesConsidered: number;
  excludedMalformedCount: number;
  excludedUnpublishedCount: number;
}

export type AdaptiveNoSelectionReason = "no_candidates_supplied" | "no_published_candidates" | "no_structurally_valid_candidates";

export type AdaptiveSelectionOutcome =
  | { status: "selected"; result: AdaptiveSelectionResult }
  | { status: "no_selection"; reason: AdaptiveNoSelectionReason; explanation: string; candidatesConsidered: number; excludedMalformedCount: number };
