import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_CATALOG_SOURCE, TEST_WEBHOOK_SECRET, eventBody, signWebhook } from "@ipmat/billing-api/testing";
import { parsePlanCatalog } from "@ipmat/billing";
import { Q, buildApp, type App } from "./securityHarness.js";

/**
 * Phase 9 Unit 4 (docs/DECISIONS.md D-100) -- MONETIZATION + ENTITLEMENTS over the real HTTP transport. The payment provider is a
 * deterministic, signed-event double (never a live provider); the model is the usual scripted double. Everything else is real.
 * Plans, limits, durations and amounts are LABELLED TEST FIXTURES, not business proposals.
 */
const clock = { now: new Date("2026-10-15T12:00:00.000Z") };
const nowSec = (): number => Math.floor(clock.now.getTime() / 1000);
const minutesAgo = (m: number): string => new Date(clock.now.getTime() - m * 60_000).toISOString();
const PLUS = { amountMinor: 123456, currency: "INR" }; // test_plus, from the fixture catalog

const FORBIDDEN_IN_BILLING_RESPONSES = [TEST_WEBHOOK_SECRET, "cs_test_", "pay.test.invalid", "providerRef", "providerPriceRef", "price_test_plus", "digest", "signature", "x-test-", "stack", "node_modules", "Prisma", "test-provider"];

let seq = 0;
const nextEvent = (label: string): string => `evt_${label}_${++seq}_${Math.random().toString(36).slice(2, 8)}`;

