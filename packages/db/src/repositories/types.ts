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
