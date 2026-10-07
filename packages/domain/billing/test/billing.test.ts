import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CatalogError,
  EntitlementService,
  MAX_AMOUNT_MINOR,
  UsageService,
  WebhookRejectedError,
  applyBillingEvent,
  effectiveStatus,
  findPurchasablePlan,
  grantsAccess,
  mostGenerous,
  normalizeBillingEvent,
  parsePlanCatalog,
  parsePlanCatalogJson,
  periodBounds,
  verifyHmacSha256Signature,
  type BillingEvent,
  type PlanCatalog,
  type ReserveInput,
  type ReserveResult,
  type Subscription,
  type UsageStore
} from "../src/index.js";

/** LABELLED TEST FIXTURES: made-up plan names, limits, durations and prices - not a business proposal. */
const SOURCE = {
  baseline: { exams: ["EXAM_A"], features: ["tutor"], usageLimits: [{ meter: "tutor_request", limit: 2, period: "day" }] },
  plans: [
    { id: "plus", name: "Plus", description: "d", active: true, provisional: true, exams: ["EXAM_A"], features: ["tutor", "simulation"], usageLimits: [{ meter: "tutor_request", limit: 10, period: "day" }, { meter: "simulation_start", limit: 3, period: "month" }], durationDays: 30, price: { amountMinor: 1000, currency: "INR", providerPriceRef: "price_1" } },
    { id: "other_exam", name: "Other", description: "d", active: true, provisional: true, exams: ["EXAM_B"], features: ["simulation"], usageLimits: [{ meter: "simulation_start", limit: 9, period: "month" }], durationDays: 30, price: null },
    { id: "old", name: "Old", description: "d", active: false, provisional: true, exams: ["EXAM_A"], features: ["tutor"], usageLimits: [{ meter: "tutor_request", limit: "unlimited", period: "day" }], durationDays: 30, price: { amountMinor: 1, currency: "INR", providerPriceRef: null } }
  ]
};
const catalog = (): PlanCatalog => parsePlanCatalog(structuredClone(SOURCE));
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper mutating a deliberately untyped fixture
const bad = (mutate: (c: Loose) => void): unknown => {
  const c = structuredClone(SOURCE) as Loose;
  mutate(c);
  return c;
};

describe("plan catalog", () => {
  it("parses a valid catalog and freezes it", () => {
    const c = catalog();
    expect(c.plans.map((p) => p.id)).toEqual(["plus", "other_exam", "old"]);
    expect(Object.isFrozen(c)).toBe(true);
    expect(parsePlanCatalogJson(JSON.stringify(SOURCE)).plans).toHaveLength(3);
  });

  it("an empty catalog is valid and grants nothing by itself (no shipped plan, price or baseline)", () => {
    const c = parsePlanCatalog({ plans: [] });
    expect(c.plans).toEqual([]);
    expect(c.baseline).toEqual({ exams: [], features: [], usageLimits: [] });
  });

  const refusals: Array<[string, (c: Loose) => void]> = [
    ["an unknown top-level field", (c) => { c.extra = 1; }],
    ["an unknown plan field (a typo must not silently grant less or more)", (c) => { c.plans[0].featurs = ["tutor"]; }],
    ["a duplicate plan id", (c) => { c.plans[1].id = "plus"; }],
    ["an upper-case plan id", (c) => { c.plans[0].id = "Plus"; }],
    ["an unknown feature", (c) => { c.plans[0].features = ["tutor", "everything"]; }],
    ["question generation as a student feature", (c) => { c.plans[0].features = ["question_generation"]; }],
    ["a metered feature with no declared limit", (c) => { c.plans[0].usageLimits = [{ meter: "tutor_request", limit: 1, period: "day" }]; }],
    ["a limit for a feature the plan does not include", (c) => { c.plans[1].usageLimits.push({ meter: "tutor_request", limit: 1, period: "day" }); }],
    ["a repeated meter", (c) => { c.plans[0].usageLimits.push({ meter: "tutor_request", limit: 1, period: "day" }); }],
    ["a negative limit", (c) => { c.plans[0].usageLimits[0].limit = -1; }],
    ["a fractional limit", (c) => { c.plans[0].usageLimits[0].limit = 1.5; }],
    ["an unknown period", (c) => { c.plans[0].usageLimits[0].period = "year"; }],
    ["no exams", (c) => { c.plans[0].exams = []; }],
    ["a lower-case exam code", (c) => { c.plans[0].exams = ["exam_a"]; }],
    ["a zero duration", (c) => { c.plans[0].durationDays = 0; }],
    ["an absurd duration", (c) => { c.plans[0].durationDays = 99999; }],
    ["a zero price", (c) => { c.plans[0].price.amountMinor = 0; }],
    ["a fractional price", (c) => { c.plans[0].price.amountMinor = 10.5; }],
    ["a price above the storable maximum", (c) => { c.plans[0].price.amountMinor = MAX_AMOUNT_MINOR + 1; }],
    ["a malformed currency", (c) => { c.plans[0].price.currency = "inr"; }],
    ["an unexpected price field", (c) => { c.plans[0].price.discount = 5; }],
    ["a missing provisional flag (the owner must say whether terms are final)", (c) => { delete c.plans[0].provisional; }],
    ["a baseline with an unknown field", (c) => { c.baseline.admin = true; }],
    ["a metered baseline feature without a limit", (c) => { c.baseline.usageLimits = []; }]
  ];
  for (const [label, mutate] of refusals) {
    it(`refuses ${label}`, () => {
      expect(() => parsePlanCatalog(bad(mutate))).toThrow(CatalogError);
    });
  }

  it("refuses non-object input and invalid JSON", () => {
    for (const v of [null, [], "x", 3]) expect(() => parsePlanCatalog(v)).toThrow(CatalogError);
    expect(() => parsePlanCatalogJson("{nope")).toThrow(CatalogError);
  });

  it("only an active, priced plan is purchasable; the client can only name an id", () => {
    const c = catalog();
    expect(findPurchasablePlan(c, "plus")?.id).toBe("plus");
    expect(findPurchasablePlan(c, "old")).toBeNull(); // inactive
    expect(findPurchasablePlan(c, "other_exam")).toBeNull(); // no price
    expect(findPurchasablePlan(c, "missing")).toBeNull();
    for (const v of [undefined, null, 5, {}, ["plus"], "__proto__", "constructor", "PLUS", " plus"]) expect(findPurchasablePlan(c, v)).toBeNull();
  });
});

