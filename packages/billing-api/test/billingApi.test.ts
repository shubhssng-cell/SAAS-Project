import { randomUUID } from "node:crypto";
import { applyBillingEvent, parsePlanCatalog, type BillingEvent, type Subscription } from "@ipmat/billing";
import { InMemoryBillingStore } from "@ipmat/db";
import { createLogger, createMetrics, runWithContext, type RequestContext } from "@ipmat/observability";
import { describe, expect, it } from "vitest";
import { BillingApiError, chooseSubscription, createCommerceServices, type CommerceServices } from "../src/index.js";
import { HmacTestProvider, TEST_CATALOG_SOURCE, TEST_WEBHOOK_SECRET, eventBody, signWebhook, testCatalog } from "../src/testing.js";

/** LABELLED TEST FIXTURES: synthetic students, plans and amounts. The payment provider is a deterministic signed-event double. */
const STUDENTS = new Set(["s1", "s2"]);
const CLAIM = { studentId: "s1", enrollmentId: "enr-1" };
const clock = { now: new Date("2026-10-15T12:00:00.000Z") };
const examScope = async (studentId: string, enrollmentId: string): Promise<string | null> => (enrollmentId === "enr-1" && studentId === "s1" ? "IPMAT_INDORE" : enrollmentId === "enr-2" && studentId === "s2" ? "IPMAT_INDORE" : null);

function build(over: { mode?: "open" | "enforced"; limit?: number; provider?: HmacTestProvider | null; returnUrl?: string | null } = {}) {
  const logs: string[] = [];
  const logger = createLogger({ sink: (l) => logs.push(l) });
  const metrics = createMetrics();
  const store = new InMemoryBillingStore(STUDENTS);
  const provider = over.provider === undefined ? new HmacTestProvider() : over.provider;
  const source = structuredClone(TEST_CATALOG_SOURCE);
  if (over.limit !== undefined) source.baseline.usageLimits = [{ meter: "tutor_request", limit: over.limit, period: "day" }];
  const commerce: CommerceServices = createCommerceServices({ mode: over.mode ?? "enforced", catalog: parsePlanCatalog(source), store, usageStore: store, provider, returnUrl: over.returnUrl ?? null, examScope, now: () => clock.now, newId: randomUUID, metrics, logger });
  return { commerce, store, provider, logs, metrics, logger };
}
const counter = (m: ReturnType<typeof createMetrics>, name: string, labels: Record<string, string> = {}): number =>
  m.snapshot().counters.filter((c) => c.name === name && Object.entries(labels).every(([k, v]) => c.labels[k] === v)).reduce((n, c) => n + c.value, 0);
const code = async (p: Promise<unknown>): Promise<string> => p.then(() => "ok", (e: unknown) => (e instanceof BillingApiError ? `${e.code}:${e.httpStatus}` : `other:${(e as Error).name}`));
const ctx = (requestId: string): RequestContext => ({ requestId, method: "POST", route: "POST /x", actorKind: "student", studentRef: null, examCode: null, startedAtMs: 0 });

