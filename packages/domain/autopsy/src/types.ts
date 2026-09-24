import type { AttemptAutopsyEvidence } from "@ipmat/attempt";
import type { AiResultMetadata } from "@ipmat/ai";
import type { ErrorCategory } from "@ipmat/examiner-lens";
import type { DifficultyDimensions, DifficultyTier, ExamRelevance, NoveltyLevel, TestingMode } from "@ipmat/question-engine";

export type { AttemptAutopsyEvidence };

/**
 * OBSERVATION -> EVIDENCE -> HYPOTHESIS -> CONFIRMED DIAGNOSIS. Phase 5A
 * implemented the first two layers; Phase 5B (docs/PHASE_5B_REVIEW.md)
 * implements the second two:
 *
 * - OBSERVATION: what `@ipmat/attempt`'s `AttemptAutopsyEvidence` already
 *   captures — raw, per-attempt facts (final answer, event timeline, etc).
 * - EVIDENCE: deterministic, named signals derived from observations plus
 *   the authoritative question context (behaviorSignals, historicalSignals,
 *   candidateErrorEvidence) — `buildAutopsyOutput()`.
 * - HYPOTHESIS: a real AI call (`generateHypothesis()`, `hypothesisPrompts.ts`,
 *   through `@ipmat/ai`) proposes ONE explanation from the EVIDENCE above —
 *   untrusted output, schema-validated, always created with
 *   `confirmationStatus: "awaiting_confirmation"`.
 * - CONFIRMED DIAGNOSIS: only reached via `applyConfirmationResponse()`
 *   (`hypothesis.ts`) — an explicit student action. Nothing in this
 *   package can move a hypothesis to `"confirmed"` any other way (docs/
 *   DECISIONS.md D-006). `buildRepairPlan()` additionally REQUIRES
 *   `confirmationStatus === "confirmed"` before it will produce anything.
 *
 * NEVER INFERRED, anywhere in this package, by design — there is no field
 * anywhere in this file for any of: confidence, motivation, emotion,
 * intelligence, anxiety, laziness, carelessness (as a trait), or intent.
 * `careless_arithmetic` appearing as an EXISTING ErrorTaxonomy *code name*
 * (from Phase 1/2 seed data, describing a category of calculation error)
 * is not an exception to this — this package never asserts "the student
 * IS careless," only ever "this attempt's evidence pattern-matches the
 * calculation_mistake category coded careless_arithmetic," as an
 * unconfirmed candidate, same as every other candidate error category.
 * `modelConfidence` (Phase 5B) is the AI model's own confidence in ONE
 * hypothesis, explicitly named as such, for ranking only — it is never,
 * and must never become, a claim about the STUDENT's confidence in
 * anything (Phase 5B §2).
 */

// ---------------------------------------------------------------------
// Centralized thresholds — never scatter magic numbers (Phase 5A §2)
// ---------------------------------------------------------------------

export const AUTOPSY_THRESHOLDS = {
  /** speedRatio <= this counts as "fast" (well under expected time) for the correct_fast/incorrect_fast signals. */
  FAST_SPEED_RATIO: 0.7,
  /** speedRatio >= this counts as "slow" (well over expected time) for the correct_slow/incorrect_slow signals. */
  SLOW_SPEED_RATIO: 1.3,
  /** changeCount >= this counts as "multiple" answer changes, as opposed to exactly one change. */
  MULTIPLE_ANSWER_CHANGES: 2,
  /** A repeated-evidence count must reach at least this many occurrences before it is reported at all — one occurrence is never "repeated" (Phase 5A §13 regression test 2). */
  REPEATED_EVIDENCE_MIN_COUNT: 2
} as const;

// ---------------------------------------------------------------------
// 1. Autopsy input — evidence + authoritative question context
// ---------------------------------------------------------------------

