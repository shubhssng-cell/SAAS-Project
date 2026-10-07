import { randomUUID } from "node:crypto";
import { applyBillingEvent, parsePlanCatalog, type AiUsageSink, type BillingEvent, type BillingStore, type OperatorBillingReader, type ProcessedEvent, type UsageStore } from "@ipmat/billing";
import { expect, it } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";

/**
 * Behavioural CONTRACTS for the billing / usage persistence (Phase 9 Unit 4, D-100), run against BOTH the in-memory reference
 * implementation (no-Postgres suite) and the Prisma implementation (real-Postgres suite). One definition, so the test double can
 * never drift from the durable store. LABELLED TEST FIXTURES: every id, plan and amount here is synthetic.
 */
const catalog = parsePlanCatalog({
  plans: [{ id: "plan_a", name: "Plan A", description: "fixture", active: true, provisional: true, exams: ["EXAM_A"], features: ["tutor"], usageLimits: [{ meter: "tutor_request", limit: 5, period: "day" }], durationDays: 30, price: { amountMinor: 1000, currency: "INR", providerPriceRef: null } }]
});
const PLAN = catalog.plans[0]!;
const NOW = "2026-10-10T00:00:00.000Z";
export const T = (n: number): string => new Date(Date.parse("2026-10-01T00:00:00.000Z") + n * 3_600_000).toISOString();

export interface BillingContractEnv {
  store: BillingStore & UsageStore & OperatorBillingReader & AiUsageSink;
  provider: string;
  studentA: string;
  studentB: string;
  unknownStudent: string;
  uid: (label: string) => string;
}

export const decideWith = (event: BillingEvent): Parameters<BillingStore["processEvent"]>[0]["decide"] => (sub) => (sub ? applyBillingEvent(sub, event, { ...PLAN, id: sub.planId }, NOW) : { outcome: "ignored_unknown_reference" });

export const evt = (eventId: string, type: BillingEvent["type"], providerRef: string, at: string, over: Partial<BillingEvent> = {}): BillingEvent => ({
  eventId,
  type,
  occurredAt: at,
  providerRef,
  subscriptionId: null,
  amountMinor: type === "payment_succeeded" ? 1000 : null,
  currency: type === "payment_succeeded" ? "INR" : null,
  ...over
});

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