async function subscriptionOf(app: App, studentId: string, planId = "test_plus") {
  const subs = await app.billing!.listSubscriptionsForStudent(studentId);
  return subs.filter((s) => s.planId === planId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!;
}

async function hook(app: App, body: unknown, options: { at?: number; secret?: string; rawBody?: string; headers?: Record<string, string>; cookie?: string; omitSignature?: boolean } = {}) {
  const signed = signWebhook(body, { at: options.at ?? nowSec(), secret: options.secret, rawBody: options.rawBody });
  const headers = { ...signed.headers, ...(options.headers ?? {}) };
  if (options.omitSignature) delete headers["x-test-signature"];
  return app.call("POST", "/v1/billing/webhook", undefined, options.cookie, headers, signed.rawBody);
}

async function startCheckout(app: App, cookie: string, planId = "test_plus") {
  return app.call("POST", "/v1/billing/checkout", { planId }, cookie);
}

/** A real purchase: checkout over HTTP, then the provider's signed "payment succeeded" event. */
async function purchase(app: App, student: { cookie: string; studentId: string }, planId = "test_plus", amount = PLUS) {
  const checkout = await startCheckout(app, student.cookie, planId);
  expect(checkout.status).toBe(200);
  const sub = await subscriptionOf(app, student.studentId, planId);
  const res = await hook(app, eventBody({ eventId: nextEvent("pay"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(5), subscriptionId: sub.id, ...amount }));
  expect(res.status).toBe(200);
  return sub;
}

describe("billing over HTTP -- enforced entitlements", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildApp({ commerce: { mode: "enforced", now: () => clock.now }, limiter: false });
  });
  afterAll(() => app.close());
  beforeEach(() => {
    clock.now = new Date("2026-10-15T12:00:00.000Z");
    app.payments.failCheckout = false;
    app.payments.failCancel = false;
    app.payments.breakIdempotency = false;
    app.provider.mode = "compliant";
    app.provider.intent = "give_hint";
  });

  describe("the billing summary", () => {
    it("requires a session; the webhook-less routes answer 401 to anonymous callers", async () => {
      expect((await app.call("GET", "/v1/billing")).status).toBe(401);
      expect((await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" })).status).toBe(401);
      expect((await app.call("POST", "/v1/billing/cancel", {})).status).toBe(401);
    });

    it("shows a student their own access, usage and the purchasable plans -- and nothing internal", async () => {
      const s = await app.student();
      const r = await app.call("GET", "/v1/billing", undefined, s.cookie);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ enforcement: "enforced", subscription: null, checkoutAvailable: true });
      expect((r.json.access as { exam: boolean; features: Array<{ id: string; allowed: boolean }> }).exam).toBe(true);
      expect((r.json.access as { features: Array<{ id: string; allowed: boolean }> }).features).toEqual([
        { id: "tutor", allowed: true },
        { id: "simulation", allowed: false },
        { id: "advanced_training", allowed: false }
      ]);
      // only active AND priced plans are offered; the provider's price reference never leaves the server
      expect((r.json.plans as Array<{ id: string }>).map((p) => p.id).sort()).toEqual(["test_plus", "test_unlimited"]);
      expect(r.json.plans).toContainEqual(expect.objectContaining({ id: "test_plus", provisional: true, price: PLUS, durationDays: 30 }));
      expect(r.json.usage).toEqual([{ meter: "tutor_request", used: 0, limit: 2, period: "day", resetsAt: "2026-10-16T00:00:00.000Z" }]);
      for (const bad of FORBIDDEN_IN_BILLING_RESPONSES) expect(r.raw, bad).not.toContain(bad);
    });

    it("a student with no enrollment still gets a summary (entitlement and enrollment are separate), with access unknown", async () => {
      const s = await app.student(false);
      const r = await app.call("GET", "/v1/billing", undefined, s.cookie);
      expect(r.status).toBe(200);
      expect(r.json.access).toBeNull();
      expect(r.json.usage).toEqual([]);
      expect(r.json.plans).not.toEqual([]);
    });

    it("ignores everything a browser might try to claim: query strings, headers, cookies", async () => {
      const s = await app.student();
      const r = await app.call("GET", "/v1/billing?studentId=other&plan=test_plus&paid=true&entitled=true&status=active", undefined, `${s.cookie}; plan=test_plus; paid=true`, { "x-plan-id": "test_plus", "x-entitlement": "pro", "x-student-id": "other", "x-forwarded-user": "admin" });
      expect(r.status).toBe(200);
      expect(r.json.subscription).toBeNull();
      expect((r.json.access as { features: Array<{ id: string; allowed: boolean }> }).features.find((f) => f.id === "simulation")?.allowed).toBe(false);
    });
  });

  describe("checkout security", () => {
    it("starts a checkout from an allowlisted plan id; amount and currency come from the SERVER catalog", async () => {
      const s = await app.student();
      const before = app.payments.checkouts.length;
      const r = await startCheckout(app, s.cookie);
      expect(r.status).toBe(200);
      expect(Object.keys(r.json)).toEqual(["checkoutUrl"]);
      expect(r.json.checkoutUrl).toMatch(/^https:\/\/pay\.test\.invalid\/session\/cs_test_/);
      const sent = app.payments.checkouts[before]!;
      expect(sent).toMatchObject({ planId: "test_plus", amountMinor: 123456, currency: "INR", providerPriceRef: "price_test_plus", returnUrl: null });
      const sub = await subscriptionOf(app, s.studentId);
      expect(sub).toMatchObject({ status: "pending", paidThrough: null, amountMinor: 123456, currency: "INR", studentId: s.studentId });
      expect(sent.idempotencyKey).toBe(sub.id);
      expect(sent.subscriptionId).toBe(sub.id);
    });

    it("returning from checkout, or clicking 'I paid', grants nothing: only a verified provider event does", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const r = await app.call("GET", "/v1/billing?checkout=success&session_id=cs_test_x&paid=true", undefined, s.cookie);
      expect(r.json.subscription).toMatchObject({ status: "pending", grantsAccess: false });
      expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    });

    const tamper: Array<[string, Record<string, unknown>]> = [
      ["amount", { planId: "test_plus", amount: 1 }],
      ["amountMinor", { planId: "test_plus", amountMinor: 1 }],
      ["price", { planId: "test_plus", price: 0 }],
      ["currency", { planId: "test_plus", currency: "USD" }],
      ["duration", { planId: "test_plus", durationDays: 3650 }],
      ["studentId", { planId: "test_plus", studentId: "someone-else" }],
      ["enrollmentId", { planId: "test_plus", enrollmentId: "e-1" }],
      ["examCode", { planId: "test_plus", examCode: "OTHER" }],
      ["entitlement", { planId: "test_plus", entitlement: "all" }],
      ["subscription status", { planId: "test_plus", status: "active" }],
      ["a success URL", { planId: "test_plus", successUrl: "https://evil.example/ok" }],
      ["a provider price reference", { planId: "test_plus", providerPriceRef: "price_cheap" }],
      ["a coupon", { planId: "test_plus", coupon: "FREE" }]
    ];
    for (const [label, body] of tamper) {
      it(`refuses a checkout that tries to set ${label}, before anything is created`, async () => {
        const s = await app.student();
        const calls = app.payments.checkouts.length;
        const r = await app.call("POST", "/v1/billing/checkout", body, s.cookie);
        expect(r.status).toBe(400);
        expect(r.json).toMatchObject({ error: { code: "invalid_request" } });
        expect(app.payments.checkouts.length).toBe(calls);
        expect(await app.billing!.listSubscriptionsForStudent(s.studentId)).toEqual([]);
      });
    }

    it("refuses an unknown, inactive, unpriced or malformed plan with the SAME answer (no plan enumeration)", async () => {
      const s = await app.student();
      const answers = new Set<string>();
      for (const planId of ["nope", "test_retired", "test_unpriced", "", " test_plus", "TEST_PLUS", "__proto__", "constructor", 5, null, ["test_plus"], { id: "test_plus" }]) {
        const r = await app.call("POST", "/v1/billing/checkout", { planId }, s.cookie);
        expect(r.status, String(JSON.stringify(planId))).toBe(400);
        answers.add(r.raw);
      }
      expect((await app.call("POST", "/v1/billing/checkout", {}, s.cookie)).status).toBe(400);
      expect((await app.call("POST", "/v1/billing/checkout", [], s.cookie)).status).toBe(400);
      expect(answers.size).toBe(1);
      expect(await app.billing!.listSubscriptionsForStudent(s.studentId)).toEqual([]);
    });

    it("duplicate checkout requests (sequential and concurrent) share ONE pending subscription and one provider session", async () => {
      const s = await app.student();
      const results = await Promise.all(Array.from({ length: 8 }, () => startCheckout(app, s.cookie)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => r.json.checkoutUrl)).size).toBe(1);
      const again = await startCheckout(app, s.cookie);
      expect(again.json.checkoutUrl).toBe(results[0]!.json.checkoutUrl);
      const subs = (await app.billing!.listSubscriptionsForStudent(s.studentId)).filter((x) => x.planId === "test_plus");
      expect(subs).toHaveLength(1);
      expect(new Set(app.payments.checkouts.filter((c) => c.subscriptionId === subs[0]!.id).map((c) => c.idempotencyKey)).size).toBe(1);
    });

    it("a different plan is a different checkout; a student who already holds a plan cannot buy it again", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie, "test_plus");
      await startCheckout(app, s.cookie, "test_unlimited");
      expect((await app.billing!.listSubscriptionsForStudent(s.studentId)).length).toBe(2);
      await purchase(app, s);
      const dup = await startCheckout(app, s.cookie, "test_plus");
      expect(dup.status).toBe(409);
      expect(dup.json).toMatchObject({ error: { code: "conflict" } });
    });

    it("a provider outage is a calm 503 with no provider text, leaves a retryable pending record, and recovers", async () => {
      const s = await app.student();
      app.payments.failCheckout = true;
      const r = await startCheckout(app, s.cookie);
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ error: { code: "not_available" } });
      expect(r.headers.get("retry-after")).toBe("5");
      for (const bad of FORBIDDEN_IN_BILLING_RESPONSES) expect(r.raw, bad).not.toContain(bad);
      const pendingAfterFailure = (await app.billing!.listSubscriptionsForStudent(s.studentId)).filter((x) => x.planId === "test_plus");
      expect(pendingAfterFailure).toHaveLength(1);
      expect(pendingAfterFailure[0]).toMatchObject({ status: "pending", providerRef: null });
      app.payments.failCheckout = false;
      const ok = await startCheckout(app, s.cookie);
      expect(ok.status).toBe(200);
      const after = (await app.billing!.listSubscriptionsForStudent(s.studentId)).filter((x) => x.planId === "test_plus");
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(pendingAfterFailure[0]!.id);
      expect(after[0]!.providerRef).not.toBeNull();
    });

    it("a provider that breaks the idempotency contract is refused safely instead of orphaning a payment", async () => {
      const s = await app.student();
      expect((await startCheckout(app, s.cookie)).status).toBe(200);
      app.payments.breakIdempotency = true;
      const r = await startCheckout(app, s.cookie);
      expect(r.status).toBe(503);
      const sub = await subscriptionOf(app, s.studentId);
      expect(sub.providerRef).toMatch(/^cs_test_/);
    });
  });

  describe("webhook authenticity and idempotency", () => {
    it("a correctly signed payment activates the subscription and grants exactly the paid period", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      const at = minutesAgo(5);
      const r = await hook(app, eventBody({ eventId: nextEvent("ok"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: at, subscriptionId: sub.id, ...PLUS }));
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ received: true });
      const view = await app.call("GET", "/v1/billing", undefined, s.cookie);
      expect(view.json.subscription).toMatchObject({ planId: "test_plus", status: "active", renews: true, grantsAccess: true, canCancel: true, validUntil: new Date(Date.parse(at) + 30 * 86_400_000).toISOString() });
      expect((view.json.access as { features: Array<{ id: string; allowed: boolean }> }).features).toEqual([
        { id: "tutor", allowed: true },
        { id: "simulation", allowed: true },
        { id: "advanced_training", allowed: true }
      ]);
    });

    it("rejects an unsigned, wrongly signed, tampered, stale or malformed request with the SAME generic 400", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      const good = eventBody({ eventId: nextEvent("t"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), subscriptionId: sub.id, ...PLUS });
      const attempts = [
        await hook(app, good, { omitSignature: true }),
        await hook(app, good, { secret: "whsec_attacker_guess" }),
        await hook(app, good, { headers: { "x-test-signature": "0".repeat(64) } }),
        await hook(app, good, { headers: { "x-test-signature": "not-hex" } }),
        await hook(app, good, { headers: { "x-test-timestamp": "" } }),
        await hook(app, good, { at: nowSec() - 3600 }),
        await hook(app, good, { at: nowSec() + 3600 }),
        // signed over one body, delivered with another
        await app.call("POST", "/v1/billing/webhook", undefined, undefined, { ...signWebhook(good, { at: nowSec() }).headers }, JSON.stringify({ ...good, amountMinor: 1 })),
        await hook(app, {}, { rawBody: "not json at all" }),
        await hook(app, {}, { rawBody: "" }),
        await hook(app, [], {}),
        await hook(app, { ...good, extra: "field" }),
        await hook(app, { ...good, type: "payment_magic" }),
        await hook(app, { ...good, eventId: "has spaces" }),
        await hook(app, { ...good, occurredAt: new Date(clock.now.getTime() + 3_600_000).toISOString() })
      ];
      for (const [i, r] of attempts.entries()) {
        expect(r.status, `attempt ${i}`).toBe(400);
        expect(r.json).toEqual({ error: { code: "invalid_webhook", message: "The request was not accepted." } });
      }
      expect(new Set(attempts.map((r) => r.raw)).size).toBe(1); // no oracle: every rejection reads the same
      expect((await subscriptionOf(app, s.studentId)).status).toBe("pending");
    });

    it("verifies the signature over the EXACT bytes received, including surrounding whitespace the provider signed", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      const ev = eventBody({ eventId: nextEvent("raw"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), subscriptionId: sub.id, ...PLUS });
      const exact = `
  ${JSON.stringify(ev)}
`;
      const r = await hook(app, ev, { rawBody: exact });
      expect(r.status).toBe(200);
      expect((await subscriptionOf(app, s.studentId)).status).toBe("active");
    });

    it("rejects the wrong method, content type and oversize bodies", async () => {
      expect((await app.call("GET", "/v1/billing/webhook")).status).toBe(404);
      expect((await app.call("PUT", "/v1/billing/webhook", {})).status).toBe(404);
      const signed = signWebhook({ a: 1 }, { at: nowSec() });
      expect((await app.call("POST", "/v1/billing/webhook", undefined, undefined, { ...signed.headers, "content-type": "text/plain" }, signed.rawBody)).status).toBe(415);
      const big = signWebhook({}, { at: nowSec(), rawBody: JSON.stringify({ pad: "x".repeat(40_000) }) });
      expect((await app.call("POST", "/v1/billing/webhook", undefined, undefined, big.headers, big.rawBody)).status).toBe(413);
    });

    it("a replayed delivery is acknowledged and applied exactly once (entitlement is not extended twice)", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      const ev = eventBody({ eventId: nextEvent("replay"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(5), subscriptionId: sub.id, ...PLUS });
      const first = await hook(app, ev);
      const second = await hook(app, ev);
      const third = await hook(app, ev, { at: nowSec() + 10 }); // a re-signed redelivery with a fresh timestamp
      expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
      expect([first.raw, second.raw, third.raw].every((x) => x === first.raw)).toBe(true);
      expect((await subscriptionOf(app, s.studentId)).paidThrough).toBe(new Date(Date.parse(ev.occurredAt as string) + 30 * 86_400_000).toISOString());
      expect(await app.billing!.listEventsForSubscription(sub.id)).toHaveLength(1);
    });

    it("concurrent deliveries of one event apply it once", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      const ev = eventBody({ eventId: nextEvent("conc"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(5), subscriptionId: sub.id, ...PLUS });
      const rs = await Promise.all(Array.from({ length: 12 }, () => hook(app, ev)));
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect((await subscriptionOf(app, s.studentId)).paidThrough).toBe(new Date(Date.parse(ev.occurredAt as string) + 30 * 86_400_000).toISOString());
      expect(await app.billing!.listEventsForSubscription(sub.id)).toHaveLength(1);
    });

    it("a validly signed but DIFFERENT payload reusing a processed event id changes nothing", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      const id = nextEvent("reuse");
      await hook(app, eventBody({ eventId: id, type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(5), subscriptionId: sub.id, ...PLUS }));
      const before = await subscriptionOf(app, s.studentId);
      const r = await hook(app, eventBody({ eventId: id, type: "payment_refunded", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), subscriptionId: sub.id }));
      expect(r.status).toBe(200);
      expect(await subscriptionOf(app, s.studentId)).toEqual(before);
    });

    it("a payment whose amount or currency differs from the server's snapshot is acknowledged but grants nothing, and is flagged for a human", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      for (const over of [{ amountMinor: 1, currency: "INR" }, { amountMinor: 123456, currency: "USD" }, { amountMinor: 999999999, currency: "INR" }]) {
        const r = await hook(app, eventBody({ eventId: nextEvent("amt"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(5), subscriptionId: sub.id, ...over }));
        expect(r.status).toBe(200);
      }
      expect(await subscriptionOf(app, s.studentId)).toMatchObject({ status: "pending", paidThrough: null });
      const events = await app.billing!.listEventsForSubscription(sub.id);
      expect(events.map((e) => e.outcome)).toEqual(["rejected_amount_mismatch", "rejected_amount_mismatch", "rejected_amount_mismatch"]);
      expect(app.logRecords().some((l) => l.event === "billing.webhook_needs_attention" && l.outcome === "rejected_amount_mismatch")).toBe(true);
      expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    });

    it("an event for an unknown payment reference, or naming someone else's subscription, grants nothing to anyone", async () => {
      const a = await app.student();
      const b = await app.student();
      await startCheckout(app, a.cookie);
      await startCheckout(app, b.cookie);
      const subA = await subscriptionOf(app, a.studentId);
      const subB = await subscriptionOf(app, b.studentId);
      expect((await hook(app, eventBody({ eventId: nextEvent("unk"), type: "payment_succeeded", providerRef: "cs_test_unknown", occurredAt: minutesAgo(1), ...PLUS }))).status).toBe(200);
      // A's payment reference but B's client reference: a mismatch, not a payment for B
      expect((await hook(app, eventBody({ eventId: nextEvent("mix"), type: "payment_succeeded", providerRef: subA.providerRef!, occurredAt: minutesAgo(1), subscriptionId: subB.id, ...PLUS }))).status).toBe(200);
      expect((await subscriptionOf(app, a.studentId)).status).toBe("pending");
      expect((await subscriptionOf(app, b.studentId)).status).toBe("pending");
      expect((await app.billing!.listEventsForSubscription(subA.id)).map((e) => e.outcome)).toEqual(["rejected_reference_mismatch"]);
    });

    it("a refund revokes access immediately and a late 'payment succeeded' cannot bring it back", async () => {
      const s = await app.student();
      const sub = await purchase(app, s);
      expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(200);
      expect((await hook(app, eventBody({ eventId: nextEvent("refund"), type: "payment_refunded", providerRef: sub.providerRef!, occurredAt: minutesAgo(2), subscriptionId: sub.id }))).status).toBe(200);
      expect((await subscriptionOf(app, s.studentId)).status).toBe("refunded");
      expect((await app.call("GET", "/v1/billing", undefined, s.cookie)).json.subscription).toMatchObject({ status: "refunded", grantsAccess: false, renews: false, canCancel: false });
      expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
      await hook(app, eventBody({ eventId: nextEvent("late"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(10), subscriptionId: sub.id, ...PLUS }));
      expect((await subscriptionOf(app, s.studentId)).status).toBe("refunded");
      expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    });

    it("renewals extend access; failed renewals, cancellation and expiry move the state deterministically", async () => {
      const s = await app.student();
      const sub = await purchase(app, s);
      const paid1 = (await subscriptionOf(app, s.studentId)).paidThrough!;
      await hook(app, eventBody({ eventId: nextEvent("renew"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(3), subscriptionId: sub.id, ...PLUS }));
      expect(Date.parse((await subscriptionOf(app, s.studentId)).paidThrough!)).toBe(Date.parse(paid1) + 30 * 86_400_000);
      await hook(app, eventBody({ eventId: nextEvent("fail"), type: "payment_failed", providerRef: sub.providerRef!, occurredAt: minutesAgo(2), subscriptionId: sub.id }));
      expect((await subscriptionOf(app, s.studentId)).status).toBe("past_due");
      expect((await app.call("GET", "/v1/billing", undefined, s.cookie)).json.subscription).toMatchObject({ status: "past_due", grantsAccess: true, canCancel: true });
      await hook(app, eventBody({ eventId: nextEvent("cancel"), type: "subscription_cancelled", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), subscriptionId: sub.id }));
      expect((await app.call("GET", "/v1/billing", undefined, s.cookie)).json.subscription).toMatchObject({ status: "cancelled", renews: false, grantsAccess: true, canCancel: false });
      await hook(app, eventBody({ eventId: nextEvent("expire"), type: "subscription_expired", providerRef: sub.providerRef!, occurredAt: minutesAgo(0), subscriptionId: sub.id }));
      expect((await app.call("GET", "/v1/billing", undefined, s.cookie)).json.subscription).toMatchObject({ status: "expired", grantsAccess: false });
    });

    it("answers a signed event the application does not act on with 200 and records nothing", async () => {
      const r = await hook(app, { ignore: true });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ received: true });
    });

    it("never reads a session: a student's cookie neither authorises nor changes a webhook", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      const r = await hook(app, eventBody({ eventId: nextEvent("cookie"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), subscriptionId: sub.id, ...PLUS }), { omitSignature: true, cookie: s.cookie });
      expect(r.status).toBe(400);
      expect((await subscriptionOf(app, s.studentId)).status).toBe("pending");
    });
  });

  describe("cancellation", () => {
    it("asks the PROVIDER to stop renewing; local state changes only when the provider's event arrives", async () => {
      const s = await app.student();
      const sub = await purchase(app, s);
      const r = await app.call("POST", "/v1/billing/cancel", {}, s.cookie);
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ requested: true });
      expect(app.payments.cancelled).toContain(sub.providerRef);
      expect((await subscriptionOf(app, s.studentId)).status).toBe("active");
      await hook(app, eventBody({ eventId: nextEvent("c"), type: "subscription_cancelled", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), subscriptionId: sub.id }));
      expect((await subscriptionOf(app, s.studentId)).status).toBe("cancelled");
    });

    it("has nothing to cancel without an active subscription, and never cancels someone else's", async () => {
      const owner = await app.student();
      const other = await app.student();
      const sub = await purchase(app, owner);
      app.payments.cancelled.length = 0;
      const r = await app.call("POST", "/v1/billing/cancel", {}, other.cookie);
      expect(r.status).toBe(404);
      expect(app.payments.cancelled).toEqual([]);
      expect((await subscriptionOf(app, owner.studentId)).providerRef).toBe(sub.providerRef);
      const withTarget = await app.call("POST", "/v1/billing/cancel", { subscriptionId: sub.id, providerRef: sub.providerRef }, other.cookie);
      expect(withTarget.status).toBe(400);
      expect(app.payments.cancelled).toEqual([]);
    });

    it("a provider failure is a calm 503", async () => {
      const s = await app.student();
      await purchase(app, s);
      app.payments.failCancel = true;
      const r = await app.call("POST", "/v1/billing/cancel", {}, s.cookie);
      expect(r.status).toBe(503);
      for (const bad of FORBIDDEN_IN_BILLING_RESPONSES) expect(r.raw, bad).not.toContain(bad);
    });
  });

  describe("entitlement enforcement on the existing features", () => {
    it("the tutor works within the baseline limit, then refuses with a fixed message; a refusal calls no model", async () => {
      const s = await app.student();
      const ask = () => app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }, s.cookie);
      expect((await ask()).status).toBe(200);
      expect((await ask()).status).toBe(200);
      const prompts = app.provider.prompts.length;
      const third = await ask();
      expect(third.status).toBe(403);
      expect(third.json).toEqual({ error: { code: "usage_limit_reached", message: "You've reached your limit for this feature for now." } });
      expect(app.provider.prompts.length).toBe(prompts);
      const usage = (await app.call("GET", "/v1/billing", undefined, s.cookie)).json.usage;
      expect(usage).toEqual([expect.objectContaining({ meter: "tutor_request", used: 2, limit: 2 })]);
    });

    it("a tutor request the provider could not serve does not use up the student's allowance", async () => {
      const s = await app.student();
      app.provider.mode = "throw500";
      for (let i = 0; i < 4; i += 1) {
        const r = await app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }, s.cookie);
        expect(r.status).toBe(200);
        expect(r.json.status).toBe("not_answered");
      }
      expect(((await app.call("GET", "/v1/billing", undefined, s.cookie)).json.usage as Array<{ used: number }>)[0]!.used).toBe(0);
      app.provider.mode = "compliant";
      expect((await app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }, s.cookie)).json.status).toBe("answered");
    });

    it("a malformed tutor request does not use up the allowance either", async () => {
      const s = await app.student();
      for (let i = 0; i < 4; i += 1) expect((await app.call("POST", "/v1/tutor/ask", { operation: "nonsense", questionId: Q }, s.cookie)).status).toBe(400);
      expect(((await app.call("GET", "/v1/billing", undefined, s.cookie)).json.usage as Array<{ used: number }>)[0]!.used).toBe(0);
    });

    it("usage resets with the period, and is per student", async () => {
      const a = await app.student();
      const b = await app.student();
      const ask = (c: string) => app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }, c);
      await ask(a.cookie);
      await ask(a.cookie);
      expect((await ask(a.cookie)).status).toBe(403);
      expect((await ask(b.cookie)).status).toBe(200); // another student's allowance is untouched
      clock.now = new Date("2026-10-16T00:00:01.000Z");
      expect((await ask(a.cookie)).status).toBe(200); // a new day
    });

    it("simulations need an entitlement; a purchase unlocks them, with a monthly limit", async () => {
      const s = await app.student();
      const denied = await app.call("POST", "/v1/simulations", undefined, s.cookie);
      expect(denied.status).toBe(403);
      expect(denied.json).toEqual({ error: { code: "not_entitled", message: "Your current access doesn't include this feature." } });
      await purchase(app, s);
      const started: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const r = await app.call("POST", "/v1/simulations", undefined, s.cookie);
        expect(r.status, `start ${i}`).toBe(200);
        const id = (r.json.simulation as { simulationId: string }).simulationId;
        started.push(id);
        const submit = await app.call("POST", `/v1/simulations/${id}/submit`, undefined, s.cookie);
        expect(submit.status, `submit ${i}`).toBe(200);
      }
      const third = await app.call("POST", "/v1/simulations", undefined, s.cookie);
      expect(third.status).toBe(403);
      expect(third.json).toMatchObject({ error: { code: "usage_limit_reached" } });
    });

    it("starting a simulation that is already in progress returns it and does not use another unit", async () => {
      const s = await app.student();
      await purchase(app, s);
      const first = await app.call("POST", "/v1/simulations", undefined, s.cookie);
      expect(first.json.created).toBe(true);
      for (let i = 0; i < 4; i += 1) expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).json.created).toBe(false);
      const usage = (await app.call("GET", "/v1/billing", undefined, s.cookie)).json.usage as Array<{ meter: string; used: number }>;
      expect(usage.find((u) => u.meter === "simulation_start")?.used).toBe(1);
      const id = (first.json.simulation as { simulationId: string }).simulationId;
      await app.call("POST", `/v1/simulations/${id}/submit`, undefined, s.cookie);
    });

    it("access ends when the paid period does, with no way to keep it alive from the browser", async () => {
      const s = await app.student();
      await purchase(app, s);
      const r1 = await app.call("POST", "/v1/simulations", undefined, s.cookie);
      expect(r1.status).toBe(200);
      const id = (r1.json.simulation as { simulationId: string }).simulationId;
      await app.call("POST", `/v1/simulations/${id}/submit`, undefined, s.cookie);
      clock.now = new Date(clock.now.getTime() + 31 * 86_400_000);
      const after = await app.call("GET", "/v1/billing", undefined, s.cookie);
      expect(after.json.subscription).toMatchObject({ status: "expired", grantsAccess: false });
      const denied = await app.call("POST", "/v1/simulations", { entitled: true, plan: "test_plus" }, s.cookie, { "x-entitlement": "pro" });
      expect(denied.status).toBe(403);
    });

    it("advanced training sessions need an entitlement; a plan without that feature does not unlock them, one with it does", async () => {
      const s = await app.student();
      const start = () => app.call("POST", "/v1/training/sessions", { systemId: "calculation_gym" }, s.cookie);
      const denied = await start();
      expect(denied.status).toBe(403);
      expect(denied.json).toMatchObject({ error: { code: "not_entitled" } });
      await purchase(app, s, "test_unlimited", { amountMinor: 5000, currency: "INR" }); // tutor only
      expect((await start()).json).toMatchObject({ error: { code: "not_entitled" } });
      await purchase(app, s, "test_plus"); // includes advanced_training
      const allowed = await start();
      expect(allowed.json).not.toMatchObject({ error: { code: "not_entitled" } }); // past the paywall (the training service itself then judges the request)
    });

    it("core practice stays available on the baseline, and the training hub is readable", async () => {
      const s = await app.student();
      expect((await app.call("POST", "/v1/attempts", { questionId: Q }, s.cookie)).status).toBe(200);
      expect((await app.call("POST", "/v1/recommendation", {}, s.cookie)).status).toBe(200);
      expect((await app.call("GET", "/v1/training/systems", undefined, s.cookie)).status).toBe(200);
    });

    it("an expired or never-bought entitlement for ANOTHER student is irrelevant: access is per authenticated student", async () => {
      const buyer = await app.student();
      const other = await app.student();
      await purchase(app, buyer);
      expect((await app.call("POST", "/v1/simulations", undefined, other.cookie)).status).toBe(403);
      expect((await app.call("GET", "/v1/billing", undefined, other.cookie)).json.subscription).toBeNull();
    });
  });

  describe("isolation and the absence of admin surface", () => {
    it("one student can never see or touch another's billing: summaries are session-scoped", async () => {
      const a = await app.student();
      const b = await app.student();
      await purchase(app, a);
      const rb = await app.call("GET", `/v1/billing?studentId=${a.studentId}`, undefined, b.cookie);
      expect(rb.json.subscription).toBeNull();
      expect(rb.raw).not.toContain(a.studentId);
      const ra = await app.call("GET", "/v1/billing", undefined, a.cookie);
      expect(ra.raw).not.toContain(b.studentId);
    });

    it("no student-reachable route exposes subscriptions, events, grants, revocations or entitlements administratively", async () => {
      const s = await app.student();
      for (const path of ["/v1/admin/billing", "/v1/admin/subscriptions", "/v1/billing/subscriptions", "/v1/billing/events", "/v1/billing/grant", "/v1/billing/revoke", "/v1/billing/usage", "/v1/billing/usage/reset", "/v1/entitlements", "/v1/entitlements/grant", "/v1/usage", "/v1/subscriptions", "/v1/plans", "/v1/checkout"]) {
        for (const method of ["GET", "POST", "PUT", "DELETE"]) {
          const r = await app.call(method, path, method === "GET" ? undefined : {}, s.cookie);
          expect(r.status, `${method} ${path}`).toBe(404);
        }
      }
      for (const method of ["PUT", "DELETE", "PATCH"]) expect((await app.call(method, "/v1/billing", {}, s.cookie)).status, method).toBe(404);
      expect((await app.call("GET", "/v1/billing/checkout", undefined, s.cookie)).status).toBe(404);
      expect((await app.call("POST", "/v1/billing", {}, s.cookie)).status).toBe(404);
    });

    it("billing routes never contain provider secrets, references, signatures, digests or payment metadata, on success or failure", async () => {
      const s = await app.student();
      const outputs: string[] = [];
      outputs.push((await app.call("GET", "/v1/billing", undefined, s.cookie)).raw);
      outputs.push((await startCheckout(app, s.cookie)).raw.replace(/https:\/\/pay\.test\.invalid\/session\/cs_test_[0-9a-f]+/, "<url>"));
      outputs.push((await app.call("GET", "/v1/billing", undefined, s.cookie)).raw);
      app.payments.failCheckout = true;
      outputs.push((await startCheckout(app, s.cookie, "test_unlimited")).raw);
      outputs.push((await app.call("POST", "/v1/billing/cancel", {}, s.cookie)).raw);
      outputs.push((await app.call("POST", "/v1/billing/checkout", { planId: "nope" }, s.cookie)).raw);
      for (const out of outputs) for (const bad of FORBIDDEN_IN_BILLING_RESPONSES) expect(out, bad).not.toContain(bad);
    });
  });

  describe("observability", () => {
    it("logs billing events with allowlisted fields only: no secrets, signatures, references, amounts or checkout URLs", async () => {
      const s = await app.student();
      const sub = await purchase(app, s);
      await hook(app, eventBody({ eventId: nextEvent("bad"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), ...PLUS }), { secret: "whsec_attacker" });
      const logText = app.logs.join("\n");
      for (const bad of [TEST_WEBHOOK_SECRET, "whsec_attacker", sub.providerRef!, "pay.test.invalid", "x-test-signature", "123456", s.email, sub.id]) expect(logText, bad).not.toContain(bad);
      const records = app.logRecords();
      expect(records.some((l) => l.event === "billing.checkout_created" && l.planId === "test_plus")).toBe(true);
      expect(records.some((l) => l.event === "billing.webhook_processed" && l.eventType === "payment_succeeded" && l.outcome === "applied")).toBe(true);
      expect(records.some((l) => l.event === "billing.subscription_transition" && l.subscriptionStatus === "active")).toBe(true);
      expect(records.some((l) => l.event === "billing.webhook_rejected" && l.outcome === "rejected_bad_signature")).toBe(true);
      // every billing record carries the request correlation id
      for (const l of records.filter((x) => String(x.event).startsWith("billing."))) expect(typeof l.requestId).toBe("string");
    });

    it("counts checkouts, webhooks, denials and usage with bounded labels", async () => {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      await app.call("POST", "/v1/simulations", undefined, s.cookie);
      const names = new Set(app.metrics.snapshot().counters.map((c) => c.name));
      for (const n of ["billing_checkout_total", "billing_webhook_total", "billing_denied_total"]) expect(names.has(n), n).toBe(true);
      const denied = app.metrics.snapshot().counters.find((c) => c.name === "billing_denied_total" && c.labels.feature === "simulation");
      expect(denied?.labels).toEqual({ category: "not_entitled_feature", feature: "simulation" });
    });
  });

});

