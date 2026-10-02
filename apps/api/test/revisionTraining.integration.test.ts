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
 * Phase 5 Unit 7 -- Revision on REAL POSTGRES, through the real HTTP server on the real Prisma repositories, with two independent API instances.
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (same opt-in and "name must contain test" guard as the other integration suites).
 *
 * SYNTHETIC TEST DATA. The seed has three real questions -- far too few to show a standard baseline, three peer styles or surface variation -- and the
 * provider's rule is NOT weakened to make it appear. This suite builds its OWN throwaway database (migrate + seed), publishes a labelled pool into it
 * (bodies start with "[TEST DATA phase-5-unit-7]"; clones of the seeded demonstration question carrying different `novelty_level` values, seeded
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
const TEST_DATA = "[TEST DATA phase-5-unit-7]";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
interface Spec {
  key: string;
  cell: number; // index into the seeded pattern-taxonomy cells
  concept: 0 | 1; // index into two seeded concepts
}
// Percentages: H1-H3 are the history questions (cells 0-2), R1-R4 fresh (R4 shares R3's cell). Ratio (a second seeded concept): T1-T3 history, U1-U2 fresh.
const SPECS: Spec[] = [
  { key: "H1", cell: 0, concept: 0 },
  { key: "H2", cell: 1, concept: 0 },
  { key: "H3", cell: 2, concept: 0 },
  { key: "R1", cell: 3, concept: 0 },
  { key: "R2", cell: 4, concept: 0 },
  { key: "R3", cell: 5, concept: 0 },
  { key: "R4", cell: 5, concept: 0 },
  { key: "T1", cell: 0, concept: 1 },
  { key: "T2", cell: 1, concept: 1 },
  { key: "T3", cell: 2, concept: 1 },
  { key: "U1", cell: 3, concept: 1 },
  { key: "U2", cell: 4, concept: 1 }
];
const idOf = (key: string): string => `00000000-0000-0000-0000-00000000f${String(SPECS.findIndex((s) => s.key === key) + 1).padStart(3, "0")}`;
const keyOf = (id: string): string => SPECS[Number(id.slice(-3)) - 1]!.key;
let cellIds: string[] = [];

const FETCH_BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

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
  // `fetch` refuses a fixed list of "bad ports" (a known source of flaky "fetch failed: bad port" in suites that bind port 0): rebind until the OS gives a usable one.
  for (let tries = 0; tries < 50; tries += 1) {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    if (!FETCH_BLOCKED_PORTS.has((server.address() as AddressInfo).port)) break;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
        options: demo.options as object,
        difficultyDimensions: demo.difficultyDimensions as object,
        solutionSteps: demo.solutionSteps as object,
        groundTruthDerivation: demo.groundTruthDerivation as object
      }
    });
  }
}

const TWO = { completion: { kind: "fixed_question_count", questionCount: 2 } };
const FIVE = { completion: { kind: "fixed_question_count", questionCount: 5 } };
const DAY_MS = 86_400_000;
const card = async (instance: Instance, cookie: string): Promise<Json> => ((await call(instance, "GET", "/v1/training/systems", cookie)).json.systems as Json[]).find((x) => x.systemId === "revision")!;
const setPublished = (prisma: PrismaClient, keys: string[], published: boolean) => prisma.question.updateMany({ where: { id: { in: keys.map(idOf) } }, data: { validationState: published ? "published" : "human_reviewed" } });

/** Ordinary practice through the real HTTP path; returns the attempt ids. */
async function answer(instance: Instance, cookie: string, keys: string[], correct = true): Promise<string[]> {
  const ids: string[] = [];
  for (const key of keys) {
    const questionId = idOf(key);
    const started = await call(instance, "POST", "/v1/attempts", cookie, { questionId });
    expect(started.status).toBe(200);
    expect((await call(instance, "POST", `/v1/attempts/${started.json.attemptId}/submit`, cookie, { questionId, chosenAnswer: correct ? CORRECT : WRONG })).status).toBe(200);
    ids.push(started.json.attemptId);
  }
  return ids;
}
/** Moves attempts' persisted times so the LATEST finalized one is `ageMs` before now (earlier ones a minute apart, older still) -- exactly how a dormant history looks in the table. */
async function backdate(attemptIds: string[], ageMs: number): Promise<void> {
  const base = Date.now() - ageMs;
  for (let i = 0; i < attemptIds.length; i += 1) {
    const finalized = new Date(base - (attemptIds.length - 1 - i) * 60_000);
    await a.prisma.attempt.update({ where: { id: attemptIds[i]! }, data: { startedAt: new Date(finalized.getTime() - 30_000), submittedAt: finalized, finalizedAt: finalized, timeSpentSeconds: 30 } });
  }
}
async function dormantStudent(label: string, ageDays = 20, keys = ["H1", "H2", "H3"], correct = true): Promise<{ cookie: string; studentId: string }> {
  const s = await newStudent(a, label);
  await backdate(await answer(a, s.cookie, keys, correct), ageDays * DAY_MS);
  return s;
}

let a: Instance;
let b: Instance;
let seededPublishedBefore: string[] = [];

