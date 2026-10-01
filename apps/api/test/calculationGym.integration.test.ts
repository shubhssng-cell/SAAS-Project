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
 * Phase 5 Unit 2 -- Calculation Gym on REAL POSTGRES, through the real HTTP server on the real Prisma repositories, with two independent
 * API instances (a restart / a second deployed instance as far as the database can tell).
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (same opt-in and "name must contain test" guard as the other integration suites).
 *
 * SYNTHETIC TEST DATA. The seeded content is three real questions -- far too few to exercise three calculation stages, and Calculation Gym's
 * thresholds are NOT weakened to make it appear. This suite therefore builds its OWN throwaway database (migrate + seed), publishes a
 * clearly labelled synthetic pool into it (bodies start with "[TEST DATA phase-5-unit-2]"; clones of the seeded demonstration question with
 * different `computationalLoad` / `testingModes`, each carrying the seeded provenance row so the published-requires-provenance CHECK holds), and
 * drops the database afterwards. Nothing synthetic is ever created in the shared test database, by the seed, or by any application code path.
 * It verifies up front that the real seeded published set is exactly what the seed made.
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
const TEST_DATA = "[TEST DATA phase-5-unit-2]";

// Responses are untyped JSON read through the real HTTP boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

interface Spec {
  key: string;
  load: number;
  modes?: string[];
}
const SPECS: Spec[] = [
  ...["L1", "L2", "L3"].map((key) => ({ key, load: 0.2 })),
  ...["H1", "H2", "H3"].map((key) => ({ key, load: 0.8 })),
  ...["F1", "F2", "F3", "F4"].map((key) => ({ key, load: 0.2 })),
  { key: "Fm", load: 0.1, modes: ["multi_step"] },
  ...["M1", "M2", "M3", "M4", "M5"].map((key) => ({ key, load: 0.8 })),
  ...["TP1", "TP2", "TP3"].map((key) => ({ key, load: 0.9, modes: ["time_pressured"] }))
];
const idOf = (key: string): string => `00000000-0000-0000-0000-00000000c${String(SPECS.findIndex((s) => s.key === key) + 1).padStart(3, "0")}`;
const keyOf = (id: string): string => SPECS[Number(id.slice(-3)) - 1]!.key;
const MIXED_SET = ["M1", "M2", "M3", "M4", "M5"].map(idOf);
const TP_SET = ["TP1", "TP2", "TP3"].map(idOf);
// low 3/3 cleared; heavy H1 H2 right, H3 wrong (2/3): friction (gap .33), stage 2 (mixed); one more right heavy answer => 3/4 clears stage 3.
const MIXED_HISTORY: Array<[string, boolean]> = [["L1", true], ["L2", true], ["L3", true], ["H1", true], ["H2", true], ["H3", false]];

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

async function answerHistory(instance: Instance, cookie: string, plan: Array<[string, boolean]>): Promise<void> {
  for (const [key, correct] of plan) {
    const questionId = idOf(key);
    const started = await call(instance, "POST", "/v1/attempts", cookie, { questionId });
    expect(started.status).toBe(200);
    expect((await call(instance, "POST", `/v1/attempts/${started.json.attemptId}/submit`, cookie, { questionId, chosenAnswer: correct ? CORRECT : WRONG })).status).toBe(200);
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
        difficultyDimensions: { ...(demo.difficultyDimensions as object), computationalLoad: spec.load },
        testingModes: (spec.modes ?? ["direct"]) as never,
        solutionSteps: demo.solutionSteps as object,
        groundTruthDerivation: demo.groundTruthDerivation as object
      }
    });
  }
}

const FIVE = { completion: { kind: "fixed_question_count", questionCount: 5 } };
const TWO = { completion: { kind: "fixed_question_count", questionCount: 2 } };

let a: Instance;
let b: Instance;
let seededPublishedBefore: string[] = [];

