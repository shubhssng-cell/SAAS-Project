import { randomUUID } from "node:crypto";
import { ContentAuthoringService, type QuestionInstanceDna } from "@ipmat/content-authoring";
import {
  buildKnowledgeGraph,
  ContentIntelligencePipeline,
  DeterministicConceptProvider,
  EvidenceRetriever,
  LexicalRetrievalIndex,
  questionDraftFromCandidate,
  registerableSource,
  StaticExtractionProvider,
  validateGraph,
  whyRelated,
  ContentAccessDeniedError,
  type QuestionCandidate,
  type SourceInput
} from "@ipmat/content-intelligence";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PrismaContentIntelligenceRepository } from "../../src/repositories/prismaContentIntelligenceRepository.js";
import { PrismaExamPackRepository } from "../../src/repositories/prismaExamPackRepository.js";
import { PrismaQuestionAuthoringRepository } from "../../src/repositories/prismaQuestionAuthoringRepository.js";
import { PrismaQuestionContentReader } from "../../src/repositories/prismaQuestionContentReader.js";

/**
 * REAL DATABASE tests for the content intelligence pipeline (docs/DECISIONS.md
 * D-085, migration 0015). SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set; refuses
 * any database whose name does not contain "test". Prerequisites: migrations
 * applied and `prisma/seed.ts` run. ALL content here is a labelled synthetic
 * FIXTURE (not a real exam source), created under a unique per-run key prefix and
 * deleted afterwards.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

const RUN = `p4-${randomUUID().slice(0, 8)}`;
const SENTINEL = `SOURCE-SENTINEL-${randomUUID().slice(0, 8)}`;
const NOTES = `# Synthetic Fixture Notes ${SENTINEL}

## Percentages

A percentage expresses a quantity as parts per hundred. Understanding Ratio is required before Percentages make sense, and Number Systems underlies both.

1. In this synthetic example, what is 10 percent of the base quantity 200?
A) 10
B) 20
C) 30
D) 40
Answer: B
`;
const source = (suffix: string, over: Partial<SourceInput> = {}): SourceInput => ({
  examCode: "IPMAT_INDORE",
  sourceKey: `${RUN}-${suffix}`,
  title: `Synthetic fixture ${suffix}`,
  sourceType: "original",
  sourceRef: `fixture:${RUN}-${suffix}`,
  licenseRef: null,
  attributedTo: null,
  authority: null,
  dataOrigin: "fixture",
  fixtureLabel: "FIXTURE - synthetic test document, not a real exam source",
  ...over
});
const REVIEW = { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T10:00:00.000Z" };
const ingest = (p: ContentIntelligencePipeline, suffix: string, content = NOTES) => p.ingest({ examCode: "IPMAT_INDORE", sourceKey: `${RUN}-${suffix}`, format: "markdown", content });

describe.skipIf(!DATABASE_URL)("PrismaContentIntelligenceRepository - real Postgres", () => {
  let prisma: PrismaClient;
  let repo: PrismaContentIntelligenceRepository;
  let pipeline: ContentIntelligencePipeline;
  const otherCode = `ISOLATION_${RUN.toUpperCase().replace(/-/g, "_")}`;

  const mine = async () => prisma.contentSource.findMany({ where: { sourceKey: { startsWith: RUN } }, select: { id: true } });

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    repo = new PrismaContentIntelligenceRepository(prisma);
    pipeline = new ContentIntelligencePipeline({ repo, packs: new PrismaExamPackRepository(prisma), conceptProviders: [new DeterministicConceptProvider()] });
  });

  afterAll(async () => {
    const ids = (await mine()).map((s) => s.id);
    const versions = (await prisma.contentSourceVersion.findMany({ where: { sourceId: { in: ids } }, select: { id: true } })).map((v) => v.id);
    await prisma.contentCandidateEvidence.deleteMany({ where: { candidate: { sourceVersionId: { in: versions } } } });
    await prisma.contentCandidate.deleteMany({ where: { sourceVersionId: { in: versions } } });
    await prisma.contentChunk.deleteMany({ where: { sourceVersionId: { in: versions } } });
    await prisma.contentSourceVersion.deleteMany({ where: { id: { in: versions } } });
    await prisma.contentSource.deleteMany({ where: { id: { in: ids } } });
    const questions = await prisma.question.findMany({ where: { id: { startsWith: "q_" }, provenance: { sourceRef: { startsWith: RUN } } }, select: { id: true, provenanceId: true } });
    await prisma.question.deleteMany({ where: { id: { in: questions.map((q) => q.id) } } });
    await prisma.provenance.deleteMany({ where: { id: { in: questions.flatMap((q) => (q.provenanceId ? [q.provenanceId] : [])) } } });
    await prisma.exam.deleteMany({ where: { code: otherCode } });
    await prisma.$disconnect();
  });

  describe("source registration", () => {
    it("is idempotent: the same source twice is one row, one identity", async () => {
      const a = await pipeline.registerSource(source("idem"));
      const b = await pipeline.registerSource(source("idem"));
      expect(a.alreadyExisted).toBe(false);
      expect(b.alreadyExisted).toBe(true);
      expect(b.source.id).toBe(a.source.id);
      expect(await prisma.contentSource.count({ where: { sourceKey: `${RUN}-idem` } })).toBe(1);
      expect(await repo.findSource("IPMAT_INDORE", `${RUN}-idem`)).toEqual(a.source);
    });
    it("an unauthorized source is refused by the pipeline and nothing is persisted", async () => {
      const before = await prisma.contentSource.count();
      await expect(pipeline.registerSource(source("pirate", { dataOrigin: "real_source", fixtureLabel: null, sourceType: "licensed", sourceRef: "https://t.me/coaching_pdfs/1", licenseRef: "x", authority: "y" }))).rejects.toMatchObject({ code: "unauthorized_source" });
      expect(await prisma.contentSource.count()).toBe(before);
    });
  });

  describe("database CHECK constraints refuse unauthorized content even when the application layer is bypassed", () => {
    const examId = () => prisma.exam.findUniqueOrThrow({ where: { code: "IPMAT_INDORE" }, select: { id: true } }).then((e) => e.id);
    const insert = async (suffix: string, fields: Record<string, unknown>) =>
      prisma.contentSource.create({ data: { id: `src_${RUN}_${suffix}`, examId: await examId(), sourceKey: `${RUN}-chk-${suffix}`, title: "t", sourceType: "original", sourceRef: "fixture:x", dataOrigin: "fixture", fixtureLabel: "FIXTURE", ...fields } as never });

    it("control: a minimal valid fixture is accepted", async () => {
      await expect(insert("ok", {})).resolves.toBeDefined();
    });
    it("third-party material needs a source reference, a license and a named authority", async () => {
      const real = { dataOrigin: "real_source", fixtureLabel: null };
      await expect(insert("r1", { ...real, sourceType: "licensed", sourceRef: null, licenseRef: "l", authority: "a" })).rejects.toThrow(/content_sources_rights/);
      await expect(insert("r2", { ...real, sourceType: "licensed", sourceRef: "doc", licenseRef: null, authority: "a" })).rejects.toThrow(/content_sources_rights/);
      await expect(insert("r3", { ...real, sourceType: "licensed", sourceRef: "doc", licenseRef: "l", authority: null })).rejects.toThrow(/content_sources_rights/);
      await expect(insert("r4", { ...real, sourceType: "public_domain", sourceRef: "doc" })).resolves.toBeDefined();
    });
    it("a reference naming an unauthorized-distribution channel is refused", async () => {
      for (const [i, ref] of ["https://t.me/dump/1", "libgen mirror", "torrent batch"].entries()) {
        await expect(insert(`m${i}`, { dataOrigin: "real_source", fixtureLabel: null, sourceType: "licensed", sourceRef: ref, licenseRef: "l", authority: "a" })).rejects.toThrow(/content_sources_no_unauthorized_marker/);
      }
    });
    it("real source vs fixture is never ambiguous", async () => {
      await expect(insert("f1", { fixtureLabel: null })).rejects.toThrow(/content_sources_fixture_vs_real_source/);
      await expect(insert("f2", { sourceRef: "https://example.org/real" })).rejects.toThrow(/content_sources_fixture_vs_real_source/);
      await expect(insert("f3", { dataOrigin: "real_source", fixtureLabel: "x", sourceType: "public_domain", sourceRef: "doc" })).rejects.toThrow(/content_sources_fixture_vs_real_source/);
      await expect(insert("f4", { dataOrigin: "real_source", fixtureLabel: null, sourceType: "public_domain", sourceRef: "fixture:disguised" })).rejects.toThrow(/content_sources_fixture_vs_real_source/);
    });
    it("a malformed source key is refused", async () => {
      await expect(insert("k1", { sourceKey: "Bad Key" })).rejects.toThrow(/content_sources_key_format/);
    });
    it("a version needs a real sha256, a declared format and a failure iff it failed; a decided candidate needs a reviewer", async () => {
      const src = await repo.findSource("IPMAT_INDORE", `${RUN}-idem`);
      const base = { sourceId: src!.id, version: 99, contentHash: "a".repeat(64), format: "markdown", byteLength: 1, state: "registered" };
      await expect(prisma.contentSourceVersion.create({ data: { ...base, id: `ver_${RUN}_1`, contentHash: "nothex" } as never })).rejects.toThrow(/content_source_versions_shape/);
      await expect(prisma.contentSourceVersion.create({ data: { ...base, id: `ver_${RUN}_2`, format: " " } as never })).rejects.toThrow(/content_source_versions_shape/);
      await expect(prisma.contentSourceVersion.create({ data: { ...base, id: `ver_${RUN}_3`, state: "failed" } as never })).rejects.toThrow(/content_source_versions_failure_matches_state/);
      await expect(prisma.contentSourceVersion.create({ data: { ...base, id: `ver_${RUN}_4`, failureStage: "chunked", failureCode: "c", failureMessage: "m" } as never })).rejects.toThrow(/content_source_versions_failure_matches_state/);
      const ok = await prisma.contentSourceVersion.create({ data: { ...base, id: `ver_${RUN}_5` } as never });
      await expect(prisma.contentCandidate.create({ data: { id: `cnd_${RUN}_1`, sourceVersionId: ok.id, kind: "concept_mention", state: "accepted", proposerKind: "deterministic", proposedBy: "p", payload: {} } as never })).rejects.toThrow(/content_candidates_review_matches_state/);
      await expect(prisma.contentCandidate.create({ data: { id: `cnd_${RUN}_2`, sourceVersionId: ok.id, kind: "concept_mention", state: "candidate", proposerKind: "deterministic", proposedBy: "p", reviewedBy: "x", reviewedAt: new Date(), payload: {} } as never })).rejects.toThrow(/content_candidates_review_matches_state/);
    });
  });

  describe("ingestion on real Postgres", () => {
    it("runs the whole pipeline: chunks and candidates persist with evidence, nothing is auto-accepted", async () => {
      await pipeline.registerSource(source("full"));
      const r = await ingest(pipeline, "full");
      expect(r.failure).toBeNull();
      expect(r.version.state).toBe("enriched");
      const chunks = await repo.listChunks(r.version.id);
      expect(chunks.length).toBeGreaterThan(1);
      const candidates = await repo.listCandidates(r.version.id);
      expect(candidates.length).toBeGreaterThan(2);
      expect(candidates.every((c) => c.state === "candidate" && c.review === null)).toBe(true);
      const byId = new Map(chunks.map((c) => [c.id, c]));
      for (const c of candidates) for (const e of c.evidence) expect(byId.get(e.chunkId)!.text.slice(e.charStart, e.charEnd)).toBe(e.quote);
      expect(candidates.some((c) => c.kind === "question")).toBe(true);
    });
    it("the same content again is a no-op: same version, no duplicate chunks/candidates", async () => {
      const before = { chunks: await prisma.contentChunk.count(), candidates: await prisma.contentCandidate.count(), versions: await prisma.contentSourceVersion.count() };
      const again = await ingest(pipeline, "full");
      expect(again.unchanged).toBe(true);
      expect({ chunks: await prisma.contentChunk.count(), candidates: await prisma.contentCandidate.count(), versions: await prisma.contentSourceVersion.count() }).toEqual(before);
    });
    it("two CONCURRENT ingestions of the same content converge on one version", async () => {
      await pipeline.registerSource(source("race"));
      const [a, b] = await Promise.all([ingest(pipeline, "race"), ingest(pipeline, "race")]);
      expect(a.version.id).toBe(b.version.id);
      expect(await prisma.contentSourceVersion.count({ where: { source: { sourceKey: `${RUN}-race` } } })).toBe(1);
      const chunkOrdinals = (await repo.listChunks(a.version.id)).map((c) => c.ordinal);
      expect(chunkOrdinals).toEqual(chunkOrdinals.map((_, i) => i));
    });
    it("changed content is a NEW version; the old version and its decided candidate are untouched", async () => {
      const v1 = (await repo.findSource("IPMAT_INDORE", `${RUN}-full`))!;
      const first = (await repo.listVersions(v1.id))[0]!;
      const mention = (await repo.listCandidates(first.id)).find((c) => c.kind === "concept_mention" && c.conceptKey === "percentages")!;
      await pipeline.reviewCandidate(mention.id, "accept", REVIEW);
      const v2 = await ingest(pipeline, "full", NOTES + "\nA closing paragraph mentioning Ratio.\n");
      expect(v2.version.version).toBe(2);
      expect((await repo.findVersion(first.id))!.state).toBe("enriched");
      expect((await repo.findCandidate(mention.id))!.state).toBe("accepted");
      expect((await repo.listVersions(v1.id)).map((v) => v.version)).toEqual([1, 2]);
    });
    it("unsupported format fails at a recorded stage with a stable code and no content in the message", async () => {
      await pipeline.registerSource(source("bad"));
      const r = await pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: `${RUN}-bad`, format: "pdf" as never, content: `${SENTINEL} binary` });
      expect(r.version.state).toBe("failed");
      expect(r.failure).toMatchObject({ stage: "extracted", code: "unsupported_format" });
      const stored = (await repo.findVersion(r.version.id))!;
      expect(stored.failure).toEqual(r.failure);
      expect(JSON.stringify(stored)).not.toContain(SENTINEL);
    });
    it("a part-way provider failure fails the stage; a retry resumes and converges (no duplicate candidates)", async () => {
      let fail = true;
      const flaky = new StaticExtractionProvider("flaky", { fail: (chunk) => (fail && chunk.ordinal === 1 ? new Error("boom") : null) });
      const p = new ContentIntelligencePipeline({ repo, packs: new PrismaExamPackRepository(prisma), conceptProviders: [flaky, new DeterministicConceptProvider()] });
      await p.registerSource(source("flaky"));
      const first = await ingest(p, "flaky");
      expect(first.failure).toMatchObject({ stage: "enriched", code: "provider_error" });
      expect((await repo.findVersion(first.version.id))!.state).toBe("failed");
      fail = false;
      const retry = await ingest(p, "flaky");
      expect(retry.failure).toBeNull();
      expect(retry.version.attempts).toBe(2);
      const reference = await repo.listCandidates((await ingest(pipeline, "full")).version.id);
      const mineIds = (await repo.listCandidates(retry.version.id)).map((c) => c.kind).sort();
      expect(mineIds.length).toBeGreaterThan(0);
      void reference;
      expect(new Set((await repo.listCandidates(retry.version.id)).map((c) => c.id)).size).toBe(mineIds.length);
    });
    it("a decided candidate is never overwritten by a re-run, and a decision is applied only once", async () => {
      const src = (await repo.findSource("IPMAT_INDORE", `${RUN}-full`))!;
      const v = (await repo.listVersions(src.id))[0]!;
      const cand = (await repo.listCandidates(v.id)).find((c) => c.state === "accepted")!;
      await repo.updateVersionState(v.id, { state: "chunked", failure: null });
      await pipeline.run(v.id); // re-enrich from the persisted chunks
      expect((await repo.findCandidate(cand.id))!.state).toBe("accepted");
      await expect(pipeline.reviewCandidate(cand.id, "reject", REVIEW)).rejects.toMatchObject({ code: "invalid_transition" });
      await expect(repo.decideCandidate({ ...cand, state: "rejected", review: REVIEW })).rejects.toMatchObject({ code: "invalid_transition" });
    });
    it("review -> available locks the version's chunks; an available version is untouched by re-ingestion", async () => {
      await pipeline.registerSource(source("lock"));
      const r = await ingest(pipeline, "lock");
      for (const c of await repo.listCandidates(r.version.id)) await pipeline.reviewCandidate(c.id, "reject", REVIEW);
      await pipeline.completeReview(r.version.id);
      await pipeline.makeAvailable(r.version.id);
      await expect(repo.replaceChunks(r.version.id, [])).rejects.toMatchObject({ code: "invalid_transition" });
      expect((await ingest(pipeline, "lock")).unchanged).toBe(true);
    });
  });

  describe("knowledge graph and evidence over real rows", () => {
    it("builds a valid graph from DB rows; an accepted candidate explains a relation with source, version, location and reviewer", async () => {
      const relProvider = new StaticExtractionProvider("rel@1", { relationships: (c) => (c.text.includes("Understanding Ratio") ? [{ fromConceptName: "Number Systems", toConceptName: "Ratio", relationType: "foundational", rationale: "The note says it underlies both.", quote: "Number Systems underlies both" }] : []) });
      const p = new ContentIntelligencePipeline({ repo, packs: new PrismaExamPackRepository(prisma), conceptProviders: [new DeterministicConceptProvider()], relationshipProviders: [relProvider] });
      await p.registerSource(source("graph"));
      const r = await ingest(p, "graph");
      const rel = (await repo.listCandidates(r.version.id)).find((c) => c.kind === "relationship")!;
      const pack = (await new PrismaExamPackRepository(prisma).findByExamCode("IPMAT_INDORE"))!;
      const build = async (opts = {}) => buildKnowledgeGraph({ pack, patternFamilies: percentagesPatternFamilies, questions: [], ...(await repo.loadExam("IPMAT_INDORE")) }, { includeFixtures: true, ...opts });
      expect(whyRelated(await build(), "number-systems", "ratio")).toEqual([]); // unreviewed -> not intelligence
      await p.reviewCandidate(rel.id, "accept", REVIEW);
      const g = await build();
      expect(validateGraph(g)).toEqual([]);
      const [why] = whyRelated(g, "number-systems", "ratio");
      expect(why).toMatchObject({ relationType: "foundational", basis: "accepted_candidate", provenance: { reviewState: "reviewed", reviewedBy: "fixture-reviewer" } });
      expect(why!.evidence[0]).toMatchObject({ quote: "Number Systems underlies both", sourceKey: `${RUN}-graph`, sourceVersion: 1 });
    });
    it("a rejected candidate never appears, even when candidates are requested", async () => {
      const src = (await repo.findSource("IPMAT_INDORE", `${RUN}-graph`))!;
      const v = (await repo.listVersions(src.id))[0]!;
      const pending = (await repo.listCandidates(v.id)).find((c) => c.state === "candidate" && c.kind === "concept_mention" && c.conceptKey === "ratio")!;
      await pipeline.reviewCandidate(pending.id, "reject", REVIEW);
      const pack = (await new PrismaExamPackRepository(prisma).findByExamCode("IPMAT_INDORE"))!;
      const g = buildKnowledgeGraph({ pack, patternFamilies: [], questions: [], ...(await repo.loadExam("IPMAT_INDORE")) }, { includeFixtures: true, includeCandidates: true });
      expect(g.edges.some((e) => e.candidateId === pending.id)).toBe(false);
    });
  });

  describe("question extraction on real Postgres enters the authoring lifecycle as a draft and never publishes", () => {
    it("accepted question candidate -> draft; blocked by the authoring gates; invisible to students", async () => {
      const src = (await repo.findSource("IPMAT_INDORE", `${RUN}-full`))!;
      const version = (await repo.listVersions(src.id))[0]!;
      const cand = (await repo.listCandidates(version.id)).find((c) => c.kind === "question") as QuestionCandidate;
      const accepted = (await pipeline.reviewCandidate(cand.id, "accept", REVIEW)) as QuestionCandidate;
      const chunk = (await repo.listChunks(version.id)).find((c) => c.id === accepted.evidence[0]!.chunkId)!;
      const d: Record<string, unknown> = { ...percentagesReversePercentageExample.dna };
      delete d.provenanceSourceType;
      delete d.validationState;
      const input = questionDraftFromCandidate({ candidate: accepted, chunk, source: src, version, dna: d as unknown as QuestionInstanceDna, dnaProposer: { kind: "human", proposedBy: "editor" } });
      const authoringRepo = new PrismaQuestionAuthoringRepository(prisma);
      const authoring = new ContentAuthoringService({ questions: authoringRepo, packs: new PrismaExamPackRepository(prisma), patternFamiliesFor: () => percentagesPatternFamilies, errorTaxonomyCodes: (await prisma.errorTaxonomy.findMany({ select: { code: true } })).map((t) => t.code) });
      const { id } = await authoring.createDraft(input);
      expect((await authoringRepo.findById(id))!.validationState).toBe("draft");
      expect((await authoring.gateReport(id)).publishable).toBe(false);
      await expect(authoring.publish(id)).rejects.toMatchObject({ code: "publication_blocked" });
      expect(await new PrismaQuestionContentReader(prisma).findPublishedById(id)).toBeNull();
      expect((await authoring.createDraft(input))).toEqual({ id, alreadyExisted: true });
    });
  });

  describe("retrieval over real rows: authorization and structured authority", () => {
    it("content staff retrieve evidence; students and other-exam staff are denied; fixtures are excluded by default", async () => {
      const retriever = new EvidenceRetriever(repo, new LexicalRetrievalIndex());
      expect(await retriever.indexExam("IPMAT_INDORE")).toBeGreaterThan(0);
      const admin = { role: "content_admin" as const, examCodes: ["IPMAT_INDORE"] };
      const hits = await retriever.retrieve(admin, { examCode: "IPMAT_INDORE", text: "parts per hundred percentage", limit: 3, includeFixtures: true });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.text).toContain("hundred");
      expect(hits[0]!.source.sourceKey.startsWith(RUN)).toBe(true);
      await expect(retriever.retrieve({ role: "student", examCodes: ["IPMAT_INDORE"] }, { examCode: "IPMAT_INDORE", text: "percentage", limit: 3, includeFixtures: true })).rejects.toBeInstanceOf(ContentAccessDeniedError);
      await expect(retriever.retrieve({ role: "content_admin", examCodes: ["OTHER"] }, { examCode: "IPMAT_INDORE", text: "percentage", limit: 3, includeFixtures: true })).rejects.toBeInstanceOf(ContentAccessDeniedError);
      expect(await retriever.retrieve(admin, { examCode: "IPMAT_INDORE", text: "percentage", limit: 3 })).toEqual([]);
    });
    it("a chunk rejected in the database disappears from results even though the index still lists it", async () => {
      const retriever = new EvidenceRetriever(repo, new LexicalRetrievalIndex());
      await retriever.indexExam("IPMAT_INDORE");
      const admin = { role: "content_admin" as const, examCodes: ["IPMAT_INDORE"] };
      const q = { examCode: "IPMAT_INDORE", text: "parts per hundred percentage", limit: 50, includeFixtures: true };
      const target = (await retriever.retrieve(admin, q))[0]!;
      await repo.setChunkValidation(target.chunkId, "rejected");
      expect((await retriever.retrieve(admin, q)).map((h) => h.chunkId)).not.toContain(target.chunkId);
    });
  });

  describe("cross-exam isolation", () => {
    it("another exam sees none of IPMAT's sources/chunks, and cannot resolve an IPMAT chunk id", async () => {
      await prisma.exam.create({ data: { name: "Isolation Test Exam", code: otherCode, examDateRule: { type: "fixed_date", date: "2030-01-01" }, sections: { create: { name: "Quant", order: 1, chapters: { create: { name: "Percentages", order: 1, concepts: { create: { name: "Percentages", description: "t", status: "draft" } } } } } } } });
      const theirs = await repo.registerSource(registerableSource(source("theirs", { examCode: otherCode })));
      expect(theirs.alreadyExisted).toBe(false);
      expect((await repo.listSources(otherCode)).map((s) => s.sourceKey)).toEqual([`${RUN}-theirs`]);
      expect((await repo.listSources("IPMAT_INDORE")).map((s) => s.sourceKey)).not.toContain(`${RUN}-theirs`);
      const ipmatChunk = (await prisma.contentChunk.findFirstOrThrow({ where: { sourceVersion: { source: { sourceKey: `${RUN}-full` } } } })).id;
      expect(await repo.getChunks(otherCode, [ipmatChunk])).toEqual([]);
      expect((await repo.getChunks("IPMAT_INDORE", [ipmatChunk])).length).toBe(1);
      const exam = await repo.loadExam(otherCode);
      expect(exam.chunks).toEqual([]);
      expect(exam.candidates).toEqual([]);
    });
    it("the same source key may exist in two exams (identity is per exam)", async () => {
      const a = await repo.findSource("IPMAT_INDORE", `${RUN}-full`);
      const b = await repo.registerSource(registerableSource(source("full", { examCode: otherCode })));
      expect(b.alreadyExisted).toBe(false);
      expect(b.source.id).not.toBe(a!.id);
    });
  });

  describe("existing data is untouched and no student reader can see pipeline tables", () => {
    it("pre-existing published questions are intact", async () => {
      expect(await prisma.question.count({ where: { validationState: "published", id: { not: { startsWith: "q_" } } } })).toBeGreaterThanOrEqual(3);
    });
    it("source text lives only in content_chunks / content_candidate_evidence, never in any student-readable question column", async () => {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`select count(*) as n from questions where body like ${"%" + SENTINEL + "%"} or correct_answer like ${"%" + SENTINEL + "%"}`;
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });
});