describe("CommerceGuard", () => {
  it("open mode never consults the store: no read, no reservation", async () => {
    const { commerce, store } = build({ mode: "open" });
    const spy = { reads: 0 };
    store.listSubscriptionsForStudent = async () => { spy.reads += 1; return []; };
    await commerce.guard.requireExam(CLAIM);
    await commerce.guard.requireFeature(CLAIM, "simulation");
    expect(await commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => "done", () => "consumed")).toBe("done");
    expect(spy.reads).toBe(0);
  });

  it("an enrollment that does not resolve to the student can never be entitled", async () => {
    const { commerce } = build();
    expect(await code(commerce.guard.requireExam({ studentId: "s1", enrollmentId: "enr-2" }))).toBe("not_entitled:403");
    expect(await code(commerce.guard.requireFeature({ studentId: "s2", enrollmentId: "enr-1" }, "tutor"))).toBe("not_entitled:403");
  });

  it("simultaneous requests cannot exceed the limit: exactly `limit` units of work run", async () => {
    const { commerce, store } = build({ limit: 5 });
    let ran = 0;
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        runWithContext(ctx(`req-${i}`), () =>
          code(commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => { ran += 1; await new Promise((r) => setTimeout(r, 5)); return i; }, () => "consumed"))
        )
      )
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(5);
    expect(results.filter((r) => r === "usage_limit_reached:403")).toHaveLength(35);
    expect(ran).toBe(5);
    expect(await store.usedInPeriod("s1", "tutor_request", "2026-10-15T00:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe(5);
  });

  it("units are per student: one student's use never reduces another's", async () => {
    const { commerce } = build({ limit: 1 });
    expect(await code(commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => 1, () => "consumed"))).toBe("ok");
    expect(await code(commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => 1, () => "consumed"))).toBe("usage_limit_reached:403");
    expect(await code(commerce.guard.metered({ studentId: "s2", enrollmentId: "enr-2" }, "tutor", "tutor_request", async () => 1, () => "consumed"))).toBe("ok");
  });

  it("work that throws gives the unit back and the error passes through unchanged", async () => {
    const { commerce, store } = build({ limit: 1 });
    const boom = new Error("boom");
    await expect(commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => { throw boom; }, () => "consumed")).rejects.toBe(boom);
    expect(await store.usedInPeriod("s1", "tutor_request", "2026-10-15T00:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe(0);
    expect(await code(commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => 1, () => "consumed"))).toBe("ok");
  });

  it("the caller's rule decides: a 'released' result frees the unit, a 'consumed' one keeps it", async () => {
    const { commerce, store } = build({ limit: 2 });
    await commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => "undelivered", () => "released");
    await commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => "delivered", () => "consumed");
    expect(await store.usedInPeriod("s1", "tutor_request", "2026-10-15T00:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe(1);
  });

  it("a failure to settle never fails the student's response, leaves the unit counted (the conservative side) and is logged", async () => {
    const { commerce, store, logs } = build({ limit: 3 });
    store.settle = async () => { throw new Error("db down password=hunter2"); };
    expect(await commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => "reply", () => "released")).toBe("reply");
    expect(await store.usedInPeriod("s1", "tutor_request", "2026-10-15T00:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe(1);
    expect(logs.some((l) => l.includes("billing.usage_settle_failed"))).toBe(true);
    expect(logs.join("\n")).not.toMatch(/hunter2|db down/);
  });

  it("the same request id reserves once: a retry inside one request is not a second unit", async () => {
    const { commerce, store } = build({ limit: 5 });
    await runWithContext(ctx("same-request"), async () => {
      await commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => 1, () => "consumed");
      await commerce.guard.metered(CLAIM, "tutor", "tutor_request", async () => 1, () => "consumed");
    });
    expect(await store.usedInPeriod("s1", "tutor_request", "2026-10-15T00:00:00.000Z", "2026-10-16T00:00:00.000Z")).toBe(1);
  });

  it("a store failure fails CLOSED with a fixed error, never a silent grant and never the driver's message", async () => {
    const { commerce, store, logs } = build();
    store.listSubscriptionsForStudent = async () => { throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.5 password=hunter2"), { name: "PrismaClientInitializationError" }); };
    let ran = false;
    const err = await commerce.guard.metered(CLAIM, "simulation", "simulation_start", async () => { ran = true; }, () => "consumed").catch((e: unknown) => e);
    expect(ran).toBe(false);
    expect(err).toBeInstanceOf(BillingApiError);
    expect(err).toMatchObject({ code: "not_available", httpStatus: 503 });
    expect(String((err as Error).message)).not.toMatch(/ECONNREFUSED|hunter2/);
    expect(logs.join("\n")).not.toMatch(/ECONNREFUSED|hunter2/);
    store.listSubscriptionsForStudent = async () => { throw new Error("some bug"); };
    expect(await code(commerce.guard.requireFeature(CLAIM, "simulation"))).toBe("infrastructure_failure:500");
  });
});

