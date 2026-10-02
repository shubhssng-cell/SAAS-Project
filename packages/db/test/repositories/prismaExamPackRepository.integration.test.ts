import { randomUUID } from "node:crypto";
import {
  ExamPackInvalidError,
  ExamPackService,
  ipmatIndoreExamPack,
  summarizePackValidationState,
  toPublicExamPackView,
  validateExamPack
} from "@ipmat/exam-pack";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PrismaExamPackRepository } from "../../src/repositories/prismaExamPackRepository.js";

/**
 * REAL DATABASE test for the Exam Pack reader (docs/DECISIONS.md D-082).
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set; refuses any database whose
 * name does not contain "test" (it writes - and cleans up - a throwaway exam).
 * Prerequisites: migrations applied and `prisma/seed.ts` run.
 */

const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
  }
}

describe.skipIf(!DATABASE_URL)("PrismaExamPackRepository - real Postgres", () => {
  let prisma: PrismaClient;
  const otherCode = `ISOLATION_TEST_${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, "")}`;
  let otherConceptId = "";
  let ipmatConceptId = "";
  let relationId = "";

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup of everything this suite created (cascade removes sections/chapters/concepts/relations).
    if (relationId) await prisma.conceptRelation.deleteMany({ where: { id: relationId } });
    await prisma.exam.deleteMany({ where: { code: otherCode } });
    await prisma.$disconnect();
  });

  it("the seeded IPMAT exam assembles into a pack that validates with no errors", async () => {
    const pack = await new PrismaExamPackRepository(prisma).findByExamCode("IPMAT_INDORE");
    expect(pack).not.toBeNull();
    const result = validateExamPack(pack!);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("the database-assembled structure equals the in-code IPMAT pack (seed and pack cannot drift)", async () => {
    const fromDb = (await new PrismaExamPackRepository(prisma).findByExamCode("IPMAT_INDORE"))!;
    expect(fromDb.sections.map((s) => [s.key, s.name, s.order])).toEqual(ipmatIndoreExamPack.sections.map((s) => [s.key, s.name, s.order]));
    expect(fromDb.syllabus.map((n) => [n.key, n.parentKey, n.name, n.order])).toEqual(ipmatIndoreExamPack.syllabus.map((n) => [n.key, n.parentKey, n.name, n.order]));
    const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);
    expect([...fromDb.concepts].sort(byKey).map((c) => [c.key, c.name, c.syllabusNodeKey])).toEqual(
      [...ipmatIndoreExamPack.concepts].sort(byKey).map((c) => [c.key, c.name, c.syllabusNodeKey])
    );
    const edge = (r: { from: string; to: string; type: string; certainty: string; source: string }) => `${r.from}|${r.to}|${r.type}|${r.certainty}|${r.source}`;
    expect(fromDb.relations.map(edge).sort()).toEqual(ipmatIndoreExamPack.relations.map(edge).sort());
    expect(JSON.stringify(toPublicExamPackView(fromDb))).toEqual(JSON.stringify(toPublicExamPackView(ipmatIndoreExamPack)));
  });

  it("persistence never upgrades provenance: everything read back is unvalidated", async () => {
    const fromDb = (await new PrismaExamPackRepository(prisma).findByExamCode("IPMAT_INDORE"))!;
    const summary = summarizePackValidationState(fromDb);
    expect(summary.byReviewState.reviewed).toBe(0);
    expect(summary.byKind.canonical).toBe(0);
  });

  it("an unknown exam code reads as null", async () => {
    expect(await new PrismaExamPackRepository(prisma).findByExamCode("NO_SUCH_EXAM")).toBeNull();
  });

  it("a second exam is isolated; a cross-exam relation row is detected and the service fails closed for BOTH exams", async () => {
    const other = await prisma.exam.create({
      data: {
        name: "Isolation Test Exam",
        code: otherCode,
        examDateRule: { type: "fixed_date", date: "2030-01-01" },
        sections: { create: { name: "Only", order: 1, chapters: { create: { name: "Only Chapter", order: 1, concepts: { create: { name: "Isolated Concept", description: "test", status: "draft" } } } } } }
      },
      select: { sections: { select: { chapters: { select: { concepts: { select: { id: true } } } } } } }
    });
    otherConceptId = other.sections[0]!.chapters[0]!.concepts[0]!.id;

    const repo = new PrismaExamPackRepository(prisma);
    const service = new ExamPackService(repo);

    // 1. Before any leak: the other exam is its own clean pack, and IPMAT does not see its concepts.
    const otherPack = (await repo.findByExamCode(otherCode))!;
    expect(otherPack.concepts.map((c) => c.key)).toEqual(["isolated-concept"]);
    expect(validateExamPack(otherPack).issues.filter((i) => i.severity === "error")).toEqual([]);
    const ipmatBefore = (await repo.findByExamCode("IPMAT_INDORE"))!;
    expect(ipmatBefore.concepts.map((c) => c.key)).not.toContain("isolated-concept");

    // 2. Introduce a cross-exam relation row directly (the schema allows it).
    const percentages = await prisma.concept.findFirstOrThrow({ where: { name: "Percentages", chapter: { section: { exam: { code: "IPMAT_INDORE" } } } }, select: { id: true } });
    ipmatConceptId = percentages.id;
    const row = await prisma.conceptRelation.create({
      data: {
        fromConceptId: ipmatConceptId,
        toConceptId: otherConceptId,
        type: "directly_related",
        rationale: "test-only cross-exam row",
        sharedKnowledge: "none",
        usefulForQuestionGeneration: false,
        requirementLevel: "optional",
        certainty: "speculative",
        source: "human"
      },
      select: { id: true }
    });
    relationId = row.id;

    // 3. Both sides see it as a cross-exam relation, and neither is queried as if it were sound.
    for (const code of ["IPMAT_INDORE", otherCode]) {
      const report = await service.validationReport(code);
      expect(report.valid, code).toBe(false);
      expect(report.issues.map((i) => i.code), code).toContain("cross_exam_relation");
      await expect(service.getConcept(code, "percentages")).rejects.toBeInstanceOf(ExamPackInvalidError);
    }

    // 4. Removing it restores both.
    await prisma.conceptRelation.delete({ where: { id: relationId } });
    relationId = "";
    expect((await service.validationReport("IPMAT_INDORE")).valid).toBe(true);
    expect((await service.validationReport(otherCode)).valid).toBe(true);
  });
});
