import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PrismaAiUsageSink, PrismaBillingStore, PrismaUsageStore } from "../../src/repositories/prismaBilling.js";
import { billingContract, evt, T, usageContract, decideWith, type BillingContractEnv } from "./billingContracts.js";

/**
 * REAL DATABASE tests for the Phase 9 Unit 4 billing / usage persistence (docs/DECISIONS.md D-100). SKIPPED unless
 * `IPMAT_TEST_DATABASE_URL` is set; refuses any database whose name does not contain "test". FIXTURE DATA: every student,
 * subscription, event and usage row is synthetic and tagged with a per-run id. Billing events are append-only by design, so
 * their rows (and the detached subscriptions) are left behind in the disposable test database.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

vi.setConfig({ testTimeout: 60_000 });

const RUN = `p9u4-${randomUUID().slice(0, 8)}`;
const sqlState = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "no error",
    (e: { message?: string; meta?: { code?: string }; code?: string }) => `${e.code ?? ""}|${e.meta?.code ?? ""}|${(e.message ?? "").slice(-400)}`
  );

describe.skipIf(!DATABASE_URL)("billing, usage and AI-usage persistence - real Postgres", () => {
  let prisma: PrismaClient;
  let studentA = "";
  let studentB = "";
  const students: string[] = [];
  const mkStudent = async (label: string): Promise<string> => {
    const s = await prisma.student.create({ data: { authRef: `${RUN}-${label}` } });
    students.push(s.id);
    return s.id;
  };
  const uid = (label: string): string => `${RUN}-${label}`;
  let billing: PrismaBillingStore;
  let usage: PrismaUsageStore;
  let ai: PrismaAiUsageSink;
  const env = (): BillingContractEnv => ({
    store: Object.assign(Object.create(billing) as PrismaBillingStore, {
      reserve: usage.reserve.bind(usage),
      settle: usage.settle.bind(usage),
      usedInPeriod: usage.usedInPeriod.bind(usage),
      record: ai.record.bind(ai)
    }) as BillingContractEnv["store"],
    provider: `${RUN}-provider`,
    studentA,
    studentB,
    unknownStudent: `${RUN}-ghost`,
    uid
  });

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    studentA = await mkStudent("a");
    studentB = await mkStudent("b");
    billing = new PrismaBillingStore(prisma);
    usage = new PrismaUsageStore(prisma, () => new Date("2026-10-10T10:00:00.000Z"));
    ai = new PrismaAiUsageSink(prisma);
  });

  afterAll(async () => {
    await prisma.usageEvent.deleteMany({ where: { studentId: { in: students } } });
    await prisma.aiUsageRecord.deleteMany({ where: { requestId: { startsWith: RUN } } });
    await prisma.student.deleteMany({ where: { id: { in: students } } });
    await prisma.$disconnect();
  });

  describe("PrismaBillingStore", () => {
    billingContract(env);
  });

  describe("PrismaUsageStore / PrismaAiUsageSink", () => {
    usageContract(env);

    it("stores AI usage facts exactly, with no prompt, output or cost column", async () => {
      const requestId = uid("ai-facts");
      await ai.record({ requestId, studentRef: "abcdef123456", occurredAt: "2026-10-10T10:00:00.000Z", provider: "anthropic", model: "model-x", inputTokens: 11, outputTokens: 22, outcome: "ok", failureCategory: null, latencyMs: 321.6 });
      const row = await prisma.aiUsageRecord.findFirstOrThrow({ where: { requestId } });
      expect(row).toMatchObject({ requestId, studentRef: "abcdef123456", provider: "anthropic", model: "model-x", inputTokens: 11, outputTokens: 22, outcome: "ok", failureCategory: null, latencyMs: 322 });
      const columns = (await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_usage_records'`).map((c) => c.column_name).sort();
      expect(columns).toEqual(["failure_category", "id", "input_tokens", "latency_ms", "model", "occurred_at", "outcome", "output_tokens", "provider", "recorded_at", "request_id", "student_ref"]);
    });
  });

  describe("schema constraints", () => {
    const insertSub = (over: Partial<Record<string, string | number | null>> = {}) => {
      const v = { id: randomUUID(), student: studentA, plan: `${RUN}-p-${randomUUID().slice(0, 6)}`, provider: "x", ref: null as string | null, status: "pending", amount: 1000, currency: "INR", paid: null as string | null, ...over };
      return prisma.$executeRawUnsafe(
        `INSERT INTO billing_subscriptions (id, student_id, plan_id, provider, provider_ref, status, amount_minor, currency, paid_through, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamp, now(), now())`,
        v.id, v.student, v.plan, v.provider, v.ref, v.status, v.amount, v.currency, v.paid
      );
    };

    it("the database refuses states and values the domain would never produce", async () => {
      expect(await sqlState(insertSub({ status: "paid" }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ amount: 0 }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ amount: -5 }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ amount: 2_000_000_001 }))).toMatch(/check|23514|out of range/i);
      expect(await sqlState(insertSub({ currency: "inr" }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ currency: "RUPEES" }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ ref: "  " }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ plan: " " }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ student: `${RUN}-nobody` }))).toMatch(/foreign|23503/i);
    });

    it("paid access always has a paid period; a pending checkout has none", async () => {
      expect(await sqlState(insertSub({ status: "active", paid: null }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ status: "past_due", paid: null }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ status: "pending", paid: "2030-01-01T00:00:00" }))).toMatch(/check|23514/i);
      expect(await sqlState(insertSub({ status: "active", paid: "2030-01-01T00:00:00" }))).toBe("no error");
    });

    it("one open checkout per (student, plan) even through raw SQL; two paid rows for one plan are allowed", async () => {
      const plan = `${RUN}-dup-${randomUUID().slice(0, 6)}`;
      expect(await sqlState(insertSub({ plan }))).toBe("no error");
      expect(await sqlState(insertSub({ plan }))).toMatch(/unique|23505/i);
      expect(await sqlState(insertSub({ plan, student: studentB }))).toBe("no error");
      const paid = `${RUN}-paid-${randomUUID().slice(0, 6)}`;
      expect(await sqlState(insertSub({ plan: paid, status: "active", paid: "2030-01-01T00:00:00" }))).toBe("no error");
      expect(await sqlState(insertSub({ plan: paid, status: "active", paid: "2030-02-01T00:00:00" }))).toBe("no error");
    });

    it("a provider reference maps to one subscription per provider; many unattached checkouts may coexist", async () => {
      const provider = `${RUN}-uniq`;
      const ref = uid("ref-unique");
      expect(await sqlState(insertSub({ provider, ref }))).toBe("no error");
      expect(await sqlState(insertSub({ provider, ref }))).toMatch(/unique|23505/i);
      expect(await sqlState(insertSub({ provider: `${provider}-2`, ref }))).toBe("no error");
      expect(await sqlState(insertSub({ provider, ref: null }))).toBe("no error");
      expect(await sqlState(insertSub({ provider, ref: null }))).toBe("no error");
    });

    it("billing events are append-only: no UPDATE, no DELETE", async () => {
      const s = await billing.openPendingSubscription({ id: randomUUID(), studentId: studentA, planId: `${RUN}-ev`, provider: `${RUN}-ev`, amountMinor: 1000, currency: "INR", now: "2026-10-10T00:00:00.000Z" });
      await billing.attachProviderRef(s.subscription.id, uid("ev-ref"), "2026-10-10T00:00:00.000Z");
      const e = evt(uid("ev-1"), "payment_succeeded", uid("ev-ref"), T(2));
      await billing.processEvent({ provider: `${RUN}-ev`, event: e, digest: "c".repeat(64), receivedAt: "2026-10-10T00:00:00.000Z", decide: decideWith(e) });
      expect(await sqlState(prisma.billingEvent.updateMany({ where: { eventId: e.eventId }, data: { outcome: "ignored_stale" } }))).toMatch(/append-only/);
      expect(await sqlState(prisma.billingEvent.deleteMany({ where: { eventId: e.eventId } }))).toMatch(/append-only/);
      expect((await billing.findEvent(`${RUN}-ev`, e.eventId))?.outcome).toBe("applied");
    });

    it("event rows reject unknown types/outcomes, a malformed digest and a blank id", async () => {
      const insertEvent = (type: string, outcome: string, digest: string, eventId: string) =>
        prisma.$executeRawUnsafe(`INSERT INTO billing_events (id, provider, event_id, type, occurred_at, received_at, digest, outcome) VALUES (gen_random_uuid()::text, $1, $2, $3, now(), now(), $4, $5)`, `${RUN}-chk`, eventId, type, digest, outcome);
      const good = "d".repeat(64);
      expect(await sqlState(insertEvent("payment_magic", "applied", good, uid("c1")))).toMatch(/check|23514/i);
      expect(await sqlState(insertEvent("payment_failed", "mystery", good, uid("c2")))).toMatch(/check|23514/i);
      expect(await sqlState(insertEvent("payment_failed", "applied", "xyz", uid("c3")))).toMatch(/check|23514/i);
      expect(await sqlState(insertEvent("payment_failed", "applied", good, " "))).toMatch(/check|23514/i);
      expect(await sqlState(insertEvent("payment_failed", "rejected_event_conflict", good, uid("c4")))).toMatch(/check|23514/i); // a conflict is reported, never stored
    });

    it("usage rows reject unknown meters/statuses, bad quantities, and an inconsistent settled state", async () => {
      const insertUsage = (meter: string, status: string, qty: number, key: string, settled: boolean) =>
        prisma.$executeRawUnsafe(`INSERT INTO usage_events (id, student_id, meter, quantity, idempotency_key, status, created_at, settled_at) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, now(), ${settled ? "now()" : "NULL"})`, studentA, meter, qty, key, status);
      expect(await sqlState(insertUsage("coffee", "reserved", 1, uid("u1"), false))).toMatch(/check|23514/i);
      expect(await sqlState(insertUsage("tutor_request", "paid", 1, uid("u2"), false))).toMatch(/check|23514/i);
      expect(await sqlState(insertUsage("tutor_request", "reserved", 0, uid("u3"), false))).toMatch(/check|23514/i);
      expect(await sqlState(insertUsage("tutor_request", "reserved", -3, uid("u4"), false))).toMatch(/check|23514/i);
      expect(await sqlState(insertUsage("tutor_request", "reserved", 1, " ", false))).toMatch(/check|23514/i);
      expect(await sqlState(insertUsage("tutor_request", "reserved", 1, uid("u5"), true))).toMatch(/check|23514/i);
      expect(await sqlState(insertUsage("tutor_request", "consumed", 1, uid("u6"), false))).toMatch(/check|23514/i);
      expect(await sqlState(insertUsage("tutor_request", "consumed", 1, uid("u7"), true))).toBe("no error");
      expect(await sqlState(insertUsage("tutor_request", "consumed", 1, uid("u7"), true))).toMatch(/unique|23505/i);
    });

    it("deleting a student detaches their subscriptions (the financial record survives) and removes their usage", async () => {
      const s = await mkStudent("delete");
      const sub = await billing.openPendingSubscription({ id: randomUUID(), studentId: s, planId: `${RUN}-del`, provider: `${RUN}-del`, amountMinor: 1000, currency: "INR", now: "2026-10-10T00:00:00.000Z" });
      await usage.reserve({ id: randomUUID(), studentId: s, meter: "tutor_request", quantity: 1, idempotencyKey: uid("del-u"), limit: 5, periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", now: "2026-10-10T00:00:00.000Z" });
      await prisma.student.delete({ where: { id: s } });
      const row = await prisma.billingSubscription.findUnique({ where: { id: sub.subscription.id } });
      expect(row).not.toBeNull();
      expect(row?.studentId).toBeNull();
      expect(await prisma.usageEvent.count({ where: { studentId: s } })).toBe(0);
      expect(await billing.listSubscriptionsForStudent(studentA)).not.toContainEqual(expect.objectContaining({ id: sub.subscription.id }));
    });

    it("holds no card, customer, payload or signature column anywhere", async () => {
      const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('billing_subscriptions','billing_events','usage_events','ai_usage_records')`;
      expect(cols.filter((c) => /card|cvv|cvc|pan|iban|account_number|secret|signature|payload|body|email|name|address|phone|prompt|^output$|output_text|completion|response|answer/i.test(c.column_name))).toEqual([]);
    });
  });

  describe("the migration chain", () => {
    it("is applied through 0018 with no failed migration", async () => {
      const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
      expect(rows.every((r) => r.finished_at !== null && r.rolled_back_at === null)).toBe(true);
      expect(rows.some((r) => r.migration_name === "0018_monetization_entitlements")).toBe(true);
      expect(rows[0]?.migration_name).toBe("0001_init");
    });
  });
});