/**
 * The authoritative Question / Question DNA context this package needs,
 * restated (not imported from `@prisma/client`) the same way
 * `@ipmat/attempt`'s `AttemptQuestionContext` restates `Question` fields —
 * this package has no Prisma dependency either. `expectedTimeSeconds` is
 * deliberately NOT included here: it already lives on
 * `AttemptAutopsyEvidence.expectedTimeSeconds` (Phase 4A), and repeating
 * it here would be exactly the kind of unnecessary duplication Phase 5A
 * §1 warns against — read it from `attemptFacts` in the output instead.
 */
export interface AutopsyQuestionContext {
  questionId: string;
  examCode: string;
  sectionName: string;
  chapterName: string;
  conceptName: string;
  patternFamilyName: string;
  /** An opaque identifier for the PatternTaxonomyCell this question was generated for — caller-supplied, not resolved by this package (no DB access). */
  patternTaxonomyCellId: string;
  difficultyTier: DifficultyTier;
  difficultyDimensions: DifficultyDimensions;
  noveltyLevel: NoveltyLevel;
  examRelevance: ExamRelevance;
  testingModes: TestingMode[];
  trapErrorTaxonomyCode: string | null;
  combinesWithConcepts: string[];
}

/**
 * Restated from `@ipmat/db/seed-data/errorTaxonomy.ts`'s shape (not
 * imported — domain packages must not depend on `@ipmat/db`, which pulls
 * in Prisma; see docs/ARCHITECTURE.md §6). This package integrates the
 * EXISTING error taxonomy by requiring the caller to supply the same
 * entries a real database would hold — it does not define a second,
 * competing taxonomy (Phase 5A §8).
 */
export interface ErrorTaxonomyEntry {
  code: string;
  label: string;
  description: string;
  category: ErrorCategory;
}

/** One PRIOR finalized attempt on some question, paired with that question's context — the minimal unit historical-signal derivation needs (Phase 5A §7). */
export interface HistoricalAttemptRecord {
  evidence: AttemptAutopsyEvidence;
  question: AutopsyQuestionContext;
}

export interface AutopsyInput {
  evidence: AttemptAutopsyEvidence;
  question: AutopsyQuestionContext;
  /** The existing ErrorTaxonomy — every entry the caller has available, not a subset this package curates. */
  errorTaxonomy: ErrorTaxonomyEntry[];
  /** Prior finalized attempts (same student, any question) for historical/repeated-evidence detection. Omit or pass `[]` when none are available — historicalSignals will then be entirely absent (not fabricated as zero-count evidence). */
  priorAttempts?: HistoricalAttemptRecord[];
}

// ---------------------------------------------------------------------
// 2/3. Deterministic observation signals, interpreted with question context
// ---------------------------------------------------------------------

/**
 * Named, deterministic behavior signals (Phase 5A §2/§3). Every boolean
 * here is a fact about what was OBSERVED, computed once from
 * `AttemptAutopsyEvidence` plus `AutopsyQuestionContext` — never a
 * judgment about why. `speedRatio` is `timeTaken / expectedTime`, and
 * ONLY computed when both are present, finite, and `expectedTime > 0`; if
 * expected time is missing or invalid, `speedRatio` is `null` and every
 * signal that depends on it is `false`, not guessed.
 */
export interface BehaviorSignals {
  /** `timeTakenSeconds / expectedTimeSeconds`, or null if either is missing/invalid (Phase 5A §2). Never manufactured. */
  speedRatio: number | null;
  correctFast: boolean;
  correctSlow: boolean;
  incorrectFast: boolean;
  incorrectSlow: boolean;
  /** True whenever the answer changed at least once (changeCount >= 1) — purely observational, never labeled "low confidence." */
  answerChanged: boolean;
  multipleAnswerChanges: boolean;
  hintUsed: boolean;
  solutionOpened: boolean;
  skipped: boolean;
  /** No final answer was ever recorded — covers a skip AND an abandoned attempt where nothing was selected. Distinct from `skipped`: an abandoned attempt with no_answer=true is not skipped=true. */
  noAnswer: boolean;
  /** speedRatio > 1 — ANY time over expected, a coarser signal than *_slow (which requires crossing SLOW_SPEED_RATIO). Both can and do coexist (Phase 5A §13 regression test 4). */
  timeAboveExpected: boolean;
  timeBelowExpected: boolean;
}

