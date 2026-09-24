import type { AttemptState } from "@ipmat/attempt";
import type {
  AutopsyHypothesis,
  AutopsyOutput,
  AutopsyPersistenceRecord,
  RecommendedTrainingMode,
  RepairPlan,
  RepairPlanPersistenceRecord,
  RepairPriority
} from "@ipmat/autopsy";
import type { ErrorCategory } from "@ipmat/examiner-lens";
import type { MasteryStatePersistenceRecord, MasteryStateResult } from "@ipmat/mastery";
import type { PracticeBlockState } from "@ipmat/practice-block";
import type { PracticeSessionState } from "@ipmat/practice-session";
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

/**
 * `confirmedAt`/`attemptId` (docs/DECISIONS.md D-039 addendum) are joined
 * in from the linked `Autopsy` row (via `autopsyId`), never columns on
 * `RepairPlan` itself — see `RepairPlanRepository.findConfirmedActiveByStudentId()`.
 *
 * Unlike `RepairPlanPersistenceRecord` (always constructed from a genuine,
 * fully-populated domain `RepairPlan`, so its six snapshot fields are
 * non-optional there), a row actually READ BACK from the database can
 * legitimately predate migration `0007_repair_plan_persistence_fidelity`
 * and have any of them `NULL` — this is the one place, at the repository
 * boundary, nullable database-compatible state is allowed to surface.
 * `fromRepairPlanPersistenceRecord()` (`@ipmat/autopsy`) is what turns
 * "any of these is null" into "cannot reconstruct a domain RepairPlan,"
 * never a fabricated value.
 */
export interface StoredRepairPlan
  extends Omit<
    RepairPlanPersistenceRecord,
    "targetConceptName" | "targetPatternFamilyName" | "targetTaxonomyCellId" | "targetErrorCategory" | "recommendedTrainingMode" | "priority" | "status"
  > {
  id: string;
  createdAt: string;
  confirmedAt: string | null;
  attemptId: string;
  /** Widened from `RepairPlanPersistenceRecord`'s write-only `"pending"` literal (a freshly built plan is always `"pending"`) — a row actually read back may since have progressed to `"in_progress"`/`"completed"`, a fact `findConfirmedActiveByStudentId()`'s own exclusion filter depends on. */
  status: "pending" | "in_progress" | "completed";
  targetConceptName: string | null;
  targetPatternFamilyName: string | null;
  targetTaxonomyCellId: string | null;
  targetErrorCategory: ErrorCategory | null;
  recommendedTrainingMode: RecommendedTrainingMode | null;
  priority: RepairPriority | null;
  /** Resolved from `targetErrorTaxonomyId` (when non-null) via `ErrorTaxonomy.code` — the same resolution `toStoredRepairPlan()` and `fromRepairPlanPersistenceRecord()`'s caller already perform for the write side, mirrored here for the read side. `null` when `targetErrorTaxonomyId` is `null` (no trap code resolved — a legitimate domain state, not a gap). */
  targetErrorTaxonomyCode: string | null;
}

export interface RepairPlanRepository {
  /** Always inserts a new row — RepairPlan has no uniqueness constraint beyond its id, since a student can legitimately receive more than one repair plan over time. */
  save(input: { plan: RepairPlan; autopsyId: string; studentId: string }): Promise<StoredRepairPlan>;
  findByAutopsyId(autopsyId: string): Promise<StoredRepairPlan | null>;
  /**
   * All of this student's RepairPlans whose linked Autopsy is confirmed
   * (`confirmed === true` — the one authoritative confirmation fact,
   * docs/DECISIONS.md D-006/D-038) and whose own `status` has not reached
   * `"completed"` (a separate, orthogonal workflow-progress fact, never
   * conflated with confirmation). Ordered `createdAt DESC` — callers that
   * need to choose among several active plans (e.g.
   * `@ipmat/training-orchestration`'s `selectPlanForOrchestration()`) do
   * their own priority/recency sort over whatever this returns.
   */
  findConfirmedActiveByStudentId(studentId: string): Promise<StoredRepairPlan[]>;
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
  /**
   * `blockAllocationRequest` (docs/DECISIONS.md D-060) is the ONLY place in
   * the entire system a non-null `AttemptState.blockMembership` is ever
   * constructed — `@ipmat/attempt`'s pure `startAttempt()` always sets it to
   * `null` and stays entirely block-unaware. When supplied (only meaningful
   * for a BRAND-NEW attempt id — block membership is immutable once an
   * attempt exists, mirroring `retryOfAttemptId`), an implementation must,
   * inside the SAME transaction as the row write: re-verify the referenced
   * `PracticeBlock` exists and is `active`; **re-derive its OWNERSHIP chain
   * from scratch — `PracticeBlock -> PracticeSession -> Enrollment ->
   * Student` — and reject (fail closed) unless BOTH `enrollment.id ===
   * state.enrollmentId` AND `enrollment.studentId === state.studentId`**
   * (security-fix addendum, docs/DECISIONS.md D-060 — this is the
   * AUTHORITATIVE ownership check; it is never skipped just because
   * `PracticeBlockReader`'s own fast pre-check, one layer up, already
   * approved the same block — an eventual HTTP/API caller could bypass or
   * never call that pre-check at all, so this transaction is the one place
   * ownership can never be trusted from the caller); allocate the next
   * `blockSequenceNumber` as `(current max for that block) + 1`; verify a
   * retry (`state.retryOfAttemptId` set) inherits EXACTLY the retried
   * attempt's `practiceBlockId` (both null, or both the same block) —
   * fails closed otherwise. Omitting it (the common case) persists whatever
   * `state.blockMembership` already is (`null` for an ordinary attempt).
   */
  save(state: AttemptState, blockAllocationRequest?: { practiceBlockId: string }): Promise<AttemptState>;
  /** Reconstructs a full, faithful `AttemptState` (including its ordered event timeline) from the persisted rows, or `null` if no attempt with this id exists. */
  findById(attemptId: string): Promise<AttemptState | null>;
}