describe("BillingApiService.startCheckout", () => {
  it("gives the provider the server's price, the plan's price reference and the server-configured return URL", async () => {
    const { commerce, provider } = build({ returnUrl: "https://app.example.test/billing" });
    await commerce.billing.startCheckout("s1", { planId: "test_plus" });
    expect(provider!.checkouts[0]).toMatchObject({ planId: "test_plus", planName: "Test Plus (fixture)", amountMinor: 123456, currency: "INR", providerPriceRef: "price_test_plus", returnUrl: "https://app.example.test/billing" });
  });

  const badSessions: Array<[string, { providerRef: string; checkoutUrl: string }]> = [
    ["an http URL", { providerRef: "cs_ok", checkoutUrl: "http://pay.example.test/x" }],
    ["a javascript: URL", { providerRef: "cs_ok", checkoutUrl: "javascript:alert(1)" }],
    ["a data: URL", { providerRef: "cs_ok", checkoutUrl: "data:text/html,hi" }],
    ["a URL with credentials", { providerRef: "cs_ok", checkoutUrl: "https://user:pw@pay.example.test/x" }],
    ["a relative URL", { providerRef: "cs_ok", checkoutUrl: "/pay" }],
    ["an enormous URL", { providerRef: "cs_ok", checkoutUrl: `https://pay.example.test/${"a".repeat(3000)}` }],
    ["a reference with spaces", { providerRef: "cs bad ref", checkoutUrl: "https://pay.example.test/x" }],
    ["an empty reference", { providerRef: "", checkoutUrl: "https://pay.example.test/x" }]
  ];
  for (const [label, session] of badSessions) {
    it(`refuses to hand a student ${label} from the provider`, async () => {
      const provider = new HmacTestProvider();
      provider.createCheckout = async () => session;
      const { commerce, store, logs } = build({ provider });
      expect(await code(commerce.billing.startCheckout("s1", { planId: "test_plus" }))).toBe("not_available:503");
      expect((await store.listSubscriptionsForStudent("s1"))[0]?.providerRef).toBeNull();
      expect(logs.join("\n")).not.toContain(session.checkoutUrl.slice(0, 40));
    });
  }

  it("an unknown student cannot open a checkout (the foreign key), and surfaces as a fixed error", async () => {
    const { commerce } = build();
    expect(await code(commerce.billing.startCheckout("ghost", { planId: "test_plus" }))).toMatch(/^(infrastructure_failure:500|not_available:503)$/);
  });

  it("counts outcomes without labels a client could inflate", async () => {
    const { commerce, metrics } = build();
    await commerce.billing.startCheckout("s1", { planId: "test_plus" }).catch(() => undefined);
    for (const planId of ["a", "b", "c", "d"]) await commerce.billing.startCheckout("s1", { planId }).catch(() => undefined);
    expect(counter(metrics, "billing_checkout_total", { outcome: "created" })).toBe(1);
    expect(counter(metrics, "billing_checkout_total", { outcome: "plan_refused" })).toBe(4);
    expect(metrics.snapshot().counters.filter((c) => c.name === "billing_checkout_total")).toHaveLength(2);
  });
});

describe("BillingApiService.requestCancellation", () => {
  const activate = async (c: ReturnType<typeof build>, planId: string, amount: number, studentId = "s1") => {
    await c.commerce.billing.startCheckout(studentId, { planId });
    const sub = (await c.store.listSubscriptionsForStudent(studentId)).find((s) => s.planId === planId)!;
    const event: BillingEvent = { eventId: `e-${planId}-${studentId}`, type: "payment_succeeded", occurredAt: "2026-10-15T11:00:00.000Z", providerRef: sub.providerRef!, subscriptionId: sub.id, amountMinor: amount, currency: "INR" };
    await c.store.processEvent({ provider: "test-provider", event, digest: "a".repeat(64), receivedAt: clock.now.toISOString(), decide: (s) => (s ? applyBillingEvent(s, event, testCatalog().plans.find((p) => p.id === planId)!, clock.now.toISOString()) : { outcome: "ignored_unknown_reference" }) });
    return sub;
  };

  it("cancels the subscription that is paid furthest ahead, using the provider's own reference", async () => {
    const c = build();
    const plus = await activate(c, "test_plus", 123456);
    const unlimited = await activate(c, "test_unlimited", 5000);
    await c.commerce.billing.requestCancellation("s1", {});
    expect(c.provider!.cancelled).toEqual([plus.providerRef]); // 30-day plan outlasts the 7-day one
    expect(plus.providerRef).not.toBe(unlimited.providerRef);
  });

  it("only an active or past-due subscription that still grants access can be cancelled: pending, cancelled, expired and refunded ones are not", async () => {
    for (const status of ["pending", "cancelled", "expired", "refunded", "failed"] as const) {
      const c = build();
      await c.commerce.billing.startCheckout("s1", { planId: "test_plus" });
      const sub = (await c.store.listSubscriptionsForStudent("s1"))[0]!;
      const types = { pending: null, cancelled: "subscription_cancelled", expired: "subscription_expired", refunded: "payment_refunded", failed: "payment_failed" } as const;
      const paid: BillingEvent = { eventId: "pay", type: "payment_succeeded", occurredAt: "2026-10-15T11:00:00.000Z", providerRef: sub.providerRef!, subscriptionId: sub.id, amountMinor: 123456, currency: "INR" };
      const plan = testCatalog().plans.find((p) => p.id === "test_plus")!;
      const apply = (e: BillingEvent) => c.store.processEvent({ provider: "test-provider", event: e, digest: "a".repeat(64), receivedAt: clock.now.toISOString(), decide: (s) => (s ? applyBillingEvent(s, e, plan, clock.now.toISOString()) : { outcome: "ignored_unknown_reference" }) });
      if (status !== "pending" && status !== "failed") await apply(paid);
      if (types[status]) await apply({ ...paid, eventId: `t-${status}`, type: types[status], occurredAt: "2026-10-15T11:30:00.000Z", amountMinor: null, currency: null });
      expect((await c.store.listSubscriptionsForStudent("s1"))[0]!.status, status).toBe(status);
      expect(await code(c.commerce.billing.requestCancellation("s1", {})), status).toBe("not_found:404");
      expect(c.provider!.cancelled, status).toEqual([]);
    }
  });

  it("takes no input at all: a target named by the client is refused", async () => {
    const c = build();
    await activate(c, "test_plus", 123456);
    expect(await code(c.commerce.billing.requestCancellation("s1", { providerRef: "x" }))).toBe("invalid_request:400");
    expect(c.provider!.cancelled).toEqual([]);
  });
});

