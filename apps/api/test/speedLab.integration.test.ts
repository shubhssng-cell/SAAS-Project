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
 * Phase 5 Unit 3 -- Speed Lab on REAL POSTGRES, through the real HTTP server on the real Prisma repositories, with two independent API
 * instances (a restart / a second deployed instance as far as the database can tell).
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (same opt-in and "name must contain test" guard as the other integration suites).
 *
 * SYNTHETIC TEST DATA. The seed has three real questions, far too few to exercise three Speed Lab stages, and the provider's thresholds are NOT
 * weakened to make it appear. This suite builds its OWN throwaway database (migrate + seed), publishes a labelled pool into it (bodies start with
 * "[TEST DATA phase-5-unit-3]"; clones of the seeded demonstration question with different `conceptualLoad` / `testingModes`, each carrying the
 * seeded provenance row), and drops the database afterwards. "Slow" history cannot be produced by waiting, so after the student answers a history
 * question through the real HTTP path its attempt's server-recorded `time_spent_seconds` is set directly in this throwaway database -- the same
 * stored column the evidence reads. Nothing synthetic exists in the shared test database, the seed, or any application code path.
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
const TEST_DATA = "[TEST DATA phase-5-unit-3]";

interface Spec {
  key: string;
  conceptual: number;
  modes?: string[];
}
const SPECS: Spec[] = [
  ...["A1", "A2", "A3", "A4"].map((key) => ({ key, conceptual: 0.2 })),
  ...["S1", "S2", "S3", "S4", "S5"].map((key) => ({ key, conceptual: 0.2 })),
  { key: "SX", conceptual: 0.1, modes: ["time_pressured"] },
  ...["X1", "X2", "X3", "X4"].map((key) => ({ key, conceptual: 0.7 })),
  ...["T1", "T2", "T3"].map((key) => ({ key, conceptual: 0.3, modes: ["time_pressured"] }))
];
const idOf = (key: string): string => `00000000-0000-0000-0000-00000000d${String(SPECS.findIndex((s) => s.key === key) + 1).padStart(3, "0")}`;
const keyOf = (id: string): string => SPECS[Number(id.slice(-3)) - 1]!.key;
const STEADY_IDS = ["S1", "S2", "S3", "S4", "S5", "A1", "A2", "A3", "A4"].map(idOf);
const MIXED_IDS = ["X1", "X2", "X3", "X4"].map(idOf);
const TIMED_IDS = ["T1", "T2", "T3", "SX"].map(idOf);
const SLOW_HISTORY = ["A1", "A2", "A3", "A4"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
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

/** Answers history questions through the real HTTP path, then records how long each took (server-side column) as a multiple of the expected time. */
async function answerHistory(instance: Instance, student: { cookie: string; studentId: string }, keys: string[], correct: boolean, timeFactor: number): Promise<void> {
  for (const key of keys) {
    const questionId = idOf(key);
    const started = await call(instance, "POST", "/v1/attempts", student.cookie, { questionId });
    expect(started.status).toBe(200);
    expect((await call(instance, "POST", `/v1/attempts/${started.json.attemptId}/submit`, student.cookie, { questionId, chosenAnswer: correct ? CORRECT : WRONG })).status).toBe(200);
    const expected = (await instance.prisma.question.findUniqueOrThrow({ where: { id: questionId } })).expectedTimeSeconds;
    await instance.prisma.attempt.update({ where: { id: started.json.attemptId }, data: { timeSpentSeconds: Math.round(expected * timeFactor) } });
  }
}

async function publishSyntheticPool(prisma: PrismaClient): Promise<void> {
  const demo = await prisma.question.findUniqueOrThrow({ where: { id: DEMO_QUESTION } });
  for (const spec of SPECS) {
    const rest: Record<string, unknown> = { ...demo };
    delete rest.id;
    delete rest.createdAt;
    await prisma.question.create({
      data: {
        ...(rest as Omit<typeof demo, "id" | "createdAt">),
        id: idOf(spec.key),
        body: `${TEST_DATA} ${spec.key}`,
        options: demo.options as object,
        difficultyDimensions: { ...(demo.difficultyDimensions as object), conceptualLoad: spec.conceptual },
        testingModes: (spec.modes ?? ["direct"]) as never,
        solutionSteps: demo.solutionSteps as object,
        groundTruthDerivation: demo.groundTruthDerivation as object
      }
    });
  }
}

const TEN = { completion: { kind: "fixed_question_count", questionCount: 10 } };
const TWO = { completion: { kind: "fixed_question_count", questionCount: 2 } };

let a: Instance;
let b: Instance;
let seededPublishedBefore: string[] = [];

/** Serves the next question and answers it correctly and immediately (a good-pace answer), on the given instance. */
async function serveAndAnswer(instance: Instance, cookie: string, sessionId: string): Promise<Json> {
  const next = await call(instance, "POST", `/v1/training/sessions/${sessionId}/next`, cookie, {});
  expect(next.status).toBe(200);
  expect(next.json.status).toBe("question");
  expect((await call(instance, "POST", `/v1/attempts/${next.json.attemptId}/submit`, cookie, { questionId: next.json.question.questionId, chosenAnswer: CORRECT })).status).toBe(200);
  return next.json;
}

describe.skipIf(!DATABASE_URL)("Speed Lab -- real Postgres, synthetic TEST DATA pool (Phase 5 Unit 3)", { timeout: 240_000 }, () => {
  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, "speed");
    a = await startInstance();
    b = await startInstance();
    seededPublishedBefore = (await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } })).map((q) => q.id).sort();
    await publishSyntheticPool(a.prisma);
    // Inside this THROWAWAY database only: take the seeded real questions out of the pool so the labelled synthetic pool alone defines what Speed Lab can serve.
    await a.prisma.question.updateMany({ where: { validationState: "published", NOT: { body: { startsWith: TEST_DATA } } }, data: { validationState: "human_reviewed" } });
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await isolated?.drop();
  }, 60_000);

  it("the real seeded published set is what the seed made; the synthetic pool is labelled TEST DATA and lives only in this throwaway database", async () => {
    expect(seededPublishedBefore).toContain(DEMO_QUESTION);
    expect(await a.prisma.question.count({ where: { validationState: "published", body: { startsWith: TEST_DATA } } })).toBe(SPECS.length);
    // the seeded real questions are exactly what the seed made (they were published before; here they are withheld from the pool, never altered otherwise)
    const real = await a.prisma.question.findMany({ where: { NOT: { body: { startsWith: TEST_DATA } } }, select: { id: true } });
    expect(real.map((q) => q.id).sort()).toEqual(seededPublishedBefore);
    const shared = createPrismaClient(DATABASE_URL!);
    await shared.$connect();
    const table = await shared.$queryRawUnsafe<Array<{ t: string | null }>>("select to_regclass('public.questions')::text as t");
    if (table[0]?.t) expect(await shared.question.count({ where: { body: { startsWith: TEST_DATA } } })).toBe(0);
    await shared.$disconnect();
  });

  it("not applicable: no evidence, fast, wrong-and-slow, or too few attempts never activate Speed Lab; the card gives its own explanation and a start is 409", async () => {
    const none = await newStudent(a, "sp-none");
    const card = ((await call(a, "GET", "/v1/training/systems", none.cookie)).json.systems as Json[]).find((x) => x.systemId === "speed-lab")!;
    expect(card).toMatchObject({ label: "Speed", availability: "not_applicable", note: "Needs several recorded answers on straightforward questions of the same concept first." });
    expect((await call(a, "POST", "/v1/training/sessions", none.cookie, { systemId: "speed-lab", config: TEN })).status).toBe(409);

    for (const [label, keys, correct, factor] of [["fast", SLOW_HISTORY, true, 0.5], ["wrongslow", SLOW_HISTORY, false, 2.5], ["few", SLOW_HISTORY.slice(0, 2), true, 2.5]] as Array<[string, string[], boolean, number]>) {
      const s = await newStudent(a, `sp-${label}`);
      await answerHistory(a, s, keys, correct, factor);
      const c = ((await call(a, "GET", "/v1/training/systems", s.cookie)).json.systems as Json[]).find((x) => x.systemId === "speed-lab")!;
      expect(c.availability, label).toBe("not_applicable");
      expect((await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "speed-lab", config: TEN })).status, label).toBe(409);
    }
  });

  it("objective -> stage 1 -> stage 2 -> stage 3 -> completion, across a restart, a second instance and ownership; no stage is stored", async () => {
    const s = await newStudent(a, "sp-life");
    const other = await newStudent(b, "sp-oth");
    await answerHistory(a, s, SLOW_HISTORY, true, 2.5);

    const hub = await call(a, "GET", "/v1/training/systems", s.cookie);
    expect((hub.json.systems as Json[]).find((x) => x.systemId === "speed-lab")?.availability).toBe("available");
    expect((hub.json.systems as Json[]).find((x) => x.systemId === "calculation-gym")?.availability).toBe("not_applicable"); // a separate system with its own evidence

    const started = await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "speed-lab", config: TEN });
    expect(started.status).toBe(200);
    const session = started.json.session as Json;
    expect(session).toMatchObject({ systemTitle: "Speed Lab", dimension: "speed", objective: { targetConceptName: "Percentages" }, stage: { key: "steady_pace", position: 1, total: 3 } });
    expect(session.objective.statement).toBe("Improve solving speed: working within the expected time on concepts you already answer correctly. Focus: Percentages.");
    const row = await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(JSON.stringify([row.objective, row.config])).not.toMatch(/stage|steady_pace|mixed_pace|time_constrained/);

    // stage 1: light, non-timed questions only; leakage; second instance parity; ownership
    const q1 = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(STEADY_IDS.map(keyOf)).toContain(keyOf(q1.json.question.questionId));
    expect(q1.json.stageTransition).toBeNull();
    expect(q1.raw).not.toMatch(/correctAnswer|groundTruth|solutionSteps|conceptualLoad|slowFraction|eligibleGradedCount|providerId|diagnostics|speedRatio/);
    const viaB = await call(b, "GET", `/v1/training/sessions/${session.sessionId}`, s.cookie);
    expect(viaB.json).toMatchObject({ stage: { key: "steady_pace" }, progress: { hasOpenQuestion: true } });
    expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {})).json.attemptId).toBe(q1.json.attemptId);
    expect((await call(b, "GET", `/v1/training/sessions/${session.sessionId}`, other.cookie)).status).toBe(403);
    expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, other.cookie, {})).status).toBe(403);

    // three immediate (good-pace) correct answers on stage-1 questions clear the steady gate
    expect((await call(b, "POST", `/v1/attempts/${q1.json.attemptId}/submit`, s.cookie, { questionId: q1.json.question.questionId, chosenAnswer: CORRECT })).json).toMatchObject({ status: "submitted", isCorrect: true });
    for (let i = 0; i < 2; i += 1) expect(STEADY_IDS.map(keyOf)).toContain(keyOf((await serveAndAnswer(i % 2 === 0 ? a : b, s.cookie, session.sessionId)).question.questionId));

    // stage 2: heavier, non-timed questions; announced; rebuilt identically by the other instance (nothing stored)
    const q4 = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(MIXED_IDS.map(keyOf)).toContain(keyOf(q4.json.question.questionId));
    expect(q4.json.stageTransition).toMatchObject({ direction: "forward", from: { key: "steady_pace" }, to: { key: "mixed_pace", label: "Stage 2 · Mixed pace" } });
    expect(JSON.stringify(q4.json.stageTransition)).not.toMatch(/ratio|threshold|1\.3|score/i);
    const q4b = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(q4b.json.attemptId).toBe(q4.json.attemptId);
    expect(q4b.json.stageTransition).toEqual(q4.json.stageTransition);
    await call(a, "POST", `/v1/attempts/${q4.json.attemptId}/submit`, s.cookie, { questionId: q4.json.question.questionId, chosenAnswer: CORRECT });
    for (let i = 0; i < 2; i += 1) expect(MIXED_IDS.map(keyOf)).toContain(keyOf((await serveAndAnswer(a, s.cookie, session.sessionId)).question.questionId));

    // stage 3: only questions that carry the time-pressured testing mode
    const q7 = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(TIMED_IDS.map(keyOf)).toContain(keyOf(q7.json.question.questionId));
    expect(q7.json.stageTransition).toMatchObject({ direction: "forward", from: { key: "mixed_pace" }, to: { key: "time_constrained", label: "Stage 3 · Time-constrained" } });
    expect(q7.json.session.stage.key).toBe("time_constrained");
    await call(b, "POST", `/v1/attempts/${q7.json.attemptId}/submit`, s.cookie, { questionId: q7.json.question.questionId, chosenAnswer: WRONG });

    // end the session (explicit, nothing open) and read the observable summary; the rows are ordinary attempts in order
    const done = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/finish`, s.cookie, {});
    expect(done.json).toMatchObject({ status: "completed", summary: { submittedCount: 7, skippedCount: 0, correctCount: 6, incorrectCount: 1 }, stage: { key: "time_constrained" } });
    expect(JSON.stringify(done.json).toLowerCase()).not.toMatch(/mastery|improved|weakness|confidence|score|slow solver/);
    const block = (await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } })).practiceBlockId;
    const rows = await a.prisma.attempt.findMany({ where: { practiceBlockId: block }, orderBy: { blockSequenceNumber: "asc" } });
    expect(rows.map((r) => [r.status, r.blockSequenceNumber])).toEqual(Array.from({ length: 7 }, (_, i) => ["submitted", i + 1]));
    expect(rows.map((r) => keyOf(r.questionId)).slice(3, 6).every((k) => k.startsWith("X"))).toBe(true);
    expect(rows.every((r) => r.timeSpentSeconds !== null && r.timeSpentSeconds < 30)).toBe(true); // the server measured these; no client duration exists
  });

  it("concurrency: 12 parallel starts make one session; 10 parallel next calls across two instances make one open attempt", async () => {
    const s = await newStudent(a, "sp-race");
    await answerHistory(a, s, SLOW_HISTORY, true, 2.5);
    const starts = await Promise.all(Array.from({ length: 12 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", "/v1/training/sessions", s.cookie, { systemId: "speed-lab", config: TEN })));
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
    const s = await newStudent(a, "sp-ev");
    await answerHistory(a, s, SLOW_HISTORY, true, 2.5);
    const counts = async () => ({ autopsies: await a.prisma.autopsy.count(), plans: await a.prisma.repairPlan.count(), mastery: await a.prisma.masteryState.count() });
    const before = await counts();
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "speed-lab", config: TWO })).json as { session: Json };
    const q = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    await call(a, "POST", `/v1/attempts/${q.json.attemptId}/skip`, s.cookie, { questionId: q.json.question.questionId });
    const evidence = await call(a, "GET", `/v1/attempts/${q.json.attemptId}/evidence`, s.cookie);
    expect(evidence.status).toBe(200);
    expect(evidence.json.facts.verdict).toBe("not_graded");
    expect(evidence.json.history.priorAttempts).toBe(SLOW_HISTORY.length);
    expect(await counts()).toEqual(before);
  });

  it("when no question qualifies for the student's stage the card says so and a start is refused -- nothing else is served as Speed Lab", async () => {
    const s = await newStudent(a, "sp-short");
    await answerHistory(a, s, SLOW_HISTORY, true, 2.5);
    await answerHistory(a, s, ["S1", "S2", "S3"], true, 0.3); // steady gate cleared => stage 2
    await a.prisma.question.updateMany({ where: { id: { in: MIXED_IDS } }, data: { validationState: "human_reviewed" } });
    try {
      const card = ((await call(a, "GET", "/v1/training/systems", s.cookie)).json.systems as Json[]).find((x) => x.systemId === "speed-lab")!;
      expect(card.availability).toBe("no_eligible_question");
      expect((await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "speed-lab", config: TEN })).status).toBe(409);
    } finally {
      await a.prisma.question.updateMany({ where: { id: { in: MIXED_IDS } }, data: { validationState: "published" } });
    }
  });
});
