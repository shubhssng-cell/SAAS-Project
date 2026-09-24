import type { PrismaClient } from "@prisma/client";
import type { RepairPlan } from "@ipmat/autopsy";
import { describe, expect, it, vi } from "vitest";
import { PrismaRepairPlanRepository } from "../../src/repositories/prismaRepairPlanRepository.js";

/**
 * docs/DECISIONS.md D-039 addendum. Deliberately narrow, code-level tests
 * against a fake `PrismaClient` (the same pattern already used by
 * `prismaQuestionPublicationRepository.test.ts`/`prismaQuestionImportRepository.test.ts`)
 * — NOT a claim that this proves real PostgreSQL behavior; no live
 * database has ever been reachable in this environment. What CAN be
 * proven deterministically is the EXACT query/include shape
 * `findConfirmedActiveByStudentId()` sends to Prisma, since that shape —
 * not `InMemoryRepairPlanRepository`'s own hand-written filter logic — is
 * what actually enforces confirmation/ownership/status semantics against
 * a real database.
 */

const confirmedPlan: RepairPlan = {
  targetConceptName: "Percentages",
  targetPatternFamilyName: "Reverse Percentage",
  targetTaxonomyCellId: "cell-repair-1",
  targetErrorCategory: "misconception",
  targetErrorTaxonomyCode: "base_confusion",
  recommendedTrainingMode: "guided_hint_first",
  priority: "high",
  rationale: ["Matched the designated trap."],
  prerequisites: [],
  confirmationSource: { attemptId: "attempt-prisma-1", hypothesisConfirmedAt: "2026-09-22T11:00:00.000Z" }
};

function makeFakePrisma() {
  const conceptFindFirst = vi.fn().mockResolvedValue({ id: "concept-row-1" });
  const errorTaxonomyFindUnique = vi.fn().mockResolvedValue({ id: "taxonomy-row-1" });

  const createdRow = {
    id: "repair-plan-row-1",
    autopsyId: "autopsy-row-1",
    studentId: "student-1",
    targetConceptId: "concept-row-1",
    targetErrorTaxonomyId: "taxonomy-row-1",
    followUpQuestionIds: [] as string[],
    status: "pending",
    createdAt: new Date("2026-09-22T11:05:00.000Z"),
    targetConceptName: confirmedPlan.targetConceptName,
    targetPatternFamilyName: confirmedPlan.targetPatternFamilyName,
    targetTaxonomyCellId: confirmedPlan.targetTaxonomyCellId,
    targetErrorCategory: confirmedPlan.targetErrorCategory,
    recommendedTrainingMode: confirmedPlan.recommendedTrainingMode,
    priority: confirmedPlan.priority,
    autopsy: { attemptId: "attempt-prisma-1", confirmedAt: new Date("2026-09-22T11:00:00.000Z") },
    errorTaxonomy: { code: "base_confusion" }
  };

  const create = vi.fn().mockResolvedValue(createdRow);
  const findFirst = vi.fn().mockResolvedValue(createdRow);
  const findMany = vi.fn().mockResolvedValue([createdRow]);

  const fake = {
    concept: { findFirst: conceptFindFirst },
    errorTaxonomy: { findUnique: errorTaxonomyFindUnique },
    repairPlan: { create, findFirst, findMany }
  };

  return { fake, create, findFirst, findMany, createdRow };
}