describe("BillingWebhookService", () => {
  it("counts and logs outcomes; an unknown reference is a warning, a mismatch needs attention, nothing logs a payload or secret", async () => {
    const c = build();
    await c.commerce.billing.startCheckout("s1", { planId: "test_plus" });
    const sub = (await c.store.listSubscriptionsForStudent("s1"))[0]!;
    const send = (body: Record<string, unknown>) => c.commerce.webhook.handle({ rawBody: signWebhook(body, { at: clock.now.getTime() / 1000 }).rawBody, headers: signWebhook(body, { at: clock.now.getTime() / 1000 }).headers });
    await send(eventBody({ eventId: "e1", type: "payment_succeeded", providerRef: "cs_unknown", occurredAt: "2026-10-15T11:00:00.000Z", amountMinor: 123456, currency: "INR" }));
    await send(eventBody({ eventId: "e2", type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: "2026-10-15T11:00:00.000Z", subscriptionId: sub.id, amountMinor: 1, currency: "INR" }));
    await send(eventBody({ eventId: "e3", type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: "2026-10-15T11:00:00.000Z", subscriptionId: sub.id, amountMinor: 123456, currency: "INR" }));
    await send(eventBody({ eventId: "e3", type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: "2026-10-15T11:00:00.000Z", subscriptionId: sub.id, amountMinor: 123456, currency: "INR" }));
    expect(counter(c.metrics, "billing_webhook_total", { outcome: "ignored_unknown_reference" })).toBe(1);
    expect(counter(c.metrics, "billing_webhook_total", { outcome: "rejected_amount_mismatch" })).toBe(1);
    expect(counter(c.metrics, "billing_webhook_total", { outcome: "applied" })).toBe(1);
    expect(counter(c.metrics, "billing_webhook_total", { outcome: "duplicate" })).toBe(1);
    const events = c.logs.map((l) => JSON.parse(l) as Record<string, unknown>).map((l) => l.event);
    expect(events).toContain("billing.webhook_unknown_reference");
    expect(events).toContain("billing.webhook_needs_attention");
    expect(events).toContain("billing.subscription_transition");
    const text = c.logs.join("\n");
    for (const bad of [TEST_WEBHOOK_SECRET, sub.providerRef!, sub.id, "123456", "x-test-signature"]) expect(text, bad).not.toContain(bad);
  });

  it("a different payload reusing a processed event id is labelled as a conflict (needs a human), not as a harmless duplicate", async () => {
    const c = build();
    await c.commerce.billing.startCheckout("s1", { planId: "test_plus" });
    const sub = (await c.store.listSubscriptionsForStudent("s1"))[0]!;
    const at = clock.now.getTime() / 1000;
    const send = (type: string, amountMinor: number | null) => {
      const body = eventBody({ eventId: "same-id", type: type as never, providerRef: sub.providerRef!, occurredAt: "2026-10-15T11:00:00.000Z", subscriptionId: sub.id, amountMinor, currency: amountMinor ? "INR" : null });
      const signed = signWebhook(body, { at });
      return c.commerce.webhook.handle({ rawBody: signed.rawBody, headers: signed.headers });
    };
    await send("payment_succeeded", 123456);
    await send("payment_succeeded", 123456); // identical redelivery
    await send("payment_refunded", null); // same id, different content
    expect(counter(c.metrics, "billing_webhook_total", { outcome: "duplicate" })).toBe(1);
    expect(counter(c.metrics, "billing_webhook_total", { outcome: "rejected_event_conflict" })).toBe(1);
    expect(c.logs.some((l) => l.includes("billing.webhook_needs_attention") && l.includes("rejected_event_conflict"))).toBe(true);
    expect((await c.store.listSubscriptionsForStudent("s1"))[0]!.status).toBe("active");
  });

  it("rejects before touching the store, and counts rejections by coarse reason only", async () => {
    const c = build();
    let touched = false;
    c.store.processEvent = async () => { touched = true; throw new Error("unreachable"); };
    const bad = signWebhook({ a: 1 }, { at: clock.now.getTime() / 1000, secret: "wrong" });
    expect(await code(c.commerce.webhook.handle({ rawBody: bad.rawBody, headers: bad.headers }))).toBe("invalid_webhook:400");
    expect(touched).toBe(false);
    expect(counter(c.metrics, "billing_webhook_total", { outcome: "rejected_bad_signature" })).toBe(1);
  });

  it("with no provider configured it accepts nothing", async () => {
    const c = build({ provider: null });
    expect(await code(c.commerce.webhook.handle({ rawBody: "{}", headers: {} }))).toBe("not_available:503");
  });
});

