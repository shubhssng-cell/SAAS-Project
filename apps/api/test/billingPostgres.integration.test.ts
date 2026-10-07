import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createAssistantServices, ExamPackTutorConceptPort } from "@ipmat/assistant-api";
import { parsePlanCatalog } from "@ipmat/billing";
import type { CommerceServices } from "@ipmat/billing-api";
import { HmacTestProvider, TEST_CATALOG_SOURCE, eventBody, signWebhook } from "@ipmat/billing-api/testing";
import { createPrismaClient, PrismaAiUsageSink, PrismaExamPackRepository, PrismaOrchestrationAuditStore, PrismaPreferenceStore, PrismaSimulationEnrollmentReader, PrismaSimulationQuestionSource, PrismaSimulationRepository, PrismaTutorAttemptPort, PrismaTutorOwnershipPort, PrismaTutorQuestionPort } from "@ipmat/db";
import { SimulationService, type SimulationDefinition } from "@ipmat/exam-simulation";
import { createLogger, createMetrics, createRateLimiter } from "@ipmat/observability";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaCommerce } from "../src/commerceWiring.js";
import { createRuntime } from "../src/hardening.js";
import { observeProvider } from "../src/providerObservability.js";
import { createServer } from "../src/server.js";
import { createPrismaDependencies } from "../src/wiring.js";
import { ScriptedProvider } from "./assistantFixtures.js";