/**
 * Phase 4B-2's exact `QuestionReader` role (docs/DECISIONS.md D-048),
 * mirrored for PracticeBlock (docs/DECISIONS.md D-060) — the narrow,
 * server-loaded fact `@ipmat/practice-loop`'s fast, NON-transactional
 * ownership pre-check needs before calling into `startAttempt()`. This is
 * NOT the authoritative check (that lives inside
 * `AttemptRepository.save()`'s own transaction, re-verified there against a
 * fresh read) — this is only a quick, early, better-error-message rejection
 * for the common case, exactly like `QuestionReader` is for question
 * publication state.
 *
 * `enrollmentId`/`studentId` (security-fix addendum, docs/DECISIONS.md
 * D-060) are resolved by a real join through the authoritative chain
 * `PracticeBlock -> PracticeSession -> Enrollment -> Student` — NEVER
 * columns stored redundantly on `PracticeBlock` itself. They exist here
 * only so this FAST pre-check can reject an obvious student/enrollment
 * mismatch before ever calling `AttemptRepository.save()`. This is
 * explicitly NOT the authoritative check — see `save()`'s own doc comment
 * below for why the same verification is REPEATED, from scratch, inside
 * its transaction, and must never be skipped just because this pre-check
 * already ran.
 */
export interface PracticeBlockOwnershipRecord {
  id: string;
  status: PracticeBlockState["status"];
  enrollmentId: string;
  studentId: string;
}

export interface PracticeBlockReader {
  findById(practiceBlockId: string): Promise<PracticeBlockOwnershipRecord | null>;
}

/**
 * Phase D-060 — dedicated, atomic methods (never a generic overloaded
 * `save()`) specifically because session completion/abandonment requires a
 * re-read-check-write pattern ("no active child block," re-verified INSIDE
 * the same transaction as the status write) that a simple
 * `save(state)` — given an already-computed state from an earlier,
 * separate read — cannot satisfy (docs/DECISIONS.md D-060). `create()` is
 * the sibling of `AttemptRepository.save()`'s creation path; `complete()`/
 * `abandon()` each run their OWN Serializable transaction via
 * `runSerializableTransaction()`, never inside a caller-supplied one.
 */
export interface PracticeSessionRepository {
  /** Throws `PersistenceError("missing_reference")` if `enrollmentId` doesn't resolve. */
  create(input: { id: string; enrollmentId: string; now: string; sessionTimeBudgetSeconds?: number | null }): Promise<PracticeSessionState>;
  findById(sessionId: string): Promise<PracticeSessionState | null>;
  /**
   * Re-reads the session AND re-checks "no active child PracticeBlock"
   * INSIDE one fresh `Serializable` transaction, then writes
   * `status: "completed"` — never trusts an earlier, separate read of
   * either fact. Throws `PracticeSessionLifecycleError` (`@ipmat/practice-
   * session`) if the session doesn't exist, is already finalized, or still
   * has an active block; throws `SerializationFailureError` on a genuine
   * concurrent conflict (never retried automatically).
   */
  complete(sessionId: string, input: { now: string }): Promise<PracticeSessionState>;
  /** Same re-read-check-write contract as `complete()`, for `status: "abandoned"`. */
  abandon(sessionId: string, input: { now: string }): Promise<PracticeSessionState>;
}

/**
 * Phase D-060 — the PracticeBlock sibling of `PracticeSessionRepository`.
 * `create()` allocates `sequenceNumber` as `(current max for the session) +
 * 1` and re-verifies the parent session is still `active`, both INSIDE the
 * same `Serializable` transaction as the insert — never a caller-supplied
 * sequence number, never a separate, earlier "is the session active" read.
 */
export interface PracticeBlockRepository {
  /** Throws `PracticeBlockLifecycleError("session_not_active")` if the parent session is not `active`; throws `PersistenceError("missing_reference")` if `practiceSessionId` doesn't resolve at all. */
  create(input: {
    id: string;
    practiceSessionId: string;
    now: string;
    targetQuestionCount?: number | null;
    blockTimeBudgetSeconds?: number | null;
  }): Promise<PracticeBlockState>;
  findById(blockId: string): Promise<PracticeBlockState | null>;
  findBySessionId(practiceSessionId: string): Promise<PracticeBlockState[]>;
  /** Re-reads the block INSIDE one fresh `Serializable` transaction, then writes `status: "completed"`. Throws `PracticeBlockLifecycleError` if not found or already finalized. */
  complete(blockId: string, input: { now: string }): Promise<PracticeBlockState>;
  /** Same re-read-check-write contract as `complete()`, for `status: "abandoned"`. */
  abandon(blockId: string, input: { now: string }): Promise<PracticeBlockState>;
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
