import { toAutopsyPersistenceRecord, toRepairPlanPersistenceRecord, type AutopsyHypothesis, type AutopsyOutput, type RepairPlan } from "@ipmat/autopsy";
import { PersistenceError } from "./errors.js";
import type { AutopsyDecisionRepository, StoredAutopsy, StoredDiagnosis, StoredRepairPlan } from "./types.js";
import { assertAutopsyLinkage, assertRepairPlanConfirmed } from "./validation.js";

interface Row {
  studentId: string;
  autopsy: StoredAutopsy;
  plan: StoredRepairPlan | null;
}

/**
 * The same contract as `PrismaAutopsyDecisionRepository`, in memory (development wiring and tests). One row per attempt (the "unique
 * attempt_id"), one plan per autopsy, a response applies to a still-awaiting row exactly once. `errorTaxonomyId` / `targetConceptId` are
 * deterministic stand-ins (`taxonomy:<code>`, `concept:<name>`) because no database exists to resolve real ids.
 *
 * Also acts as the `findConfirmedActiveByStudentId` reader the recommendation composition needs, so the in-memory wiring reads the plans it
 * writes (a plan counts only when its autopsy is confirmed, mirroring `PrismaRepairPlanRepository`).
 */
export class InMemoryAutopsyDecisionRepository implements AutopsyDecisionRepository {
  private readonly rows = new Map<string, Row>();
  private nextId = 1;

  /** Studentless lookup helper for tests. */
  get size(): number {
    return this.rows.size;
  }

  async findByAttemptId(attemptId: string): Promise<StoredDiagnosis | null> {
    const row = this.rows.get(attemptId);
    return row ? snapshot(row) : null;
  }

  async offer(input: { studentId?: string; hypothesis: AutopsyHypothesis; output: AutopsyOutput; observation: unknown }): Promise<{ stored: StoredDiagnosis; created: boolean }> {
    assertAutopsyLinkage(input.hypothesis, input.output);
    if (input.hypothesis.confirmationStatus !== "awaiting_confirmation") {
      throw new PersistenceError("invalid_record", "Only an awaiting_confirmation hypothesis can be stored as an offer.");
    }
    const existing = this.rows.get(input.hypothesis.attemptId);
    if (existing) return { stored: snapshot(existing), created: false };
    const code = input.output.candidateErrorEvidence?.proposedErrorTaxonomyCode ?? null;
    const record = toAutopsyPersistenceRecord(input.hypothesis, input.output, code ? `taxonomy:${code}` : null);
    const row: Row = {
      studentId: input.output.attemptFacts.studentId,
      autopsy: { ...record, evidenceUsed: { ...record.evidenceUsed, observationEvidence: input.observation }, id: `autopsy-${this.nextId++}`, createdAt: new Date().toISOString() },
      plan: null
    };
    this.rows.set(input.hypothesis.attemptId, row);
    return { stored: snapshot(row), created: true };
  }

  async respond(input: { studentId: string; decided: AutopsyHypothesis; plan: RepairPlan | null }): Promise<{ stored: StoredDiagnosis; applied: boolean }> {
    const { studentId, decided, plan } = input;
    if (decided.confirmationStatus === "awaiting_confirmation" || decided.respondedAt === null) {
      throw new PersistenceError("invalid_record", "Cannot record a response that has not been decided.");
    }
    if (plan !== null) {
      if (decided.confirmationStatus !== "confirmed") throw new PersistenceError("invalid_record", "A RepairPlan can only be stored for a student-confirmed hypothesis.");
      assertRepairPlanConfirmed(plan);
    }
    const row = this.rows.get(decided.attemptId);
    if (!row) throw new PersistenceError("missing_reference", `No autopsy exists for attempt "${decided.attemptId}".`);
    if (row.studentId !== studentId) throw new PersistenceError("ownership_mismatch", "This attempt does not belong to the responding student.");
    if (row.autopsy.confirmed !== null) return { stored: snapshot(row), applied: false };

    row.autopsy = { ...row.autopsy, confirmed: decided.confirmationStatus === "confirmed", confirmedAt: decided.respondedAt, studentCorrectionText: decided.studentCorrectionText };
    if (plan !== null && row.plan === null) {
      const planRecord = toRepairPlanPersistenceRecord(plan, {
        studentId,
        autopsyId: row.autopsy.id,
        targetConceptId: `concept:${plan.targetConceptName}`,
        targetErrorTaxonomyId: plan.targetErrorTaxonomyCode ? `taxonomy:${plan.targetErrorTaxonomyCode}` : null
      });
      row.plan = {
        ...planRecord,
        id: `plan-${this.nextId++}`,
        createdAt: new Date().toISOString(),
        confirmedAt: decided.respondedAt,
        attemptId: decided.attemptId,
        status: "pending",
        targetErrorTaxonomyCode: plan.targetErrorTaxonomyCode
      };
    }
    return { stored: snapshot(row), applied: true };
  }

  /** The `RepairPlanRepository` read the recommendation composition uses: this student's plans whose autopsy is confirmed and not completed, newest first. */
  async findConfirmedActiveByStudentId(studentId: string): Promise<StoredRepairPlan[]> {
    return [...this.rows.values()]
      .filter((row) => row.studentId === studentId && row.autopsy.confirmed === true && row.plan !== null && row.plan.status !== "completed")
      .map((row) => ({ ...(row.plan as StoredRepairPlan) }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }
}

function snapshot(row: Row): StoredDiagnosis {
  return { autopsy: { ...row.autopsy, evidenceUsed: { ...row.autopsy.evidenceUsed } }, repairPlan: row.plan ? { ...row.plan } : null };
}
