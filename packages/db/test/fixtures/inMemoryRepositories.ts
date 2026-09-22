import { toAutopsyPersistenceRecord, toRepairPlanPersistenceRecord, type AutopsyHypothesis, type AutopsyOutput, type RepairPlan } from "@ipmat/autopsy";
import { toMasteryStatePersistenceRecord, type MasteryStateResult } from "@ipmat/mastery";
import {
  assertAutopsyLinkage,
  assertConceptResolved,
  assertErrorTaxonomyResolved,
  assertRepairPlanConfirmed,
  assertRepairPlanIdentifiers,
  assertValidMasteryStateRecord
} from "../../src/repositories/validation.js";
import type { AutopsyRepository, MasteryStateRepository, RepairPlanRepository, StoredAutopsy, StoredMasteryState, StoredRepairPlan } from "../../src/repositories/types.js";

// InMemoryAttemptRepository moved to packages/db/src/repositories/inMemoryAttemptRepository.ts
// (Phase 4B-2) — a real, exported part of @ipmat/db's production surface, the same
// FixtureProvider-in-@ipmat/ai pattern, so packages/practice-loop's tests can depend on it
// via the package name instead of reaching into this test/ directory across a package
// boundary. Re-exported here so this package's OWN existing tests (attemptRepository.test.ts)
// keep working unchanged.
export { InMemoryAttemptRepository, type InMemoryAttemptRepositoryOptions } from "../../src/repositories/inMemoryAttemptRepository.js";

/**
 * In-memory implementations of the SAME repository interfaces
 * `PrismaXRepository` implements (packages/db/src/repositories) — this is
 * how round-trip persistence semantics are tested without a live database
 * (none has ever been reachable — see docs/MASTER_PLAN.md "Current
 * state"). They call the EXACT SAME validation functions
 * (`packages/db/src/repositories/validation.ts`) the Prisma-backed classes
 * call — not a second, hand-copied version of the same rules — so
 * "invalid state combinations are rejected" is tested against the real,
 * shared logic that would also run in production, and the two
 * implementations cannot silently drift apart. Only the FOREIGN-KEY
 * RESOLUTION mechanism differs by necessity (a `Record<string, string>`
 * lookup here vs. a Prisma query in production) — everything downstream of
 * "what was resolved" is identical.
 */

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class InMemoryAutopsyRepository implements AutopsyRepository {
  private readonly byAttemptId = new Map<string, StoredAutopsy>();

  constructor(private readonly errorTaxonomyIdsByCode: Record<string, string> = {}) {}

  async save(input: { hypothesis: AutopsyHypothesis; output: AutopsyOutput }): Promise<StoredAutopsy> {
    const { hypothesis, output } = input;
    assertAutopsyLinkage(hypothesis, output);

    const proposedCode = output.candidateErrorEvidence?.proposedErrorTaxonomyCode ?? null;
    let resolvedErrorTaxonomyId: string | null = null;
    if (proposedCode) {
      const resolvedId = this.errorTaxonomyIdsByCode[proposedCode] ?? null;
      assertErrorTaxonomyResolved(proposedCode, resolvedId);
      resolvedErrorTaxonomyId = resolvedId;
    }

    const record = toAutopsyPersistenceRecord(hypothesis, output, resolvedErrorTaxonomyId);

    const existing = this.byAttemptId.get(record.attemptId);
    const stored: StoredAutopsy = {
      ...record,
      id: existing?.id ?? nextId("autopsy"),
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };
    this.byAttemptId.set(record.attemptId, stored);
    return stored;
  }

  async findByAttemptId(attemptId: string): Promise<StoredAutopsy | null> {
    return this.byAttemptId.get(attemptId) ?? null;
  }
}

export class InMemoryRepairPlanRepository implements RepairPlanRepository {
  private readonly plansByAutopsyId = new Map<string, StoredRepairPlan>();

  constructor(
    private readonly conceptIdsByName: Record<string, string> = {},
    private readonly errorTaxonomyIdsByCode: Record<string, string> = {}
  ) {}

  async save(input: { plan: RepairPlan; autopsyId: string; studentId: string }): Promise<StoredRepairPlan> {
    const { plan, autopsyId, studentId } = input;

    assertRepairPlanConfirmed(plan);
    assertRepairPlanIdentifiers(autopsyId, studentId);

    const targetConceptId = this.conceptIdsByName[plan.targetConceptName] ?? null;
    assertConceptResolved(plan.targetConceptName, targetConceptId);

    let targetErrorTaxonomyId: string | null = null;
    if (plan.targetErrorTaxonomyCode) {
      const resolvedId = this.errorTaxonomyIdsByCode[plan.targetErrorTaxonomyCode] ?? null;
      assertErrorTaxonomyResolved(plan.targetErrorTaxonomyCode, resolvedId);
      targetErrorTaxonomyId = resolvedId;
    }

    const record = toRepairPlanPersistenceRecord(plan, { studentId, autopsyId, targetConceptId, targetErrorTaxonomyId });
    const stored: StoredRepairPlan = { ...record, id: nextId("repair-plan"), createdAt: new Date().toISOString() };
    this.plansByAutopsyId.set(autopsyId, stored);
    return stored;
  }

  async findByAutopsyId(autopsyId: string): Promise<StoredRepairPlan | null> {
    return this.plansByAutopsyId.get(autopsyId) ?? null;
  }
}

export class InMemoryMasteryStateRepository implements MasteryStateRepository {
  private readonly byStudentAndConcept = new Map<string, StoredMasteryState>();

  private key(studentId: string, conceptId: string): string {
    return `${studentId}::${conceptId}`;
  }

  async save(result: MasteryStateResult): Promise<StoredMasteryState | null> {
    const record = toMasteryStatePersistenceRecord(result);
    if (record === null) {
      return null;
    }

    assertValidMasteryStateRecord(record);

    const key = this.key(record.studentId, record.conceptId);
    const existing = this.byStudentAndConcept.get(key);
    const stored: StoredMasteryState = { ...record, id: existing?.id ?? nextId("mastery-state") };
    this.byStudentAndConcept.set(key, stored);
    return stored;
  }

  async findByStudentAndConcept(studentId: string, conceptId: string): Promise<StoredMasteryState | null> {
    return this.byStudentAndConcept.get(this.key(studentId, conceptId)) ?? null;
  }
}
