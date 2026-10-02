import { randomUUID } from "node:crypto";
import {
  ExaminerIntelligenceService,
  HistoricalRecordInvalidError,
  proposeAnnotation,
  recordReview,
  type HistoricalDnaClassification,
  type HistoricalQuestionRecord
} from "@ipmat/examiner-intelligence";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PersistenceError } from "../../src/repositories/errors.js";
import { PrismaExamPackRepository } from "../../src/repositories/prismaExamPackRepository.js";
import { PrismaHistoricalRecordRepository } from "../../src/repositories/prismaHistoricalRecordRepository.js";

/**
 * REAL DATABASE tests for Historical Examiner Intelligence persistence
 * (docs/DECISIONS.md D-083, migration 0013). SKIPPED unless
 * `IPMAT_TEST_DATABASE_URL` is set; refuses any database whose name does not
 * contain "test". Prerequisites: migrations applied and `prisma/seed.ts` run.
 *
 * EVERYTHING written here is a labelled FIXTURE (data_origin = 'fixture',
 * source_ref 'fixture:...'), created with a unique per-run prefix and deleted
 * afterwards. None of it is, or is presented as, real historical evidence.
 */

const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

const RUN = `p2-${randomUUID().slice(0, 8)}`;
const { dna: demo } = percentagesReversePercentageExample;
const classification = (over: Partial<HistoricalDnaClassification> = {}): HistoricalDnaClassification => {
  const rest: Record<string, unknown> = { ...demo };
  for (const k of ["provenanceSourceType", "validationState", "examRelevance"]) delete rest[k];
  return { ...rest, ...over } as HistoricalDnaClassification;
};
const fixture = (suffix: string, over: Partial<HistoricalQuestionRecord> = {}): HistoricalQuestionRecord => ({
  id: `${RUN}-${suffix}`,
  examCode: "IPMAT_INDORE",
  locator: { examVersion: null, year: null, session: null, questionLabel: null },
  source: { sourceType: "original", sourceRef: `fixture:${RUN}-${suffix}`, licenseRef: null, attributedTo: null },
  dataOrigin: "fixture",
  fixtureLabel: "FIXTURE - synthetic test data, not real historical exam evidence",
  annotationState: "reviewed_validated",
  classification: classification(),
  authorship: "human",
  proposedBy: null,
  review: { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T00:00:00.000Z" },
  editorialRelevance: null,
  ...over
});
const rawFixture = (suffix: string) => fixture(suffix, { annotationState: "raw_imported", classification: null, authorship: null, review: null });

describe.skipIf(!DATABASE_URL)("PrismaHistoricalRecordRepository - real Postgres", () => {
  let prisma: PrismaClient;
  let repo: PrismaHistoricalRecordRepository;
  let service: ExaminerIntelligenceService;
  const otherCode = `ISOLATION_${RUN.toUpperCase().replace(/-/g, "_")}`;

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    repo = new PrismaHistoricalRecordRepository(prisma);
    service = new ExaminerIntelligenceService({
      records: repo,
      packs: new PrismaExamPackRepository(prisma),
      patternFamiliesFor: (code) => (code === "IPMAT_INDORE" ? percentagesPatternFamilies : []),
      errorTaxonomyCodes: (await prisma.errorTaxonomy.findMany({ select: { code: true } })).map((t) => t.code)
    });
  });

  afterAll(async () => {
    await prisma.historicalQuestionRecord.deleteMany({ where: { id: { startsWith: RUN } } });
    await prisma.exam.deleteMany({ where: { code: otherCode } });
    await prisma.$disconnect();
  });

  it("round-trips a reviewed fixture record exactly (names resolved to ids and back)", async () => {
    const r = fixture("roundtrip", { editorialRelevance: { label: "core", rationale: "Editorial note.", annotatedBy: "editor" }, locator: { examVersion: "fixture-v1", year: 2019, session: "S1", questionLabel: "Q1" } });
    await repo.save(r);
    expect(await repo.findById("IPMAT_INDORE", r.id)).toEqual(r);
  });

  it("round-trips a raw import and an AI-proposed candidate", async () => {
    const raw = rawFixture("raw");
    await repo.save(raw);
    expect(await repo.findById("IPMAT_INDORE", raw.id)).toEqual(raw);
    const candidate = proposeAnnotation(raw, { classification: classification(), authorship: "ai_assisted", proposedBy: "classifier-v1" });
    await repo.save(candidate);
    expect(await repo.findById("IPMAT_INDORE", raw.id)).toEqual(candidate);
    await repo.save(recordReview(candidate, { reviewedBy: "editor", reviewedAt: "2026-10-02T10:00:00.000Z" }));
    const stored = (await repo.findById("IPMAT_INDORE", raw.id))!;
    expect(stored.annotationState).toBe("reviewed_validated");
    expect(stored.authorship).toBe("ai_assisted");
    expect(stored.review?.reviewedBy).toBe("editor");
  });

  it("the service queries real rows: defaults exclude fixtures, opt-in includes them, unvalidated states stay out", async () => {
    await repo.save(fixture("svc-reviewed"));
    await repo.save(fixture("svc-candidate", { annotationState: "candidate_annotation", review: null, authorship: "ai_assisted", proposedBy: "classifier-v1", classification: classification({ patternFamilyName: "Successive Percentage Change", combinesWithConcepts: ["Profit and Loss"], testingModes: ["combined"], trapErrorTaxonomyCode: "successive_change_error" }) }));
    const mine = (r: { id: string }) => r.id.startsWith(RUN);
    expect((await service.listRecords({ examCode: "IPMAT_INDORE" })).filter(mine)).toEqual([]);
    const reviewed = (await service.listRecords({ examCode: "IPMAT_INDORE", origins: ["fixture"] })).filter(mine).map((r) => r.id);
    expect(reviewed).toContain(`${RUN}-svc-reviewed`);
    expect(reviewed).not.toContain(`${RUN}-svc-candidate`);
    const withCandidates = (await service.listRecords({ examCode: "IPMAT_INDORE", origins: ["fixture"], states: ["candidate_annotation"] })).filter(mine).map((r) => r.id);
    expect(withCandidates).toContain(`${RUN}-svc-candidate`);
    const patterns = await service.patternsForConcept({ examCode: "IPMAT_INDORE", origins: ["fixture"] }, "Percentages");
    expect(patterns.find((p) => p.value === "Reverse Percentage")!.count).toBeGreaterThanOrEqual(1);
  });

  it("the service refuses an invalid record before it reaches the database", async () => {
    await expect(service.saveRecord(fixture("svc-bad", { classification: classification({ conceptName: "Nope" }) }))).rejects.toBeInstanceOf(HistoricalRecordInvalidError);
    expect(await repo.findById("IPMAT_INDORE", `${RUN}-svc-bad`)).toBeNull();
  });

  it("unresolvable references are a typed missing_reference and write nothing", async () => {
    for (const bad of [
      classification({ trapErrorTaxonomyCode: "no_such_trap" }),
      classification({ patternFamilyName: "No Such Pattern" }),
      classification({ chapterName: "No Such Chapter" }),
      classification({ combinesWithConcepts: ["No Such Concept"] })
    ]) {
      const r = fixture("badref", { classification: bad });
      await expect(repo.save(r)).rejects.toMatchObject({ name: "PersistenceError", code: "missing_reference" });
      expect(await repo.findById("IPMAT_INDORE", r.id)).toBeNull();
    }
    await expect(repo.save(fixture("noexam", { examCode: "NO_SUCH_EXAM" }))).rejects.toMatchObject({ code: "missing_reference" });
  });

  describe("database CHECK constraints (migration 0013) reject bad rows even when the application layer is bypassed", () => {
    const examIdPromise = () => prisma.exam.findUniqueOrThrow({ where: { code: "IPMAT_INDORE" }, select: { id: true } });
    const insert = async (id: string, fields: Record<string, unknown>) => {
      const { id: examId } = await examIdPromise();
      return prisma.historicalQuestionRecord.create({
        data: {
          id: `${RUN}-chk-${id}`,
          examId,
          sourceType: "original",
          sourceRef: "fixture:chk",
          dataOrigin: "fixture",
          fixtureLabel: "FIXTURE - check",
          annotationState: "raw_imported",
          ...fields
        } as never
      });
    };

    it("accepts the minimal valid raw fixture (control)", async () => {
      await expect(insert("ok", {})).resolves.toBeDefined();
    });
    it("a fixture needs a label, 'original' source type and a 'fixture:' reference", async () => {
      await expect(insert("f1", { fixtureLabel: null })).rejects.toThrow(/hqr_/);
      await expect(insert("f2", { sourceType: "official", licenseRef: "x" })).rejects.toThrow(/hqr_/);
      await expect(insert("f3", { sourceRef: "https://example.org/paper" })).rejects.toThrow(/hqr_/);
    });
    it("a real source is never 'original', never labelled, and needs a rights basis unless public domain", async () => {
      await expect(insert("r1", { dataOrigin: "real_source", fixtureLabel: null, sourceType: "original" })).rejects.toThrow(/hqr_/);
      await expect(insert("r2", { dataOrigin: "real_source", fixtureLabel: "x", sourceType: "licensed", licenseRef: "l" })).rejects.toThrow(/hqr_/);
      await expect(insert("r3", { dataOrigin: "real_source", fixtureLabel: null, sourceType: "licensed", licenseRef: null, sourceRef: "doc" })).rejects.toThrow(/hqr_/);
      await expect(insert("r4", { dataOrigin: "real_source", fixtureLabel: null, sourceType: "public_domain", sourceRef: "doc" })).resolves.toBeDefined();
    });
    it("a blank source reference is rejected", async () => {
      await expect(insert("s1", { dataOrigin: "real_source", fixtureLabel: null, sourceType: "public_domain", sourceRef: "  " })).rejects.toThrow(/hqr_/);
    });
    it("a raw import cannot carry classification, authorship, review or editorial data", async () => {
      await expect(insert("raw1", { skill: "x" })).rejects.toThrow(/hqr_/);
      await expect(insert("raw2", { authorship: "human" })).rejects.toThrow(/hqr_/);
      await expect(insert("raw3", { reviewedBy: "x", reviewedAt: new Date() })).rejects.toThrow(/hqr_/);
      await expect(insert("raw4", { testingModes: ["direct"] })).rejects.toThrow(/hqr_/);
    });
    it("a candidate/reviewed row must have a complete classification", async () => {
      await expect(insert("c1", { annotationState: "candidate_annotation", authorship: "human" })).rejects.toThrow(/hqr_/);
    });
    it("an AI proposal cannot be reviewed_validated without a reviewer, and a candidate cannot carry a review", async () => {
      const full = await (async () => {
        const c = await prisma.concept.findFirstOrThrow({ where: { name: "Percentages" }, select: { id: true, chapterId: true, patternFamilies: { take: 1, select: { id: true } }, chapter: { select: { sectionId: true } } } });
        return { conceptId: c.id, chapterId: c.chapterId, sectionId: c.chapter.sectionId, patternFamilyId: c.patternFamilies[0]!.id, skill: "s", difficultyTier: "standard", difficultyDimensions: { conceptualLoad: 0.1 }, noveltyLevel: "standard", expectedTimeSeconds: 60, testingModes: ["direct"], authorship: "ai_assisted", proposedBy: "classifier-v1" };
      })();
      await expect(insert("a1", { ...full, annotationState: "reviewed_validated" })).rejects.toThrow(/hqr_/);
      await expect(insert("a2", { ...full, annotationState: "candidate_annotation", reviewedBy: "x", reviewedAt: new Date() })).rejects.toThrow(/hqr_/);
      await expect(insert("a3", { ...full, annotationState: "candidate_annotation", proposedBy: null })).rejects.toThrow(/hqr_/);
      await expect(insert("a4", { ...full, annotationState: "candidate_annotation" })).resolves.toBeDefined();
      await expect(insert("a5", { ...full, annotationState: "reviewed_validated", reviewedBy: "editor", reviewedAt: new Date() })).resolves.toBeDefined();
    });
    it("editorial relevance is all-or-none and a year must be plausible", async () => {
      await expect(insert("e1", { editorialRelevance: "core" })).rejects.toThrow(/hqr_/);
      await expect(insert("y1", { examYear: 1500 })).rejects.toThrow(/hqr_/);
    });
  });

  it("the table has NO question-content column: no body, options, answer, solution or explanation can be stored", async () => {
    const cols = (await prisma.$queryRaw<Array<{ column_name: string }>>`select column_name from information_schema.columns where table_name = 'historical_question_records'`).map((c) => c.column_name.toLowerCase());
    for (const forbidden of ["body", "options", "correct_answer", "solution_steps", "ground_truth_derivation", "explanation", "stem"]) expect(cols).not.toContain(forbidden);
    expect(cols).toContain("source_ref");
  });

  it("cross-exam isolation on real rows: another exam never sees IPMAT records, cannot take over an id, and cannot reference IPMAT structure", async () => {
    const other = await prisma.exam.create({
      data: {
        name: "Isolation Test Exam",
        code: otherCode,
        examDateRule: { type: "fixed_date", date: "2030-01-01" },
        sections: { create: { name: "Quant", order: 1, chapters: { create: { name: "Percentages", order: 1, concepts: { create: { name: "Percentages", description: "test", status: "draft", patternFamilies: { create: { name: "Reverse Percentage", skill: "s", description: "d", expectedDifficultyTier: "standard", potentialCombinationConceptIds: [], potentialTrapErrorTaxonomyIds: [], potentialTestingModes: [] } } } } } } } }
      }
    });
    expect(other.id).toBeDefined();

    const mine = fixture("iso-ipmat");
    await repo.save(mine);

    // 1. invisible from the other exam
    expect(await repo.findById(otherCode, mine.id)).toBeNull();
    expect((await repo.listByExamCode(otherCode)).length).toBe(0);
    expect(await service.sourceSupport(otherCode, mine.id)).toBeNull();
    expect((await service.summarize({ examCode: otherCode, origins: ["fixture", "real_source"], states: ["reviewed_validated", "candidate_annotation", "raw_imported"] })).recordCount).toBe(0);

    // 2. the id cannot be moved to the other exam
    const hijack = fixture("iso-ipmat", { examCode: otherCode, classification: { ...classification(), examCode: otherCode, subconcepts: [], prerequisites: [], combinesWithConcepts: [], trapErrorTaxonomyCode: null } });
    await expect(repo.save(hijack)).rejects.toBeInstanceOf(PersistenceError);
    await expect(repo.save(hijack)).rejects.toMatchObject({ code: "ownership_mismatch" });

    // 3. the other exam cannot reference concepts that exist only in IPMAT
    const crossRef = fixture("iso-cross", { examCode: otherCode, classification: { ...classification(), examCode: otherCode, combinesWithConcepts: ["Profit and Loss"], subconcepts: [], prerequisites: [] } });
    await expect(repo.save(crossRef)).rejects.toMatchObject({ code: "missing_reference" });

    // 4. a record legitimately in the other exam is visible there and NOT in IPMAT, though concept names are identical
    const theirs = fixture("iso-theirs", { examCode: otherCode, classification: { ...classification(), examCode: otherCode, subconcepts: [], prerequisites: [], combinesWithConcepts: [], trapErrorTaxonomyCode: null } });
    await repo.save(theirs);
    expect((await repo.listByExamCode(otherCode)).map((r) => r.id)).toEqual([theirs.id]);
    expect((await repo.listByExamCode("IPMAT_INDORE")).map((r) => r.id)).not.toContain(theirs.id);
  });
});