const T0 = "2026-10-01T00:00:00.000Z";
const sub = (over: Partial<Subscription> = {}): Subscription => ({ id: "s1", studentId: "stu", planId: "plus", provider: "p", providerRef: "ref1", status: "pending", amountMinor: 1000, currency: "INR", paidThrough: null, lastEventAt: null, createdAt: T0, updatedAt: T0, ...over });
const ev = (type: BillingEvent["type"], at: string, over: Partial<BillingEvent> = {}): BillingEvent => ({ eventId: `e-${type}-${at}`, type, occurredAt: at, providerRef: "ref1", subscriptionId: null, amountMinor: type === "payment_succeeded" ? 1000 : null, currency: type === "payment_succeeded" ? "INR" : null, ...over });
const plan = catalog().plans[0]!;
const NOW = "2026-10-05T00:00:00.000Z";
const day = (iso: string, n: number): string => new Date(Date.parse(iso) + n * 86_400_000).toISOString();

describe("subscription transitions (pure, deterministic)", () => {
  it("a verified payment activates a pending subscription for exactly the plan's duration", () => {
    const r = applyBillingEvent(sub(), ev("payment_succeeded", "2026-10-02T00:00:00.000Z"), plan, NOW);
    expect(r.outcome).toBe("applied");
    expect(r.next.status).toBe("active");
    expect(r.next.paidThrough).toBe(day("2026-10-02T00:00:00.000Z", 30));
    expect(r.next.lastEventAt).toBe("2026-10-02T00:00:00.000Z");
    expect(r.next.updatedAt).toBe(NOW);
  });

  it("never mutates its input and is a pure function (same inputs, same result)", () => {
    const s = sub();
    const frozen = structuredClone(s);
    const a = applyBillingEvent(s, ev("payment_succeeded", "2026-10-02T00:00:00.000Z"), plan, NOW);
    const b = applyBillingEvent(s, ev("payment_succeeded", "2026-10-02T00:00:00.000Z"), plan, NOW);
    expect(s).toEqual(frozen);
    expect(a).toEqual(b);
  });

  it("a renewal extends from the existing paid-through date, not from the event date, when the period is still running", () => {
    const active = sub({ status: "active", paidThrough: day("2026-10-02T00:00:00.000Z", 30), lastEventAt: "2026-10-02T00:00:00.000Z" });
    const r = applyBillingEvent(active, ev("payment_succeeded", "2026-10-20T00:00:00.000Z", { eventId: "renew" }), plan, NOW);
    expect(r.next.paidThrough).toBe(day(active.paidThrough!, 30));
  });

  it("a payment after a lapse starts a fresh period from the event time", () => {
    const active = sub({ status: "active", paidThrough: "2026-10-03T00:00:00.000Z", lastEventAt: "2026-09-03T00:00:00.000Z" });
    const r = applyBillingEvent(active, ev("payment_succeeded", "2026-10-10T00:00:00.000Z"), plan, NOW);
    expect(r.next.paidThrough).toBe(day("2026-10-10T00:00:00.000Z", 30));
  });

  it("a payment amount or currency that differs from the server's snapshot is rejected and changes nothing", () => {
    for (const over of [{ amountMinor: 1 }, { amountMinor: 1001 }, { amountMinor: null }, { currency: "USD" }, { currency: null }]) {
      const r = applyBillingEvent(sub(), ev("payment_succeeded", "2026-10-02T00:00:00.000Z", over), plan, NOW);
      expect(r.outcome).toBe("rejected_amount_mismatch");
      expect(r.next.status).toBe("pending");
      expect(r.next.paidThrough).toBeNull();
    }
  });

  it("a payment for a subscription whose plan is not in the catalog is rejected, not silently dropped or granted", () => {
    expect(applyBillingEvent(sub(), ev("payment_succeeded", "2026-10-02T00:00:00.000Z"), null, NOW).outcome).toBe("rejected_unknown_plan");
    expect(applyBillingEvent(sub({ planId: "gone" }), ev("payment_succeeded", "2026-10-02T00:00:00.000Z"), plan, NOW).outcome).toBe("rejected_unknown_plan");
  });

  it("an event whose client reference names another subscription is rejected", () => {
    const r = applyBillingEvent(sub(), ev("payment_succeeded", "2026-10-02T00:00:00.000Z", { subscriptionId: "someone-elses" }), plan, NOW);
    expect(r.outcome).toBe("rejected_reference_mismatch");
    expect(r.next.status).toBe("pending");
    expect(applyBillingEvent(sub(), ev("payment_succeeded", "2026-10-02T00:00:00.000Z", { subscriptionId: "s1" }), plan, NOW).outcome).toBe("applied");
  });

  it("failure of a first payment ends the checkout; failure of a renewal makes an active subscription past_due", () => {
    expect(applyBillingEvent(sub(), ev("payment_failed", "2026-10-02T00:00:00.000Z"), plan, NOW).next.status).toBe("failed");
    const active = sub({ status: "active", paidThrough: day(T0, 30), lastEventAt: T0 });
    expect(applyBillingEvent(active, ev("payment_failed", "2026-10-10T00:00:00.000Z"), plan, NOW).next.status).toBe("past_due");
    expect(applyBillingEvent(active, ev("payment_past_due", "2026-10-10T00:00:00.000Z"), plan, NOW).next.status).toBe("past_due");
  });

  it("a payment recovers a past_due subscription", () => {
    const pastDue = sub({ status: "past_due", paidThrough: day(T0, 30), lastEventAt: "2026-10-10T00:00:00.000Z" });
    const r = applyBillingEvent(pastDue, ev("payment_succeeded", "2026-10-11T00:00:00.000Z"), plan, NOW);
    expect(r.next.status).toBe("active");
  });

  it("cancellation stops renewal but keeps the paid period; a later payment event extends it without reactivating", () => {
    const active = sub({ status: "active", paidThrough: day(T0, 30), lastEventAt: T0 });
    const cancelled = applyBillingEvent(active, ev("subscription_cancelled", "2026-10-05T00:00:00.000Z"), plan, NOW);
    expect(cancelled.next.status).toBe("cancelled");
    expect(cancelled.next.paidThrough).toBe(active.paidThrough);
    const again = applyBillingEvent(cancelled.next, ev("subscription_cancelled", "2026-10-06T00:00:00.000Z", { eventId: "c2" }), plan, NOW);
    expect(again.outcome).toBe("ignored_invalid_transition");
    const paid = applyBillingEvent(cancelled.next, ev("payment_succeeded", "2026-10-07T00:00:00.000Z"), plan, NOW);
    expect(paid.next.status).toBe("cancelled");
    expect(Date.parse(paid.next.paidThrough!)).toBeGreaterThan(Date.parse(active.paidThrough!));
  });

  it("expired and failed are final for that record: a later event changes nothing", () => {
    for (const status of ["expired", "failed"] as const) {
      const s = sub({ status, paidThrough: status === "expired" ? day(T0, 30) : null, lastEventAt: T0 });
      for (const t of ["payment_succeeded", "payment_failed", "subscription_cancelled", "subscription_expired", "payment_past_due"] as const) {
        const r = applyBillingEvent(s, ev(t, "2026-11-01T00:00:00.000Z"), plan, NOW);
        expect(r.outcome).toBe("ignored_terminal");
        expect(r.next).toBe(s);
      }
    }
  });

  it("a refund revokes from any status, in any order, and is final", () => {
    for (const status of ["pending", "active", "past_due", "cancelled", "expired", "failed"] as const) {
      const s = sub({ status, paidThrough: status === "pending" || status === "failed" ? null : day(T0, 30), lastEventAt: "2026-10-20T00:00:00.000Z" });
      const r = applyBillingEvent(s, ev("payment_refunded", "2026-10-02T00:00:00.000Z"), plan, NOW); // older than lastEventAt: still applies
      expect(r.outcome).toBe("applied");
      expect(r.next.status).toBe("refunded");
      expect(grantsAccess(r.next, new Date(NOW))).toBe(false);
      for (const t of ["payment_succeeded", "payment_failed", "subscription_cancelled", "payment_refunded"] as const) {
        expect(applyBillingEvent(r.next, ev(t, "2026-10-30T00:00:00.000Z", { eventId: `x-${t}` }), plan, NOW).outcome).toBe("ignored_terminal");
      }
    }
  });

  it("a success delivered after its own refund cannot restore access (out-of-order)", () => {
    const refunded = applyBillingEvent(sub(), ev("payment_refunded", "2026-10-03T00:00:00.000Z"), plan, NOW).next;
    const late = applyBillingEvent(refunded, ev("payment_succeeded", "2026-10-02T00:00:00.000Z"), plan, NOW);
    expect(late.outcome).toBe("ignored_terminal");
    expect(grantsAccess(late.next, new Date(NOW))).toBe(false);
  });

  it("state-changing events older than the last change are ignored as stale", () => {
    const active = sub({ status: "active", paidThrough: day(T0, 30), lastEventAt: "2026-10-10T00:00:00.000Z" });
    for (const t of ["payment_failed", "payment_past_due", "subscription_cancelled", "subscription_expired"] as const) {
      const r = applyBillingEvent(active, ev(t, "2026-10-05T00:00:00.000Z"), plan, NOW);
      expect(r.outcome).toBe("ignored_stale");
      expect(r.next.status).toBe("active");
    }
  });

  it("an older success still extends the paid period but does not undo a later status change", () => {
    const pastDue = sub({ status: "past_due", paidThrough: day(T0, 30), lastEventAt: "2026-10-20T00:00:00.000Z" });
    const r = applyBillingEvent(pastDue, ev("payment_succeeded", "2026-10-15T00:00:00.000Z"), plan, NOW);
    expect(r.outcome).toBe("applied");
    expect(r.next.status).toBe("past_due");
    expect(Date.parse(r.next.paidThrough!)).toBeGreaterThan(Date.parse(pastDue.paidThrough!));
    expect(r.next.lastEventAt).toBe("2026-10-20T00:00:00.000Z"); // lastEventAt never moves backwards
  });

  it("an event with the same timestamp as the last change is not stale", () => {
    const active = sub({ status: "active", paidThrough: day(T0, 30), lastEventAt: "2026-10-10T00:00:00.000Z" });
    expect(applyBillingEvent(active, ev("payment_failed", "2026-10-10T00:00:00.000Z"), plan, NOW).outcome).toBe("applied");
  });

  it("subscription_expired ends an active, past_due, cancelled or pending record", () => {
    for (const status of ["active", "past_due", "cancelled", "pending"] as const) {
      const s = sub({ status, paidThrough: status === "pending" ? null : day(T0, 30), lastEventAt: T0 });
      expect(applyBillingEvent(s, ev("subscription_expired", "2026-10-02T00:00:00.000Z"), plan, NOW).next.status).toBe("expired");
    }
  });
});

