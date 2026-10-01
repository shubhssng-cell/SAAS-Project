import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createPrismaClient } from "@ipmat/db";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createPrismaDependencies } from "../src/wiring.js";
import { createIsolatedDatabase } from "./isolatedDatabase.js";

/**
 * Phase 5 Unit 5 -- Novelty Training on REAL POSTGRES, through the real HTTP server on the real Prisma repositories, with two independent API instances.
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (same opt-in and "name must contain test" guard as the other integration suites).
 *
 * SYNTHETIC TEST DATA. The seed has three real questions -- far too few to show a standard baseline, three peer styles or surface variation -- and the
 * provider's rule is NOT weakened to make it appear. This suite builds its OWN throwaway database (migrate + seed), publishes a labelled pool into it
 * (bodies start with "[TEST DATA phase-5-unit-5]"; clones of the seeded demonstration question carrying different `novelty_level` values, seeded
 * pattern-taxonomy cells and two seeded concepts, plus the seeded provenance row), withholds the seeded real questions from the pool INSIDE that
 * database only, and drops it afterwards. Nothing synthetic exists in the shared test database, the seed, or any application code path.
 */

const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
  }
}

const DEMO_QUESTION = "00000000-0000-0000-0000-000000000002";
const CORRECT = "20,000";
const WRONG = "16,000";
const TEST_DATA = "[TEST DATA phase-5-unit-5]";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Level = "standard" | "novel_representation" | "novel_combination" | "novel_context";
interface Spec {
  key: string;
  level: Level;
  cell: number; // index into the seeded pattern-taxonomy cells
  concept: 0 | 1; // index into two seeded concepts
}
const SPECS: Spec[] = [
  { key: "S1", level: "standard", cell: 0, concept: 0 },
  { key: "S2", level: "standard", cell: 1, concept: 0 },
  { key: "S3", level: "standard", cell: 2, concept: 0 },
  { key: "nc1", level: "novel_combination", cell: 0, concept: 0 },
  { key: "nc2", level: "novel_combination", cell: 1, concept: 0 },
  { key: "nc3", level: "novel_combination", cell: 2, concept: 0 },
  { key: "nc4", level: "novel_combination", cell: 3, concept: 0 },
  { key: "nx1", level: "novel_context", cell: 4, concept: 0 },
  { key: "nx2", level: "novel_context", cell: 5, concept: 0 },
  { key: "nx3", level: "novel_context", cell: 6, concept: 0 },
  { key: "nx4", level: "novel_context", cell: 7, concept: 0 },
  { key: "nr1", level: "novel_representation", cell: 0, concept: 0 },
  { key: "nr2", level: "novel_representation", cell: 0, concept: 0 }, // the SAME surface as nr1
  { key: "nr3", level: "novel_representation", cell: 1, concept: 0 },
  { key: "nr4", level: "novel_representation", cell: 2, concept: 0 },
  { key: "RS1", level: "standard", cell: 3, concept: 1 },
  { key: "RS2", level: "standard", cell: 4, concept: 1 },
  { key: "RK1", level: "novel_combination", cell: 5, concept: 1 }
];
const idOf = (key: string): string => `00000000-0000-0000-0000-00000000f${String(SPECS.findIndex((s) => s.key === key) + 1).padStart(3, "0")}`;
const keyOf = (id: string): string => SPECS[Number(id.slice(-3)) - 1]!.key;
const style = (key: string): string => (key.startsWith("nc") || key === "RK1" ? "comb" : key.startsWith("nx") ? "ctx" : key.startsWith("nr") ? "rep" : "std");
const NON_STANDARD_KEYS = SPECS.filter((s) => s.level !== "standard").map((s) => s.key);
let cellIds: string[] = [];

interface Instance {
  prisma: PrismaClient;
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}
let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>>;

async function startInstance(): Promise<Instance> {
  const prisma = createPrismaClient(isolated.url);
  await prisma.$connect();
  const server = createServer(createPrismaDependencies(prisma));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    prisma,
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    }
  };
}

async function call(instance: Instance, method: string, path: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json; raw: string; setCookie: string | null }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${instance.baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const raw = await res.text();
  return { status: res.status, json: JSON.parse(raw), raw, setCookie: res.headers.get("set-cookie") };
}