/**
 * Temporal hint/solution evidence (Phase 5A §5). "Before finalization" is
 * computed from actual event ordering in the timeline, not assumed — but
 * under Phase 4A's guarantee that no event can be recorded after an
 * attempt is finalized (`@ipmat/attempt`'s `already_finalized` guard),
 * this is structurally always true whenever both a hint/solution event
 * AND a terminal event (`answer_submitted`/`question_skipped`) exist in
 * the same attempt's timeline. It is computed genuinely, not hardcoded,
 * so it stays correct if that guarantee ever changes — this is
 * deliberately NOT simplified away, and the "currently always true" fact
 * is documented, not hidden (docs/PHASE_5A_REVIEW.md).
 */
export interface HintSolutionEvidence {
  hintUsed: boolean;
  hintCount: number;
  solutionOpened: boolean;
  /** Null when no hint was used, or when the attempt has no terminal event in its timeline (an `abandoned` attempt never appends one). */
  hintBeforeFinalization: boolean | null;
  solutionBeforeFinalization: boolean | null;
}

// ---------------------------------------------------------------------
// 7. Historical / repeated evidence — counts, never a narrative
// ---------------------------------------------------------------------

/** A repeated-occurrence count, always >= AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT when present — a single occurrence is never reported as "repeated" (Phase 5A §13 regression test 2). */
export interface RepetitionCount {
  count: number;
  /** Which attempts (by id) contributed to this count, for auditability — never just a bare number with no trace back to real attempts. */
  attemptIds: string[];
}

/**
 * Purely observable counts across the current attempt plus any supplied
 * prior attempts — e.g. "same taxonomy cell failed 3 times," never
 * "student doesn't understand the concept" (Phase 5A §7). `null` on any
 * field means that specific pattern was not observed at the repeated
 * threshold (or, for the pressure field, that no pressure-context
 * question was present to evaluate at all) — never a fabricated zero.
 */
export interface HistoricalSignals {
  totalPriorAttempts: number;
  repeatedConceptFailure: RepetitionCount | null;
  repeatedPatternFamilyFailure: RepetitionCount | null;
  repeatedTaxonomyCellFailure: RepetitionCount | null;
  repeatedSlowPerformance: RepetitionCount | null;
  repeatedHintUse: RepetitionCount | null;
  repeatedSolutionOpening: RepetitionCount | null;
  /** Repeated INCORRECT results specifically on non-"standard" noveltyLevel questions for this concept. */
  repeatedNoveltyDifficulty: RepetitionCount | null;
  /** Repeated INCORRECT results specifically on questions whose testingModes include "time_pressured" for this concept — null (not zero) when no pressure-context question was present in the supplied history at all, since there is then nothing to evaluate. */
  repeatedPressureDifficulty: RepetitionCount | null;
  /** Observable sequencing fact: was the solution opened in the CURRENT attempt, given that an earlier attempt (in the supplied history) on the same question was incorrect? Never a claim about why. */
  solutionOpenedAfterPriorIncorrectAttempt: boolean;
}

// ---------------------------------------------------------------------
// 8. Error taxonomy candidate evidence — CANDIDATE, never confirmed
// ---------------------------------------------------------------------