describe("derived status and access", () => {
  const now = new Date("2026-10-15T00:00:00.000Z");
  it("access follows status AND the paid period, never one alone", () => {
    const end = "2026-10-20T00:00:00.000Z";
    expect(grantsAccess(sub({ status: "active", paidThrough: end }), now)).toBe(true);
    expect(grantsAccess(sub({ status: "cancelled", paidThrough: end }), now)).toBe(true);
    expect(grantsAccess(sub({ status: "past_due", paidThrough: end }), now)).toBe(true);
    for (const status of ["pending", "failed", "expired", "refunded"] as const) expect(grantsAccess(sub({ status, paidThrough: end }), now)).toBe(false);
    expect(grantsAccess(sub({ status: "active", paidThrough: "2026-10-14T23:59:59.999Z" }), now)).toBe(false);
    expect(grantsAccess(sub({ status: "active", paidThrough: "2026-10-15T00:00:00.000Z" }), now)).toBe(false); // the end is exclusive
    expect(grantsAccess(sub({ status: "active", paidThrough: null }), now)).toBe(false);
  });

  it("an elapsed active or cancelled period reads as expired without waiting for an event", () => {
    expect(effectiveStatus(sub({ status: "active", paidThrough: "2026-10-01T00:00:00.000Z" }), now)).toBe("expired");
    expect(effectiveStatus(sub({ status: "cancelled", paidThrough: "2026-10-01T00:00:00.000Z" }), now)).toBe("expired");
    expect(effectiveStatus(sub({ status: "active", paidThrough: "2026-10-30T00:00:00.000Z" }), now)).toBe("active");
    expect(effectiveStatus(sub({ status: "pending" }), now)).toBe("pending");
    expect(effectiveStatus(sub({ status: "refunded", paidThrough: "2026-10-30T00:00:00.000Z" }), now)).toBe("refunded");
  });
});

