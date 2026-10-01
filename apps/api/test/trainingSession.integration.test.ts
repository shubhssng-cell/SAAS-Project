import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createPrismaClient } from "@ipmat/db";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createPrismaDependencies } from "../src/wiring.js";

/**
 * Phase 5 Unit 1 -- REAL DATABASE tests of Training Sessions, through the real HTTP server on the real Prisma repositories.
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (same opt-in and "database name must contain test" guard as the Phase 2 Unit 7
 * suite). Prerequisite: a reachable Postgres whose configured database name contains "test" (the suite migrates and seeds its own copy).
 *
 * ISOLATION: the suite creates its OWN throwaway database (name derived from the configured one, so it still contains "test"),
 * applies the migrations and the seed to it, and drops it afterwards -- it never publishes anything into the shared test database,
 * whose other suites assume exactly the seeded published set and run in parallel with this one.
 *
 * The suite inserts a fixed set of QA-only published questions (clones of the seeded demonstration question, each with the
 * seeded provenance row, so the published-requires-provenance CHECK is satisfied) shaped so Novelty Training applies after
 * 9 ordinary answers. They are upserted with fixed ids, so repeated runs do not grow the pool. This is a test fixture for a
 * DISPOSABLE test database -- it is not content and is never created by the seed or by any application code path.
 *
 * "Two instances" = two independent PrismaClients + independently constructed servers sharing nothing but the database --
 * exactly what a process restart or a second deployed instance looks like.
 */

const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
  }
}

const DEMO_QUESTION = "00000000-0000-0000-0000-000000000002";
const DEMO_CORRECT = "20,000";
const DEMO_WRONG = "16,000";
const qaId = (n: number): string => `00000000-0000-0000-0000-00000000b0${String(n).padStart(2, "0")}`;
const HISTORY: Array<{ id: string; level: "standard" | "novel_representation" | "novel_context" }> = [];
const NOVEL_IDS: string[] = [];
for (let i = 0; i < 9; i += 1) HISTORY.push({ id: qaId(i + 1), level: (["standard", "novel_representation", "novel_context"] as const)[Math.floor(i / 3)]! });
for (let i = 0; i < 4; i += 1) NOVEL_IDS.push(qaId(20 + i));

interface Instance {
  prisma: PrismaClient;
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}

let dbUrl = "";
let dbName = "";

async function createIsolatedDatabase(): Promise<void> {
  const base = new URL(DATABASE_URL!);
  dbName = `${base.pathname.replace(/^\//, "")}_train_${randomUUID().slice(0, 8)}`;
  const admin = createPrismaClient(DATABASE_URL!);
  await admin.$connect();
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await admin.$disconnect();
  const target = new URL(DATABASE_URL!);
  target.pathname = `/${dbName}`;
  dbUrl = target.toString();
  const dbPackage = fileURLToPath(new URL("../../../packages/db", import.meta.url));
  const env = { ...process.env, DATABASE_URL: dbUrl };
  execSync("npx prisma migrate deploy", { cwd: dbPackage, env, stdio: "ignore" });
  execSync("npx tsx prisma/seed.ts", { cwd: dbPackage, env, stdio: "ignore" });
}

async function dropIsolatedDatabase(): Promise<void> {
  if (!dbName) return;
  const admin = createPrismaClient(DATABASE_URL!);
  await admin.$connect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.$disconnect();
}

