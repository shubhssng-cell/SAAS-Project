import type { PrismaClient } from "@prisma/client";
import { ExamPackInvalidError, ExamPackService, summarizePackValidationState, validateExamPack } from "@ipmat/exam-pack";
import { describe, expect, it, vi } from "vitest";
import { PrismaExamPackRepository } from "../../src/repositories/prismaExamPackRepository.js";

/**
 * Code-level tests against a fake `PrismaClient` (same pattern as
 * prismaRepairPlanRepository.test.ts) - NOT a claim about real Postgres
 * behavior; that is `prismaExamPackRepository.integration.test.ts`. What is
 * provable here is the exact query shape and the row -> pack mapping.
 */

const exam = (code: string) => ({ chapter: { section: { exam: { code } } } });
const conceptRow = (name: string, examCode = "TEST_EXAM") => ({ name, ...exam(examCode) });

function fakePrisma(options: { relations?: unknown[]; examRow?: unknown | null } = {}) {
  const examFindUnique = vi.fn().mockResolvedValue(
    options.examRow === undefined
      ? {
          code: "TEST_EXAM",
          name: "Test Exam",
          sections: [
            {
              name: "Quant",
              order: 1,
              chapters: [
                { name: "Number Systems", order: 1, concepts: [{ name: "Number Systems", description: "Numbers.", status: "curated" }] },
                { name: "Time, Speed and Distance", order: 2, concepts: [{ name: "Speed", description: null, status: "draft" }] }
              ]
            }
          ]
        }
      : options.examRow
  );
  const relationFindMany = vi.fn().mockResolvedValue(options.relations ?? []);
  const prisma = { exam: { findUnique: examFindUnique }, conceptRelation: { findMany: relationFindMany } } as unknown as PrismaClient;
  return { prisma, examFindUnique, relationFindMany };
}

const relRow = (from: unknown, to: unknown, over: Record<string, unknown> = {}) => ({
  type: "prerequisite",
  rationale: "why",
  sharedKnowledge: "what",
  usefulForQuestionGeneration: true,
  requirementLevel: "required",
  certainty: "probable",
  source: "human",
  fromConcept: from,
  toConcept: to,
  ...over
});

describe("PrismaExamPackRepository", () => {
  it("returns null for an unknown exam code", async () => {
    const { prisma } = fakePrisma({ examRow: null });
    expect(await new PrismaExamPackRepository(prisma).findByExamCode("NOPE")).toBeNull();
  });

  it("queries the exam by code with ordered nested sections/chapters, and relations touching EITHER endpoint in the exam", async () => {
    const { prisma, examFindUnique, relationFindMany } = fakePrisma();
    await new PrismaExamPackRepository(prisma).findByExamCode("TEST_EXAM");
    expect(examFindUnique.mock.calls[0]![0].where).toEqual({ code: "TEST_EXAM" });
    expect(examFindUnique.mock.calls[0]![0].select.sections.orderBy).toEqual({ order: "asc" });
    expect(examFindUnique.mock.calls[0]![0].select.sections.select.chapters.orderBy).toEqual({ order: "asc" });
    const where = relationFindMany.mock.calls[0]![0].where;
    expect(where.OR).toHaveLength(2);
    expect(JSON.stringify(where)).toContain('"code":"TEST_EXAM"');
  });

  it("selects only what it maps - never question content, attempts or student data", async () => {
    const { prisma, examFindUnique, relationFindMany } = fakePrisma();
    await new PrismaExamPackRepository(prisma).findByExamCode("TEST_EXAM");
    const text = JSON.stringify([examFindUnique.mock.calls[0]![0].select, relationFindMany.mock.calls[0]![0].select]).replace("usefulForQuestionGeneration", "").toLowerCase();
    for (const forbidden of ["question", "attempt", "student", "mastery", "enrollment"]) expect(text).not.toContain(forbidden);
  });

  it("maps rows to a pack with slug keys, ordered sections/nodes, and honest unvalidated provenance", async () => {
    const { prisma } = fakePrisma({ relations: [relRow(conceptRow("Number Systems"), conceptRow("Speed"))] });
    const pack = (await new PrismaExamPackRepository(prisma).findByExamCode("TEST_EXAM"))!;
    expect(pack.sections.map((s) => s.key)).toEqual(["quant"]);
    expect(pack.syllabus.map((n) => [n.key, n.order])).toEqual([["quant/number-systems", 1], ["quant/time-speed-and-distance", 2]]);
    expect(pack.concepts.map((c) => [c.key, c.syllabusNodeKey, c.description])).toEqual([
      ["number-systems", "quant/number-systems", "Numbers."],
      ["speed", "quant/time-speed-and-distance", ""]
    ]);
    expect(pack.relations[0]).toMatchObject({ from: "number-systems", to: "speed", type: "prerequisite" });
    const summary = summarizePackValidationState(pack);
    expect(summary.byReviewState.reviewed).toBe(0);
    expect(summary.byKind.canonical).toBe(0);
  });

  it("a persisted ai_suggested relation is reported as inferred, a human one as authored", async () => {
    const a = conceptRow("Number Systems");
    const b = conceptRow("Speed");
    const { prisma } = fakePrisma({ relations: [relRow(a, b, { source: "ai_suggested" }), relRow(a, b, { type: "directly_related" })] });
    const pack = (await new PrismaExamPackRepository(prisma).findByExamCode("TEST_EXAM"))!;
    expect(pack.relations.map((r) => r.provenance.kind)).toEqual(["inferred", "authored"]);
  });

  it("marks an endpoint in ANOTHER exam as external, so validation reports a cross-exam relation and the service fails closed", async () => {
    const { prisma } = fakePrisma({ relations: [relRow(conceptRow("Number Systems"), conceptRow("Quantum Thing", "OTHER_EXAM"))] });
    const repo = new PrismaExamPackRepository(prisma);
    const pack = (await repo.findByExamCode("TEST_EXAM"))!;
    expect(pack.relations[0]!.to).toBe("external:OTHER_EXAM:quantum-thing");
    expect(validateExamPack(pack).issues.map((i) => i.code)).toContain("cross_exam_relation");
    await expect(new ExamPackService(repo).getAncestors("TEST_EXAM", "speed")).rejects.toBeInstanceOf(ExamPackInvalidError);
  });
});