async function newStudent(instance: Instance, label: string): Promise<{ cookie: string; studentId: string }> {
  const signup = await call(instance, "POST", "/v1/auth/signup", undefined, { email: `${label}-${randomUUID()}@example.com`, password: "correct-horse" });
  const cookie = (signup.setCookie ?? "").split(";")[0] ?? "";
  await call(instance, "POST", "/v1/onboarding/complete", cookie);
  expect((await call(instance, "POST", "/v1/enrollment", cookie)).status).toBe(200);
  return { cookie, studentId: (signup.json.student as { id: string }).id };
}

/** Ordinary practice through the real HTTP path; `keys` may repeat (a question retried). */
async function answer(instance: Instance, cookie: string, keys: string[], correct = true): Promise<void> {
  for (const key of keys) {
    const questionId = idOf(key);
    const started = await call(instance, "POST", "/v1/attempts", cookie, { questionId });
    expect(started.status).toBe(200);
    expect((await call(instance, "POST", `/v1/attempts/${started.json.attemptId}/submit`, cookie, { questionId, chosenAnswer: correct ? CORRECT : WRONG })).status).toBe(200);
  }
}

async function publishSyntheticPool(prisma: PrismaClient): Promise<void> {
  const demo = await prisma.question.findUniqueOrThrow({ where: { id: DEMO_QUESTION } });
  cellIds = (await prisma.patternTaxonomyCell.findMany({ orderBy: { id: "asc" }, take: 8 })).map((c) => c.id);
  expect(cellIds.length).toBe(8);
  const conceptIds = [demo.conceptId, (await prisma.concept.findMany({ where: { id: { not: demo.conceptId } }, take: 1, orderBy: { id: "asc" } }))[0]!.id];
  for (const spec of SPECS) {
    const rest: Record<string, unknown> = { ...demo };
    delete rest.id;
    delete rest.createdAt;
    await prisma.question.create({
      data: {
        ...(rest as Omit<typeof demo, "id" | "createdAt">),
        id: idOf(spec.key),
        body: `${TEST_DATA} ${spec.key}`,
        conceptId: conceptIds[spec.concept]!,
        patternTaxonomyCellId: cellIds[spec.cell]!,
        noveltyLevel: spec.level,
        options: demo.options as object,
        difficultyDimensions: demo.difficultyDimensions as object,
        solutionSteps: demo.solutionSteps as object,
        groundTruthDerivation: demo.groundTruthDerivation as object
      }
    });
  }
}

const TEN = { completion: { kind: "fixed_question_count", questionCount: 10 } };
const TWO = { completion: { kind: "fixed_question_count", questionCount: 2 } };
const card = async (instance: Instance, cookie: string): Promise<Json> => ((await call(instance, "GET", "/v1/training/systems", cookie)).json.systems as Json[]).find((x) => x.systemId === "novelty-training")!;
const setPublished = (prisma: PrismaClient, keys: string[], published: boolean) => prisma.question.updateMany({ where: { id: { in: keys.map(idOf) } }, data: { validationState: published ? "published" : "human_reviewed" } });

let a: Instance;
let b: Instance;
let seededPublishedBefore: string[] = [];