describe("which subscription a person sees", () => {
  const s = (over: Partial<Subscription>): Subscription => ({ id: "x", studentId: "s1", planId: "p", provider: "t", providerRef: "r", status: "pending", amountMinor: 1, currency: "INR", paidThrough: null, lastEventAt: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...over });
  const now = new Date("2026-10-15T12:00:00.000Z");
  it("prefers one that grants access (latest end), then the newest pending, then the newest of any", () => {
    const old = s({ id: "old", status: "expired", paidThrough: "2026-09-01T00:00:00.000Z", createdAt: "2026-08-01T00:00:00.000Z" });
    const pending = s({ id: "pend", createdAt: "2026-10-10T00:00:00.000Z" });
    const a = s({ id: "a", status: "active", paidThrough: "2026-10-20T00:00:00.000Z" });
    const b = s({ id: "b", status: "cancelled", paidThrough: "2026-11-20T00:00:00.000Z" });
    expect(chooseSubscription([old, pending, a, b], now)?.id).toBe("b");
    expect(chooseSubscription([old, pending], now)?.id).toBe("pend");
    expect(chooseSubscription([old, s({ id: "refunded", status: "refunded", paidThrough: "2026-12-01T00:00:00.000Z", createdAt: "2026-09-15T00:00:00.000Z" })], now)?.id).toBe("refunded");
    expect(chooseSubscription([], now)).toBeNull();
  });
});

describe("billing summary cost (Phase 9 Unit 5)", () => {
  it("one summary reads the student's subscriptions once, and the usage counts it needs, nothing more", async () => {
    const c = build();
    let reads = 0;
    let counts = 0;
    const list = c.store.listSubscriptionsForStudent.bind(c.store);
    c.store.listSubscriptionsForStudent = async (id) => { reads += 1; return list(id); };
    const used = c.store.usedInPeriod.bind(c.store);
    c.store.usedInPeriod = async (...a) => { counts += 1; return used(...a); };
    const summary = await c.commerce.billing.getSummary("s1", "IPMAT_INDORE");
    expect(reads).toBe(1);
    expect(counts).toBe(summary.usage.length);
    expect(summary.usage).toEqual([{ meter: "tutor_request", used: 0, limit: 2, period: "day", resetsAt: "2026-10-16T00:00:00.000Z" }]);
  });

  it("without an enrollment (no exam) the summary reads subscriptions once and counts nothing", async () => {
    const c = build();
    let counts = 0;
    c.store.usedInPeriod = async () => { counts += 1; return 0; };
    const summary = await c.commerce.billing.getSummary("s1", null);
    expect(summary.access).toBeNull();
    expect(counts).toBe(0);
  });
});
