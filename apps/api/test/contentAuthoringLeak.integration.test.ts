import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ContentAuthoringService, type NewQuestionInput, type QuestionInstanceDna } from "@ipmat/content-authoring";
import { PrismaExamPackRepository, PrismaQuestionAuthoringRepository, createPrismaClient } from "@ipmat/db";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHypothesisDependencies } from "../src/hypothesisWiring.js";
import { createServer } from "../src/server.js";
import { createPrismaDependencies } from "../src/wiring.js";

/**
 * Product Phase 6 Prompt 3 (docs/DECISIONS.md D-084) -- REAL DATABASE + REAL HTTP leakage test. Questions are
 * authored through the real authoring service on real Postgres, left in every unpublished lifecycle state, and
 * then probed through the real student endpoints. Nothing unpublished, no answer key before submission, no
 * reviewer note, no source/provenance detail and no internal id/diagnostic may appear in any raw response.
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (database name must contain "test"). Every question is a labelled
 * fixture with a unique prefix, deleted afterwards.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run against database "${dbName}": IPMAT_TEST_DATABASE_URL must name a database containing "test".`);
}

const RUN = `p3api-${randomUUID().slice(0, 8)}`;
const INTERNAL = `INTERNAL-${randomUUID().slice(0, 8)}`; // reviewer notes, source refs, attribution: never student-visible
const UNPUBLISHED = `UNPUBLISHED-${randomUUID().slice(0, 8)}`; // text that exists only in unpublished questions
const { dna: demoDna } = percentagesReversePercentageExample;

const dna = (over: Partial<QuestionInstanceDna> = {}): QuestionInstanceDna => {
  const d: Record<string, unknown> = { ...demoDna };
  delete d.provenanceSourceType;
  delete d.validationState;
  return { ...d, ...over } as QuestionInstanceDna;
};
const words = (suffix: string): string => Array.from({ length: 12 }, (_, i) => `x${(suffix + i).split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16)}`).join(" ");
const input = (suffix: string, body: string): NewQuestionInput => ({
  id: `${RUN}-${suffix}`,
  dna: dna(),
  content: { body: `${words(suffix + RUN)} ${body}`, answerFormat: "multiple_choice", options: ["11", "22", "33", "44"], correctAnswer: "33", solutionSteps: [`step one ${INTERNAL}-solution-is-visible-only-after-submission-of-a-PUBLISHED-question`], groundTruthDerivation: { computation: "11 * 3", expectedAnswer: 33 } },
  source: { sourceType: "original", sourceRef: `fixture:${INTERNAL}-source`, licenseRef: null, attributedTo: `${INTERNAL}-attribution` },
  origin: "human_authored"
});
const REVIEW = { reviewedBy: `${INTERNAL}-reviewer`, reviewedAt: "2026-10-02T10:00:00.000Z", notes: `${INTERNAL}-review-notes`, answerVerifiedByReviewer: false, reviewedAsDistinct: false };

interface Instance { prisma: PrismaClient; server: Server; baseUrl: string; close: () => Promise<void> }
async function startInstance(): Promise<Instance> {
  const prisma = createPrismaClient(DATABASE_URL!);
  await prisma.$connect();
  const server = createServer({ ...createPrismaDependencies(prisma), ...createHypothesisDependencies({ IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: "integration-test-secret-0123456789" }) });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { prisma, server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: async () => { await new Promise<void>((r) => server.close(() => r())); await prisma.$disconnect(); } };
}
async function call(i: Instance, method: string, path: string, cookie?: string, body?: unknown): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${i.baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON */ }
  return { status: res.status, text, json };
}