/**
 * A CANDIDATE error category, deterministically pattern-matched against
 * the question's own designated trap and the observed signals — NEVER an
 * AI call, and NEVER auto-promoted to a confirmed diagnosis (Phase 5A
 * §8). There is no `confirmed` field on this type at all — confirmation
 * is exclusively a property of `AutopsyHypothesis` (implemented in
 * Phase 5B — see `hypothesis.ts`'s `applyConfirmationResponse()`) / the
 * real `Autopsy.confirmed` column, gated on the student's own response
 * (docs/DECISIONS.md D-006). `qualification` is mandatory and always
 * present, precisely so this can never be read as more certain than it is.
 */
export interface CandidateErrorEvidence {
  proposedErrorCategory: ErrorCategory | null;
  proposedErrorTaxonomyCode: string | null;
  supportingEvidence: string[];
  missingEvidence: string[];
  /** Always present — a plain-language caveat that this is a candidate, not a confirmed diagnosis. */
  qualification: string;
}

// ---------------------------------------------------------------------
// 9. Autopsy output contract — structured, deterministic, no AI prose
// ---------------------------------------------------------------------

export interface AutopsyOutput {
  /** Reused directly from `@ipmat/attempt` — not re-derived (Phase 5A §1). */
  attemptFacts: AttemptAutopsyEvidence;
  questionFacts: AutopsyQuestionContext;
  behaviorSignals: BehaviorSignals;
  hintSolutionEvidence: HintSolutionEvidence;
  /** Absent (not zero-filled) when no prior attempts were supplied. */
  historicalSignals: HistoricalSignals | null;
  /** Absent (null) when the attempt was correct, in_progress, or otherwise has no wrong answer to categorize. */
  candidateErrorEvidence: CandidateErrorEvidence | null;
  /** Plain-language notes on what evidence WAS available for this output (auditability). */
  availableEvidence: string[];
  /** Plain-language notes on what evidence was NOT available — e.g. no prior attempt history, no error-taxonomy match for the question's trap code. */
  missingEvidence: string[];
}

// ---------------------------------------------------------------------
// 10. Hypothesis + confirmation — IMPLEMENTED (Phase 5B)
// ---------------------------------------------------------------------

/**
 * `awaiting_confirmation` is the ONLY status `generateHypothesis()` ever
 * produces — every other value is reachable exclusively through
 * `applyConfirmationResponse()`, an explicit student action (Phase 5B §4,
 * docs/DECISIONS.md D-006). `corrected` is distinct from `rejected`: it
 * means the student supplied their own replacement explanation (preserved
 * verbatim as NEW evidence, never overwriting `proposedExplanation`);
 * `rejected` means they said no without providing one. Both are terminal —
 * once set, `applyConfirmationResponse()` refuses to apply a second
 * response (`already_decided`).
 */
export type HypothesisConfirmationStatus = "awaiting_confirmation" | "confirmed" | "rejected" | "corrected";

/**
 * A real, generated hypothesis (Phase 5B) — the output of `generateHypothesis()`,
 * evolved by `applyConfirmationResponse()`. `confirmationRequired` is a
 * literal `true`: structurally, a hypothesis can never claim to skip
 * confirmation. There is NO field representing the STUDENT's confidence —
 * `modelConfidence` is the AI model's own confidence in this hypothesis,
 * explicitly named as such, never exposed or reinterpreted as the
 * student's (Phase 5B §2).
 */
export interface AutopsyHypothesis {
  attemptId: string;
  proposedErrorCategory: ErrorCategory | null;
  proposedExplanation: string;
  supportingEvidence: string[];
  contradictoryEvidence: string[];
  missingEvidence: string[];
  /** The MODEL's confidence in this hypothesis (0-1), for ranking only — NEVER the student's confidence in anything. Null if the model gave none. */
  modelConfidence: number | null;
  confirmationRequired: true;
  confirmationStatus: HypothesisConfirmationStatus;
  /** Set only when confirmationStatus is "corrected" — the student's own replacement explanation, preserved as new evidence alongside (never overwriting) `proposedExplanation`. */
  studentCorrectionText: string | null;
  /** When the confirmation response was applied — null while still `awaiting_confirmation`. */
  respondedAt: string | null;
  /** The AI call's own metadata (provider, model, promptVersion, cost, etc.) — this is the "hypothesis-generation metadata" Phase 5B §1 asks for. */
  generationMetadata: AiResultMetadata;
}