describe("PrismaRepairPlanRepository — code-level query-shape verification (no live database)", () => {
  it("save() persists all six new snapshot fields and includes the Autopsy/ErrorTaxonomy join", async () => {
    const { fake, create } = makeFakePrisma();
    const repo = new PrismaRepairPlanRepository(fake as unknown as PrismaClient);

    const stored = await repo.save({ plan: confirmedPlan, autopsyId: "autopsy-row-1", studentId: "student-1" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetConceptName: "Percentages",
        targetPatternFamilyName: "Reverse Percentage",
        targetTaxonomyCellId: "cell-repair-1",
        targetErrorCategory: "misconception",
        recommendedTrainingMode: "guided_hint_first",
        priority: "high"
      }),
      include: { autopsy: { select: { attemptId: true, confirmedAt: true } }, errorTaxonomy: { select: { code: true } } }
    });
    expect(stored.attemptId).toBe("attempt-prisma-1");
    expect(stored.confirmedAt).toBe("2026-09-22T11:00:00.000Z");
    expect(stored.targetErrorTaxonomyCode).toBe("base_confusion");
  });

  it("[G] StoredRepairPlan surfaces the six snapshot fields as their real values when present -- the domain RepairPlan passed to save() was fully populated, matching what buildRepairPlan() always produces", async () => {
    const { fake } = makeFakePrisma();
    const repo = new PrismaRepairPlanRepository(fake as unknown as PrismaClient);

    const stored = await repo.save({ plan: confirmedPlan, autopsyId: "autopsy-row-1", studentId: "student-1" });

    expect(stored.targetConceptName).toBe("Percentages");
    expect(stored.priority).toBe("high");
    expect(stored.recommendedTrainingMode).toBe("guided_hint_first");
  });

  it("findByAutopsyId() also includes the Autopsy/ErrorTaxonomy join", async () => {
    const { fake, findFirst } = makeFakePrisma();
    const repo = new PrismaRepairPlanRepository(fake as unknown as PrismaClient);

    await repo.findByAutopsyId("autopsy-row-1");

    expect(findFirst).toHaveBeenCalledWith({
      where: { autopsyId: "autopsy-row-1" },
      orderBy: { createdAt: "desc" },
      include: { autopsy: { select: { attemptId: true, confirmedAt: true } }, errorTaxonomy: { select: { code: true } } }
    });
  });

  it("[C, D] findConfirmedActiveByStudentId() sends the exact where clause: studentId scope, status != completed, autopsy.confirmed = true", async () => {
    const { fake, findMany } = makeFakePrisma();
    const repo = new PrismaRepairPlanRepository(fake as unknown as PrismaClient);

    await repo.findConfirmedActiveByStudentId("student-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { studentId: "student-1", status: { not: "completed" }, autopsy: { confirmed: true } },
      orderBy: { createdAt: "desc" },
      include: { autopsy: { select: { attemptId: true, confirmedAt: true } }, errorTaxonomy: { select: { code: true } } }
    });
  });

  it("[F] findConfirmedActiveByStudentId() resolves targetErrorTaxonomyCode from the joined ErrorTaxonomy row, not a second query", async () => {
    const { fake } = makeFakePrisma();
    const repo = new PrismaRepairPlanRepository(fake as unknown as PrismaClient);

    const [result] = await repo.findConfirmedActiveByStudentId("student-1");

    expect(result?.targetErrorTaxonomyCode).toBe("base_confusion");
  });

  it("[M, N] findConfirmedActiveByStudentId() resolves attemptId/confirmedAt from the joined Autopsy row", async () => {
    const { fake } = makeFakePrisma();
    const repo = new PrismaRepairPlanRepository(fake as unknown as PrismaClient);

    const [result] = await repo.findConfirmedActiveByStudentId("student-1");

    expect(result?.attemptId).toBe("attempt-prisma-1");
    expect(result?.confirmedAt).toBe("2026-09-22T11:00:00.000Z");
  });

  it("a row with no linked ErrorTaxonomy (targetErrorTaxonomyId was null) reconstructs targetErrorTaxonomyCode as null, never fabricated", async () => {
    const { fake, createdRow } = makeFakePrisma();
    createdRow.errorTaxonomy = null as never;
    createdRow.targetErrorTaxonomyId = null as never;
    const repo = new PrismaRepairPlanRepository(fake as unknown as PrismaClient);

    const [result] = await repo.findConfirmedActiveByStudentId("student-1");

    expect(result?.targetErrorTaxonomyCode).toBeNull();
  });
});