describe("entitlement service", () => {
  const clock = { now: new Date("2026-10-15T12:00:00.000Z") };
  const make = (subs: Subscription[], mode: "open" | "enforced" = "enforced", c: PlanCatalog = catalog()) =>
    new EntitlementService({ mode, catalog: c, subscriptions: { listSubscriptionsForStudent: async (id) => subs.filter((s) => s.studentId === id) }, now: () => clock.now });
  const active = (over: Partial<Subscription> = {}): Subscription => sub({ status: "active", paidThrough: "2026-11-01T00:00:00.000Z", ...over });

  it("with no subscription only the baseline applies", async () => {
    const e = make([]);
    expect(await e.canAccessExam("stu", "EXAM_A")).toEqual({ allowed: true, reason: "baseline" });
    expect(await e.canAccessExam("stu", "EXAM_B")).toEqual({ allowed: false, reason: "not_entitled_exam" });
    expect(await e.canUseTutor("stu", "EXAM_A")).toEqual({ allowed: true, reason: "baseline" });
    expect(await e.canTakeSimulation("stu", "EXAM_A")).toEqual({ allowed: false, reason: "not_entitled_feature" });
    expect(await e.canUseAdvancedTraining("stu", "EXAM_A")).toEqual({ allowed: false, reason: "not_entitled_feature" });
  });

  it("an active subscription unlocks the plan's features, with the plan's limits", async () => {
    const e = make([active()]);
    expect(await e.canTakeSimulation("stu", "EXAM_A")).toEqual({ allowed: true, reason: "entitled" });
    expect(await e.getUsageLimit("stu", "tutor_request", "EXAM_A")).toEqual({ meter: "tutor_request", limit: 10, period: "day" });
    expect(await e.getUsageLimit("stu", "simulation_start", "EXAM_A")).toEqual({ meter: "simulation_start", limit: 3, period: "month" });
    expect(await e.canUseAdvancedTraining("stu", "EXAM_A")).toEqual({ allowed: false, reason: "not_entitled_feature" }); // not in this plan
  });

  it("is derived from the clock on every call: access ends when the paid period does, with no stored flag to go stale", async () => {
    const e = make([active({ paidThrough: "2026-10-16T00:00:00.000Z" })]);
    expect((await e.canTakeSimulation("stu", "EXAM_A")).allowed).toBe(true);
    clock.now = new Date("2026-10-16T00:00:00.000Z");
    expect((await e.canTakeSimulation("stu", "EXAM_A")).allowed).toBe(false);
    expect(await e.getUsageLimit("stu", "tutor_request", "EXAM_A")).toEqual({ meter: "tutor_request", limit: 2, period: "day" }); // back to the baseline
    clock.now = new Date("2026-10-15T12:00:00.000Z");
  });

  it("pending, failed, expired and refunded subscriptions grant nothing; cancelled keeps access until the paid period ends", async () => {
    for (const status of ["pending", "failed", "expired", "refunded"] as const) expect((await make([active({ status })]).canTakeSimulation("stu", "EXAM_A")).allowed).toBe(false);
    expect((await make([active({ status: "cancelled" })]).canTakeSimulation("stu", "EXAM_A")).allowed).toBe(true);
    expect((await make([active({ status: "past_due" })]).canTakeSimulation("stu", "EXAM_A")).allowed).toBe(true);
  });

  it("a subscription row belonging to another student never grants anything, even if a reader returned it", async () => {
    const leaky = new EntitlementService({ mode: "enforced", catalog: catalog(), subscriptions: { listSubscriptionsForStudent: async () => [active({ studentId: "someone-else" })] }, now: () => clock.now });
    expect((await leaky.canTakeSimulation("stu", "EXAM_A")).allowed).toBe(false);
    const detached = new EntitlementService({ mode: "enforced", catalog: catalog(), subscriptions: { listSubscriptionsForStudent: async () => [active({ studentId: null })] }, now: () => clock.now });
    expect((await detached.canTakeSimulation("stu", "EXAM_A")).allowed).toBe(false);
  });

  it("a subscription to a plan no longer in the catalog grants nothing (fail closed)", async () => {
    expect((await make([active({ planId: "deleted_plan" })]).canTakeSimulation("stu", "EXAM_A")).allowed).toBe(false);
  });

  it("exam and feature must come from the SAME source: two plans cannot be mixed to assemble access", async () => {
    // other_exam grants simulation for EXAM_B only; plus grants tutor+simulation for EXAM_A only.
    const e = make([active({ planId: "other_exam" })]);
    expect((await e.canTakeSimulation("stu", "EXAM_B")).allowed).toBe(true);
    expect((await e.canTakeSimulation("stu", "EXAM_A")).allowed).toBe(false);
    expect(await e.canAccessExam("stu", "EXAM_B")).toEqual({ allowed: true, reason: "entitled" });
    expect((await e.canUseTutor("stu", "EXAM_B")).allowed).toBe(false); // EXAM_B plan has no tutor and the baseline is EXAM_A only
  });

  it("entitled does not imply enrolled and authenticated does not imply entitled: the answer depends only on student, feature and exam", async () => {
    const e = make([]);
    expect((await e.decide("anyone", "simulation", "EXAM_A")).allowed).toBe(false);
    expect((await e.decide("anyone", "tutor", "EXAM_A")).allowed).toBe(true);
  });

  it("limits from several sources merge deterministically: unlimited, then the larger number, then the longer period", () => {
    expect(mostGenerous([])).toBeNull();
    expect(mostGenerous([{ meter: "tutor_request", limit: 5, period: "day" }, { meter: "tutor_request", limit: "unlimited", period: "month" }])).toEqual({ meter: "tutor_request", limit: "unlimited", period: "month" });
    expect(mostGenerous([{ meter: "tutor_request", limit: 5, period: "day" }, { meter: "tutor_request", limit: 9, period: "day" }])?.limit).toBe(9);
    expect(mostGenerous([{ meter: "tutor_request", limit: 5, period: "day" }, { meter: "tutor_request", limit: 5, period: "month" }])?.period).toBe("month");
  });

  it("open mode restricts nothing, says so, and meters nothing", async () => {
    const e = make([], "open");
    expect(await e.canTakeSimulation("stu", "ANY")).toEqual({ allowed: true, reason: "open_access_mode" });
    expect(await e.canAccessExam("stu", "ANY")).toEqual({ allowed: true, reason: "open_access_mode" });
    expect(await e.getUsageLimit("stu", "tutor_request", "EXAM_A")).toBeNull();
  });

  it("question generation is never a student entitlement; staff are not blocked by student billing", () => {
    const e = make([active()]);
    expect(e.canGenerateQuestion({ kind: "student", studentId: "stu" })).toEqual({ allowed: false, reason: "staff_only" });
    expect(e.canGenerateQuestion({ kind: "staff" })).toEqual({ allowed: true, reason: "staff_not_subject_to_student_billing" });
  });
});

