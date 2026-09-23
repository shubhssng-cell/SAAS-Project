import type { AttemptState } from "@ipmat/attempt";
import type { AutopsyHypothesis, AutopsyOutput, AutopsyPersistenceRecord, RepairPlan, RepairPlanPersistenceRecord } from "@ipmat/autopsy";
import type { MasteryStatePersistenceRecord, MasteryStateResult } from "@ipmat/mastery";
import type {
  DifficultyTier,
  ProvenanceSourceType,
  PublicationDecisionAction,
  QuestionBlueprint,
  QuestionCandidateAiOutput,
  QuestionLifecycleStatus,
  ValidationState
} from "@ipmat/question-engine";

/**
 * Repository/adapter contracts (Phase 5C-1) — the FIRST persistence
 * adapters in this codebase. Each interface is the "clear ownership
 * boundary" the phase asked for: the interface is the contract a caller
 * (a future `apps/web`, a test) depends on; `PrismaXRepository` is the ONE
 * concrete implementation that actually calls Prisma; `InMemoryXRepository`
 * (packages/db/test/fixtures/inMemoryRepositories.ts) is a test double
 * implementing the SAME interface so round-trip persistence semantics can
 * be tested without a live database (none has ever been reachable — see
 * docs/MASTER_PLAN.md "Current state").
 *
 * Every `save()` here is responsible for resolving the real database
 * foreign keys (`ErrorTaxonomy.id`, `Concept.id`) that the pure domain
 * mapping functions (`toAutopsyPersistenceRecord()`, etc.) deliberately
 * cannot resolve themselves (no DB access, no Prisma dependency — domain
 * packages stay database-independent). Resolution is the repository's job,
 * not the domain layer's.
 */

export interface StoredAutopsy extends AutopsyPersistenceRecord {
  id: string;
  createdAt: string;
}

export interface AutopsyRepository {
  /** Upserts on `attemptId` (unique in the schema) — saving twice for the same attempt updates the same row, matching Autopsy's real 1:1-with-Attempt shape. */
  save(input: { hypothesis: AutopsyHypothesis; output: AutopsyOutput }): Promise<StoredAutopsy>;
  findByAttemptId(attemptId: string): Promise<StoredAutopsy | null>;
}

export interface StoredRepairPlan extends RepairPlanPersistenceRecord {
  id: string;
  createdAt: string;
}

export interface RepairPlanRepository {
  /** Always inserts a new row — RepairPlan has no uniqueness constraint beyond its id, since a student can legitimately receive more than one repair plan over time. */
  save(input: { plan: RepairPlan; autopsyId: string; studentId: string }): Promise<StoredRepairPlan>;
  findByAutopsyId(autopsyId: string): Promise<StoredRepairPlan | null>;
}

export interface StoredMasteryState extends MasteryStatePersistenceRecord {
  id: string;
}

export interface MasteryStateRepository {
  /** Upserts on `(studentId, conceptId)` (the real schema's unique constraint). Returns `null` — writes nothing — when `toMasteryStatePersistenceRecord()` returns `null` (zero contributing attempts; see @ipmat/mastery/src/persistence.ts). */
  save(result: MasteryStateResult): Promise<StoredMasteryState | null>;
  findByStudentAndConcept(studentId: string, conceptId: string): Promise<StoredMasteryState | null>;
}

/**
 * Phase 4B-1 — the persistence boundary for `@ipmat/attempt`, unlike
 * Autopsy/RepairPlan/MasteryState above, persists a PARENT row (`attempts`)
 * plus a variable-length CHILD collection (`attempt_events`), and
 * `AttemptState` already carries its own `id` (assigned by the caller via
 * `startAttempt({id, ...})`, never by this layer) — so there is no separate
 * `StoredAttempt` wrapper type here; `save()`/`findById()` traffic directly
 * in the domain's own `AttemptState`, and reconstructing one from persisted
 * rows IS the faithfulness contract this repository exists to prove.
 */
export interface AttemptRepository {
  /**
   * Upserts on `id` (the same id `startAttempt()` assigned). A brand-new id
   * creates a row after verifying the referenced `Student`/`Question`/
   * `Enrollment` (and `retryOfAttemptId`, if set) actually exist; an
   * existing id updates it in place after verifying ownership hasn't
   * changed and the existing row isn't already finalized to a DIFFERENT
   * status (see `assertAttemptOwnershipUnchanged()`/
   * `assertAttemptNotRegressingFromFinalized()` in `validation.ts`).
   * ALWAYS fully replaces the persisted `AttemptEvent` rows to match
   * `state.events` exactly, in the SAME canonical timeline order
   * `@ipmat/attempt`'s own `getEventTimeline()` computes — never an
   * incremental diff, so "what's persisted" can never silently drift from
   * "what the domain state actually says happened."
   */
  save(state: AttemptState): Promise<AttemptState>;
  /** Reconstructs a full, faithful `AttemptState` (including its ordered event timeline) from the persisted rows, or `null` if no attempt with this id exists. */
  findById(attemptId: string): Promise<AttemptState | null>;
}

/**
 * Phase 4B-2 security fix (docs/DECISIONS.md D-048) — the canonical,
 * server-loaded subset of a `Question` row that `@ipmat/practice-loop`
 * needs to gate publication and grade an attempt. A `CanonicalQuestion` is
 * NEVER meant to be constructed from caller-supplied/client input; only a
 * `QuestionReader` implementation (backed by a real lookup) may produce
 * one. This is exactly why `correctAnswer`/`validationState` live only
 * here, and never on any client-facing input type in `@ipmat/practice-loop`.
 */