describe.skipIf(!DATABASE_URL)("Revision -- real Postgres, synthetic TEST DATA pool (Phase 5 Unit 7)", { timeout: 300_000 }, () => {
  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, "revision");
    a = await startInstance();
    b = await startInstance();
    seededPublishedBefore = (await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } })).map((q) => q.id).sort();
    await publishSyntheticPool(a.prisma);
    // Inside this THROWAWAY database only: withhold the seeded real questions so the labelled synthetic pool alone defines what Revision can serve.
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

  it("not applicable: no history / recent history / only two old graded attempts / old SKIPPED attempts -- each honest, and a start is 409", async () => {
    const note = "Needs a concept you have practiced several times before and have not attempted for a while.";
    const none = await newStudent(a, "rv-none");
    expect(await card(a, none.cookie)).toMatchObject({ label: "Revision", availability: "not_applicable", note, completionKinds: null });
    expect((await call(a, "POST", "/v1/training/sessions", none.cookie, { systemId: "revision", config: FIVE })).status).toBe(409);

    const recent = await newStudent(a, "rv-recent");
    await answer(a, recent.cookie, ["H1", "H2", "H3"]); // just now
    expect((await card(a, recent.cookie)).availability).toBe("not_applicable");

    const two = await dormantStudent("rv-two", 30, ["H1", "H2"]);
    expect((await card(a, two.cookie)).availability).toBe("not_applicable");

    const skipper = await newStudent(a, "rv-skip");
    const skipped: string[] = [];
    for (const key of ["H1", "H2", "H3"]) {
      const started = await call(a, "POST", "/v1/attempts", skipper.cookie, { questionId: idOf(key) });
      await call(a, "POST", `/v1/attempts/${started.json.attemptId}/skip`, skipper.cookie, { questionId: idOf(key) });
      skipped.push(started.json.attemptId);
    }
    await backdate(skipped, 30 * DAY_MS);
    expect((await card(a, skipper.cookie)).availability).toBe("not_applicable"); // skips are never graded attempts
  });

  it("the 14-day boundary on persisted times: a minute short is not available, a minute past is; correctness never matters", async () => {
    const short = await dormantStudent("rv-short", 14 - 1 / 1440);
    expect((await card(a, short.cookie)).availability).toBe("not_applicable");
    const past = await dormantStudent("rv-past", 14 + 1 / 1440);
    expect(await card(a, past.cookie)).toMatchObject({ availability: "available", note: "Ready to train." });
    const wrong = await dormantStudent("rv-wrong", 20, ["H1", "H2", "H3"], false);
    expect((await card(a, wrong.cookie)).availability).toBe("available");
  });

  it("lifecycle across two instances: longest-dormant concept first, then the next concept, then nothing; ordinary attempts; no stage; ownership; no leakage", async () => {
    const s = await newStudent(a, "rv-life");
    const other = await newStudent(b, "rv-oth");
    await backdate(await answer(a, s.cookie, ["H1", "H2", "H3"]), 40 * DAY_MS); // Percentages: older
    await backdate(await answer(a, s.cookie, ["T1", "T2", "T3"]), 20 * DAY_MS); // Ratio: newer, still dormant
    expect(await card(a, s.cookie)).toMatchObject({ availability: "available", note: "Ready to train." });

    const started = await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "revision", config: FIVE });
    expect(started.status).toBe(200);
    const session = started.json.session as Json;
    expect(session).toMatchObject({ systemTitle: "Revision", dimension: "revision", stage: null, status: "active", objective: { targetConceptName: null } });
    expect(session.objective.statement).toBe("Revisit a concept you have practiced before but not attempted for a while. This session is revisiting a concept you have not practiced for a while.");
    const row = await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(JSON.stringify([row.objective, row.config])).not.toMatch(/stage|dormant|dormancy|forgot|14 day|14-day/i);

    const served: string[] = [];
    const raws: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const instance = i % 2 === 0 ? a : b;
      const next = await call(instance, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
      expect(next.status).toBe(200);
      expect(next.json.status).toBe("question");
      expect(next.json.session.stage).toBeNull();
      raws.push(next.raw);
      if (i === 0) {
        expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {})).json.attemptId).toBe(next.json.attemptId);
        expect((await call(b, "GET", `/v1/training/sessions/${session.sessionId}`, other.cookie)).status).toBe(403);
        expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, other.cookie, {})).status).toBe(403);
      }
      served.push(keyOf(next.json.question.questionId));
      expect((await call(instance, "POST", `/v1/attempts/${next.json.attemptId}/submit`, s.cookie, { questionId: next.json.question.questionId, chosenAnswer: i === 0 ? CORRECT : WRONG })).json).toMatchObject({ status: "submitted" });
    }
    expect(served).toEqual(["R1", "U1"]); // Percentages (dormant 40 days) first, then Ratio (20 days); each the unseen surface, lowest id

    // both concepts were revised, so nothing is dormant any more: the provider's own evidence ends the session's supply
    const end = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(end.json).toMatchObject({ status: "no_question", message: "That concept has now been revisited, and no other concept is waiting for a revisit right now. You can end the session.", session: { status: "active", stage: null } });
    const done = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/finish`, s.cookie, {});
    expect(done.json).toMatchObject({ status: "completed", stage: null, summary: { submittedCount: 2, correctCount: 1, incorrectCount: 1 } });
    expect((await card(a, s.cookie)).availability).toBe("not_applicable"); // the revision attempts are ordinary evidence: both concepts are recent now

    for (const text of [...raws, JSON.stringify(done.json), (await call(a, "GET", "/v1/training/systems", s.cookie)).raw]) {
      for (const secret of ["revision-training", "providerId", "diagnostics", "\"requirement\"", "dormant", "dormancy", "finalizedAt", "gradedAttempt", ...cellIds, "correctAnswer", "groundTruth"]) expect(text, secret).not.toContain(secret);
      expect(text.toLowerCase()).not.toMatch(/forgot|forget|decay|confidence|struggle|weak at|you lack|stress|anxi/);
    }
    const rows = await a.prisma.attempt.findMany({ where: { practiceBlockId: row.practiceBlockId }, orderBy: { blockSequenceNumber: "asc" } });
    expect(rows.map((r) => [r.blockSequenceNumber, r.status])).toEqual([[1, "submitted"], [2, "submitted"]]);
  });

  it("an unpublished question is never served: with R1 and R2 withheld the first is R3", async () => {
    const s = await dormantStudent("rv-content");
    await setPublished(a.prisma, ["R1", "R2"], false);
    try {
      const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "revision", config: TWO })).json as { session: Json };
      const first = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
      expect(keyOf(first.json.question.questionId)).toBe("R3");
    } finally {
      await setPublished(a.prisma, ["R1", "R2"], true);
    }
  });

  it("repeat the concept, vary the surface: unseen cells first (R4 shares R3's cell and waits), no repeat within the session, never the other concept", async () => {
    const s = await dormantStudent("rv-surface");
    await backdate(await answer(a, s.cookie, ["T1", "T2", "T3"]), 5 * DAY_MS); // Ratio is recent: never a target
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "revision", config: FIVE })).json as { session: Json };
    const served: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
      if (next.json.status !== "question") break;
      served.push(keyOf(next.json.question.questionId));
      await call(a, "POST", `/v1/attempts/${next.json.attemptId}/skip`, s.cookie, { questionId: next.json.question.questionId }); // a skip is not a graded attempt: the concept stays dormant
    }
    expect(served.slice(0, 3)).toEqual(["R1", "R2", "R3"]);
    expect(served.indexOf("R4")).toBeGreaterThan(served.indexOf("R3"));
    expect(new Set(served).size).toBe(served.length);
    for (const key of served) expect(["T1", "T2", "T3", "U1", "U2"]).not.toContain(key);
  });

  it("concurrency: 12 parallel starts make one session; 10 parallel next calls across two instances make one open attempt", async () => {
    const s = await dormantStudent("rv-race");
    const starts = await Promise.all(Array.from({ length: 12 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", "/v1/training/sessions", s.cookie, { systemId: "revision", config: FIVE })));
    expect(starts.map((r) => (r.status === 200 ? 200 : r.raw))).toEqual(Array(12).fill(200));
    expect(new Set(starts.map((r) => r.json.session.sessionId)).size).toBe(1);
    expect(starts.filter((r) => r.json.resumed === false)).toHaveLength(1);
    const sessionId = starts[0]!.json.session.sessionId as string;
    const nexts = await Promise.all(Array.from({ length: 10 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", `/v1/training/sessions/${sessionId}/next`, s.cookie, {})));
    expect(nexts.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(nexts.map((r) => r.json.attemptId)).size).toBe(1);
    const block = (await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })).practiceBlockId;
    expect(await a.prisma.attempt.count({ where: { practiceBlockId: block } })).toBe(1);
  });

  it("training attempts are ordinary attempts: ordinary evidence, no stored revision state, and no autopsy / repair / mastery row is written", async () => {
    const s = await dormantStudent("rv-ev");
    const counts = async () => ({ autopsies: await a.prisma.autopsy.count(), plans: await a.prisma.repairPlan.count(), mastery: await a.prisma.masteryState.count() });
    const before = await counts();
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "revision", config: TWO })).json as { session: Json };
    const q = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    await call(a, "POST", `/v1/attempts/${q.json.attemptId}/skip`, s.cookie, { questionId: q.json.question.questionId });
    const evidence = await call(a, "GET", `/v1/attempts/${q.json.attemptId}/evidence`, s.cookie);
    expect(evidence.status).toBe(200);
    expect(evidence.json.facts.verdict).toBe("not_graded");
    expect(await counts()).toEqual(before);
    const columns = await a.prisma.$queryRawUnsafe<Array<{ column_name: string }>>("select column_name from information_schema.columns where table_schema = 'public' and (table_name in ('training_sessions','attempts','practice_blocks','practice_sessions','enrollments') ) and (column_name ilike '%revision%' or column_name ilike '%dormant%' or column_name ilike '%due%')");
    expect(columns).toEqual([]); // nothing stores a revision flag, due date or state
  });
});