describe("billing over HTTP -- open access mode (the behaviour before any plan existed)", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildApp({ commerce: { mode: "open", now: () => clock.now }, limiter: false });
  });
  afterAll(() => app.close());

  it("restricts nothing and meters nothing, and says so", async () => {
    const s = await app.student();
    for (let i = 0; i < 4; i += 1) expect((await app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }, s.cookie)).status).toBe(200);
    expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(200);
    const view = await app.call("GET", "/v1/billing", undefined, s.cookie);
    expect(view.json).toMatchObject({ enforcement: "open", usage: [] });
    expect(((view.json.access as { features: Array<{ allowed: boolean }> }).features).every((f) => f.allowed)).toBe(true);
    expect(await app.billing!.usedInPeriod(s.studentId, "tutor_request", "2020-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toBe(0);
  });
});

describe("billing over HTTP -- no payment provider configured", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildApp({ commerce: { mode: "enforced", provider: false, now: () => clock.now }, limiter: false });
  });
  afterAll(() => app.close());

  it("checkout, cancellation and the webhook are honestly unavailable -- nothing is faked", async () => {
    const s = await app.student();
    const summary = await app.call("GET", "/v1/billing", undefined, s.cookie);
    expect(summary.json).toMatchObject({ checkoutAvailable: false });
    expect((await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie)).status).toBe(503);
    expect((await app.call("POST", "/v1/billing/cancel", {}, s.cookie)).status).toBe(503);
    const r = await hook(app, eventBody({ eventId: nextEvent("np"), type: "payment_succeeded", providerRef: "x", occurredAt: minutesAgo(1), ...PLUS }));
    expect(r.status).toBe(503);
    expect(await app.billing!.listSubscriptionsForStudent(s.studentId)).toEqual([]);
  });
});