export interface CanonicalQuestion {
  id: string;
  conceptId: string;
  /** Non-null only for multiple_choice, matching `AttemptQuestionContext.options` (`@ipmat/attempt`). */
  options: string[] | null;
  correctAnswer: string;
  expectedTimeSeconds: number;
  validationState: ValidationState;
}

/**
 * The ONE legitimate source of truth for a `Question`'s answer key and
 * publication state, for any orchestration layer (`@ipmat/practice-loop`)
 * that needs to grade an attempt or gate on `validationState`. An
 * untrusted HTTP/UI caller supplies an id, never the answer-bearing fields
 * this interface's implementations resolve server-side.
 */
export interface QuestionReader {
  /** Loads the canonical Question by id, or `null` if none exists. */
  findById(questionId: string): Promise<CanonicalQuestion | null>;
}

/**
 * Phase 3.5 (Content Curation / Publication Workflow) — the narrow subset
 * of a `Question` row needed to decide and apply an explicit human
 * "publish"/"reject" decision. Deliberately NOT a general Question
 * read/write shape (no `body`/`options`/`correctAnswer`/etc.) — this is
 * not a second Question repository, only a publication-decision boundary
 * (docs/DECISIONS.md D-049).
 */
export interface QuestionPublicationRecord {
  id: string;
  validationState: ValidationState;
  difficultyTier: DifficultyTier;
  /** Mirrors the DB-level CHECK constraint `questions_published_requires_provenance` (migration 0001_init) — whether a Provenance row is actually attached, never a caller's claim about it. */
  hasProvenance: boolean;
}

/**
 * The ONE write path for a Question's `validationState`, and deliberately
 * the ONLY one — there is no general Question `save()`/`update()` method
 * anywhere in this codebase, so an ordinary persistence operation can
 * never accidentally promote a `rejected` question or bypass
 * `decidePublication()`'s prerequisites (docs/DECISIONS.md D-049).
 * `decide()` intentionally takes an ACTION (`"publish" | "reject"`), never
 * a raw target `ValidationState` — every implementation must load the
 * CURRENT state itself and run it through `@ipmat/question-engine`'s
 * `decidePublication()` before writing, so a caller can never construct a
 * pre-approved target state and skip the check.
 */
export interface QuestionPublicationRepository {
  findById(questionId: string): Promise<QuestionPublicationRecord | null>;
  /** Throws `PublicationDecisionError` (never partially writes) if the decision is not currently allowed; throws `PersistenceError("missing_reference")` if no such Question exists. */
  decide(questionId: string, action: PublicationDecisionAction): Promise<QuestionPublicationRecord>;
}

/**
 * Phase 3.5 (Candidate -> persisted Question import boundary, docs/DECISIONS.md
 * D-050) — provenance metadata the CALLER supplies at import time. Never an
 * existing `provenanceId` (that would let a caller claim false pedigree for
 * imported content) — a fresh `Provenance` row is always created per import,
 * using the existing schema's own fields, never a parallel provenance system.
 */
export interface QuestionImportProvenanceInput {
  sourceType: ProvenanceSourceType;
  sourceRef?: string | null;
  licenseRef?: string | null;
  attributedTo?: string | null;
}

/**
 * Returned by `QuestionImportRepository.importValidatedCandidate()`.
 * Deliberately the SAME shape as `QuestionPublicationRecord` (plus
 * `alreadyExisted`) — an imported record must be immediately usable as
 * input to `QuestionPublicationRepository.decide()` without a caller
 * needing a separate read.
 */
export interface ImportedQuestionRecord {
  id: string;
  validationState: ValidationState;
  difficultyTier: DifficultyTier;
  hasProvenance: boolean;
  /** True when this call matched an already-imported row (same taxonomy cell + exact stem) and returned it unchanged, rather than creating a second one — see D-050's idempotency strategy. */
  alreadyExisted: boolean;
}

/**
 * The ONE write path from a validated generation-pipeline result to a real,
 * persisted `Question` row — deliberately NOT a general Question CRUD
 * repository (no update/delete, no arbitrary field overrides). Accepts only
 * `{ blueprint, candidate, status }` — the exact shape a real
 * `GenerationPipelineResult` carries — plus provenance metadata; there is no
 * parameter through which a caller could supply `validationState`,
 * `correctAnswer`, `difficultyTier`, or an existing `provenanceId` directly
 * (docs/DECISIONS.md D-050). Implementations MUST call
 * `@ipmat/question-engine`'s `assertCandidateIsImportable()` themselves
 * before writing anything, never trust that a caller already did.
 */
export interface QuestionImportRepository {
  /**
   * Throws `CandidateImportError` if `status !== "validated"` or `candidate`
   * is null (never partially writes). Throws `PersistenceError("missing_reference")`
   * if any referenced Exam/Section/Chapter/Concept/PatternFamily/
   * ErrorTaxonomy/PatternTaxonomyCell cannot be resolved by natural key.
   * Idempotent: re-importing the same candidate (same resolved
   * `patternTaxonomyCellId` + exact stem) returns the existing row with
   * `alreadyExisted: true`, never creates a second one. The persisted
   * `validationState` is always `"ai_validated"` — never `"published"`; the
   * only later path to `"published"` remains
   * `QuestionPublicationRepository.decide(id, "publish")`.
   */
  importValidatedCandidate(input: {
    blueprint: QuestionBlueprint;
    candidate: QuestionCandidateAiOutput | null;
    status: QuestionLifecycleStatus;
    provenance: QuestionImportProvenanceInput;
  }): Promise<ImportedQuestionRecord>;
}