/** What a student's response to a hypothesis may contain (Phase 5B §4) — a closed, discriminated set; there is no fourth option. */
export type ConfirmationResponse =
  | { type: "confirmed" }
  | { type: "rejected" }
  | { type: "corrected"; correctedExplanation: string };

export const HYPOTHESIS_ERROR_CODES = [
  "hypothesis_not_found",
  "no_evidence_to_diagnose",
  "already_decided",
  "malformed_correction",
  "not_confirmed",
  "mismatched_attempt",
  "no_error_category"
] as const;

export type HypothesisErrorCode = (typeof HYPOTHESIS_ERROR_CODES)[number];

/** Every invalid-transition / malformed-input case in the hypothesis/confirmation/repair-plan layer fails closed by throwing this — the same discipline `@ipmat/attempt`'s `AttemptLifecycleError` established (docs/DECISIONS.md D-034). */
export class HypothesisError extends Error {
  readonly code: HypothesisErrorCode;

  constructor(code: HypothesisErrorCode, message: string) {
    super(message);
    this.name = "HypothesisError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------
// 11. Repair context — identifies a target, does not select content
// ---------------------------------------------------------------------

/**
 * A simple, deterministic priority label — not a psychological urgency
 * judgment, just a rule-based summary of how much repeated/candidate
 * evidence exists (see `repairContext.ts`).
 */
export type RepairPriority = "low" | "medium" | "high";

/**
 * A provisional, deliberately small vocabulary for what KIND of practice
 * might help — this is a v1 heuristic (see `buildRepairContext()`), not a
 * finalized taxonomy; growing it is expected, the same way ErrorTaxonomy
 * itself grows deliberately (docs/DATABASE.md §Error Taxonomy).
 */
export type RecommendedTrainingMode = "standard_practice" | "guided_hint_first" | "timed_pressure_drill" | "novelty_exposure";

/**
 * The minimal input a future RepairPlan/question-selection system would
 * need (Phase 5A §11) — identifies a TARGET, never selects or generates
 * actual follow-up questions (`followUpQuestionIds` deliberately does not
 * exist on this type; that remains Phase 5B+ work).
 */
export interface RepairContext {
  targetConceptName: string;
  targetPatternFamilyName: string;
  targetTaxonomyCellId: string;
  candidateErrorCategory: ErrorCategory | null;
  candidateErrorTaxonomyCode: string | null;
  recommendedTrainingMode: RecommendedTrainingMode;
  supportingEvidence: string[];
  priority: RepairPriority;
}

// ---------------------------------------------------------------------
// 6 (Phase 5B). RepairPlan — a CONFIRMED diagnosis turned into a target,
// still never selects/generates actual follow-up questions
// ---------------------------------------------------------------------

/**
 * Built by `buildRepairPlan()` ONLY from a `confirmationStatus ===
 * "confirmed"` hypothesis (Phase 5B §6) — a `RepairContext` (Phase 5A) is
 * built from evidence ALONE and can exist for any incorrect attempt;
 * a `RepairPlan` additionally requires a STUDENT-CONFIRMED diagnosis,
 * which is what makes `targetErrorCategory` trustworthy enough to act on.
 * Still has NO `followUpQuestionIds` field — selecting or generating
 * actual questions remains explicitly out of scope (Phase 5B §6, the same
 * restriction Phase 5A's `RepairContext` already carries).
 */
export interface RepairPlan {
  targetConceptName: string;
  targetPatternFamilyName: string;
  targetTaxonomyCellId: string;
  /** From the CONFIRMED hypothesis — the student-validated category, not merely the deterministic candidate's guess. */
  targetErrorCategory: ErrorCategory;
  /** From the deterministic `candidateErrorEvidence` (Phase 5A) computed for this same attempt — may be null if no trap code resolved even though the hypothesis proposed a category from other evidence; see docs/PHASE_5B_REVIEW.md for this known tension between the AI-proposed category and the deterministically-matched code. */
  targetErrorTaxonomyCode: string | null;
  recommendedTrainingMode: RecommendedTrainingMode;
  priority: RepairPriority;
  rationale: string[];
  /** Real concept-graph prerequisites for the target concept, when a `ConceptGraph` was supplied to `buildRepairPlan()` — `[]` otherwise (never guessed). */
  prerequisites: string[];
  /** Traceability back to exactly which confirmed hypothesis authorized this plan. */
  confirmationSource: { attemptId: string; hypothesisConfirmedAt: string };
}

// ---------------------------------------------------------------------
// 5 (Phase 5B). Persistence-ready contracts — shapes only, no adapter
// ---------------------------------------------------------------------

/**
 * The exact shape a Prisma adapter writes to the `autopsies` table
 * (packages/db/prisma/schema.prisma) — Phase 5B §5 found the
 * confirmation-status side of this needs no migration: `confirmed:
 * Boolean?` + `studentCorrectionText: String?` already jointly encode all
 * 4 `HypothesisConfirmationStatus` values (see `toAutopsyPersistenceRecord()`
 * in `persistence.ts` for the exact mapping). `confirmedAt` (docs/DECISIONS.md
 * D-039 addendum) was the one field genuinely missing a column — the exact
 * instant `confirmed` became true/false, distinct from `confirmed` itself,
 * needed by `RepairPlan.confirmationSource.hypothesisConfirmedAt` and
 * added by migration `0007_repair_plan_persistence_fidelity`.
 * `errorTaxonomyId` is a real database foreign key this package cannot
 * resolve itself (no DB access, no Prisma dependency) — the caller/adapter
 * resolves `proposedErrorTaxonomyCode` to a real `ErrorTaxonomy.id` before
 * writing.
 */
export interface AutopsyPersistenceRecord {
  attemptId: string;
  hypothesisText: string;
  errorTaxonomyId: string | null;
  likelyRootCause: string | null;
  evidenceUsed: Record<string, unknown>;
  confirmed: boolean | null;
  /** `hypothesis.respondedAt` verbatim — `null` while still `awaiting_confirmation`. Never inferred from `createdAt`/`updatedAt`/the current time (docs/DECISIONS.md D-039 addendum). */
  confirmedAt: string | null;
  studentCorrectionText: string | null;
  generatedByProvider: string;
  promptVersion: string;
}

/**
 * The exact shape a Prisma adapter writes to the `repair_plans` table.
 * `followUpQuestionIds` is always `[]` since this package never selects
 * questions. The six snapshot fields below (docs/DECISIONS.md D-039
 * addendum) were previously silently dropped by `toRepairPlanPersistenceRecord()`
 * even though the domain `RepairPlan` always carries them — added by
 * migration `0007_repair_plan_persistence_fidelity`. They are HISTORICAL
 * SNAPSHOT data (what was diagnosed, computed once at `buildRepairPlan()`
 * time), never re-derived from a live join to `Concept`/`QuestionPatternFamily`
 * at read time — a later rename of either must not rewrite an existing
 * RepairPlan's recorded target.
 */
export interface RepairPlanPersistenceRecord {
  studentId: string;
  autopsyId: string;
  targetConceptId: string;
  targetErrorTaxonomyId: string | null;
  followUpQuestionIds: string[];
  status: "pending";
  targetConceptName: string;
  targetPatternFamilyName: string;
  targetTaxonomyCellId: string;
  targetErrorCategory: ErrorCategory;
  recommendedTrainingMode: RecommendedTrainingMode;
  priority: RepairPriority;
}