async function startInstance(): Promise<Instance> {
  const prisma = createPrismaClient(dbUrl);
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

async function call(instance: Instance, method: string, path: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; raw: string; setCookie: string | null }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${instance.baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const raw = await res.text();
  return { status: res.status, json: JSON.parse(raw) as Record<string, unknown>, raw, setCookie: res.headers.get("set-cookie") };
}

async function newStudent(instance: Instance, label: string): Promise<{ cookie: string; studentId: string }> {
  const signup = await call(instance, "POST", "/v1/auth/signup", undefined, { email: `${label}-${randomUUID()}@example.com`, password: "correct-horse" });
  const cookie = (signup.setCookie ?? "").split(";")[0] ?? "";
  await call(instance, "POST", "/v1/onboarding/complete", cookie);
  expect((await call(instance, "POST", "/v1/enrollment", cookie)).status).toBe(200);
  return { cookie, studentId: (signup.json.student as { id: string }).id };
}

/** Ordinary (ungrouped) practice on the 9 history questions, so Novelty Training applies. */
async function seedHistory(instance: Instance, cookie: string): Promise<void> {
  for (const { id } of HISTORY) {
    const started = await call(instance, "POST", "/v1/attempts", cookie, { questionId: id });
    expect(started.status).toBe(200);
    const submitted = await call(instance, "POST", `/v1/attempts/${started.json.attemptId as string}/submit`, cookie, { questionId: id, chosenAnswer: DEMO_CORRECT });
    expect(submitted.status).toBe(200);
  }
}

async function ensureQaQuestions(prisma: PrismaClient): Promise<void> {
  const demo = await prisma.question.findUniqueOrThrow({ where: { id: DEMO_QUESTION } });
  expect(demo.validationState).toBe("published");
  const clone = (id: string, noveltyLevel: "standard" | "novel_representation" | "novel_context" | "novel_combination") => {
    const rest: Record<string, unknown> = { ...demo };
    delete rest.id;
    delete rest.createdAt;
    return { where: { id }, update: {}, create: { ...(rest as Omit<typeof demo, "id" | "createdAt">), id, noveltyLevel, body: `QA training fixture ${id}`, options: demo.options as object, difficultyDimensions: demo.difficultyDimensions as object, solutionSteps: demo.solutionSteps as object, groundTruthDerivation: demo.groundTruthDerivation as object } };
  };
  for (const h of HISTORY) await prisma.question.upsert(clone(h.id, h.level));
  for (const id of NOVEL_IDS) await prisma.question.upsert(clone(id, "novel_combination"));
}

const FIVE = { completion: { kind: "fixed_question_count", questionCount: 5 } };
const TWO = { completion: { kind: "fixed_question_count", questionCount: 2 } };

let a: Instance;
let b: Instance;

describe.skipIf(!DATABASE_URL)("Training sessions -- real Postgres (Phase 5 Unit 1)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    await createIsolatedDatabase();
    a = await startInstance();
    b = await startInstance();
    await ensureQaQuestions(a.prisma);
  }, 180_000); // creating + migrating + seeding a database can take a while under a loaded machine
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await dropIsolatedDatabase();
  }, 60_000);

  it("the database guarantees exist: training_sessions table, one-to-one block link, and one ACTIVE practice session per enrollment", async () => {
    const idx = await a.prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(`select indexdef from pg_indexes where indexname = 'practice_sessions_one_active_per_enrollment'`);
    expect(idx).toHaveLength(1);
    expect(idx[0]!.indexdef).toMatch(/UNIQUE/);
    expect(idx[0]!.indexdef).toMatch(/WHERE.*active/);
    const uniq = await a.prisma.$queryRawUnsafe<Array<{ indexname: string }>>(`select indexname from pg_indexes where tablename = 'training_sessions'`);
    expect(uniq.map((r) => r.indexname)).toContain("training_sessions_practice_block_id_key");
  });

  it("create -> restart -> reconstruct -> attempt -> persist normally -> reload -> continue -> complete", async () => {
    const s = await newStudent(a, "life");
    await seedHistory(a, s.cookie);

    const hub = await call(a, "GET", "/v1/training/systems", s.cookie);
    expect((hub.json.systems as Array<{ systemId: string; availability: string }>).find((x) => x.systemId === "novelty-training")?.availability).toBe("available");

    const started = await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TWO });
    expect(started.status).toBe(200);
    const session = started.json.session as { sessionId: string };

    // real rows: one training session on one active block under one active practice session
    const row = await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId }, include: { practiceBlock: { include: { practiceSession: true } } } });
    expect(row).toMatchObject({ systemId: "novelty-training" });
    expect(row.practiceBlock).toMatchObject({ status: "active", sequenceNumber: 1, targetQuestionCount: 2, blockTimeBudgetSeconds: null });
    expect(row.practiceBlock.practiceSession.status).toBe("active");
    expect((row.objective as { dimension: string }).dimension).toBe("novelty");

    // question on A; "restart" = instance B reconstructs the same session and the same open question
    const q1 = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(q1.status).toBe(200);
    expect(NOVEL_IDS).toContain((q1.json.question as { questionId: string }).questionId);
    // the options list legitimately contains every choice (the demo question is multiple choice); what must never appear is any answer-key field
    expect(q1.raw).not.toMatch(/correctAnswer|groundTruth|solutionSteps|requirement|diagnostics|providerId/);
    const viaB = await call(b, "GET", `/v1/training/sessions/${session.sessionId}`, s.cookie);
    expect(viaB.json).toMatchObject({ sessionId: session.sessionId, status: "active", progress: { hasOpenQuestion: true, completedQuestionCount: 0 } });
    const resumedOnB = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(resumedOnB.json.attemptId).toBe(q1.json.attemptId);

    // answered on B through the ORDINARY attempt route; the attempt is a normal persisted attempt inside the session's block
    const submitted = await call(b, "POST", `/v1/attempts/${q1.json.attemptId as string}/submit`, s.cookie, { questionId: (q1.json.question as { questionId: string }).questionId, chosenAnswer: DEMO_WRONG });
    expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: false, correctAnswer: DEMO_CORRECT });
    const attemptRow = await a.prisma.attempt.findUniqueOrThrow({ where: { id: q1.json.attemptId as string } });
    expect(attemptRow).toMatchObject({ studentId: s.studentId, status: "submitted", isCorrect: false, practiceBlockId: row.practiceBlockId, blockSequenceNumber: 1 });

    // evidence and the global recommendation still work with an active training block present (the composition reads it)
    expect((await call(a, "GET", `/v1/attempts/${q1.json.attemptId as string}/evidence`, s.cookie)).status).toBe(200);
    expect((await call(a, "POST", "/v1/recommendation", s.cookie)).status).toBe(200);

    const q2 = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(q2.json.status).toBe("question");
    expect((q2.json.question as { questionId: string }).questionId).not.toBe((q1.json.question as { questionId: string }).questionId); // never repeats within a session
    await call(a, "POST", `/v1/attempts/${q2.json.attemptId as string}/submit`, s.cookie, { questionId: (q2.json.question as { questionId: string }).questionId, chosenAnswer: DEMO_CORRECT });
    expect((await a.prisma.attempt.findUniqueOrThrow({ where: { id: q2.json.attemptId as string } })).blockSequenceNumber).toBe(2);

    const done = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(done.json).toMatchObject({ status: "completed", session: { status: "completed", progress: { completedQuestionCount: 2, submittedCount: 2 } } });
    expect((await a.prisma.practiceBlock.findUniqueOrThrow({ where: { id: row.practiceBlockId } })).status).toBe("completed");
    expect((await call(a, "GET", `/v1/training/sessions/${session.sessionId}`, s.cookie)).json).toMatchObject({ status: "completed" });
  });

  it("ownership: another student gets 403 on every route against the real database", async () => {
    const owner = await newStudent(a, "own");
    const other = await newStudent(b, "oth");
    await seedHistory(a, owner.cookie);
    const { session } = (await call(a, "POST", "/v1/training/sessions", owner.cookie, { systemId: "novelty-training", config: FIVE })).json as { session: { sessionId: string } };
    for (const [method, path] of [["GET", ""], ["POST", "/next"], ["POST", "/finish"]] as const) {
      expect((await call(b, method, `/v1/training/sessions/${session.sessionId}${path}`, other.cookie, method === "POST" ? {} : undefined)).status, `${method}${path}`).toBe(403);
    }
    expect((await call(a, "GET", "/v1/training/sessions/00000000-0000-0000-0000-00000000dead", owner.cookie)).status).toBe(404);
  });

  it("concurrency: 12 parallel starts across two instances create exactly one session, one block, one active practice session", async () => {
    const s = await newStudent(a, "race");
    await seedHistory(a, s.cookie);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: FIVE })));
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
    const ids = new Set(results.map((r) => (r.json.session as { sessionId: string }).sessionId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.json.resumed === false)).toHaveLength(1);

    const enrollment = await a.prisma.enrollment.findFirstOrThrow({ where: { studentId: s.studentId } });
    expect(await a.prisma.practiceSession.count({ where: { enrollmentId: enrollment.id, status: "active" } })).toBe(1);
    expect(await a.prisma.trainingSession.count({ where: { practiceBlock: { practiceSession: { enrollmentId: enrollment.id } } } })).toBe(1);
    expect(await a.prisma.practiceBlock.count({ where: { practiceSession: { enrollmentId: enrollment.id } } })).toBe(1);

    // a second active practice session for the same enrollment is rejected by the database itself
    await expect(a.prisma.practiceSession.create({ data: { enrollmentId: enrollment.id, startedAt: new Date() } })).rejects.toThrow();
  });

  it("concurrency: parallel next calls across two instances converge on one open question and one persisted attempt", async () => {
    const s = await newStudent(a, "nxt");
    await seedHistory(a, s.cookie);
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: FIVE })).json as { session: { sessionId: string } };
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {})));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(results.map((r) => r.json.attemptId)).size).toBe(1);
    const row = await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(await a.prisma.attempt.count({ where: { practiceBlockId: row.practiceBlockId } })).toBe(1);
  });

  it("a session cannot be ended while a question is open, and ending is final", async () => {
    const s = await newStudent(a, "fin");
    await seedHistory(a, s.cookie);
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: FIVE })).json as { session: { sessionId: string } };
    const q = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/finish`, s.cookie, {})).status).toBe(409);
    await call(a, "POST", `/v1/attempts/${q.json.attemptId as string}/skip`, s.cookie, { questionId: (q.json.question as { questionId: string }).questionId });
    expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/finish`, s.cookie, {})).json).toMatchObject({ status: "completed", progress: { skippedCount: 1 } });
    expect((await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {})).json.status).toBe("completed");
  });

  it("no training request writes autopsy, repair, or mastery rows", async () => {
    const s = await newStudent(a, "nowrite");
    await seedHistory(a, s.cookie);
    const counts = async () => ({ autopsies: await a.prisma.autopsy.count(), repairPlans: await a.prisma.repairPlan.count(), mastery: await a.prisma.masteryState.count() });
    const before = await counts();
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "novelty-training", config: TWO })).json as { session: { sessionId: string } };
    const q = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    await call(a, "GET", "/v1/training/systems", s.cookie);
    await call(a, "GET", `/v1/training/sessions/${session.sessionId}`, s.cookie);
    expect(q.status).toBe(200);
    expect(await counts()).toEqual(before);
  });
});
