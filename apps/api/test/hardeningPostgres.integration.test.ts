import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createAssistantServices, ExamPackTutorConceptPort } from "@ipmat/assistant-api";
import { createPrismaClient, PrismaExamPackRepository, PrismaOrchestrationAuditStore, PrismaPreferenceStore, PrismaSimulationEnrollmentReader, PrismaSimulationQuestionSource, PrismaSimulationRepository, PrismaTutorAttemptPort, PrismaTutorOwnershipPort, PrismaTutorQuestionPort } from "@ipmat/db";
import { SimulationService, type SimulationDefinition } from "@ipmat/exam-simulation";
import { createLogger, createMetrics, createRateLimiter } from "@ipmat/observability";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/hardening.js";
import { observeProvider } from "../src/providerObservability.js";
import { createServer } from "../src/server.js";
import { createPrismaDependencies } from "../src/wiring.js";
import { PROVIDER_SECRET, ScriptedProvider } from "./assistantFixtures.js";

/**
 * REAL DATABASE reliability and isolation tests for Phase 9 Unit 3 (docs/DECISIONS.md D-099): concurrency, idempotency, replay,
 * IDOR against Postgres rows, deleted resources, and the behaviour when the database is unreachable. The model is a deterministic
 * double. SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set; refuses any database whose name does not contain "test".
 * FIXTURE DATA: students are created through the real signup route and deleted afterwards; the seeded published questions are
 * only read; the simulation configuration is a labelled TEST fixture (no exam rule is specified in the repository).
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}
vi.setConfig({ testTimeout: 90_000 });

type Res = { status: number; json: Record<string, unknown>; raw: string; headers: Headers };

describe.skipIf(!DATABASE_URL)("hardening - real Postgres", () => {
  let prisma: PrismaClient;
  let base = "";
  let closeServer: () => Promise<void>;
  let questionIds: string[] = [];
  const provider = new ScriptedProvider();
  const studentIds: string[] = [];
  const createdExams: string[] = [];
  const logs: string[] = [];
  let sim: SimulationService;
  const options: Record<string, string[]> = {};
  /** A valid option of a seeded multiple-choice question (answers outside the options are rightly refused). */
  const opt = (qid: string, i = 0): string => options[qid]![i % options[qid]!.length]!;

  const call = async (url: string, method: string, path: string, body?: unknown, cookie?: string): Promise<Res> => {
    const res = await fetch(`${url}${path}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const raw = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* not json */
    }
    return { status: res.status, json, raw, headers: res.headers };
  };
  const api = (method: string, path: string, body?: unknown, cookie?: string) => call(base, method, path, body, cookie);

  async function student(url = base): Promise<{ cookie: string; studentId: string }> {
    const res = await fetch(`${url}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `p9u3-${randomUUID()}@example.com`, password: "correct-horse-battery-1" }) });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const studentId = ((await res.json()) as { student: { id: string } }).student.id;
    studentIds.push(studentId);
    await fetch(`${url}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
    await fetch(`${url}/v1/enrollment`, { method: "POST", headers: { cookie } });
    return { cookie, studentId };
  }

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    const rows = await prisma.question.findMany({ where: { validationState: "published", exam: { code: "IPMAT_INDORE" } }, orderBy: { id: "asc" }, select: { id: true, options: true, section: { select: { name: true } } } });
    questionIds = rows.map((r) => r.id);
    for (const r of rows) options[r.id] = (r.options as string[]).map(String);
    const sectionName = rows[0]!.section.name;
    const definition: SimulationDefinition = {
      config: { examCode: "IPMAT_INDORE", configVersion: "p9u3-fixture", overallDurationSeconds: 600, sections: [{ sectionName, order: 1, questionCount: 3 }], provenance: { kind: "authored", sourceRef: "fixture:p9u3-test-configuration (not an exam rule)", reviewState: "unvalidated", reviewedBy: null, note: "TEST DATA" } },
      selection: { origin: "assembled", sourceRef: "fixture:p9u3-test-paper", sections: { [sectionName]: questionIds.slice(0, 3) } }
    };
    sim = new SimulationService({ enrollments: new PrismaSimulationEnrollmentReader(prisma), configs: { findDefinition: async () => definition }, questions: new PrismaSimulationQuestionSource(prisma), repository: new PrismaSimulationRepository(prisma), now: () => new Date().toISOString(), newId: () => randomUUID() });
    const logger = createLogger({ sink: (l) => logs.push(l) });
    const metrics = createMetrics();
    const assistant = createAssistantServices({
      ownership: new PrismaTutorOwnershipPort(prisma),
      tutorPorts: { questions: new PrismaTutorQuestionPort(prisma), concepts: new ExamPackTutorConceptPort(new PrismaExamPackRepository(prisma)), attempts: new PrismaTutorAttemptPort(prisma) },
      provider: observeProvider(provider, { metrics, logger }),
      preferences: new PrismaPreferenceStore(prisma),
      audit: new PrismaOrchestrationAuditStore(prisma),
      simulation: sim,
      aiOptions: { timeoutMs: 20_000, maxRetries: 0 },
      metrics,
      logger
    });
    const runtime = createRuntime({ logger, metrics, limiter: createRateLimiter(), readiness: async () => { await prisma.$queryRaw`SELECT 1`; return true; } });
    const server = createServer({ ...createPrismaDependencies(prisma), hypothesisGenerator: null, hypothesisSealer: { seal: () => "x", open: () => null }, assistant, runtime });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
  });

  afterAll(async () => {
    await prisma.orchestrationAudit.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    for (const id of createdExams) await prisma.exam.delete({ where: { id } }).catch(() => undefined);
    await closeServer();
    await prisma.$disconnect();
  });

  it("readiness reflects the real database: ready now", async () => {
    expect([(await api("GET", "/readyz")).status, (await api("GET", "/healthz")).status]).toEqual([200, 200]);
  });

  describe("concurrency and idempotency", () => {
    it("concurrent preference writes to different fields all persist (no lost update), as one row", async () => {
      const { cookie, studentId } = await student();
      const results = await Promise.all([api("PUT", "/v1/preferences", { language: "hinglish" }, cookie), api("PUT", "/v1/preferences", { verbosity: "detailed" }, cookie), api("PUT", "/v1/preferences", { preferredHelp: "hint" }, cookie)]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect((await api("GET", "/v1/preferences", undefined, cookie)).json).toEqual({ preferences: { language: "hinglish", verbosity: "detailed", preferredHelp: "hint" } });
      expect(await prisma.studentPreference.count({ where: { studentId } })).toBe(1);
    });

    it("concurrent simulation starts for one student create exactly ONE simulation; every response names the same one", async () => {
      const { cookie, studentId } = await student();
      const results = await Promise.all(Array.from({ length: 8 }, () => api("POST", "/v1/simulations", {}, cookie)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.json.created === true)).toHaveLength(1);
      expect(new Set(results.map((r) => (r.json.simulation as { simulationId: string }).simulationId)).size).toBe(1);
      expect(await prisma.examSimulation.count({ where: { studentId } })).toBe(1);
    });

    it("concurrent answers to one simulation are all recorded in a strict, gap-free sequence (append-only log, no lost write)", async () => {
      const { cookie } = await student();
      const id = ((await api("POST", "/v1/simulations", {}, cookie)).json.simulation as { simulationId: string }).simulationId;
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => api("POST", `/v1/simulations/${id}/answers`, { position: 1 + (i % 3), answer: opt(questionIds[i % 3]!, i) }, cookie)));
      expect(results.map((r) => r.json.outcome)).toEqual(Array(10).fill("recorded"));
      const events = await prisma.simulationAnswerEvent.findMany({ where: { simulationId: id }, orderBy: { sequence: "asc" } });
      expect(events.map((e) => e.sequence)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    });

    it("concurrent submits finalize exactly once: one 'submitted', the rest idempotent 'already_submitted'; later answers are rejected", async () => {
      const { cookie } = await student();
      const id = ((await api("POST", "/v1/simulations", {}, cookie)).json.simulation as { simulationId: string }).simulationId;
      await api("POST", `/v1/simulations/${id}/answers`, { position: 1, answer: opt(questionIds[0]!) }, cookie);
      const results = await Promise.all(Array.from({ length: 8 }, () => api("POST", `/v1/simulations/${id}/submit`, {}, cookie)));
      const outcomes = results.map((r) => r.json.outcome);
      expect(outcomes.filter((o) => o === "submitted")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "already_submitted")).toHaveLength(7);
      const row = await prisma.examSimulation.findUniqueOrThrow({ where: { id } });
      expect([row.status, row.finalizedAt !== null, row.result !== null]).toEqual(["submitted", true, true]);
      expect((await api("POST", `/v1/simulations/${id}/answers`, { position: 2, answer: opt(questionIds[1]!) }, cookie)).json.outcome).toBe("rejected_finalized");
      expect(await prisma.simulationAnswerEvent.count({ where: { simulationId: id } })).toBe(1);
    });

    it("a replayed attempt submission is rejected and the first stands; concurrent starts of the same question share ONE open attempt", async () => {
      const { cookie, studentId } = await student();
      const q = questionIds[0]!;
      const starts = await Promise.all(Array.from({ length: 6 }, () => api("POST", "/v1/attempts", { questionId: q }, cookie)));
      expect(starts.every((r) => r.status === 200)).toBe(true);
      expect(new Set(starts.map((r) => r.json.attemptId)).size).toBe(1);
      expect(await prisma.attempt.count({ where: { studentId, questionId: q, status: "in_progress" } })).toBe(1);
      const attemptId = starts[0]!.json.attemptId as string;
      const first = await api("POST", `/v1/attempts/${attemptId}/submit`, { questionId: q, chosenAnswer: opt(q, 0) }, cookie);
      const replay = await api("POST", `/v1/attempts/${attemptId}/submit`, { questionId: q, chosenAnswer: opt(q, 1) }, cookie);
      expect(first.status).toBe(200);
      expect(replay.status).toBeGreaterThanOrEqual(400);
      expect(replay.status).toBeLessThan(500);
      expect((await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).chosenAnswer).toBe(opt(q, 0));
    });

    it("concurrent tutor requests from one student: exactly one reaches the model, the rest are 429 (spend control under a race); every audit row is distinct", async () => {
      const { cookie, studentId } = await student();
      provider.mode = "compliant";
      provider.intent = "give_hint";
      provider.delayMs = 300;
      const before = provider.prompts.length;
      const results = await Promise.all(Array.from({ length: 6 }, () => api("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: questionIds[0] }, cookie)));
      provider.delayMs = 0;
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 429)).toHaveLength(5);
      expect(provider.prompts.length - before).toBe(1);
      const audits = await prisma.orchestrationAudit.findMany({ where: { studentId } });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.requestId).toBe(results.find((r) => r.status === 200)!.headers.get("x-request-id"));
    });
  });

  describe("IDOR against stored rows", () => {
    it("another student cannot read or change a simulation; a deleted simulation is 'not found' for its owner; the unauthorized response equals the missing one", async () => {
      const a = await student();
      const b = await student();
      const id = ((await api("POST", "/v1/simulations", {}, a.cookie)).json.simulation as { simulationId: string }).simulationId;
      for (const [m, p, body] of [["GET", `/v1/simulations/${id}`, undefined], ["GET", `/v1/simulations/${id}/questions/1`, undefined], ["POST", `/v1/simulations/${id}/answers`, { position: 1, answer: "1" }], ["POST", `/v1/simulations/${id}/submit`, {}]] as const) {
        const theirs = await api(m, p, body, b.cookie);
        const missing = await api(m, p.replace(id, randomUUID()), body, b.cookie);
        expect([theirs.status, theirs.raw]).toEqual([missing.status, missing.raw]);
        expect(theirs.status).toBe(404);
      }
      expect(await prisma.simulationAnswerEvent.count({ where: { simulationId: id } })).toBe(0);
      await prisma.examSimulation.delete({ where: { id } });
      const gone = await api("GET", `/v1/simulations/${id}`, undefined, a.cookie);
      expect([gone.status, gone.json]).toEqual([404, { error: { code: "not_found", message: "No such simulation." } }]);
    });

    it("the same student under a DIFFERENT enrollment cannot reach a simulation (service level: the enrollment is part of the key)", async () => {
      const a = await student();
      const id = ((await api("POST", "/v1/simulations", {}, a.cookie)).json.simulation as { simulationId: string }).simulationId;
      const exam = await prisma.exam.create({ data: { code: `P9U3_${randomUUID().slice(0, 8)}`, name: "P9U3 TEST EXAM (deleted after the test)", examDateRule: { type: "fixed_date", date: "2027-01-01" } } as never });
      createdExams.push(exam.id);
      const other = await prisma.enrollment.create({ data: { studentId: a.studentId, examId: exam.id, enrolledAt: new Date() } });
      const mine = await prisma.enrollment.findFirstOrThrow({ where: { studentId: a.studentId, NOT: { id: other.id } } });
      await expect(sim.get({ studentId: a.studentId, enrollmentId: other.id }, id)).rejects.toMatchObject({ code: "simulation_not_found" });
      await expect(sim.start({ studentId: a.studentId, enrollmentId: other.id })).rejects.toMatchObject({ code: "invalid_config" }); // the configuration belongs to another exam: the first exam's simulation is neither recovered nor reused
      expect((await sim.get({ studentId: a.studentId, enrollmentId: mine.id }, id)).simulationId).toBe(id);
    });

    it("a student cannot read another student's attempt, evidence or autopsy by id (403/404, no data)", async () => {
      const a = await student();
      const b = await student();
      const started = await api("POST", "/v1/attempts", { questionId: questionIds[1] }, a.cookie);
      const attemptId = started.json.attemptId as string;
      await api("POST", `/v1/attempts/${attemptId}/submit`, { questionId: questionIds[1], chosenAnswer: opt(questionIds[1]!) }, a.cookie);
      for (const p of [`/v1/attempts/${attemptId}/result`, `/v1/attempts/${attemptId}/evidence`, `/v1/attempts/${attemptId}/autopsy`]) {
        const r = await api("GET", p, undefined, b.cookie);
        expect([403, 404]).toContain(r.status);
        expect(r.raw).not.toMatch(/"correctAnswer"|"chosenAnswer"|solution/i);
      }
    });
  });

  describe("database failure behaviour", () => {
    it("with an unreachable database the API answers a fixed, retryable 503 (no driver text, host or port), and readiness says not_ready - the process stays up", async () => {
      const dead = createPrismaClient("postgresql://nobody:nopass@127.0.0.1:1/ipmat_test?connect_timeout=2&pool_timeout=2");
      const server = createServer({ ...createPrismaDependencies(dead), hypothesisGenerator: null, hypothesisSealer: { seal: () => "x", open: () => null }, runtime: createRuntime({ readiness: async () => { await dead.$queryRaw`SELECT 1`; return true; } }) });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        const me = await call(url, "GET", "/v1/auth/me", undefined, `session_token=${"a".repeat(64)}`);
        expect(me.status).toBe(503);
        expect(me.headers.get("retry-after")).toBe("5");
        expect(me.json).toEqual({ error: { code: "infrastructure_failure", message: "The service is temporarily unavailable. Please try again shortly." } });
        expect(me.raw).not.toMatch(/127\.0\.0\.1|:1\b|nopass|nobody|Prisma|ECONNREFUSED|P1001|database server/i);
        const ready = await call(url, "GET", "/readyz");
        expect([ready.status, ready.json]).toEqual([503, { status: "not_ready" }]);
        expect((await call(url, "GET", "/healthz")).status).toBe(200); // liveness is independent of the database
      } finally {
        await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
        await dead.$disconnect();
      }
    });

    it("provider failures do not leak into logs or responses against the real stack", async () => {
      const { cookie } = await student();
      provider.mode = "throw500";
      provider.intent = "give_hint";
      const r = await api("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: questionIds[0] }, cookie);
      provider.mode = "compliant";
      expect([r.status, r.json.status]).toEqual([200, "not_answered"]);
      expect(r.raw).not.toContain(PROVIDER_SECRET);
      expect(logs.join("\n")).not.toContain(PROVIDER_SECRET);
    });
  });
});