describe.skipIf(!DATABASE_URL)("Calculation Gym -- real Postgres, synthetic TEST DATA pool (Phase 5 Unit 2)", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, "calc");
    a = await startInstance();
    b = await startInstance();
    seededPublishedBefore = (await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } })).map((q) => q.id).sort();
    await publishSyntheticPool(a.prisma);
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await isolated?.drop();
  }, 60_000);

  it("the real seeded published set is what the seed made, and the synthetic pool is labelled TEST DATA and lives only in this throwaway database", async () => {
    expect(seededPublishedBefore).toContain(DEMO_QUESTION);
    expect(seededPublishedBefore.length).toBeGreaterThanOrEqual(3);
    const synthetic = await a.prisma.question.findMany({ where: { validationState: "published", body: { startsWith: TEST_DATA } } });
    expect(synthetic).toHaveLength(SPECS.length);
    const real = await a.prisma.question.findMany({ where: { validationState: "published", NOT: { body: { startsWith: TEST_DATA } } }, select: { id: true } });
    expect(real.map((q) => q.id).sort()).toEqual(seededPublishedBefore);
    // the shared test database was never touched by this suite
    const shared = createPrismaClient(DATABASE_URL!);
    await shared.$connect();
    const table = await shared.$queryRawUnsafe<Array<{ t: string | null }>>("select to_regclass('public.questions')::text as t");
    if (table[0]?.t) expect(await shared.question.count({ where: { body: { startsWith: TEST_DATA } } })).toBe(0); // (an unmigrated shared database trivially has none)
    await shared.$disconnect();
  });

  it("a student with no evidence sees Calculation honestly unavailable, with its own explanation, and cannot start it", async () => {
    const s = await newStudent(a, "calc-none");
    const hub = await call(a, "GET", "/v1/training/systems", s.cookie);
    const card = (hub.json.systems as Array<Record<string, string>>).find((x) => x.systemId === "calculation-gym")!;
    expect(card).toMatchObject({ label: "Calculation", availability: "not_applicable", note: "Needs recorded answers on both lighter and heavier-arithmetic questions of the same concept first." });
    expect((await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "calculation-gym", config: FIVE })).status).toBe(409);
  });

  it("objective -> stage -> question -> answer -> a stage change -> completion, across a restart, a second instance and ownership", async () => {
    const s = await newStudent(a, "calc-life");
    const other = await newStudent(b, "calc-oth");
    await answerHistory(a, s.cookie, MIXED_HISTORY);

    const hub = await call(a, "GET", "/v1/training/systems", s.cookie);
    expect((hub.json.systems as Array<Record<string, string>>).find((x) => x.systemId === "calculation-gym")?.availability).toBe("available");

    const started = await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "calculation-gym", config: TWO });
    expect(started.status).toBe(200);
    const session = started.json.session as Json;
    expect(session).toMatchObject({ systemTitle: "Calculation Gym", dimension: "calculation", objective: { targetConceptName: "Percentages" }, stage: { key: "mixed", position: 2, total: 3 } });
    expect(session.objective.statement).toBe("Deliberate calculation practice: accuracy on questions that need heavier arithmetic. Focus: Percentages.");

    // the persisted session holds the objective and the configuration -- and NO stage (derived, never stored)
    const row = await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(JSON.stringify([row.objective, row.config])).not.toMatch(/stage|mixed|foundational|time_pressured/);

    // stage-2 question
    const q1 = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(q1.status).toBe(200);
    expect(MIXED_SET).toContain(q1.json.question.questionId);
    expect(q1.json.stageTransition).toBeNull();
    expect(q1.raw).not.toMatch(/correctAnswer|groundTruth|solutionSteps|computationalLoad|frictionDetected|providerId|diagnostics/);

    // a second instance reconstructs the same stage and resumes the same open question; another student is refused
    const viaB = await call(b, "GET", `/v1/training/sessions/${session.sessionId}`, s.cookie);
    expect(viaB.json).toMatchObject({ stage: { key: "mixed" }, progress: { hasOpenQuestion: true } });
    expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {})).json.attemptId).toBe(q1.json.attemptId);
    expect((await call(b, "GET", `/v1/training/sessions/${session.sessionId}`, other.cookie)).status).toBe(403);
    expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, other.cookie, {})).status).toBe(403);

    // a correct heavy answer: 3/4 on the stage-2 shape => the real progression gate is met
    const submitted = await call(b, "POST", `/v1/attempts/${q1.json.attemptId}/submit`, s.cookie, { questionId: q1.json.question.questionId, chosenAnswer: CORRECT });
    expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: true });
    expect((await a.prisma.attempt.findUniqueOrThrow({ where: { id: q1.json.attemptId } })).blockSequenceNumber).toBe(1);

    const q2 = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(TP_SET).toContain(q2.json.question.questionId); // stage 3 serves only timed heavy questions
    expect(q2.json.stageTransition).toMatchObject({ direction: "forward", from: { key: "mixed" }, to: { key: "time_pressured", label: "Stage 3 · Under time pressure" } });
    expect(q2.json.session.stage.key).toBe("time_pressured");
    expect(q2.json.question.questionId).not.toBe(q1.json.question.questionId);

    // the stage change is reconstructed identically by the other instance (nothing stored)
    const q2again = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(q2again.json.attemptId).toBe(q2.json.attemptId);
    expect(q2again.json.stageTransition).toEqual(q2.json.stageTransition);

    await call(a, "POST", `/v1/attempts/${q2.json.attemptId}/submit`, s.cookie, { questionId: q2.json.question.questionId, chosenAnswer: WRONG });
    const done = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(done.json).toMatchObject({
      status: "completed",
      session: { status: "completed", summary: { submittedCount: 2, skippedCount: 0, correctCount: 1, incorrectCount: 1 }, stage: { key: "time_pressured" } }
    });
    expect(done.json.session.summary.totalTimeSeconds).toBeGreaterThanOrEqual(0);
    expect(done.json.session.summary.expectedTimeSeconds).toBe(180);
    expect(JSON.stringify(done.json).toLowerCase()).not.toMatch(/mastery|improv|weakness|confidence|score/);

    // ordinary attempts: the finalized rows are plain attempts in the block, nothing calculation-specific
    const block = (await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } })).practiceBlockId;
    const rows = await a.prisma.attempt.findMany({ where: { practiceBlockId: block }, orderBy: { blockSequenceNumber: "asc" } });
    expect(rows.map((r) => [r.status, r.isCorrect, r.blockSequenceNumber])).toEqual([["submitted", true, 1], ["submitted", false, 2]]);
    expect(keyOf(rows[0]!.questionId)).toMatch(/^(M[1-5])$/);
  });

  it("stage 1 serves only lighter single-step questions", async () => {
    const s = await newStudent(a, "calc-s1");
    await answerHistory(a, s.cookie, [["L1", true], ["L2", true], ["L3", false], ["H1", false], ["H2", false], ["H3", false]]);
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "calculation-gym", config: FIVE })).json as { session: Json };
    expect(session.stage.key).toBe("foundational");
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const next = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
      expect(next.json.status).toBe("question");
      seen.push(keyOf(next.json.question.questionId));
      await call(a, "POST", `/v1/attempts/${next.json.attemptId}/submit`, s.cookie, { questionId: next.json.question.questionId, chosenAnswer: WRONG });
    }
    for (const key of seen) expect(["L1", "L2", "L3", "F1", "F2", "F3", "F4"], key).toContain(key); // never Fm (multi-step), heavy or timed
    expect(new Set(seen).size).toBe(seen.length); // no repeats within the session
  });

  it("concurrency: 12 parallel starts make one session; 10 parallel next calls across two instances make one open attempt", async () => {
    const s = await newStudent(a, "calc-race");
    await answerHistory(a, s.cookie, MIXED_HISTORY);
    const starts = await Promise.all(Array.from({ length: 12 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", "/v1/training/sessions", s.cookie, { systemId: "calculation-gym", config: FIVE })));
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

  it("training attempts are ordinary attempts: they appear in the student's evidence, and write no autopsy / repair / mastery row", async () => {
    const s = await newStudent(a, "calc-ev");
    await answerHistory(a, s.cookie, MIXED_HISTORY);
    const counts = async () => ({ autopsies: await a.prisma.autopsy.count(), plans: await a.prisma.repairPlan.count(), mastery: await a.prisma.masteryState.count() });
    const before = await counts();
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "calculation-gym", config: TWO })).json as { session: Json };
    const q = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    await call(a, "POST", `/v1/attempts/${q.json.attemptId}/skip`, s.cookie, { questionId: q.json.question.questionId });
    const evidence = await call(a, "GET", `/v1/attempts/${q.json.attemptId}/evidence`, s.cookie);
    expect(evidence.status).toBe(200);
    expect(evidence.json.facts.verdict).toBe("not_graded");
    expect(evidence.json.history.priorAttempts).toBe(MIXED_HISTORY.length);
    expect(await counts()).toEqual(before);
  });

  it("when no question qualifies for the student's stage the card says so and a start is refused -- nothing else is served as Calculation", async () => {
    const s = await newStudent(a, "calc-short");
    await answerHistory(a, s.cookie, MIXED_HISTORY);
    // The catalogue changes under the student's real evidence: every heavy question is now a timed one and the unattempted stage-2 ones are withdrawn.
    await a.prisma.question.updateMany({ where: { id: { in: ["H1", "H2", "H3"].map(idOf) } }, data: { testingModes: ["time_pressured"] } });
    await a.prisma.question.updateMany({ where: { id: { in: MIXED_SET } }, data: { validationState: "human_reviewed" } });
    try {
      const card = ((await call(a, "GET", "/v1/training/systems", s.cookie)).json.systems as Array<Record<string, string>>).find((x) => x.systemId === "calculation-gym")!;
      expect(card.availability).toBe("no_eligible_question");
      expect((await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "calculation-gym", config: FIVE })).status).toBe(409);
    } finally {
      await a.prisma.question.updateMany({ where: { id: { in: ["H1", "H2", "H3"].map(idOf) } }, data: { testingModes: ["direct"] } });
      await a.prisma.question.updateMany({ where: { id: { in: MIXED_SET } }, data: { validationState: "published" } });
    }
  });
});
