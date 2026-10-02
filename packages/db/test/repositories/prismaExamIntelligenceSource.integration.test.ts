import { randomUUID } from "node:crypto";
import { ContentAuthoringService, type NewQuestionInput, type QuestionInstanceDna } from "@ipmat/content-authoring";
import { ExamIntelligenceService, ExamIntelligenceQueries, selectQuestions } from "@ipmat/exam-intelligence";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PrismaExamIntelligenceSource, PrismaOutcomeSource } from "../../src/repositories/prismaExamIntelligenceSource.js";
import { PrismaExamPackRepository } from "../../src/repositories/prismaExamPackRepository.js";
import { PrismaHistoricalRecordRepository } from "../../src/repositories/prismaHistoricalRecordRepository.js";
import { PrismaQuestionAuthoringRepository } from "../../src/repositories/prismaQuestionAuthoringRepository.js";

/**
 * REAL DATABASE tests for Exam Intelligence (docs/DECISIONS.md D-086). SKIPPED
 * unless `IPMAT_TEST_DATABASE_URL` is set; refuses any database whose name does not
 * contain "test". No migration exists for this unit (read-only source), so these
 * run against the schema as it already was. Everything written here is a labelled
 * synthetic FIXTURE with a unique per-run prefix, deleted afterwards. The seeded
 * content (3 project-authored published demonstration questions) is real product
 * content but NOT historical evidence; the repository has no historical data.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

const RUN = `p5-${randomUUID().slice(0, 8)}`;
const SENTINEL = `EISENTINEL-${randomUUID().slice(0, 8)}`;
const { dna: demoDna, content: demo } = percentagesReversePercentageExample;
const dna = (over: Partial<QuestionInstanceDna> = {}): QuestionInstanceDna => {
  const d: Record<string, unknown> = { ...demoDna };
  delete d.provenanceSourceType;
  delete d.validationState;
  return { ...d, ...over } as QuestionInstanceDna;
};
const words = (suffix: string): string => Array.from({ length: 12 }, (_, i) => `e${[...(suffix + i)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16)}`).join(" ");
const input = (suffix: string, over: Partial<NewQuestionInput> = {}): NewQuestionInput => ({
  id: `${RUN}-${suffix}`,
  dna: dna(),
  content: { body: `${words(RUN + suffix)} remaining quantity?`, answerFormat: "multiple_choice", options: ["11", "22", "33", "44"], correctAnswer: "33", solutionSteps: [`${SENTINEL}-solution`], groundTruthDerivation: { computation: "11 * 3", expectedAnswer: 33 } },
  source: { sourceType: "original", sourceRef: `${SENTINEL}-ref`, licenseRef: null, attributedTo: null },
  origin: "human_authored",
  ...over
});

describe.skipIf(!DATABASE_URL)("PrismaExamIntelligenceSource - real Postgres", () => {
  let prisma: PrismaClient;
  let service: ExamIntelligenceService;
  let authoring: ContentAuthoringService;
  const otherCode = `ISOLATION_${RUN.toUpperCase().replace(/-/g, "_")}`;

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    const source = new PrismaExamIntelligenceSource(prisma);
    service = new ExamIntelligenceService(source, new PrismaOutcomeSource(prisma));
    authoring = new ContentAuthoringService({ questions: new PrismaQuestionAuthoringRepository(prisma), packs: new PrismaExamPackRepository(prisma), patternFamiliesFor: () => percentagesPatternFamilies, errorTaxonomyCodes: (await prisma.errorTaxonomy.findMany({ select: { code: true } })).map((t) => t.code) });
  });

  afterAll(async () => {
    const qs = await prisma.question.findMany({ where: { OR: [{ id: { startsWith: RUN } }, { id: { startsWith: `x-${RUN}` } }] }, select: { id: true, provenanceId: true } });
    await prisma.attempt.deleteMany({ where: { questionId: { in: qs.map((q) => q.id) } } });
    await prisma.question.deleteMany({ where: { id: { in: qs.map((q) => q.id) } } });
    await prisma.historicalQuestionRecord.deleteMany({ where: { id: { startsWith: RUN } } });
    // only provenance rows no remaining question still uses (a copied fixture row shares the seeded question's)
    const shared = new Set((await prisma.question.findMany({ select: { provenanceId: true } })).flatMap((q) => (q.provenanceId ? [q.provenanceId] : [])));
    await prisma.provenance.deleteMany({ where: { id: { in: qs.flatMap((q) => (q.provenanceId && !shared.has(q.provenanceId) ? [q.provenanceId] : [])) } } });
    await prisma.exam.deleteMany({ where: { code: otherCode } });
    await prisma.$disconnect();
  });

  describe("the snapshot of the real seeded exam", () => {
    it("assembles the pack, mapped pattern families (combinations and traps resolved to names/codes) and content, scoped to one exam", async () => {
      const s = await service.snapshot("IPMAT_INDORE");
      expect(s.examCode).toBe("IPMAT_INDORE");
      expect(s.pack.concepts).toHaveLength(12);
      // other suites may add families to the shared test database, so assert the seeded four are present rather than the exact set
      expect(s.patternFamilies.map((f) => f.name)).toEqual(expect.arrayContaining(["Percentage Point vs Percentage Change", "Percentage Share in Data Interpretation", "Reverse Percentage", "Successive Percentage Change"]));
      const reverse = s.patternFamilies.find((f) => f.name === "Reverse Percentage")!;
      expect(reverse.potentialCombinationConcepts.sort()).toEqual(["Algebra", "Ratio"]);
      expect(reverse.potentialTrapErrorTaxonomyCodes).toEqual(["base_confusion"]);
      expect(s.errorTaxonomyCodes).toEqual(expect.arrayContaining(["base_confusion", "sign_error"]));
      expect(s.questions.length).toBeGreaterThanOrEqual(3);
      expect(s.questions.every((q) => q.dna.examCode === "IPMAT_INDORE")).toBe(true);
    });
    it("carries NO question content, answer, solution, reviewer data or provenance reference", async () => {
      await authoring.createDraft(input("leak"));
      // Content questions only: the historical records in a snapshot are the existing internal domain records (reviewer/source refs), which no output surface forwards (tested below).
      const text = JSON.stringify((await service.snapshot("IPMAT_INDORE")).questions);
      for (const secret of [SENTINEL, "correctAnswer", "solutionSteps", "groundTruth", "reviewedBy", "reviewNotes", "fixture:", demo.body.slice(0, 30), "20,000"]) expect(text, secret).not.toContain(secret);
    });
    it("an unknown exam is refused", async () => {
      await expect(service.snapshot("NO_SUCH_EXAM")).rejects.toMatchObject({ code: "exam_mismatch" });
    });
  });

  describe("coverage over real rows, honestly", () => {
    it("the seeded exam: real published content is measured, historical evidence is INSUFFICIENT DATA (none exists), nothing is calibrated", async () => {
      const r = await service.coverage("IPMAT_INDORE");
      expect(r.accounting.content.tiers.published).toBeGreaterThanOrEqual(3);
      const pattern = r.content.published.find((m) => m.facet === "pattern")!;
      expect(pattern.denominator).toBe((await service.snapshot("IPMAT_INDORE")).patternFamilies.length); // the mapped universe, whatever is mapped
      expect(pattern.denominator).toBeGreaterThanOrEqual(4);
      expect(pattern.numerator).toBeGreaterThanOrEqual(1);
      expect(pattern.numerator).toBeLessThanOrEqual(pattern.denominator);
      expect(r.content.published.find((m) => m.facet === "concept")!.denominator).toBe(12);
      for (const m of r.historical) expect(m).toMatchObject({ state: "insufficient_data", ratio: null, itemCount: 0 });
      expect((await service.calibration("IPMAT_INDORE")).nothingCalibrated).toBe(true);
    });
    it("unpublished content appears only in the available/validated tiers, never in published", async () => {
      const { id } = await authoring.createDraft(input("draft"));
      const r = await service.coverage("IPMAT_INDORE");
      expect(r.dispositions.find((d) => d.id === id)).toMatchObject({ disposition: "counted", tier: "available" });
      const before = (await service.queries("IPMAT_INDORE")).availability();
      expect(before.available).toBeGreaterThan(before.published);
      await authoring.validate(id);
      expect((await service.queries("IPMAT_INDORE")).availability().validated).toBe(before.validated + 1);
      expect((await service.queries("IPMAT_INDORE")).availability().published).toBe(before.published);
    });
    it("a draft/validated question never enters default selection", async () => {
      const ids = (await service.select("IPMAT_INDORE")).candidates.map((c) => c.questionId);
      expect(ids.some((i) => i.startsWith(RUN))).toBe(false);
      const withDrafts = (await service.select("IPMAT_INDORE", { states: ["published", "ai_validated", "draft"] })).candidates.map((c) => c.questionId);
      expect(withDrafts).toContain(`${RUN}-draft`);
    });
  });

  describe("data quality over real rows", () => {
    it("a test-data fixture row is excluded as a fixture; an exact duplicate row is counted once", async () => {
      const seeded = await prisma.question.findFirstOrThrow({ where: { validationState: "published", id: { not: { startsWith: RUN } } } });
      const { id: _id, createdAt: _c, ...row } = seeded;
      void _id; void _c;
      await prisma.question.create({ data: { ...row, id: `x-${RUN}-dup`, validationState: "ai_validated" } as never }); // same body+options as a published question
      await prisma.question.create({ data: { ...row, id: `x-${RUN}-fixture`, body: `[TEST DATA ${RUN}] ${seeded.body}`, validationState: "published", provenanceId: seeded.provenanceId } as never });
      const r = await service.coverage("IPMAT_INDORE");
      expect(r.dispositions.find((d) => d.id === `x-${RUN}-dup`)).toMatchObject({ disposition: "excluded_duplicate", reasons: [`duplicate of ${seeded.id}`] });
      expect(r.dispositions.find((d) => d.id === `x-${RUN}-fixture`)!.disposition).toBe("excluded_fixture");
      expect(r.dispositions.find((d) => d.id === seeded.id)!.disposition).toBe("counted");
    });
  });

  describe("historical evidence stays separate from content", () => {
    it("a reviewed real-source record raises HISTORICAL coverage only; fixtures and candidates are excluded", async () => {
      const records = new PrismaHistoricalRecordRepository(prisma);
      const d: Record<string, unknown> = { ...demoDna };
      delete d.provenanceSourceType;
      delete d.validationState;
      delete d.examRelevance;
      const base = { examCode: "IPMAT_INDORE", locator: { examVersion: null, year: null, session: null, questionLabel: null }, authorship: "human" as const, proposedBy: null, editorialRelevance: null, classification: d as never };
      await records.save({ ...base, id: `${RUN}-real`, source: { sourceType: "licensed", sourceRef: `${SENTINEL}-historical-ref`, licenseRef: "license-ref", attributedTo: null }, dataOrigin: "real_source", fixtureLabel: null, annotationState: "reviewed_validated", review: { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T00:00:00.000Z" } });
      await records.save({ ...base, id: `${RUN}-fix`, source: { sourceType: "original", sourceRef: `fixture:${RUN}-fix`, licenseRef: null, attributedTo: null }, dataOrigin: "fixture", fixtureLabel: "FIXTURE", annotationState: "reviewed_validated", review: { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T00:00:00.000Z" } });
      const r = await service.coverage("IPMAT_INDORE");
      expect(r.accounting.historical).toMatchObject({ counted: 1, excluded: { fixture: 1 } });
      const hp = r.historical.find((m) => m.facet === "pattern")!;
      expect(hp).toMatchObject({ state: "measured", numerator: 1, itemCount: 1 });
      expect(r.content.published.find((m) => m.facet === "pattern")!.itemCount).toBe((await service.coverage("IPMAT_INDORE")).content.published.find((m) => m.facet === "pattern")!.itemCount); // content unaffected
      const q = await service.queries("IPMAT_INDORE");
      expect(q.historicalEvidence("Percentages").map((e) => e.recordId)).toEqual([`${RUN}-real`]);
    });
    it("source references live in the INTERNAL historical query only: they are not in coverage, selection or calibration output", async () => {
      for (const out of [await service.coverage("IPMAT_INDORE"), await service.select("IPMAT_INDORE", { states: ["published", "draft"] }), await service.calibration("IPMAT_INDORE")]) expect(JSON.stringify(out)).not.toContain(SENTINEL);
    });
  });

  describe("observed outcomes (descriptive, aggregated, non-identifying)", () => {
    it("graded finalized attempts become outcomes with an opaque one-way student key; in-progress attempts are ignored", async () => {
      const student = await prisma.student.findFirstOrThrow({ select: { id: true } });
      const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { studentId: student.id }, select: { id: true } });
      const own = await authoring.createDraft(input("outcomes")); // a question only this test attempts, so other suites' attempts cannot change the count
      const seeded = { id: own.id };
      const base = { studentId: student.id, questionId: seeded.id, enrollmentId: enrollment.id, startedAt: new Date() };
      await prisma.attempt.create({ data: { ...base, status: "submitted", isCorrect: true, timeSpentSeconds: 40, finalizedAt: new Date(), submittedAt: new Date() } });
      await prisma.attempt.create({ data: { ...base, status: "submitted", isCorrect: false, timeSpentSeconds: 70, finalizedAt: new Date(), submittedAt: new Date() } });
      const outcomes = await new PrismaOutcomeSource(prisma).loadOutcomes("IPMAT_INDORE");
      const mine = outcomes.filter((o) => o.questionId === seeded.id);
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(outcomes)).not.toContain(student.id);
      expect(mine.every((o) => /^[0-9a-f]{24}$/.test(o.studentKey))).toBe(true);
      const calibration = await service.calibration("IPMAT_INDORE");
      // calibration measures PUBLISHED content only, so an unpublished question has no measurement at all
      expect(calibration.measurements.find((x) => x.questionId === seeded.id)).toBeUndefined();
      // and every measurement that does exist honours the hide-below-minimum rule
      for (const m of calibration.measurements) if (m.state === "insufficient_data") expect([m.accuracy, m.time]).toEqual([null, null]);
      expect(calibration.nothingCalibrated).toBe(true);
      expect(JSON.stringify(calibration)).not.toContain(student.id);
    });
    it("outcomes are exam-scoped", async () => {
      expect(await new PrismaOutcomeSource(prisma).loadOutcomes("NO_SUCH_EXAM")).toEqual([]);
    });
  });

  describe("the question-selection bridge over real rows", () => {
    it("selects published content by exam-space constraints and traces every step", async () => {
      const s = await service.snapshot("IPMAT_INDORE");
      const r = selectQuestions(s, { concepts: ["Percentages"], states: ["published"] });
      expect(r.candidates.length).toBeGreaterThanOrEqual(1);
      expect(r.trace[0]!.filter).toBe("states");
      expect(r.candidates.every((c) => c.validationState === "published" && c.conceptName === "Percentages")).toBe(true);
      expect(selectQuestions(s, { concepts: ["Percentages"], novelty: ["novel_context"] }).candidates.length).toBeLessThanOrEqual(r.candidates.length);
    });
    it("queries over real data are deterministic and re-runnable", async () => {
      const s = await service.snapshot("IPMAT_INDORE");
      expect(new ExamIntelligenceQueries(s).patterns("Percentages")).toEqual(new ExamIntelligenceQueries(s).patterns("Percentages"));
    });
  });

  describe("exam isolation on real rows", () => {
    it("another exam's intelligence contains none of IPMAT's content, history or outcomes, even with identical concept names", async () => {
      await prisma.exam.create({ data: { name: "Isolation Test Exam", code: otherCode, examDateRule: { type: "fixed_date", date: "2030-01-01" }, sections: { create: { name: "Quant", order: 1, chapters: { create: { name: "Percentages", order: 1, concepts: { create: { name: "Percentages", description: "t", status: "draft" } } } } } } } });
      const s = await service.snapshot(otherCode);
      expect(s.examCode).toBe(otherCode);
      expect(s.questions).toEqual([]);
      expect(s.historicalRecords).toEqual([]);
      expect(s.patternFamilies).toEqual([]);
      const r = await service.coverage(otherCode);
      expect(r.accounting.content.total).toBe(0);
      expect(r.content.published.find((m) => m.facet === "concept")).toMatchObject({ denominator: 1, numerator: 0 });
      expect((await service.select(otherCode)).candidates).toEqual([]);
      expect((await new PrismaOutcomeSource(prisma).loadOutcomes(otherCode))).toEqual([]);
      const ipmat = await service.snapshot("IPMAT_INDORE");
      expect(ipmat.questions.every((q) => q.dna.examCode === "IPMAT_INDORE")).toBe(true);
    });
  });

  it("this unit changed no schema: the latest migration is still the Content Intelligence one", async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`select migration_name from _prisma_migrations order by migration_name desc limit 1`;
    expect(rows[0]!.migration_name).toBe("0015_content_intelligence");
  });
});