describe.skipIf(!DATABASE_URL)("content authoring -- student-facing leakage (real Postgres + real HTTP)", { timeout: 120_000 }, () => {
  let inst: Instance;
  let service: ContentAuthoringService;
  let repo: PrismaQuestionAuthoringRepository;
  const ids: Record<"draft" | "validated" | "reviewed" | "published", string> = { draft: "", validated: "", reviewed: "", published: "" };
  let cookie = "";

  beforeAll(async () => {
    inst = await startInstance();
    repo = new PrismaQuestionAuthoringRepository(inst.prisma);
    service = new ContentAuthoringService({
      questions: repo,
      packs: new PrismaExamPackRepository(inst.prisma),
      patternFamiliesFor: () => percentagesPatternFamilies,
      errorTaxonomyCodes: (await inst.prisma.errorTaxonomy.findMany({ select: { code: true } })).map((t) => t.code)
    });
    const hard = (extra: Partial<QuestionInstanceDna>) => dna({ difficultyTier: "hard", testingModes: ["transformed"], combinesWithConcepts: ["Algebra"], ...extra });
    ids.draft = (await service.createDraft(input("draft", `${UNPUBLISHED}-draft-body`))).id;
    ids.validated = (await service.createDraft(input("validated", `${UNPUBLISHED}-validated-body`))).id;
    await service.validate(ids.validated);
    const hardInput = (suffix: string, body: string) => ({ ...input(suffix, body), dna: hard({}) });
    ids.reviewed = (await service.createDraft(hardInput("reviewed", `${UNPUBLISHED}-reviewed-body`))).id;
    await service.validate(ids.reviewed);
    await service.review(ids.reviewed, REVIEW, "approve");
    ids.published = (await service.createDraft(input("published", "a published fixture question body"))).id;
    await service.validate(ids.published);
    await service.publish(ids.published);

    const signup = await call(inst, "POST", "/v1/auth/signup", undefined, { email: `${RUN}@example.com`, password: "correct-horse-9" });
    const setCookie = signup.text && (await fetch(`${inst.baseUrl}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${RUN}@example.com`, password: "correct-horse-9" }) })).headers.get("set-cookie");
    cookie = (setCookie ?? "").split(";")[0] ?? "";
    await call(inst, "POST", "/v1/onboarding/complete", cookie);
    expect((await call(inst, "POST", "/v1/enrollment", cookie)).status).toBe(200);
  });

  afterAll(async () => {
    const rows = await inst.prisma.question.findMany({ where: { id: { startsWith: RUN } }, select: { id: true, provenanceId: true } });
    const attempts = await inst.prisma.attempt.findMany({ where: { questionId: { in: rows.map((r) => r.id) } }, select: { id: true } });
    await inst.prisma.attemptEvent.deleteMany({ where: { attemptId: { in: attempts.map((a) => a.id) } } });
    await inst.prisma.attempt.deleteMany({ where: { id: { in: attempts.map((a) => a.id) } } });
    await inst.prisma.question.deleteMany({ where: { id: { startsWith: RUN } } });
    await inst.prisma.provenance.deleteMany({ where: { id: { in: rows.flatMap((r) => (r.provenanceId ? [r.provenanceId] : [])) } } });
    await inst.close();
  });

  it("the fixtures really are in the intended lifecycle states", async () => {
    expect((await repo.findById(ids.draft))!.validationState).toBe("draft");
    expect((await repo.findById(ids.validated))!.validationState).toBe("ai_validated");
    expect((await repo.findById(ids.reviewed))!.validationState).toBe("human_reviewed");
    expect((await repo.findById(ids.published))!.validationState).toBe("published");
  });

  it.each(["draft", "validated", "reviewed"] as const)("a student cannot start an attempt on a %s (unpublished) question, and the refusal leaks nothing", async (key) => {
    const res = await call(inst, "POST", "/v1/attempts", cookie, { questionId: ids[key] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    for (const secret of [UNPUBLISHED, INTERNAL, "33", "correctAnswer", "solutionSteps", "reviewedBy", "contentFingerprint", "authoringOrigin"]) expect(res.text, `${key}: ${secret}`).not.toContain(secret);
    const attempts = await inst.prisma.attempt.count({ where: { questionId: ids[key] } });
    expect(attempts).toBe(0);
  });

  it("a published question starts without its answer key, reviewer data, source details or internal ids/diagnostics", async () => {
    const res = await call(inst, "POST", "/v1/attempts", cookie, { questionId: ids.published });
    expect(res.status).toBe(200);
    for (const secret of [INTERNAL, "correctAnswer", "solutionSteps", "groundTruth", "reviewedBy", "reviewNotes", "contentFingerprint", "authoringOrigin", "provenance", "sourceRef", "attributedTo", "validationState", "patternTaxonomyCell", "fixture:"]) expect(res.text, secret).not.toContain(secret);
    expect(Object.keys(res.json).sort()).not.toContain("question.correctAnswer");
    const attemptId = res.json.attemptId as string;

    // After submission the answer and solution ARE student-visible by design - but reviewer/source/provenance data never is.
    const submitted = await call(inst, "POST", `/v1/attempts/${attemptId}/submit`, cookie, { questionId: ids.published, chosenAnswer: "11" });
    expect(submitted.status).toBe(200);
    for (const secret of ["reviewedBy", "reviewNotes", "contentFingerprint", "authoringOrigin", "provenance", "sourceRef", "attributedTo", "fixture:", `${INTERNAL}-reviewer`, `${INTERNAL}-review-notes`, `${INTERNAL}-source`, `${INTERNAL}-attribution`]) expect(submitted.text, secret).not.toContain(secret);
    const result = await call(inst, "GET", `/v1/attempts/${attemptId}/result`, cookie);
    for (const secret of ["reviewedBy", "reviewNotes", "contentFingerprint", "authoringOrigin", "provenance", `${INTERNAL}-reviewer`, `${INTERNAL}-source`]) expect(result.text, secret).not.toContain(secret);
  });

  it("the recommendation endpoint never surfaces an unpublished question, however many times it is asked", async () => {
    for (let i = 0; i < 6; i++) {
      const rec = await call(inst, "POST", "/v1/recommendation", cookie);
      expect(rec.status).toBe(200);
      for (const key of ["draft", "validated", "reviewed"] as const) expect(rec.text).not.toContain(ids[key]);
      for (const secret of [UNPUBLISHED, INTERNAL, "correctAnswer"]) expect(rec.text).not.toContain(secret);
    }
  });

  it("the training hub never exposes unpublished content or internal data", async () => {
    const hub = await call(inst, "GET", "/v1/training/systems", cookie);
    expect(hub.status).toBe(200);
    for (const secret of [UNPUBLISHED, INTERNAL, ids.draft, ids.validated, ids.reviewed, "correctAnswer", "reviewedBy"]) expect(hub.text).not.toContain(secret);
  });

  it("there is no student route that reads authoring data at all", async () => {
    for (const path of ["/v1/questions", `/v1/questions/${ids.published}`, "/v1/authoring", "/v1/universe", `/v1/reviews/${ids.reviewed}`]) {
      const res = await call(inst, "GET", path, cookie);
      expect([401, 403, 404]).toContain(res.status);
      for (const secret of [UNPUBLISHED, INTERNAL]) expect(res.text).not.toContain(secret);
    }
  });
});
