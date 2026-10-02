import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ContentAuthoringService, type QuestionInstanceDna } from "@ipmat/content-authoring";
import { ContentIntelligencePipeline, DeterministicConceptProvider, questionDraftFromCandidate, type QuestionCandidate } from "@ipmat/content-intelligence";
import { PrismaContentIntelligenceRepository, PrismaExamPackRepository, PrismaQuestionAuthoringRepository, createPrismaClient } from "@ipmat/db";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHypothesisDependencies } from "../src/hypothesisWiring.js";
import { createServer } from "../src/server.js";
import { createPrismaDependencies } from "../src/wiring.js";

/**
 * Product Phase 6 Prompt 4 (docs/DECISIONS.md D-085) -- REAL DATABASE + REAL HTTP leakage test. Source material is
 * ingested through the real pipeline on real Postgres (chunks, candidates, an extracted question left as an unpublished
 * draft) and then probed through the real student endpoints. Nothing extracted -- source text, chunk text, candidate
 * evidence, an extracted question's stem/options/answer claim, provider/proposer identifiers, review data, hashes or any
 * graph/pipeline diagnostic -- may appear in any raw response.
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (database name must contain "test"). Everything is a labelled fixture
 * with a unique prefix, deleted afterwards.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run against database "${dbName}": IPMAT_TEST_DATABASE_URL must name a database containing "test".`);
}

const RUN = `p4api-${randomUUID().slice(0, 8)}`;
const SRC = `SRCTEXT-${randomUUID().slice(0, 8)}`; // appears only in source text / chunks
const STEM = `EXTRACTEDSTEM-${randomUUID().slice(0, 8)}`; // appears only in an extracted question
const NOTES = `# Synthetic fixture ${SRC}

## Percentages

A percentage expresses a quantity as parts per hundred ${SRC}. Understanding Ratio is required before Percentages make sense.

1. ${STEM} what is 10 percent of the base quantity 200?
A) 10
B) 20
C) 30
D) 40
Answer: B
`;
const { dna: demoDna } = percentagesReversePercentageExample;

interface Instance { prisma: PrismaClient; server: Server; baseUrl: string; close: () => Promise<void> }
async function startInstance(): Promise<Instance> {
  const prisma = createPrismaClient(DATABASE_URL!);
  await prisma.$connect();
  const server = createServer({ ...createPrismaDependencies(prisma), ...createHypothesisDependencies({ IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: "integration-test-secret-0123456789" }) });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { prisma, server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: async () => { await new Promise<void>((r) => server.close(() => r())); await prisma.$disconnect(); } };
}
async function call(i: Instance, method: string, path: string, cookie?: string, body?: unknown): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${i.baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, text: await res.text() };
}

describe.skipIf(!DATABASE_URL)("content intelligence -- student-facing leakage (real Postgres + real HTTP)", { timeout: 120_000 }, () => {
  let inst: Instance;
  let cookie = "";
  let draftId = "";
  let versionId = "";
  let pipelineSecrets: string[] = [];

  beforeAll(async () => {
    inst = await startInstance();
    const repo = new PrismaContentIntelligenceRepository(inst.prisma);
    const packs = new PrismaExamPackRepository(inst.prisma);
    const pipeline = new ContentIntelligencePipeline({ repo, packs, conceptProviders: [new DeterministicConceptProvider()] });
    await pipeline.registerSource({ examCode: "IPMAT_INDORE", sourceKey: `${RUN}-notes`, title: `${RUN} title-sentinel`, sourceType: "original", sourceRef: `fixture:${RUN}-ref-sentinel`, licenseRef: null, attributedTo: null, authority: null, dataOrigin: "fixture", fixtureLabel: `${RUN} fixture-label-sentinel` });
    const ing = await pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: `${RUN}-notes`, format: "markdown", content: NOTES });
    versionId = ing.version.id;
    const review = { reviewedBy: `${RUN}-reviewer-sentinel`, reviewedAt: "2026-10-02T10:00:00.000Z" };
    const cand = (await repo.listCandidates(versionId)).find((c) => c.kind === "question") as QuestionCandidate;
    const accepted = (await pipeline.reviewCandidate(cand.id, "accept", review)) as QuestionCandidate;
    const source = (await repo.findSource("IPMAT_INDORE", `${RUN}-notes`))!;
    const chunk = (await repo.listChunks(versionId)).find((c) => c.id === accepted.evidence[0]!.chunkId)!;
    const d: Record<string, unknown> = { ...demoDna };
    delete d.provenanceSourceType;
    delete d.validationState;
    const input = questionDraftFromCandidate({ candidate: accepted, chunk, source, version: ing.version, dna: d as unknown as QuestionInstanceDna, dnaProposer: { kind: "human", proposedBy: `${RUN}-proposer-sentinel` } });
    const authoring = new ContentAuthoringService({ questions: new PrismaQuestionAuthoringRepository(inst.prisma), packs, patternFamiliesFor: () => percentagesPatternFamilies, errorTaxonomyCodes: (await inst.prisma.errorTaxonomy.findMany({ select: { code: true } })).map((t) => t.code) });
    draftId = (await authoring.createDraft(input)).id;
    pipelineSecrets = [SRC, STEM, `${RUN}-ref-sentinel`, `${RUN}-reviewer-sentinel`, `${RUN}-proposer-sentinel`, `${RUN} title-sentinel`, `${RUN} fixture-label-sentinel`, ing.version.contentHash, versionId, draftId, "deterministic-concept-name-matcher", "question-boundary-detector", "content_chunks", "content_candidate", "contentHash", "ingestion", "headingPath", "chunk"];

    const signup = await call(inst, "POST", "/v1/auth/signup", undefined, { email: `${RUN}@example.com`, password: "correct-horse-9" });
    expect(signup.status).toBeLessThan(300);
    const login = await fetch(`${inst.baseUrl}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${RUN}@example.com`, password: "correct-horse-9" }) });
    cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    await call(inst, "POST", "/v1/onboarding/complete", cookie);
    expect((await call(inst, "POST", "/v1/enrollment", cookie)).status).toBe(200);
  });

  afterAll(async () => {
    const sources = (await inst.prisma.contentSource.findMany({ where: { sourceKey: { startsWith: RUN } }, select: { id: true } })).map((s) => s.id);
    const versions = (await inst.prisma.contentSourceVersion.findMany({ where: { sourceId: { in: sources } }, select: { id: true } })).map((v) => v.id);
    await inst.prisma.contentCandidateEvidence.deleteMany({ where: { candidate: { sourceVersionId: { in: versions } } } });
    await inst.prisma.contentCandidate.deleteMany({ where: { sourceVersionId: { in: versions } } });
    await inst.prisma.contentChunk.deleteMany({ where: { sourceVersionId: { in: versions } } });
    await inst.prisma.contentSourceVersion.deleteMany({ where: { id: { in: versions } } });
    await inst.prisma.contentSource.deleteMany({ where: { id: { in: sources } } });
    const q = await inst.prisma.question.findUnique({ where: { id: draftId }, select: { id: true, provenanceId: true } });
    if (q) {
      await inst.prisma.attempt.deleteMany({ where: { questionId: q.id } });
      await inst.prisma.question.delete({ where: { id: q.id } });
      if (q.provenanceId) await inst.prisma.provenance.delete({ where: { id: q.provenanceId } });
    }
    await inst.close();
  });

  it("the fixtures really exist: chunks and candidates are in the database, and the extracted question is an unpublished draft", async () => {
    expect(await inst.prisma.contentChunk.count({ where: { sourceVersionId: versionId } })).toBeGreaterThan(1);
    expect(await inst.prisma.contentCandidate.count({ where: { sourceVersionId: versionId } })).toBeGreaterThan(2);
    expect((await inst.prisma.question.findUniqueOrThrow({ where: { id: draftId } })).validationState).toBe("draft");
    expect((await inst.prisma.contentChunk.findFirstOrThrow({ where: { sourceVersionId: versionId, text: { contains: SRC } } })).text).toContain(SRC);
  });

  it("a student cannot start an attempt on the extracted-but-unpublished question, and the refusal leaks nothing", async () => {
    const res = await call(inst, "POST", "/v1/attempts", cookie, { questionId: draftId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    for (const secret of pipelineSecrets) expect(res.text, secret).not.toContain(secret);
    expect(await inst.prisma.attempt.count({ where: { questionId: draftId } })).toBe(0);
  });

  it("recommendation never surfaces the extracted draft or any pipeline content, however often it is asked", async () => {
    for (let i = 0; i < 6; i++) {
      const rec = await call(inst, "POST", "/v1/recommendation", cookie);
      expect(rec.status).toBe(200);
      for (const secret of pipelineSecrets) expect(rec.text, secret).not.toContain(secret);
    }
  });

  it("the student practice path (start -> submit -> result) exposes no source text, evidence, hashes, proposer/reviewer ids or diagnostics", async () => {
    const started = await call(inst, "POST", "/v1/attempts", cookie, { questionId: "00000000-0000-0000-0000-000000000002" });
    expect(started.status).toBe(200);
    for (const secret of pipelineSecrets) expect(started.text, secret).not.toContain(secret);
    const attemptId = JSON.parse(started.text).attemptId as string;
    const submitted = await call(inst, "POST", `/v1/attempts/${attemptId}/submit`, cookie, { questionId: "00000000-0000-0000-0000-000000000002", chosenAnswer: "16,000" });
    for (const secret of pipelineSecrets) expect(submitted.text, secret).not.toContain(secret);
    const result = await call(inst, "GET", `/v1/attempts/${attemptId}/result`, cookie);
    for (const secret of pipelineSecrets) expect(result.text, secret).not.toContain(secret);
  });

  it("the training hub exposes no pipeline content", async () => {
    const hub = await call(inst, "GET", "/v1/training/systems", cookie);
    expect(hub.status).toBe(200);
    for (const secret of pipelineSecrets) expect(hub.text, secret).not.toContain(secret);
  });

  it("there is no student route for sources, ingestion, chunks, candidates, the knowledge graph or retrieval", async () => {
    for (const path of ["/v1/sources", `/v1/sources/${RUN}-notes`, "/v1/ingestion", `/v1/versions/${versionId}`, "/v1/chunks", "/v1/candidates", "/v1/graph", "/v1/retrieval", "/v1/retrieve?q=percentage", "/v1/evidence"]) {
      for (const method of ["GET", "POST"]) {
        const res = await call(inst, method, path, cookie, method === "POST" ? { text: "percentage" } : undefined);
        expect([401, 403, 404, 405], `${method} ${path}`).toContain(res.status);
        for (const secret of pipelineSecrets) expect(res.text, `${method} ${path} ${secret}`).not.toContain(secret);
      }
    }
  });
});
