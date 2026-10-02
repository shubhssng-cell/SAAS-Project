import { createHash, randomUUID } from "node:crypto";
import {
  AuthoringError,
  ContentAuthoringService,
  computeContentFingerprint,
  evaluateGates,
  proposeAiQuestion,
  type AuthoredQuestion,
  type NewQuestionInput,
  type QuestionInstanceDna
} from "@ipmat/content-authoring";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PersistenceError } from "../../src/repositories/errors.js";
import { PrismaExamPackRepository } from "../../src/repositories/prismaExamPackRepository.js";
import { PrismaQuestionAuthoringRepository } from "../../src/repositories/prismaQuestionAuthoringRepository.js";
import { PrismaQuestionContentReader } from "../../src/repositories/prismaQuestionContentReader.js";
import { PrismaTrainingQuestionReader } from "../../src/repositories/prismaTrainingQuestionReader.js";

/**
 * REAL DATABASE tests for content authoring persistence (docs/DECISIONS.md
 * D-084, migration 0014). SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set;
 * refuses any database whose name does not contain "test". Prerequisites:
 * migrations applied and `prisma/seed.ts` run. Every question written here is
 * a labelled FIXTURE (original, `fixture:` source reference) created with a
 * unique per-run prefix and deleted afterwards.
 */

const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

