import type { AttemptState } from "@ipmat/attempt";
import type { AutopsyHypothesis, AutopsyOutput, AutopsyPersistenceRecord, RepairPlan, RepairPlanPersistenceRecord } from "@ipmat/autopsy";
import type { MasteryStatePersistenceRecord, MasteryStateResult } from "@ipmat/mastery";

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