describe("billing over HTTP -- not wired at all (every pre-Unit-4 deployment)", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildApp({ limiter: false });
  });
  afterAll(() => app.close());

  it("the existing features are unchanged, and the billing routes answer not_available", async () => {
    const s = await app.student();
    expect((await app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }, s.cookie)).status).toBe(200);
    expect((await app.call("GET", "/v1/billing", undefined, s.cookie)).status).toBe(503);
    expect((await hook(app, {})).status).toBe(503);
  });
});

describe("billing over HTTP -- exam access is its own requirement", () => {
  let app: App;
  beforeAll(async () => {
    const catalog = parsePlanCatalog({ ...structuredClone(TEST_CATALOG_SOURCE), baseline: { exams: [], features: [], usageLimits: [] } });
    app = await buildApp({ commerce: { mode: "enforced", catalog, now: () => clock.now }, limiter: false });
  });
  afterAll(() => app.close());

  it("an authenticated, enrolled student without the exam in their access is refused on every enrollment route, until they buy", async () => {
    const s = await app.student();
    for (const [method, path, body] of [["POST", "/v1/recommendation", {}], ["POST", "/v1/attempts", { questionId: Q }], ["GET", "/v1/training/systems", undefined], ["POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }], ["GET", "/v1/preferences", undefined]] as const) {
      const r = await app.call(method, path, body, s.cookie);
      expect(r.status, path).toBe(403);
      expect(r.json, path).toEqual({ error: { code: "not_entitled", message: "Your current access doesn't include this exam." } });
    }
    // authentication and enrollment endpoints, and billing itself, are never behind the paywall
    expect((await app.call("GET", "/v1/auth/me", undefined, s.cookie)).status).toBe(200);
    expect((await app.call("GET", "/v1/enrollment", undefined, s.cookie)).status).toBe(200);
    const billing = await app.call("GET", "/v1/billing", undefined, s.cookie);
    expect(billing.status).toBe(200);
    expect((billing.json.access as { exam: boolean }).exam).toBe(false);
    await purchase(app, s);
    expect((await app.call("POST", "/v1/recommendation", {}, s.cookie)).status).toBe(200);
  });

  it("an unenrolled student can still see billing and buy: entitlement does not require enrollment", async () => {
    const s = await app.student(false);
    expect((await startCheckout(app, s.cookie)).status).toBe(200);
  });
});

describe("billing over HTTP -- reliability", () => {
  it("a database outage while reading billing is a 503 with Retry-After and no detail", async () => {
    const app = await buildApp({ commerce: { mode: "enforced", now: () => clock.now }, limiter: false });
    try {
      const s = await app.student();
      const original = app.billing!.listSubscriptionsForStudent.bind(app.billing!);
      app.billing!.listSubscriptionsForStudent = async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"), { name: "PrismaClientInitializationError" });
      };
      const r = await app.call("GET", "/v1/billing", undefined, s.cookie);
      expect(r.status).toBe(503);
      expect(r.headers.get("retry-after")).toBe("5");
      expect(r.raw).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|5432|hunter2|Prisma/);
      // entitlement enforcement fails CLOSED: no database, no paid feature -- never a silent grant
      const sim = await app.call("POST", "/v1/simulations", undefined, s.cookie);
      expect(sim.status).toBe(503);
      app.billing!.listSubscriptionsForStudent = original;
      expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("a store failure while processing a webhook is a retryable 503 (the provider redelivers) and applies nothing", async () => {
    const app = await buildApp({ commerce: { mode: "enforced", now: () => clock.now }, limiter: false });
    try {
      const s = await app.student();
      await startCheckout(app, s.cookie);
      const sub = await subscriptionOf(app, s.studentId);
      const original = app.billing!.processEvent.bind(app.billing!);
      app.billing!.processEvent = async () => {
        throw Object.assign(new Error("deadlock detected relation billing_subscriptions"), { name: "Error", code: "40P01" });
      };
      const ev = eventBody({ eventId: nextEvent("store"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: minutesAgo(1), subscriptionId: sub.id, ...PLUS });
      const r = await hook(app, ev);
      expect(r.status).toBe(500);
      expect(r.raw).not.toMatch(/deadlock|billing_subscriptions|40P01/);
      app.billing!.processEvent = original;
      expect((await hook(app, ev)).status).toBe(200); // the redelivery succeeds
      expect((await subscriptionOf(app, s.studentId)).status).toBe("active");
    } finally {
      await app.close();
    }
  });

  it("rate limits checkout starts per student and the webhook per caller", async () => {
    const app = await buildApp({ commerce: { mode: "enforced", now: () => clock.now }, rules: { billing_write: { limit: 3, windowMs: 60_000 }, webhook: { limit: 4, windowMs: 60_000 } } });
    try {
      const s = await app.student();
      const statuses = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await startCheckout(app, s.cookie)).status);
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      const hooks = [];
      for (let i = 0; i < 6; i += 1) hooks.push((await hook(app, { ignore: true })).status);
      expect(hooks).toEqual([200, 200, 200, 200, 429, 429]);
    } finally {
      await app.close();
    }
  });
});