describe("usage service and periods", () => {
  it("day and month periods are UTC calendar periods", () => {
    expect(periodBounds("day", new Date("2026-12-31T23:59:59.999Z"))).toEqual({ start: "2026-12-31T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" });
    expect(periodBounds("month", new Date("2026-02-15T10:00:00.000Z"))).toEqual({ start: "2026-02-01T00:00:00.000Z", end: "2026-03-01T00:00:00.000Z" });
    expect(periodBounds("month", new Date("2026-12-15T10:00:00.000Z")).end).toBe("2027-01-01T00:00:00.000Z");
  });

  const store = (): UsageStore & { calls: ReserveInput[] } => ({
    calls: [] as ReserveInput[],
    async reserve(input): Promise<ReserveResult> {
      this.calls.push(input);
      return { status: "reserved", reservation: { id: input.id, studentId: input.studentId, meter: input.meter, quantity: input.quantity, idempotencyKey: input.idempotencyKey, status: "reserved", createdAt: input.now }, usedAfter: 1 };
    },
    async settle() {},
    async usedInPeriod() {
      return 0;
    }
  });
  const ent = (mode: "open" | "enforced", subs: Subscription[] = []) => new EntitlementService({ mode, catalog: catalog(), subscriptions: { listSubscriptionsForStudent: async () => subs }, now: () => new Date("2026-10-15T12:00:00.000Z") });

  it("open mode records nothing; a meter with no defined limit is denied (fail closed)", async () => {
    const s = store();
    const open = new UsageService({ store: s, entitlements: ent("open"), now: () => new Date("2026-10-15T12:00:00.000Z"), newId: () => "id" });
    expect(await open.reserve("stu", "EXAM_A", "tutor_request", "k")).toEqual({ allowed: true, metered: false, reservation: null });
    expect(s.calls).toHaveLength(0);
    const enforced = new UsageService({ store: s, entitlements: ent("enforced"), now: () => new Date("2026-10-15T12:00:00.000Z"), newId: () => "id" });
    expect(await enforced.reserve("stu", "EXAM_A", "simulation_start", "k")).toMatchObject({ allowed: false, reason: "no_limit_defined" });
    expect(s.calls).toHaveLength(0);
  });

  it("reserves with the entitlement's limit and the current period, and passes the server clock", async () => {
    const s = store();
    const u = new UsageService({ store: s, entitlements: ent("enforced"), now: () => new Date("2026-10-15T12:00:00.000Z"), newId: () => "res-1" });
    const d = await u.reserve("stu", "EXAM_A", "tutor_request", "req-1");
    expect(d).toMatchObject({ allowed: true, metered: true, limit: 2, period: "day" });
    expect(s.calls[0]).toMatchObject({ id: "res-1", limit: 2, periodStart: "2026-10-15T00:00:00.000Z", periodEnd: "2026-10-16T00:00:00.000Z", idempotencyKey: "req-1", quantity: 1, now: "2026-10-15T12:00:00.000Z" });
  });
});

