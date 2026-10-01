import { Prisma, type PrismaClient } from "@prisma/client";
import { toAutopsyPersistenceRecord, toRepairPlanPersistenceRecord, type AutopsyHypothesis, type AutopsyOutput, type RepairPlan } from "@ipmat/autopsy";
import { PersistenceError } from "./errors.js";
import { asJson } from "./json.js";
import { toStoredAutopsy } from "./prismaAutopsyRepository.js";
import { REPAIR_PLAN_JOIN_INCLUDE, toStoredRepairPlan } from "./prismaRepairPlanRepository.js";
import type { AutopsyDecisionRepository, StoredDiagnosis } from "./types.js";
import { assertAutopsyLinkage, assertConceptResolved, assertErrorTaxonomyResolved, assertRepairPlanConfirmed, assertRepairPlanIdentifiers } from "./validation.js";

const DIAGNOSIS_INCLUDE = { repairPlan: { include: REPAIR_PLAN_JOIN_INCLUDE } } as const;

/**
 * Phase 4 Unit 3 -- the ONE write path for "a hypothesis was offered" and "the student answered it" (and, only for a
 * student-CONFIRMED hypothesis, the RepairPlan built from it). It reuses the existing `autopsies` / `repair_plans` tables and the existing
 * domain mappings; nothing here decides what a diagnosis or a plan IS.
 *
 * Once-only, enforced by the database rather than by trust:
 *   - `offer()` inserts the awaiting row; `autopsies.attempt_id` is unique, so a second offer for the same attempt (another request, another
 *     API instance, a retry) can only ever find the first one -- the offered hypothesis is immutable once stored.
 *   - `respond()` is ONE transaction: a conditional update (\`confirmed IS NULL\`) that exactly one caller can win, and only the winner may create
 *     the RepairPlan. \`repair_plans.autopsy_id\` is unique (migration 0011), so even a bug could not create a second plan for one autopsy.
 *     A loser gets \`applied: false\` and the already-persisted state.
 */
export class PrismaAutopsyDecisionRepository implements AutopsyDecisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByAttemptId(attemptId: string): Promise<StoredDiagnosis | null> {
    const row = await this.prisma.autopsy.findUnique({ where: { attemptId }, include: DIAGNOSIS_INCLUDE });
    return row ? toStoredDiagnosis(row) : null;
  }

  async offer(input: { hypothesis: AutopsyHypothesis; output: AutopsyOutput; observation: unknown }): Promise<{ stored: StoredDiagnosis; created: boolean }> {
    const { hypothesis, output } = input;
    assertAutopsyLinkage(hypothesis, output);
    if (hypothesis.confirmationStatus !== "awaiting_confirmation") {
      throw new PersistenceError("invalid_record", "Only an awaiting_confirmation hypothesis can be stored as an offer.");
    }

    const taxonomyId = await this.resolveTaxonomyId(output.candidateErrorEvidence?.proposedErrorTaxonomyCode ?? null);
    const record = toAutopsyPersistenceRecord(hypothesis, output, taxonomyId);
    try {
      const row = await this.prisma.autopsy.create({
        data: {
          attemptId: record.attemptId,
          hypothesisText: record.hypothesisText,
          errorTaxonomyId: record.errorTaxonomyId,
          likelyRootCause: record.likelyRootCause,
          // The Unit 1 observation evidence the hypothesis was generated from is kept with it: that is the provenance.
          evidenceUsed: asJson({ ...record.evidenceUsed, observationEvidence: input.observation }),
          confirmed: null,
          confirmedAt: null,
          studentCorrectionText: null,
          generatedByProvider: record.generatedByProvider,
          promptVersion: record.promptVersion
        },
        include: DIAGNOSIS_INCLUDE
      });
      return { stored: toStoredDiagnosis(row), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.findByAttemptId(record.attemptId);
        if (existing) return { stored: existing, created: false };
      }
      throw error;
    }
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

    const attempt = await this.prisma.attempt.findUnique({ where: { id: decided.attemptId }, select: { studentId: true } });
    if (!attempt) throw new PersistenceError("missing_reference", `Attempt "${decided.attemptId}" does not exist.`);
    if (attempt.studentId !== studentId) throw new PersistenceError("ownership_mismatch", "This attempt does not belong to the responding student.");

    let conceptId: string | null = null;
    let planTaxonomyId: string | null = null;
    if (plan !== null) {
      conceptId = (await this.prisma.concept.findFirst({ where: { name: plan.targetConceptName } }))?.id ?? null;
      assertConceptResolved(plan.targetConceptName, conceptId);
      planTaxonomyId = await this.resolveTaxonomyId(plan.targetErrorTaxonomyCode);
    }
    const confirmed = decided.confirmationStatus === "confirmed";

    const applied = await this.prisma.$transaction(async (tx) => {
      const won = await tx.autopsy.updateMany({
        where: { attemptId: decided.attemptId, confirmed: null },
        data: { confirmed, confirmedAt: new Date(decided.respondedAt as string), studentCorrectionText: decided.studentCorrectionText }
      });
      if (won.count === 0) return false; // already answered: nothing changes, no plan is created
      if (plan !== null) {
        const autopsy = await tx.autopsy.findUniqueOrThrow({ where: { attemptId: decided.attemptId }, select: { id: true } });
        assertRepairPlanIdentifiers(autopsy.id, studentId);
        const planRecord = toRepairPlanPersistenceRecord(plan, { studentId, autopsyId: autopsy.id, targetConceptId: conceptId as string, targetErrorTaxonomyId: planTaxonomyId });
        await tx.repairPlan.create({
          data: {
            autopsyId: planRecord.autopsyId,
            studentId: planRecord.studentId,
            targetConceptId: planRecord.targetConceptId,
            targetErrorTaxonomyId: planRecord.targetErrorTaxonomyId,
            followUpQuestionIds: planRecord.followUpQuestionIds,
            status: planRecord.status,
            targetConceptName: planRecord.targetConceptName,
            targetPatternFamilyName: planRecord.targetPatternFamilyName,
            targetTaxonomyCellId: planRecord.targetTaxonomyCellId,
            targetErrorCategory: planRecord.targetErrorCategory,
            recommendedTrainingMode: planRecord.recommendedTrainingMode,
            priority: planRecord.priority
          }
        });
      }
      return true;
    });

    const stored = await this.findByAttemptId(decided.attemptId);
    if (!stored) throw new PersistenceError("missing_reference", `No autopsy exists for attempt "${decided.attemptId}".`);
    return { stored, applied };
  }

  private async resolveTaxonomyId(code: string | null): Promise<string | null> {
    if (!code) return null;
    const id = (await this.prisma.errorTaxonomy.findUnique({ where: { code } }))?.id ?? null;
    assertErrorTaxonomyResolved(code, id);
    return id;
  }
}

function toStoredDiagnosis(row: Parameters<typeof toStoredAutopsy>[0] & { repairPlan: Parameters<typeof toStoredRepairPlan>[0] | null }): StoredDiagnosis {
  return { autopsy: toStoredAutopsy(row), repairPlan: row.repairPlan ? toStoredRepairPlan(row.repairPlan) : null };
}