/**
 * REAL DATABASE tests for Phase 9 Unit 4 (docs/DECISIONS.md D-100): the whole commercial flow over HTTP against Postgres -- checkout,
 * a signed provider event, entitlement derived from the stored subscription, usage reserved in the ledger, concurrency, restart
 * durability, student isolation and a database outage. The payment provider and the model are deterministic doubles. SKIPPED
 * unless `IPMAT_TEST_DATABASE_URL` is set; refuses any database whose name does not contain "test". Plans, limits and amounts
 * are LABELLED TEST FIXTURES. Billing events are append-only by design, so their rows stay in the disposable test database.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}
vi.setConfig({ testTimeout: 90_000 });

type Res = { status: number; json: Record<string, unknown>; raw: string; headers: Headers };
const PLUS = { amountMinor: 123456, currency: "INR" };

describe.skipIf(!DATABASE_URL)("monetization and entitlements - real Postgres", () => {
  let prisma: PrismaClient;
  let base = "";
  let closeServer: () => Promise<void>;
  let commerce: CommerceServices;
  const payments = new HmacTestProvider();
  const modelDouble = new ScriptedProvider();
  const studentIds: string[] = [];
  const logs: string[] = [];
  const clock = { now: new Date() };
  let questionIds: string[] = [];

  const call = async (url: string, method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}, raw?: string): Promise<Res> => {
    const res = await fetch(`${url}${path}`, { method, headers: { ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* not json */
    }
    return { status: res.status, json, raw: text, headers: res.headers };
  };
  const api = (method: string, path: string, body?: unknown, cookie?: string) => call(base, method, path, body, cookie);
  const minutesAgo = (m: number): string => new Date(clock.now.getTime() - m * 60_000).toISOString();
  const hook = (body: unknown, options: { secret?: string } = {}) => {
    const signed = signWebhook(body, { at: Math.floor(clock.now.getTime() / 1000), secret: options.secret });
    return call(base, "POST", "/v1/billing/webhook", undefined, undefined, signed.headers, signed.rawBody);
  };

  async function student(): Promise<{ cookie: string; studentId: string; enrollmentId: string }> {
    const res = await fetch(`${base}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `p9u4-${randomUUID()}@example.com`, password: "correct-horse-battery-1" }) });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const studentId = ((await res.json()) as { student: { id: string } }).student.id;
    studentIds.push(studentId);
    await fetch(`${base}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
    const enrolled = (await (await fetch(`${base}/v1/enrollment`, { method: "POST", headers: { cookie } })).json()) as { enrollment: { id: string } };
    return { cookie, studentId, enrollmentId: enrolled.enrollment.id };
  }

  const dbSub = (studentId: string, planId = "test_plus") => prisma.billingSubscription.findFirstOrThrow({ where: { studentId, planId }, orderBy: { createdAt: "desc" } });
  async function purchase(s: { cookie: string; studentId: string }, planId = "test_plus", amount = PLUS) {
    expect((await api("POST", "/v1/billing/checkout", { planId }, s.cookie)).status).toBe(200);
    const sub = await dbSub(s.studentId, planId);
    const r = await hook(eventBody({ eventId: `p9u4-${randomUUID()}`, type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(5), subscriptionId: sub.id, ...amount }));
    expect(r.status).toBe(200);
    return sub;
  }

  function buildServer(commerceServices: CommerceServices) {
    const logger = createLogger({ sink: (l) => logs.push(l) });
    const metrics = createMetrics();
    const definition = simulationDefinition();
    const sim = new SimulationService({ enrollments: new PrismaSimulationEnrollmentReader(prisma), configs: { findDefinition: async () => definition }, questions: new PrismaSimulationQuestionSource(prisma), repository: new PrismaSimulationRepository(prisma), now: () => new Date().toISOString(), newId: () => randomUUID() });
    const assistant = createAssistantServices({
      ownership: new PrismaTutorOwnershipPort(prisma),
      tutorPorts: { questions: new PrismaTutorQuestionPort(prisma), concepts: new ExamPackTutorConceptPort(new PrismaExamPackRepository(prisma)), attempts: new PrismaTutorAttemptPort(prisma) },
      provider: observeProvider(modelDouble, { metrics, logger, usage: new PrismaAiUsageSink(prisma) }),
      preferences: new PrismaPreferenceStore(prisma),
      audit: new PrismaOrchestrationAuditStore(prisma),
      simulation: sim,
      aiOptions: { timeoutMs: 20_000, maxRetries: 0 },
      metrics,
      logger
    });
    const runtime = createRuntime({ logger, metrics, limiter: createRateLimiter(), readiness: async () => true });
    return createServer({ ...createPrismaDependencies(prisma), hypothesisGenerator: null, hypothesisSealer: { seal: () => "x", open: () => null }, assistant, commerce: commerceServices, runtime });
  }

  let simulationDef: SimulationDefinition;
  const simulationDefinition = (): SimulationDefinition => simulationDef;

  async function listen(commerceServices: CommerceServices): Promise<{ url: string; close: () => Promise<void> }> {
    const server = buildServer(commerceServices);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }) };
  }

  const config = () => ({ mode: "enforced" as const, catalog: parsePlanCatalog(structuredClone(TEST_CATALOG_SOURCE)), returnUrl: null, provider: payments });

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    const rows = await prisma.question.findMany({ where: { validationState: "published", exam: { code: "IPMAT_INDORE" } }, orderBy: { id: "asc" }, select: { id: true, section: { select: { name: true } } } });
    questionIds = rows.map((r) => r.id);
    const sectionName = rows[0]!.section.name;
    simulationDef = {
      config: { examCode: "IPMAT_INDORE", configVersion: "p9u4-fixture", overallDurationSeconds: 600, sections: [{ sectionName, order: 1, questionCount: 3 }], provenance: { kind: "authored", sourceRef: "fixture:p9u4-test-configuration (not an exam rule)", reviewState: "unvalidated", reviewedBy: null, note: "TEST DATA" } },
      selection: { origin: "assembled", sourceRef: "fixture:p9u4-test-paper", sections: { [sectionName]: questionIds.slice(0, 3) } }
    };
    const built = createPrismaCommerce(prisma, config(), undefined, () => clock.now);
    commerce = built.commerce;
    const first = await listen(commerce);
    base = first.url;
    closeServer = first.close;
  });

  afterAll(async () => {
    await prisma.usageEvent.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.orchestrationAudit.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await closeServer();
    await prisma.$disconnect();
  });

  it("a purchase is durable: checkout row, signed event, derived entitlement -- and a restarted server still honours it", async () => {
    const s = await student();
    expect((await api("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    const sub = await purchase(s);
    const row = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row).toMatchObject({ studentId: s.studentId, status: "active", planId: "test_plus", amountMinor: 123456, currency: "INR" });
    expect(row.paidThrough!.getTime()).toBe(Date.parse(minutesAgo(5)) + 30 * 86_400_000);
    const events = await prisma.billingEvent.findMany({ where: { subscriptionId: sub.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "payment_succeeded", outcome: "applied" });
    expect(events[0]!.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await api("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(200);

    // "restart": a brand-new commerce stack and server over the same database
    const restarted = await listen(createPrismaCommerce(prisma, config(), undefined, () => clock.now).commerce);
    try {
      const summary = await call(restarted.url, "GET", "/v1/billing", undefined, s.cookie);
      expect(summary.json.subscription).toMatchObject({ planId: "test_plus", status: "active", grantsAccess: true });
    } finally {
      await restarted.close();
    }
  });

  it("concurrent identical deliveries of one provider event apply it once", async () => {
    const s = await student();
    expect((await api("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie)).status).toBe(200);
    const sub = await dbSub(s.studentId);
    const ev = eventBody({ eventId: `p9u4-${randomUUID()}`, type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(5), subscriptionId: sub.id, ...PLUS });
    const rs = await Promise.all(Array.from({ length: 12 }, () => hook(ev)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const row = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row.paidThrough!.getTime()).toBe(Date.parse(ev.occurredAt as string) + 30 * 86_400_000);
    expect(await prisma.billingEvent.count({ where: { subscriptionId: sub.id } })).toBe(1);
  });

  it("concurrent checkout requests create exactly one pending subscription row", async () => {
    const s = await student();
    const rs = await Promise.all(Array.from({ length: 8 }, () => api("POST", "/v1/billing/checkout", { planId: "test_unlimited" }, s.cookie)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(new Set(rs.map((r) => r.json.checkoutUrl)).size).toBe(1);
    expect(await prisma.billingSubscription.count({ where: { studentId: s.studentId, planId: "test_unlimited" } })).toBe(1);
  });

  it("usage is a ledger in the database: tutor use is recorded, provider failures are released, and the limit holds", async () => {
    const s = await student();
    modelDouble.mode = "compliant";
    modelDouble.intent = "give_hint";
    const ask = () => api("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: questionIds[0] }, s.cookie);
    expect((await ask()).json.status).toBe("answered");
    modelDouble.mode = "throw500";
    expect((await ask()).json.status).toBe("not_answered");
    modelDouble.mode = "compliant";
    expect((await ask()).status).toBe(200);
    const denied = await ask();
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: { code: "usage_limit_reached" } });
    const rows = await prisma.usageEvent.findMany({ where: { studentId: s.studentId, meter: "tutor_request" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["consumed", "released", "consumed"]);
    expect(new Set(rows.map((r) => r.idempotencyKey)).size).toBe(3);
    expect(rows.every((r) => r.settledAt !== null)).toBe(true);
    // AI usage FACTS were recorded separately, correlated by request id, with no content
    const factsNow = () => prisma.aiUsageRecord.findMany({ where: { requestId: { in: rows.map((r) => r.idempotencyKey) } } });
    await vi.waitFor(async () => expect((await factsNow()).length).toBeGreaterThanOrEqual(3), { timeout: 5000, interval: 100 }); // recorded best-effort, just after the response
    const facts = await factsNow();
    expect(facts.length).toBeGreaterThanOrEqual(3);
    expect(facts.every((f) => f.provider === "scripted" && f.model === "scripted-v1")).toBe(true);
    expect(facts.filter((f) => f.outcome === "error").every((f) => f.inputTokens === null && f.failureCategory === "server_error")).toBe(true);
    expect(facts.filter((f) => f.outcome === "ok").every((f) => f.inputTokens === 10 && f.outputTokens === 5)).toBe(true);
  });

  it("simultaneous metered work cannot exceed the limit against the real database", async () => {
    const s = await student();
    let ran = 0;
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        commerce.guard
          .metered({ studentId: s.studentId, enrollmentId: s.enrollmentId }, "tutor", "tutor_request", async () => { ran += 1; await new Promise((r) => setTimeout(r, 10)); }, () => "consumed")
          .then(() => "ok", (e: { code?: string }) => e.code ?? "error")
      )
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(2); // the fixture baseline limit
    expect(results.filter((r) => r === "usage_limit_reached")).toHaveLength(28);
    expect(ran).toBe(2);
    expect(await prisma.usageEvent.count({ where: { studentId: s.studentId, meter: "tutor_request", status: { in: ["reserved", "consumed"] } } })).toBe(2);
  });

  it("a refund revokes access and a late success cannot restore it", async () => {
    const s = await student();
    const sub = await purchase(s);
    expect((await hook(eventBody({ eventId: `p9u4-${randomUUID()}`, type: "payment_refunded", providerRef: sub.providerRef!, occurredAt: minutesAgo(2), subscriptionId: sub.id }))).status).toBe(200);
    await hook(eventBody({ eventId: `p9u4-${randomUUID()}`, type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(10), subscriptionId: sub.id, ...PLUS }));
    expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("refunded");
    expect((await api("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    expect((await prisma.billingEvent.findMany({ where: { subscriptionId: sub.id }, orderBy: { occurredAt: "asc" } })).map((e) => e.outcome)).toEqual(["ignored_terminal", "applied", "applied"]); // late success (-10m), purchase (-5m), refund (-2m)
  });

  it("a forged or tampered event changes nothing in the database", async () => {
    const s = await student();
    expect((await api("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie)).status).toBe(200);
    const sub = await dbSub(s.studentId);
    const ev = eventBody({ eventId: `p9u4-${randomUUID()}`, type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), subscriptionId: sub.id, ...PLUS });
    expect((await hook(ev, { secret: "whsec_attacker" })).status).toBe(400);
    expect((await hook({ ...ev, amountMinor: 1 })).status).toBe(200); // validly signed but wrong amount
    const row = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(row).toMatchObject({ status: "pending", paidThrough: null });
    expect((await prisma.billingEvent.findMany({ where: { subscriptionId: sub.id } })).map((e) => e.outcome)).toEqual(["rejected_amount_mismatch"]);
  });

  it("students are isolated in the database: nobody reads or cancels another's subscription", async () => {
    const a = await student();
    const b = await student();
    const sub = await purchase(a);
    const rb = await api("GET", `/v1/billing?subscriptionId=${sub.id}`, undefined, b.cookie);
    expect(rb.json.subscription).toBeNull();
    expect(rb.raw).not.toContain(sub.id);
    payments.cancelled.length = 0;
    expect((await api("POST", "/v1/billing/cancel", {}, b.cookie)).status).toBe(404);
    expect(payments.cancelled).toEqual([]);
    expect((await api("POST", "/v1/simulations", undefined, b.cookie)).status).toBe(403);
  });

  it("when the billing database is unreachable the answer is a calm 503, and paid features fail closed", async () => {
    const dead = createPrismaClient("postgresql://nobody:nothing@127.0.0.1:1/ipmat_test");
    const broken = createPrismaCommerce(dead, config(), undefined, () => clock.now).commerce;
    const s = await student();
    const srv = await listen({ ...broken, examScope: commerce.examScope });
    try {
      const sess = s.cookie;
      const summary = await call(srv.url, "GET", "/v1/billing", undefined, sess);
      expect(summary.status).toBe(503);
      expect(summary.headers.get("retry-after")).toBe("5");
      expect(summary.raw).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|nobody|Prisma|5432|55432/);
      const sim = await call(srv.url, "POST", "/v1/simulations", undefined, sess);
      expect([sim.status, sim.json]).toEqual([503, expect.objectContaining({ error: expect.objectContaining({ code: "not_available" }) })]);
    } finally {
      await srv.close();
      await dead.$disconnect().catch(() => undefined);
    }
  });

  it("the stored billing data holds no secret, signature, card detail or provider payload", async () => {
    const text = JSON.stringify([await prisma.billingSubscription.findMany({ where: { studentId: { in: studentIds } } }), await prisma.billingEvent.findMany({ where: { subscriptionId: { not: null } }, take: 200 })]);
    expect(text).not.toMatch(/whsec_|x-test-signature|pay\.test\.invalid|card|cvv|password/i);
    expect(logs.join("\n")).not.toMatch(/whsec_|x-test-signature|pay\.test\.invalid|cs_test_/);
  });
});