describe("webhook helpers", () => {
  const secret = "whsec_TEST_ONLY";
  const now = new Date("2026-10-15T12:00:00.000Z");
  const nowSec = Math.floor(now.getTime() / 1000);
  const sign = (ts: string, body: string, key = secret): string => createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
  const verify = (over: Partial<Parameters<typeof verifyHmacSha256Signature>[0]> = {}): void => verifyHmacSha256Signature({ secret, timestamp: String(nowSec), rawBody: "{}", signatureHex: sign(String(nowSec), "{}"), now, ...over });
  const reason = (fn: () => void): string | null => {
    try {
      fn();
      return null;
    } catch (e) {
      return e instanceof WebhookRejectedError ? e.reason : "other";
    }
  };

  it("accepts a correct signature inside the window", () => {
    expect(reason(() => verify())).toBeNull();
  });
  it("rejects a wrong secret, a modified body, a malformed signature and a malformed timestamp", () => {
    expect(reason(() => verify({ signatureHex: sign(String(nowSec), "{}", "other") }))).toBe("bad_signature");
    expect(reason(() => verify({ rawBody: "{ }" }))).toBe("bad_signature");
    expect(reason(() => verify({ signatureHex: "zz" }))).toBe("bad_signature");
    expect(reason(() => verify({ signatureHex: "" }))).toBe("bad_signature");
    expect(reason(() => verify({ timestamp: "abc" }))).toBe("malformed");
    expect(reason(() => verify({ timestamp: "" }))).toBe("malformed");
  });
  it("rejects a correctly signed but replayed (stale or future) request", () => {
    const old = String(nowSec - 301);
    expect(reason(() => verify({ timestamp: old, signatureHex: sign(old, "{}") }))).toBe("stale_timestamp");
    const future = String(nowSec + 301);
    expect(reason(() => verify({ timestamp: future, signatureHex: sign(future, "{}") }))).toBe("stale_timestamp");
    const edge = String(nowSec - 300);
    expect(reason(() => verify({ timestamp: edge, signatureHex: sign(edge, "{}") }))).toBeNull();
  });
  it("the signature covers the timestamp: reusing a signature with another timestamp fails", () => {
    const sig = sign(String(nowSec), "{}");
    expect(reason(() => verify({ timestamp: String(nowSec - 1), signatureHex: sig }))).toBe("bad_signature");
  });

  const good = { eventId: "evt_1", type: "payment_succeeded", occurredAt: "2026-10-15T11:00:00.000Z", providerRef: "cs_1", subscriptionId: "abc-123", amountMinor: 1000, currency: "INR" };
  it("normalizes a well-formed event", () => {
    expect(normalizeBillingEvent(good, now)).toEqual({ ...good });
    expect(normalizeBillingEvent({ eventId: "e", type: "payment_failed", occurredAt: "2026-10-15T11:00:00Z", providerRef: "r" }, now)).toMatchObject({ amountMinor: null, currency: null, subscriptionId: null });
  });
  const malformed: Array<[string, Record<string, unknown>]> = [
    ["an extra field", { ...good, studentId: "x" }],
    ["an unknown type", { ...good, type: "payment_magic" }],
    ["a blank event id", { ...good, eventId: "" }],
    ["an event id with spaces", { ...good, eventId: "a b" }],
    ["a non-ISO time", { ...good, occurredAt: "yesterday" }],
    ["a time far in the future", { ...good, occurredAt: "2026-10-15T13:00:00.000Z" }],
    ["a time before 2020", { ...good, occurredAt: "2019-01-01T00:00:00.000Z" }],
    ["a blank provider ref", { ...good, providerRef: "" }],
    ["a provider ref with control characters", { ...good, providerRef: "a\nb" }],
    ["a fractional amount", { ...good, amountMinor: 10.5 }],
    ["a negative amount", { ...good, amountMinor: -1 }],
    ["an amount above the maximum", { ...good, amountMinor: MAX_AMOUNT_MINOR + 1 }],
    ["a lower-case currency", { ...good, currency: "inr" }],
    ["a string amount", { ...good, amountMinor: "1000" }]
  ];
  for (const [label, body] of malformed) {
    it(`rejects ${label}`, () => {
      expect(reason(() => normalizeBillingEvent(body, now))).toBe("malformed");
    });
  }
  it("rejects non-objects", () => {
    for (const v of [null, [], "x", 5, undefined]) expect(reason(() => normalizeBillingEvent(v, now))).toBe("malformed");
  });
});

