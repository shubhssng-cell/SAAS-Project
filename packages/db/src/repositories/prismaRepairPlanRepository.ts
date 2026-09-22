import type { PrismaClient } from "@prisma/client";
import { toRepairPlanPersistenceRecord, type RepairPlan } from "@ipmat/autopsy";
import type { RepairPlanRepository, StoredRepairPlan } from "./types.js";
import { assertConceptResolved, assertErrorTaxonomyResolved, assertRepairPlanConfirmed, assertRepairPlanIdentifiers } from "./validation.js";

/**
 * Resolves `RepairPlan.targetConceptName` to a real `Concept.id` via a
 * plain `findFirst({ where: { name } })`. Concept names are only unique
 * PER CHAPTER in the real schema (`@@unique([chapterId, name])`) — a
 * name-only lookup is a deliberate, honestly-scoped simplification for
 * this single-chapter (Percentages) vertical slice, not a general
 * cross-chapter concept resolver. Revisit if a second chapter is ever
 * built (docs/MASTER_PLAN.md "What should explicitly NOT be built yet").
 * Note also that `RepairPlan.targetConceptId` has no `@relation` in the
 * Prisma schema (unlike `targetErrorTaxonomyId`, which does) — the
 * database itself cannot catch a bad reference here, which is exactly why
 * `assertConceptResolved()` (an application-layer check) matters.
 *
 * `save()` performs exactly one write (`repairPlan.create`) — the two
 * `findFirst`/`findUnique` calls beforehand are reads, so there is no
 * multi-step write sequence that could leave a partially written row; no
 * transaction is needed here.
 */
export class PrismaRepairPlanRepository implements RepairPlanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(input: { plan: RepairPlan; autopsyId: string; studentId: string }): Promise<StoredRepairPlan> {
    const { plan, autopsyId, studentId } = input;

    assertRepairPlanConfirmed(plan);
    assertRepairPlanIdentifiers(autopsyId, studentId);

    const targetConcept = await this.prisma.concept.findFirst({ where: { name: plan.targetConceptName } });
    const targetConceptId = targetConcept?.id ?? null;
    assertConceptResolved(plan.targetConceptName, targetConceptId);

    let targetErrorTaxonomyId: string | null = null;
    if (plan.targetErrorTaxonomyCode) {
      const targetErrorTaxonomy = await this.prisma.errorTaxonomy.findUnique({ where: { code: plan.targetErrorTaxonomyCode } });
      const resolvedId = targetErrorTaxonomy?.id ?? null;
      assertErrorTaxonomyResolved(plan.targetErrorTaxonomyCode, resolvedId);
      targetErrorTaxonomyId = resolvedId;
    }

    const record = toRepairPlanPersistenceRecord(plan, { studentId, autopsyId, targetConceptId, targetErrorTaxonomyId });

    const row = await this.prisma.repairPlan.create({
      data: {
        autopsyId: record.autopsyId,
        studentId: record.studentId,
        targetConceptId: record.targetConceptId,
        targetErrorTaxonomyId: record.targetErrorTaxonomyId,
        followUpQuestionIds: record.followUpQuestionIds,
        status: record.status
      }
    });

    return toStoredRepairPlan(row);
  }

  async findByAutopsyId(autopsyId: string): Promise<StoredRepairPlan | null> {
    const row = await this.prisma.repairPlan.findFirst({ where: { autopsyId }, orderBy: { createdAt: "desc" } });
    return row ? toStoredRepairPlan(row) : null;
  }
}

function toStoredRepairPlan(row: {
  id: string;
  autopsyId: string;
  studentId: string;
  targetConceptId: string;
  targetErrorTaxonomyId: string | null;
  followUpQuestionIds: string[];
  status: string;
  createdAt: Date;
}): StoredRepairPlan {
  return {
    id: row.id,
    autopsyId: row.autopsyId,
    studentId: row.studentId,
    targetConceptId: row.targetConceptId,
    targetErrorTaxonomyId: row.targetErrorTaxonomyId,
    followUpQuestionIds: row.followUpQuestionIds,
    status: row.status as "pending",
    createdAt: row.createdAt.toISOString()
  };
}