const RUN = `p3-${randomUUID().slice(0, 8)}`;
const SENTINEL = `SENTINEL-${randomUUID().slice(0, 8)}`;
const { dna: demoDna, content: demo } = percentagesReversePercentageExample;
const dna = (over: Partial<QuestionInstanceDna> = {}): QuestionInstanceDna => {
  const d: Record<string, unknown> = { ...demoDna };
  delete d.provenanceSourceType;
  delete d.validationState;
  return { ...d, ...over } as QuestionInstanceDna;
};
const input = (suffix: string, over: Partial<NewQuestionInput> = {}): NewQuestionInput => ({
  id: `${RUN}-${suffix}`,
  dna: dna(),
  content: { body: uniqueBody(suffix), answerFormat: "multiple_choice", options: [...demo.options], correctAnswer: demo.correctAnswer, solutionSteps: [...demo.solutionSteps, `${SENTINEL}-solution`], groundTruthDerivation: { computation: "(3 * 8000) / 1.20", expectedAnswer: 20000 } },
  source: { sourceType: "original", sourceRef: `fixture:${RUN}-${suffix}`, licenseRef: null, attributedTo: `${SENTINEL}-attribution` },
  origin: "human_authored",
  ...over
});
/** Fixture bodies share no vocabulary with each other or with the seeded question, so the near-duplicate gate (token overlap) does not fire between unrelated fixtures. */
const uniqueBody = (suffix: string): string => {
  const words = Array.from({ length: 14 }, (_, i) => `w${createHash("sha256").update(`${RUN}-${suffix}-${i}`).digest("hex").slice(0, 8)}`);
  return `${words.join(" ")} what quantity remains after the first stated change?`;
};
const REVIEW = { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T10:00:00.000Z", notes: `${SENTINEL}-review-notes`, answerVerifiedByReviewer: false, reviewedAsDistinct: false };

describe.skipIf(!DATABASE_URL)("PrismaQuestionAuthoringRepository - real Postgres", () => {
  let prisma: PrismaClient;
  let real: PrismaQuestionAuthoringRepository;
  /** The real repository, with `createDraft` also accepting a plain `NewQuestionInput` (wrapped as a draft) to keep the tests terse. */
  const repo = {
    createDraft: (q: NewQuestionInput | AuthoredQuestion) => real.createDraft(asDraft(q)),
    findById: (id: string) => real.findById(id),
    mutate: (id: string, fn: Parameters<PrismaQuestionAuthoringRepository["mutate"]>[1]) => real.mutate(id, fn),
    listIdentityRefs: (code: string) => real.listIdentityRefs(code),
    listUniverseRefs: (code: string) => real.listUniverseRefs(code)
  };
  let service: ContentAuthoringService;
  const otherCode = `ISOLATION_${RUN.toUpperCase().replace(/-/g, "_")}`;

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    real = new PrismaQuestionAuthoringRepository(prisma);
    service = new ContentAuthoringService({
      questions: real,
      packs: new PrismaExamPackRepository(prisma),
      patternFamiliesFor: (code) => (code === "IPMAT_INDORE" ? percentagesPatternFamilies : []),
      errorTaxonomyCodes: (await prisma.errorTaxonomy.findMany({ select: { code: true } })).map((t) => t.code)
    });
  });

  afterAll(async () => {
    const rows = await prisma.question.findMany({ where: { id: { startsWith: RUN } }, select: { provenanceId: true } });
    await prisma.question.deleteMany({ where: { id: { startsWith: RUN } } });
    await prisma.provenance.deleteMany({ where: { id: { in: rows.flatMap((r) => (r.provenanceId ? [r.provenanceId] : [])) } } });
    await prisma.exam.deleteMany({ where: { code: otherCode } });
    await prisma.$disconnect();
  });

  it("round-trips a draft exactly (names -> ids -> names), with origin and no review", async () => {
    const i = input("roundtrip");
    expect(await repo.createDraft(i)).toEqual({ id: i.id, alreadyExisted: false });
    const stored = (await repo.findById(i.id))!;
    expect(stored.validationState).toBe("draft");
    expect(stored.origin).toBe("human_authored");
    expect(stored.review).toBeNull();
    expect(stored.dna).toEqual(i.dna);
    expect(stored.content).toEqual(i.content);
    expect(stored.source).toEqual(i.source);
  });

  it("the whole lifecycle persists: validate -> review -> publish, and a blocked publish changes nothing", async () => {
    const hard = input("lifecycle", { dna: dna({ difficultyTier: "hard", testingModes: ["transformed"], combinesWithConcepts: ["Algebra"] }) });
    const { id } = await service.createDraft(hard);
    expect((await service.validate(id)).advanced).toBe(true);
    expect((await repo.findById(id))!.validationState).toBe("ai_validated");
    await expect(service.publish(id)).rejects.toBeInstanceOf(AuthoringError); // hard tier needs a human review
    expect((await repo.findById(id))!.validationState).toBe("ai_validated");
    await service.review(id, REVIEW, "approve");
    const reviewed = (await repo.findById(id))!;
    expect(reviewed.validationState).toBe("human_reviewed");
    expect(reviewed.review).toEqual(REVIEW);
    expect((await service.publish(id)).validationState).toBe("published");
    expect((await repo.findById(id))!.validationState).toBe("published");
  });

  it("an AI proposal persists as an ai_generated DRAFT and never publishes without an independent check", async () => {
    const ai = proposeAiQuestion({ ...input("ai"), source: { sourceType: "original", sourceRef: `ai-generation:${RUN}`, licenseRef: null, attributedTo: null } });
    const { id } = await repo.createDraft(ai);
    expect((await repo.findById(id))!.origin).toBe("ai_generated");
    const outcome = await service.validate(id);
    expect(outcome.report.requiresHuman).toContain("answer");
    await expect(service.publish(id)).rejects.toBeInstanceOf(AuthoringError);
    expect((await repo.findById(id))!.validationState).not.toBe("published");
    await service.edit(id, { independentReverification: { derivedAnswer: "20000" } });
    expect((await repo.findById(id))!.independentReverification).toEqual({ derivedAnswer: "20000" });
    expect((await service.validate(id)).advanced).toBe(true);
    expect((await service.publish(id)).validationState).toBe("published");
  });

  describe("identity", () => {
    it("an exact logical duplicate returns the EXISTING question; a similar one is a new question", async () => {
      const first = input("dup-a");
      await repo.createDraft(first);
      const twin = input("dup-b", { content: { ...first.content, body: first.content.body.toUpperCase().replace(/ /g, "  ") } });
      expect(await repo.createDraft(twin)).toEqual({ id: first.id, alreadyExisted: true });
      expect(await repo.findById(twin.id)).toBeNull();
      const similar = input("dup-c", { content: { ...first.content, body: first.content.body + " in an additional sentence" } });
      expect(await repo.createDraft(similar)).toEqual({ id: similar.id, alreadyExisted: false });
    });
    it("the DATABASE refuses a second non-rejected row with the same fingerprint, even if the application layer is bypassed", async () => {
      const a = input("fp-a");
      await repo.createDraft(a);
      const row = (await prisma.question.findUnique({ where: { id: a.id } }))!;
      const rest: Record<string, unknown> = { ...row };
      delete rest.id;
      delete rest.createdAt;
      await expect(prisma.question.create({ data: { ...rest, id: `${RUN}-fp-bypass`, patternTaxonomyCellId: row.patternTaxonomyCellId, body: a.content.body + " (variant to dodge the app-level lookup)", contentFingerprint: row.contentFingerprint } as never })).rejects.toThrow(/Unique|questions_exam_content_fingerprint_unique/);
    });
    it("a rejected question does not block re-authoring the same wording", async () => {
      const a = input("rej-a");
      await repo.createDraft(a);
      await service.reject(a.id);
      expect((await repo.createDraft(input("rej-b", { content: a.content }))).alreadyExisted).toBe(false);
    });
    it("ids are unique and never reused for different content", async () => {
      const a = input("idu");
      await repo.createDraft(a);
      await expect(repo.createDraft(input("idu", { content: { ...a.content, body: `${a.content.body} but different` } }))).rejects.toMatchObject({ code: "conflict" });
    });
    it("editing into another question's exact content is a typed conflict (the unique index), and the original is unchanged", async () => {
      const x = input("edit-x");
      const y = input("edit-y");
      await repo.createDraft(x);
      await repo.createDraft(y);
      await expect(service.edit(y.id, { content: x.content })).rejects.toMatchObject({ name: "PersistenceError", code: "conflict" });
      expect((await repo.findById(y.id))!.content.body).toBe(y.content.body);
    });
    it("editing keeps the id and does not create a second row", async () => {
      const e = input("edit-keep");
      await repo.createDraft(e);
      const before = await prisma.question.count({ where: { id: { startsWith: RUN } } });
      await service.edit(e.id, { content: { ...e.content, solutionSteps: ["Edited step."] } });
      expect(await prisma.question.count({ where: { id: { startsWith: RUN } } })).toBe(before);
      expect((await repo.findById(e.id))!.content.solutionSteps).toEqual(["Edited step."]);
    });
    it("a published question's content is immutable at the repository", async () => {
      const p = input("immutable");
      await repo.createDraft(p);
      await service.validate(p.id);
      await service.publish(p.id);
      await expect(repo.mutate(p.id, (q) => ({ ...q, content: { ...q.content, body: `${q.content.body} changed` } }))).rejects.toBeInstanceOf(PersistenceError);
    });
  });

  describe("student boundary: unpublished and reviewer data never reach student readers", () => {
    it("draft / ai_validated / human_reviewed questions are invisible to the student content reader; published shows only student-safe fields", async () => {
      const reader = new PrismaQuestionContentReader(prisma);
      const q = input("leak", { dna: dna({ difficultyTier: "hard", testingModes: ["transformed"], combinesWithConcepts: ["Algebra"] }) });
      const { id } = await service.createDraft(q);
      expect(await reader.findPublishedById(id)).toBeNull();
      await service.validate(id);
      expect(await reader.findPublishedById(id)).toBeNull();
      await service.review(id, REVIEW, "approve");
      expect(await reader.findPublishedById(id)).toBeNull();
      await service.publish(id);
      const visible = (await reader.findPublishedById(id))!;
      const text = JSON.stringify(visible);
      for (const secret of [SENTINEL, "fixture-reviewer", "reviewNotes", "solutionSteps", "correctAnswer", "groundTruth", "fixture:", "provenance", "reviewedBy", "contentFingerprint", "authoringOrigin"]) expect(text, secret).not.toContain(secret);
      expect(Object.keys(visible).sort()).toEqual(["answerFormat", "chapterName", "conceptName", "expectedTimeSeconds", "options", "prompt", "id"].sort());
    });

    it("the training question reader returns no answer, solution, reviewer, provenance or fingerprint for published questions, and none for unpublished", async () => {
      const exam = await prisma.exam.findUniqueOrThrow({ where: { code: "IPMAT_INDORE" }, select: { id: true } });
      const unpublished = input("tleak");
      await service.createDraft(unpublished);
      const records = await new PrismaTrainingQuestionReader(prisma).findPublishedByExamId(exam.id);
      const text = JSON.stringify(records);
      expect(records.some((r) => r.question.questionId === unpublished.id)).toBe(false);
      expect(records.some((r) => r.question.questionId === `${RUN}-lifecycle`)).toBe(true); // the control: a published fixture IS listed, so the absence above is meaningful
      for (const secret of [SENTINEL, "fixture-reviewer", "correctAnswer", "solutionSteps", "reviewedBy", "contentFingerprint", "authoringOrigin", "reviewNotes"]) expect(text, secret).not.toContain(secret);
    });
  });

  describe("existing data survives migration 0014", () => {
    it("pre-existing published questions are untouched, readable, and read as origin 'unknown' (never guessed human)", async () => {
      const legacy = await prisma.question.findMany({ where: { validationState: "published", authoringOrigin: null, id: { not: { startsWith: RUN } } }, select: { id: true, contentFingerprint: true, reviewedBy: true } });
      expect(legacy.length).toBeGreaterThanOrEqual(3);
      for (const row of legacy) {
        expect(row.contentFingerprint).toBeNull();
        expect(row.reviewedBy).toBeNull();
        const q = (await repo.findById(row.id))!;
        expect(q.origin).toBe("unknown");
        expect(q.validationState).toBe("published");
        expect(q.review).toBeNull();
      }
    });
    it("a legacy question is gated conservatively: no deterministic derivation or origin means its answer is not assumed verified", async () => {
      const [row] = await prisma.question.findMany({ where: { authoringOrigin: null, id: { not: { startsWith: RUN } } }, select: { id: true }, take: 1 });
      const q = (await repo.findById(row!.id))!;
      const pack = (await new PrismaExamPackRepository(prisma).findByExamCode("IPMAT_INDORE"))!;
      const report = evaluateGates(q, { pack, patternFamilies: percentagesPatternFamilies, errorTaxonomyCodes: ["base_confusion", "sign_error", "misread_question", "careless_arithmetic", "successive_change_error", "percentage_point_confusion"], existing: [] });
      const answer = report.gates.find((g) => g.gate === "answer")!;
      expect(["requires_human", "passed"]).toContain(answer.status);
    });
    it("a new question cannot be created with an unknown origin", async () => {
      await expect(repo.createDraft({ ...proposeLike(input("noorigin")), origin: "unknown" as const })).rejects.toMatchObject({ code: "invalid_record" });
    });
  });

  describe("database constraints (migration 0014) hold even when the application layer is bypassed", () => {
    it("review data is all-or-none", async () => {
      const q = input("chk-pair");
      await repo.createDraft(q);
      await expect(prisma.question.update({ where: { id: q.id }, data: { reviewedBy: "someone" } })).rejects.toThrow(/questions_review_pair/);
      await expect(prisma.question.update({ where: { id: q.id }, data: { reviewedBy: " ", reviewedAt: new Date() } })).rejects.toThrow(/questions_review_pair/);
    });
    it("human_reviewed WITHOUT a review record is NOT a database rule (pre-existing flows hold such rows); the authoring review gate flags it instead", async () => {
      const q = input("chk-human");
      await repo.createDraft(q);
      await prisma.question.update({ where: { id: q.id }, data: { validationState: "human_reviewed" } });
      const stored = (await repo.findById(q.id))!;
      expect(stored.review).toBeNull();
      const pack = (await new PrismaExamPackRepository(prisma).findByExamCode("IPMAT_INDORE"))!;
      const report = evaluateGates(stored, { pack, patternFamilies: percentagesPatternFamilies, errorTaxonomyCodes: ["base_confusion"], existing: [] });
      expect(report.gates.find((g) => g.gate === "review")!.reasons.map((r) => r.code)).toEqual(["review_record_missing"]);
    });
    it("a fingerprint requires a stated origin", async () => {
      const q = input("chk-origin");
      await repo.createDraft(q);
      await expect(prisma.question.update({ where: { id: q.id }, data: { authoringOrigin: null } })).rejects.toThrow(/questions_fingerprint_needs_origin/);
    });
    it("the pre-existing published-requires-provenance CHECK still holds", async () => {
      const q = input("chk-prov");
      await repo.createDraft(q);
      await expect(prisma.question.update({ where: { id: q.id }, data: { validationState: "published", provenanceId: null } })).rejects.toThrow(/questions_published_requires_provenance/);
    });
  });

  describe("Question Universe over real rows", () => {
    it("builds from the persisted questions, counts published separately from total, and includes the seeded published pool", async () => {
      const universe = await service.conceptUniverse("IPMAT_INDORE", "Percentages");
      expect(universe.totals.published).toBeGreaterThanOrEqual(3);
      expect(universe.totals.questions).toBeGreaterThanOrEqual(universe.totals.published);
      const reverse = universe.patterns.find((p) => p.patternFamilyName === "Reverse Percentage")!;
      expect(reverse.published).toBeGreaterThanOrEqual(1);
      expect(universe.patterns.length).toBeGreaterThanOrEqual(4);
      expect(universe.emptyRegions.length).toBeGreaterThan(0);
    });
    it("refs carry DNA only: no content, answer or reviewer data", async () => {
      const refs = await repo.listUniverseRefs("IPMAT_INDORE");
      const text = JSON.stringify(refs);
      for (const secret of [SENTINEL, "correctAnswer", "solutionSteps", "reviewedBy", "body"]) expect(text, secret).not.toContain(secret);
      expect(refs.length).toBeGreaterThanOrEqual(3);
    });
    it("identity refs of one exam never include another's", async () => {
      expect(await repo.listIdentityRefs(otherCode)).toEqual([]);
      const refs = await repo.listIdentityRefs("IPMAT_INDORE");
      expect(refs.every((r) => /^[0-9a-f]{64}$/.test(r.fingerprint))).toBe(true);
      expect(refs.find((r) => r.id === `${RUN}-roundtrip`)!.fingerprint).toBe(computeContentFingerprint("IPMAT_INDORE", input("roundtrip").content.body, input("roundtrip").content.options));
    });
  });

  describe("cross-exam contamination", () => {
    it("a question for another exam cannot reference IPMAT structure, and creates nothing", async () => {
      await prisma.exam.create({
        data: { name: "Isolation Test Exam", code: otherCode, examDateRule: { type: "fixed_date", date: "2030-01-01" }, sections: { create: { name: "Quant", order: 1, chapters: { create: { name: "Percentages", order: 1, concepts: { create: { name: "Percentages", description: "t", status: "draft" } } } } } } }
      });
      const foreign = input("foreign", { dna: dna({ examCode: otherCode, subconcepts: [], prerequisites: [], combinesWithConcepts: ["Profit and Loss"] }) });
      const before = await prisma.question.count({ where: { id: { startsWith: RUN } } });
      await expect(repo.createDraft(foreign)).rejects.toMatchObject({ code: "missing_reference" });
      expect(await prisma.question.count({ where: { id: { startsWith: RUN } } })).toBe(before);
    });
    it("a question never moves between exams", async () => {
      const q = input("move");
      await repo.createDraft(q);
      await expect(repo.mutate(q.id, (cur) => ({ ...cur, dna: { ...cur.dna, examCode: otherCode } }))).rejects.toMatchObject({ code: "ownership_mismatch" });
    });
  });
});

const asDraft = (i: NewQuestionInput | AuthoredQuestion): AuthoredQuestion => ("validationState" in i ? i : proposeLike(i));
const proposeLike = (i: NewQuestionInput) => ({ id: i.id, dna: i.dna, content: i.content, source: i.source, origin: i.origin, validationState: "draft" as const, review: null, independentReverification: i.independentReverification ?? null });