describe("describeAccess: a whole summary from ONE snapshot, identical to the individual decisions", () => {
  const nowFixed = new Date("2026-10-15T12:00:00.000Z");
  const act = (over: Partial<Subscription> = {}): Subscription => sub({ status: "active", paidThrough: "2026-11-01T00:00:00.000Z", ...over });
  const build = (subs: Subscription[], mode: "open" | "enforced" = "enforced") => {
    const reads = { n: 0 };
    const service = new EntitlementService({ mode, catalog: catalog(), subscriptions: { listSubscriptionsForStudent: async (id) => { reads.n += 1; return subs.filter((s) => s.studentId === id); } }, now: () => nowFixed });
    return { service, reads };
  };

  it("matches decide() and getUsageLimit() for every feature, meter and exam, across scenarios", async () => {
    const scenarios: Subscription[][] = [[], [act()], [act({ status: "cancelled" })], [act({ status: "refunded" })], [act({ planId: "other_exam" })], [act({ planId: "old" })], [act(), act({ id: "s2", planId: "old" })], [act({ planId: "gone" })]];
    for (const subs of scenarios) {
      const { service } = build(subs);
      for (const exam of ["EXAM_A", "EXAM_B", "NOPE"]) {
        const described = await service.describeAccess("stu", exam);
        expect(described.exam).toBe((await service.canAccessExam("stu", exam)).allowed);
        for (const f of described.features) expect(f.allowed, `${f.id}@${exam}`).toBe((await service.decide("stu", f.id, exam)).allowed);
        for (const meter of ["tutor_request", "simulation_start"] as const) {
          const individual = await service.getUsageLimit("stu", meter, exam);
          const got = described.limits.find((l) => l.meter === meter) ?? null;
          expect(got, `${meter}@${exam}`).toEqual(individual);
        }
      }
    }
  });

  it("reads subscriptions once, or not at all when the caller already has them", async () => {
    const { service, reads } = build([act()]);
    await service.describeAccess("stu", "EXAM_A");
    expect(reads.n).toBe(1);
    await service.describeAccess("stu", "EXAM_A", [act()]);
    expect(reads.n).toBe(1);
  });

  it("an exam outside every source yields no allowed feature and no limit; open mode allows all and meters nothing", async () => {
    const { service } = build([act()]);
    const none = await service.describeAccess("stu", "NOPE");
    expect(none).toEqual({ exam: false, features: [{ id: "tutor", allowed: false }, { id: "simulation", allowed: false }, { id: "advanced_training", allowed: false }], limits: [] });
    const open = await build([], "open").service.describeAccess("stu", "ANY");
    expect(open.features.every((f) => f.allowed) && open.limits.length === 0 && open.exam).toBe(true);
  });

  it("a preloaded list from another student is still filtered by the student id (no foreign grant)", async () => {
    const { service } = build([]);
    const d = await service.describeAccess("stu", "EXAM_A", [act({ studentId: "someone-else" })]);
    expect(d.features.find((f) => f.id === "simulation")?.allowed).toBe(false);
  });
});