export function billingContract(getEnv: () => BillingContractEnv): void {
  const open = async (studentId: string, planId = "plan_a") => {
    const { store, uid, provider } = getEnv();
    const { subscription } = await store.openPendingSubscription({ id: randomUUID(), studentId, planId, provider, amountMinor: 1000, currency: "INR", now: NOW });
    const ref = uid(`ref-${randomUUID().slice(0, 6)}`);
    expect(await store.attachProviderRef(subscription.id, ref, NOW)).toBe("attached");
    return { id: subscription.id, ref };
  };
  const send = (e: BillingEvent, digest = DIGEST_A): Promise<ProcessedEvent> => {
    const { store, provider } = getEnv();
    return store.processEvent({ provider, event: e, digest, receivedAt: NOW, decide: decideWith(e) });
  };

  it("opens one pending checkout per (student, plan): a repeat reuses it, a different plan or student gets its own", async () => {
    const { store, studentA, studentB, provider } = getEnv();
    const first = await store.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: "plan_a", provider, amountMinor: 1000, currency: "INR", now: NOW });
    expect(first.created).toBe(true);
    expect(first.subscription).toMatchObject({ status: "pending", studentId: studentA, providerRef: null, paidThrough: null, lastEventAt: null, amountMinor: 1000, currency: "INR" });
    const again = await store.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: "plan_a", provider, amountMinor: 1000, currency: "INR", now: NOW });
    expect(again.created).toBe(false);
    expect(again.subscription.id).toBe(first.subscription.id);
    const otherPlan = await store.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: "plan_b", provider, amountMinor: 500, currency: "INR", now: NOW });
    expect(otherPlan.created).toBe(true);
    const otherStudent = await store.openPendingSubscription({ id: randomUUID(), studentId: studentB, planId: "plan_a", provider, amountMinor: 1000, currency: "INR", now: NOW });
    expect(otherStudent.created).toBe(true);
    expect(otherStudent.subscription.id).not.toBe(first.subscription.id);
  });

  it("concurrent checkout requests share one pending record", async () => {
    const { store, studentA, provider } = getEnv();
    const plan = `race_${randomUUID().slice(0, 6)}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => store.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: plan, provider, amountMinor: 1000, currency: "INR", now: NOW })));
    expect(new Set(results.map((r) => r.subscription.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const rows = (await store.listSubscriptionsForStudent(studentA)).filter((s) => s.planId === plan);
    expect(rows).toHaveLength(1);
  });

  it("after a checkout is paid, a new request for the same plan opens a fresh pending record", async () => {
    const { studentA, store, provider } = getEnv();
    const plan = `renew_${randomUUID().slice(0, 6)}`;
    const a = await store.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: plan, provider, amountMinor: 1000, currency: "INR", now: NOW });
    expect(await store.attachProviderRef(a.subscription.id, getEnv().uid(`pay-${plan}`), NOW)).toBe("attached");
    const paid = evt(getEnv().uid(`evt-${plan}`), "payment_succeeded", getEnv().uid(`pay-${plan}`), T(1));
    // decide() uses PLAN_A's duration; the subscription's plan id differs, so use a decision built for this record.
    const processed = await store.processEvent({ provider, event: paid, digest: DIGEST_A, receivedAt: NOW, decide: (sub) => (sub ? applyBillingEvent(sub, paid, { ...PLAN, id: plan }, NOW) : { outcome: "ignored_unknown_reference" }) });
    expect(processed.outcome).toBe("applied");
    const b = await store.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: plan, provider, amountMinor: 1000, currency: "INR", now: NOW });
    expect(b.created).toBe(true);
    expect(b.subscription.id).not.toBe(a.subscription.id);
  });

  it("refuses a checkout for a student that does not exist", async () => {
    const { store, unknownStudent, provider } = getEnv();
    await expect(store.openPendingSubscription({ id: randomUUID(), studentId: unknownStudent, planId: "plan_a", provider, amountMinor: 1000, currency: "INR", now: NOW })).rejects.toMatchObject({ code: "missing_reference" });
    await expect(store.openPendingSubscription({ id: randomUUID(), studentId: "  ", planId: "plan_a", provider, amountMinor: 1000, currency: "INR", now: NOW })).rejects.toBeInstanceOf(PersistenceError);
  });

  it("attaches a provider reference once; the same again is a no-op; a different or already-used one is a conflict", async () => {
    const { store, studentA, provider, uid } = getEnv();
    const plan = `att_${randomUUID().slice(0, 6)}`;
    const a = await store.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: plan, provider, amountMinor: 1000, currency: "INR", now: NOW });
    const ref = uid(`r-${plan}`);
    expect(await store.attachProviderRef(a.subscription.id, ref, NOW)).toBe("attached");
    expect(await store.attachProviderRef(a.subscription.id, ref, NOW)).toBe("already_attached_same");
    expect(await store.attachProviderRef(a.subscription.id, uid(`r2-${plan}`), NOW)).toBe("conflict");
    const b = await store.openPendingSubscription({ id: randomUUID(), studentId: getEnv().studentB, planId: plan, provider, amountMinor: 1000, currency: "INR", now: NOW });
    expect(await store.attachProviderRef(b.subscription.id, ref, NOW)).toBe("conflict");
    const reread = await store.getSubscriptionForStudent(studentA, a.subscription.id);
    expect(reread?.providerRef).toBe(ref);
    await expect(store.attachProviderRef(randomUUID(), uid("nope"), NOW)).rejects.toMatchObject({ code: "missing_reference" });
  });

  it("concurrent attaches of different references leave exactly one", async () => {
    const { store, studentA, provider, uid } = getEnv();
    const plan = `att2_${randomUUID().slice(0, 6)}`;
    const a = await store.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: plan, provider, amountMinor: 1000, currency: "INR", now: NOW });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => store.attachProviderRef(a.subscription.id, uid(`c-${plan}-${i}`), NOW)));
    expect(results.filter((r) => r === "attached")).toHaveLength(1);
    expect(results.filter((r) => r === "conflict")).toHaveLength(5);
  });

  it("reads are scoped to the student: another student's subscription is indistinguishable from a missing one", async () => {
    const { store, studentA, studentB } = getEnv();
    const mine = await open(studentA, `scope_${randomUUID().slice(0, 6)}`);
    expect((await store.getSubscriptionForStudent(studentA, mine.id))?.id).toBe(mine.id);
    expect(await store.getSubscriptionForStudent(studentB, mine.id)).toBeNull();
    expect(await store.getSubscriptionForStudent(studentB, randomUUID())).toBeNull();
    expect((await store.listSubscriptionsForStudent(studentB)).some((s) => s.id === mine.id)).toBe(false);
    expect((await store.listSubscriptionsForStudent(studentA)).some((s) => s.id === mine.id)).toBe(true);
  });

  it("applies a verified payment once and records the event; the operator reader sees it", async () => {
    const { store, uid } = getEnv();
    const s = await open(getEnv().studentA, `pay1_${randomUUID().slice(0, 6)}`);
    const e = evt(uid("e1"), "payment_succeeded", s.ref, T(2), { subscriptionId: s.id });
    const first = await send(e);
    expect(first).toMatchObject({ outcome: "applied", duplicate: false, subscriptionId: s.id, status: "active" });
    const after = await store.getSubscriptionForStudent(getEnv().studentA, s.id);
    expect(after).toMatchObject({ status: "active", paidThrough: new Date(Date.parse(T(2)) + 30 * 86_400_000).toISOString(), lastEventAt: T(2) });
    const stored = await store.findEvent(getEnv().provider, e.eventId);
    expect(stored).toMatchObject({ eventId: e.eventId, type: "payment_succeeded", subscriptionId: s.id, outcome: "applied", occurredAt: T(2) });
    expect((await store.listEventsForSubscription(s.id)).map((x) => x.eventId)).toEqual([e.eventId]);
    expect((await store.getSubscription(s.id))?.status).toBe("active");
  });

  it("a replayed event id changes nothing the second time", async () => {
    const { store, uid } = getEnv();
    const s = await open(getEnv().studentA, `replay_${randomUUID().slice(0, 6)}`);
    const e = evt(uid("er"), "payment_succeeded", s.ref, T(2));
    expect((await send(e)).duplicate).toBe(false);
    const before = await store.getSubscriptionForStudent(getEnv().studentA, s.id);
    const second = await send(e);
    expect(second).toMatchObject({ duplicate: true, outcome: "applied", status: "active" });
    expect(await store.getSubscriptionForStudent(getEnv().studentA, s.id)).toEqual(before);
    expect(await store.listEventsForSubscription(s.id)).toHaveLength(1);
  });

  it("a DIFFERENT payload reusing an event id is a conflict and changes nothing", async () => {
    const { store, uid } = getEnv();
    const s = await open(getEnv().studentA, `conf_${randomUUID().slice(0, 6)}`);
    const e = evt(uid("ec"), "payment_succeeded", s.ref, T(2));
    await send(e, DIGEST_A);
    const before = await store.getSubscriptionForStudent(getEnv().studentA, s.id);
    const forged = await send({ ...e, type: "payment_refunded", amountMinor: null, currency: null }, DIGEST_B);
    expect(forged).toMatchObject({ duplicate: true, outcome: "rejected_event_conflict" });
    expect(await store.getSubscriptionForStudent(getEnv().studentA, s.id)).toEqual(before);
  });

  it("concurrent deliveries of one event apply it exactly once", async () => {
    const { store, uid } = getEnv();
    const s = await open(getEnv().studentA, `cc_${randomUUID().slice(0, 6)}`);
    const e = evt(uid("ecc"), "payment_succeeded", s.ref, T(2));
    const results = await Promise.all(Array.from({ length: 10 }, () => send(e)));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(9);
    expect(results.every((r) => r.outcome === "applied")).toBe(true);
    const after = await store.getSubscriptionForStudent(getEnv().studentA, s.id);
    expect(after?.paidThrough).toBe(new Date(Date.parse(T(2)) + 30 * 86_400_000).toISOString()); // one period, not ten
    expect(await store.listEventsForSubscription(s.id)).toHaveLength(1);
  });

  it("concurrent DIFFERENT events for one subscription are serialized and all applied (renewals add up)", async () => {
    const { store, uid } = getEnv();
    const s = await open(getEnv().studentA, `ser_${randomUUID().slice(0, 6)}`);
    await Promise.all([1, 2, 3, 4].map((i) => send(evt(uid(`ser-${i}`), "payment_succeeded", s.ref, T(2 + i)))));
    const after = await store.getSubscriptionForStudent(getEnv().studentA, s.id);
    // First payment: T(2+i)+30d; each later one extends from the then-current paid-through: 4 periods in total, whatever the arrival order.
    expect(after?.status).toBe("active");
    const end = Date.parse(after!.paidThrough!);
    expect(end).toBeGreaterThanOrEqual(Date.parse(T(6)) + 90 * 86_400_000);
    expect((await store.listEventsForSubscription(s.id)).filter((e) => e.outcome === "applied")).toHaveLength(4);
  });

  it("records an event for an unknown provider reference as ignored (and never creates a subscription)", async () => {
    const { store, uid } = getEnv();
    const e = evt(uid("eu"), "payment_succeeded", uid("no-such-ref"), T(2));
    expect(await send(e)).toMatchObject({ outcome: "ignored_unknown_reference", duplicate: false, subscriptionId: null, status: null });
    expect(await send(e)).toMatchObject({ outcome: "ignored_unknown_reference", duplicate: true });
    expect(await store.findEvent(getEnv().provider, e.eventId)).toMatchObject({ outcome: "ignored_unknown_reference", subscriptionId: null });
  });

  it("concurrent deliveries of one event for an UNKNOWN reference (nothing to lock on) record it once and never raise", async () => {
    const { store, uid } = getEnv();
    const e = evt(uid("eu-race"), "payment_succeeded", uid("still-no-such-ref"), T(2));
    const results = await Promise.all(Array.from({ length: 12 }, () => send(e)));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(results.every((r) => r.outcome === "ignored_unknown_reference")).toBe(true);
    expect(await store.findEvent(getEnv().provider, e.eventId)).toMatchObject({ outcome: "ignored_unknown_reference" });
  });

  it("a rejected event is recorded with its outcome and leaves the subscription untouched", async () => {
    const { store, uid } = getEnv();
    const s = await open(getEnv().studentA, `rej_${randomUUID().slice(0, 6)}`);
    const e = evt(uid("erj"), "payment_succeeded", s.ref, T(2), { amountMinor: 1 });
    expect(await send(e)).toMatchObject({ outcome: "rejected_amount_mismatch", duplicate: false, status: "pending" });
    expect(await store.getSubscriptionForStudent(getEnv().studentA, s.id)).toMatchObject({ status: "pending", paidThrough: null, lastEventAt: null });
    expect((await store.findEvent(getEnv().provider, e.eventId))?.outcome).toBe("rejected_amount_mismatch");
  });

  it("a refund after a payment ends access and nothing after it can restore it", async () => {
    const { store, uid } = getEnv();
    const s = await open(getEnv().studentA, `ref_${randomUUID().slice(0, 6)}`);
    await send(evt(uid("rf1"), "payment_succeeded", s.ref, T(2)));
    expect((await send(evt(uid("rf2"), "payment_refunded", s.ref, T(3)))).status).toBe("refunded");
    expect(await send(evt(uid("rf3"), "payment_succeeded", s.ref, T(4)))).toMatchObject({ outcome: "ignored_terminal", status: "refunded" });
    expect((await store.getSubscriptionForStudent(getEnv().studentA, s.id))?.status).toBe("refunded");
    // repeated refund (a different event id) is harmless and idempotent in effect
    expect((await send(evt(uid("rf4"), "payment_refunded", s.ref, T(5)))).outcome).toBe("ignored_terminal");
  });

  it("the same event id under a different provider is a different event", async () => {
    const { store, uid } = getEnv();
    const s = await open(getEnv().studentA, `prov_${randomUUID().slice(0, 6)}`);
    const e = evt(uid("ep"), "payment_succeeded", s.ref, T(2));
    await send(e);
    const other = await store.processEvent({ provider: "another-provider", event: e, digest: DIGEST_A, receivedAt: NOW, decide: decideWith(e) });
    expect(other).toMatchObject({ duplicate: false, outcome: "ignored_unknown_reference" });
  });
}

export function usageContract(getEnv: () => BillingContractEnv): void {
  const res = (over: Partial<Parameters<UsageStore["reserve"]>[0]> = {}) => ({
    id: randomUUID(),
    studentId: getEnv().studentA,
    meter: "tutor_request" as const,
    quantity: 1,
    idempotencyKey: getEnv().uid(`k-${randomUUID().slice(0, 8)}`),
    limit: 5 as number | "unlimited",
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    now: "2026-10-10T10:00:00.000Z",
    ...over
  });
  const isolated = () => ({ meter: "simulation_start" as const, studentId: getEnv().studentB, periodStart: "2030-01-01T00:00:00.000Z", periodEnd: "2030-02-01T00:00:00.000Z", now: "2030-01-10T00:00:00.000Z" });

  it("reserves up to the limit, then refuses; refusal records nothing", async () => {
    const { store } = getEnv();
    const base = { ...isolated(), limit: 3 };
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await store.reserve(res(base)));
    expect(results.map((r) => r.status)).toEqual(["reserved", "reserved", "reserved", "limit_reached", "limit_reached"]);
    expect(results[2]).toMatchObject({ usedAfter: 3 });
    expect(results[3]).toMatchObject({ used: 3 });
    expect(await store.usedInPeriod(base.studentId, base.meter, base.periodStart, base.periodEnd)).toBe(3);
  });

  it("is idempotent per key: a repeat is a duplicate and counts once", async () => {
    const { store } = getEnv();
    const base = { ...isolated(), meter: "tutor_request" as const, periodStart: "2031-01-01T00:00:00.000Z", periodEnd: "2031-02-01T00:00:00.000Z", now: "2031-01-10T00:00:00.000Z", limit: 5 };
    const input = res({ ...base, idempotencyKey: getEnv().uid("same") });
    const first = await store.reserve(input);
    const second = await store.reserve({ ...input, id: randomUUID() });
    expect(first.status).toBe("reserved");
    expect(second.status).toBe("duplicate");
    if (first.status === "reserved" && second.status === "duplicate") expect(second.reservation.id).toBe(first.reservation.id);
    expect(await store.usedInPeriod(base.studentId, base.meter, base.periodStart, base.periodEnd)).toBe(1);
  });

  it("concurrent reservations cannot exceed the limit", async () => {
    const { store } = getEnv();
    const base = { ...isolated(), meter: "tutor_request" as const, periodStart: "2032-01-01T00:00:00.000Z", periodEnd: "2032-02-01T00:00:00.000Z", now: "2032-01-10T00:00:00.000Z", limit: 5 };
    const results = await Promise.all(Array.from({ length: 25 }, () => store.reserve(res(base))));
    expect(results.filter((r) => r.status === "reserved")).toHaveLength(5);
    expect(results.filter((r) => r.status === "limit_reached")).toHaveLength(20);
    expect(await store.usedInPeriod(base.studentId, base.meter, base.periodStart, base.periodEnd)).toBe(5);
  });

  it("released units give capacity back; consumed units keep counting; settling twice or for another student changes nothing", async () => {
    const { store, studentA, studentB } = getEnv();
    const base = { studentId: studentA, meter: "tutor_request" as const, periodStart: "2033-01-01T00:00:00.000Z", periodEnd: "2033-02-01T00:00:00.000Z", now: "2033-01-10T00:00:00.000Z", limit: 2 };
    const a = await store.reserve(res(base));
    const b = await store.reserve(res(base));
    expect((await store.reserve(res(base))).status).toBe("limit_reached");
    if (a.status !== "reserved" || b.status !== "reserved") throw new Error("setup");
    await store.settle(studentB, a.reservation.id, "released"); // another student's settle: no effect
    expect((await store.reserve(res(base))).status).toBe("limit_reached");
    await store.settle(studentA, a.reservation.id, "released");
    expect(await store.usedInPeriod(studentA, base.meter, base.periodStart, base.periodEnd)).toBe(1);
    await store.settle(studentA, b.reservation.id, "consumed");
    await store.settle(studentA, b.reservation.id, "released"); // already settled: stays consumed
    expect(await store.usedInPeriod(studentA, base.meter, base.periodStart, base.periodEnd)).toBe(1);
    expect((await store.reserve(res(base))).status).toBe("reserved");
    expect((await store.reserve(res(base))).status).toBe("limit_reached");
  });

  it("counts only the requested period, and the meter and student separately", async () => {
    const { store, studentA, studentB } = getEnv();
    const p1 = { periodStart: "2034-01-01T00:00:00.000Z", periodEnd: "2034-01-02T00:00:00.000Z", now: "2034-01-01T05:00:00.000Z" };
    const p2 = { periodStart: "2034-01-02T00:00:00.000Z", periodEnd: "2034-01-03T00:00:00.000Z", now: "2034-01-02T05:00:00.000Z" };
    await store.reserve(res({ ...p1, studentId: studentA, limit: 1 }));
    expect((await store.reserve(res({ ...p1, studentId: studentA, limit: 1 }))).status).toBe("limit_reached");
    expect((await store.reserve(res({ ...p2, studentId: studentA, limit: 1 }))).status).toBe("reserved"); // next period
    expect((await store.reserve(res({ ...p1, studentId: studentB, limit: 1 }))).status).toBe("reserved"); // other student
    expect((await store.reserve(res({ ...p1, studentId: studentA, meter: "simulation_start", limit: 1 }))).status).toBe("reserved"); // other meter
  });

  it("zero is a real limit, unlimited never refuses, and bad input is refused", async () => {
    const { store, studentA, unknownStudent } = getEnv();
    const p = { periodStart: "2035-01-01T00:00:00.000Z", periodEnd: "2035-02-01T00:00:00.000Z", now: "2035-01-10T00:00:00.000Z", studentId: studentA };
    expect((await store.reserve(res({ ...p, limit: 0 }))).status).toBe("limit_reached");
    for (let i = 0; i < 12; i += 1) expect((await store.reserve(res({ ...p, limit: "unlimited" }))).status).toBe("reserved");
    await expect(store.reserve(res({ ...p, quantity: 0 }))).rejects.toBeInstanceOf(PersistenceError);
    await expect(store.reserve(res({ ...p, quantity: 101 }))).rejects.toBeInstanceOf(PersistenceError);
    await expect(store.reserve(res({ ...p, idempotencyKey: " " }))).rejects.toBeInstanceOf(PersistenceError);
    await expect(store.reserve(res({ ...p, studentId: unknownStudent }))).rejects.toMatchObject({ code: "missing_reference" });
  });

  it("records AI usage facts", async () => {
    const { store } = getEnv();
    await expect(store.record({ requestId: getEnv().uid("req"), studentRef: "abcdef123456", occurredAt: "2026-10-10T10:00:00.000Z", provider: "p", model: "m", inputTokens: 10, outputTokens: 20, outcome: "ok", failureCategory: null, latencyMs: 123 })).resolves.toBeUndefined();
    await expect(store.record({ requestId: null, studentRef: null, occurredAt: "2026-10-10T10:00:00.000Z", provider: "p", model: "m", inputTokens: null, outputTokens: null, outcome: "error", failureCategory: "timeout", latencyMs: 5 })).resolves.toBeUndefined();
  });
}