describe.skipIf(!DATABASE_URL)("Novelty Training -- real Postgres, synthetic TEST DATA pool (Phase 5 Unit 5)", { timeout: 300_000 }, () => {
  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, "novelty");
    a = await startInstance();
    b = await startInstance();
    seededPublishedBefore = (await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } })).map((q) => q.id).sort();
    await publishSyntheticPool(a.prisma);
    // Inside this THROWAWAY database only: withhold the seeded real questions so the labelled synthetic pool alone defines what Novelty Training can serve.
    await a.prisma.question.updateMany({ where: { validationState: "published", NOT: { body: { startsWith: TEST_DATA } } }, data: { validationState: "human_reviewed" } });
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await isolated?.drop();
  }, 60_000);

  it("the real seeded set is exactly what the seed made; the synthetic pool is labelled TEST DATA and lives only in this throwaway database", async () => {
    expect(seededPublishedBefore).toContain(DEMO_QUESTION);
    expect(await a.prisma.question.count({ where: { validationState: "published", body: { startsWith: TEST_DATA } } })).toBe(SPECS.length);
    const real = await a.prisma.question.findMany({ where: { NOT: { body: { startsWith: TEST_DATA } } }, select: { id: true } });
    expect(real.map((q) => q.id).sort()).toEqual(seededPublishedBefore);
    const shared = createPrismaClient(DATABASE_URL!);
    await shared.$connect();
    const table = await shared.$queryRawUnsafe<Array<{ t: string | null }>>("select to_regclass('public.questions')::text as t");
    if (table[0]?.t) expect(await shared.question.count({ where: { body: { startsWith: TEST_DATA } } })).toBe(0);
    await shared.$disconnect();
  });

  it("not applicable: no evidence / two standard answers / ONE standard question retried / a baseline split across two concepts (2 + 2) -- each honest, and a start is 409", async () => {
    const note = "Needs several recorded answers on standard questions of one concept first.";
    const cases: Array<[string, string[]]> = [["none", []], ["two", ["S1", "S2"]], ["retried", ["S1", "S1", "S1", "S1"]], ["split", ["S1", "S2", "RS1", "RS2"]]];
    for (const [label, keys] of cases) {
      const s = await newStudent(a, `nv-${label}`);
      await answer(a, s.cookie, keys);
      expect(await card(a, s.cookie), label).toMatchObject({ label: "Novelty", availability: "not_applicable", note });
      expect((await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TEN })).status, label).toBe(409);
    }
  });

  it("a cleared baseline -> peer styles rotate -> surface variation -> sufficient exposure, across a second instance and ownership; no stage, nothing about styles or counts leaks", async () => {
    const s = await newStudent(a, "nv-life");
    const other = await newStudent(b, "nv-oth");
    await answer(a, s.cookie, ["S1", "S2", "S3"]);
    expect(await card(a, s.cookie)).toMatchObject({ availability: "available", note: "Ready to train." });

    const started = await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TEN });
    expect(started.status).toBe(200);
    const session = started.json.session as Json;
    expect(session).toMatchObject({ systemTitle: "Novelty Training", dimension: "novelty", stage: null, objective: { targetConceptName: null } });
    expect(session.objective.statement).toBe("Practice unfamiliar question styles: build exposure to different ways the exam can present a concept. This session is expanding the kinds of questions you've encountered.");
    const row = await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(JSON.stringify([row.objective, row.config])).not.toMatch(/stage|novel_|noveltyLevel|targetNoveltyLevel/i);

    const served: string[] = [];
    let firstRaw = "";
    for (let i = 0; i < 9; i += 1) {
      const instance = i % 2 === 0 ? a : b;
      const next = await call(instance, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
      expect(next.status).toBe(200);
      expect(next.json.status).toBe("question");
      expect(next.json.stageTransition).toBeNull();
      expect(next.json.session.stage).toBeNull();
      if (i === 0) {
        firstRaw = next.raw;
        expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {})).json.attemptId).toBe(next.json.attemptId);
        expect((await call(b, "GET", `/v1/training/sessions/${session.sessionId}`, other.cookie)).status).toBe(403);
        expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, other.cookie, {})).status).toBe(403);
      }
      served.push(keyOf(next.json.question.questionId));
      // correctness never changes an exposure count: alternate right and wrong
      expect((await call(instance, "POST", `/v1/attempts/${next.json.attemptId}/submit`, s.cookie, { questionId: next.json.question.questionId, chosenAnswer: i % 2 === 0 ? CORRECT : WRONG })).json).toMatchObject({ status: "submitted" });
    }
    expect(served.map(style)).toEqual(["comb", "ctx", "rep", "comb", "ctx", "rep", "comb", "ctx", "rep"]); // the target rotates through the three peer styles
    expect(served.filter((k) => k.startsWith("nr"))).toEqual(["nr1", "nr3", "nr4"]); // repeat the style, vary the surface (nr2 shares nr1's surface)
    expect(served).not.toContain("RK1"); // the concept whose baseline is not cleared is never targeted
    expect(new Set(served).size).toBe(9);

    // every style now has enough exposure: the provider's own evidence says there is nothing more to add (said in authored words); the session stays active
    const end = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(end.json).toMatchObject({ status: "no_question", message: "Your recorded practice now includes several questions in each unfamiliar style, so there is nothing more to add right now. You can end the session.", session: { status: "active", stage: null } });
    expect((await card(a, s.cookie)).note).toBe("Your recorded practice already includes several questions in each unfamiliar style, so there is nothing to add right now.");
    const done = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/finish`, s.cookie, {});
    expect(done.json).toMatchObject({ status: "completed", stage: null, summary: { submittedCount: 9, correctCount: 5, incorrectCount: 4 } });

    for (const text of [firstRaw, JSON.stringify(done.json), (await call(a, "GET", "/v1/training/systems", s.cookie)).raw]) {
      for (const secret of ["novel_representation", "novel_combination", "novel_context", "noveltyLevel", "targetNoveltyLevel", "standardExposureCount", "distinctQuestionIds", ...cellIds, "providerId", "diagnostics", "correctAnswer", "groundTruth"]) expect(text, secret).not.toContain(secret);
      expect(text.toLowerCase()).not.toMatch(/confidence|struggle|weak at|you lack|not good at|adaptab/);
    }
    const block = (await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } })).practiceBlockId;
    const rows = await a.prisma.attempt.findMany({ where: { practiceBlockId: block }, orderBy: { blockSequenceNumber: "asc" } });
    expect(rows.map((r) => r.blockSequenceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]); // ordinary attempts: the persisted exposure the next decision read
  });

  it("applicable with ZERO published non-standard questions is `no_eligible_question` (a different state from not applicable); an unpublished question is never served", async () => {
    const s = await newStudent(a, "nv-content");
    await answer(a, s.cookie, ["S1", "S2", "S3"]);
    await setPublished(a.prisma, NON_STANDARD_KEYS, false);
    try {
      expect(await card(a, s.cookie)).toMatchObject({ availability: "no_eligible_question", note: "No published question in an unfamiliar style is available right now." });
      expect((await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TWO })).status).toBe(409);
    } finally {
      await setPublished(a.prisma, NON_STANDARD_KEYS, true);
    }
    await setPublished(a.prisma, ["nc1", "nc2"], false);
    try {
      const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TWO })).json as { session: Json };
      const first = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
      expect(keyOf(first.json.question.questionId)).toBe("nc3"); // nc1 / nc2 are unpublished
    } finally {
      await setPublished(a.prisma, ["nc1", "nc2"], true);
    }
  });

  it("all-seen fallback: when the target style's only questions share ONE already-seen surface they are still served (not 'no question')", async () => {
    const s = await newStudent(a, "nv-fallback");
    await answer(a, s.cookie, ["S1", "S2", "S3", "nc1", "nc2", "nc3", "nx1", "nx2", "nx3"]); // comb and ctx sufficiently exposed; rep untouched
    await setPublished(a.prisma, ["nr3", "nr4"], false);
    try {
      const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TEN })).json as { session: Json };
      const served: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const next = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
        if (next.json.status !== "question") break;
        served.push(keyOf(next.json.question.questionId));
        await call(a, "POST", `/v1/attempts/${next.json.attemptId}/submit`, s.cookie, { questionId: next.json.question.questionId, chosenAnswer: CORRECT });
      }
      expect(served).toEqual(["nr1", "nr2"]); // nr2 shares nr1's (already seen) surface and is served from the fallback pool
    } finally {
      await setPublished(a.prisma, ["nr3", "nr4"], true);
    }
  });

  it("concurrency: 12 parallel starts make one session; 10 parallel next calls across two instances make one open attempt", async () => {
    const s = await newStudent(a, "nv-race");
    await answer(a, s.cookie, ["S1", "S2", "S3"]);
    const starts = await Promise.all(Array.from({ length: 12 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TEN })));
    expect(starts.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(new Set(starts.map((r) => r.json.session.sessionId)).size).toBe(1);
    expect(starts.filter((r) => r.json.resumed === false)).toHaveLength(1);
    const sessionId = starts[0]!.json.session.sessionId as string;
    const nexts = await Promise.all(Array.from({ length: 10 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", `/v1/training/sessions/${sessionId}/next`, s.cookie, {})));
    expect(nexts.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(nexts.map((r) => r.json.attemptId)).size).toBe(1);
    const block = (await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })).practiceBlockId;
    expect(await a.prisma.attempt.count({ where: { practiceBlockId: block } })).toBe(1);
  });

  it("training attempts are ordinary attempts: ordinary evidence, and no autopsy / repair / mastery row is written", async () => {
    const s = await newStudent(a, "nv-ev");
    await answer(a, s.cookie, ["S1", "S2", "S3"]);
    const counts = async () => ({ autopsies: await a.prisma.autopsy.count(), plans: await a.prisma.repairPlan.count(), mastery: await a.prisma.masteryState.count() });
    const before = await counts();
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TWO })).json as { session: Json };
    const q = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    await call(a, "POST", `/v1/attempts/${q.json.attemptId}/skip`, s.cookie, { questionId: q.json.question.questionId });
    const evidence = await call(a, "GET", `/v1/attempts/${q.json.attemptId}/evidence`, s.cookie);
    expect(evidence.status).toBe(200);
    expect(evidence.json.facts.verdict).toBe("not_graded");
    expect(evidence.json.history.priorAttempts).toBe(3);
    expect(await counts()).toEqual(before);
  });
});
