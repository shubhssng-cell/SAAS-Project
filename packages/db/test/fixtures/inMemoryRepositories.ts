import { getEventTimeline, type AttemptState } from "@ipmat/attempt";
import { toAutopsyPersistenceRecord, toRepairPlanPersistenceRecord, type AutopsyHypothesis, type AutopsyOutput, type RepairPlan } from "@ipmat/autopsy";
import { toMasteryStatePersistenceRecord, type MasteryStateResult } from "@ipmat/mastery";
import { PersistenceError } from "../../src/repositories/errors.js";
import {
  assertAttemptNotRegressingFromFinalized,
  assertAttemptOwnershipUnchanged,
  assertAttemptStateInternallyConsistent,
  assertAutopsyLinkage,
  assertConceptResolved,
  assertErrorTaxonomyResolved,
  assertRepairPlanConfirmed,
  assertRepairPlanIdentifiers,
  assertValidMasteryStateRecord
} from "../../src/repositories/validation.js";
import type {
  AttemptRepository,
  AutopsyRepository,
  MasteryStateRepository,
  RepairPlanRepository,
  StoredAutopsy,
  StoredMasteryState,
  StoredRepairPlan
} from "../../src/repositories/types.js";

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

export interface InMemoryAttemptRepositoryOptions {
  /** Omit any of these three to skip that reference check entirely (the common case for tests that don't care about FK validation); supply a Set (even empty) to exercise the SAME `missing_reference` fail-closed path `PrismaAttemptRepository` exercises via real queries. */
  knownStudentIds?: Set<string>;
  knownQuestionIds?: Set<string>;
  knownEnrollmentIds?: Set<string>;
}

export class InMemoryAttemptRepository implements AttemptRepository {
  private readonly byId = new Map<string, AttemptState>();

  constructor(private readonly options: InMemoryAttemptRepositoryOptions = {}) {}

  async save(state: AttemptState): Promise<AttemptState> {
    assertAttemptStateInternallyConsistent(state);

    const existing = this.byId.get(state.id);
    if (existing) {
      assertAttemptOwnershipUnchanged(
        { studentId: existing.studentId, questionId: existing.questionId, enrollmentId: existing.enrollmentId, retryOfAttemptId: existing.retryOfAttemptId },
        state
      );
      assertAttemptNotRegressingFromFinalized(existing.status, state.status);
    } else {
      this.assertReferencesExist(state);
    }

    // Same canonical timeline order the Prisma-backed repository persists in — never the raw, possibly caller-reordered state.events array.
    const stored: AttemptState = { ...state, events: getEventTimeline(state) };
    this.byId.set(state.id, stored);
    return stored;
  }

  async findById(attemptId: string): Promise<AttemptState | null> {
    return this.byId.get(attemptId) ?? null;
  }

  private assertReferencesExist(state: AttemptState): void {
    if (this.options.knownStudentIds && !this.options.knownStudentIds.has(state.studentId)) {
      throw new PersistenceError("missing_reference", `No Student found with id "${state.studentId}".`);
    }
    if (this.options.knownQuestionIds && !this.options.knownQuestionIds.has(state.questionId)) {
      throw new PersistenceError("missing_reference", `No Question found with id "${state.questionId}".`);
    }
    if (this.options.knownEnrollmentIds && !this.options.knownEnrollmentIds.has(state.enrollmentId)) {
      throw new PersistenceError("missing_reference", `No Enrollment found with id "${state.enrollmentId}".`);
    }
    if (state.retryOfAttemptId && !this.byId.has(state.retryOfAttemptId)) {
      throw new PersistenceError("missing_reference", `No Attempt found with id "${state.retryOfAttemptId}" for retryOfAttemptId.`);
    }
  }
}
