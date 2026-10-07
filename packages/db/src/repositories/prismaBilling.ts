import type {
  AiUsageRecord,
  AiUsageSink,
  AttachResult,
  BillingStore,
  OpenPendingInput,
  OperatorBillingReader,
  ProcessedEvent,
  ProcessEventInput,
  RecordedEventOutcome,
  ReserveInput,
  ReserveResult,
  StoredBillingEvent,
  Subscription,
  SubscriptionStatus,
  UsageReservation,
  UsageStore
} from "@ipmat/billing";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PersistenceError } from "./errors.js";

/**
 * The durable billing, usage and AI-usage stores (Phase 9 Unit 4, docs/DECISIONS.md D-100). They implement the billing domain's
 * ports; the domain never sees Prisma, and the pure transition function (`applyBillingEvent`) is passed IN, so the rules live in
 * one place and the database only supplies atomicity.
 *
 * Concurrency, by construction:
 *  - an event is recorded under a UNIQUE (provider, event id), and the subscription row it maps to is locked `FOR UPDATE`
 *    first, so two deliveries of one event - or two different events for one subscription - are serialized and apply once;
 *  - a student has at most ONE open `pending` checkout per plan (a partial unique index), so concurrent checkout requests share it;
 *  - usage is reserved under a per-(student, meter) advisory lock held for the transaction: the sum check and the insert cannot
 *    interleave, so a limit cannot be exceeded by simultaneous requests; a repeated idempotency key is a duplicate, not a second unit.
 */
const iso = (d: Date): string => d.toISOString();

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
function isForeignKeyViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2003" || (error.code === "P2010" && JSON.stringify(error.meta ?? {}).includes("23503"));
  return false;
}
const requireText = (v: unknown, what: string): string => (typeof v === "string" && v.trim() !== "" ? v : (() => { throw new PersistenceError("invalid_record", `${what} is required.`); })());

type SubscriptionRow = {
  id: string;
  studentId: string | null;
  planId: string;
  provider: string;
  providerRef: string | null;
  status: string;
  amountMinor: number;
  currency: string;
  paidThrough: Date | null;
  lastEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    studentId: row.studentId,
    planId: row.planId,
    provider: row.provider,
    providerRef: row.providerRef,
    status: row.status as SubscriptionStatus,
    amountMinor: row.amountMinor,
    currency: row.currency,
    paidThrough: row.paidThrough ? iso(row.paidThrough) : null,
    lastEventAt: row.lastEventAt ? iso(row.lastEventAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  };
}

function toStoredEvent(row: { provider: string; eventId: string; type: string; occurredAt: Date; receivedAt: Date; subscriptionId: string | null; outcome: string }): StoredBillingEvent {
  return { provider: row.provider, eventId: row.eventId, type: row.type, occurredAt: iso(row.occurredAt), receivedAt: iso(row.receivedAt), subscriptionId: row.subscriptionId, outcome: row.outcome as RecordedEventOutcome };
}

export class PrismaBillingStore implements BillingStore, OperatorBillingReader {
  constructor(private readonly prisma: PrismaClient) {}

  async openPendingSubscription(input: OpenPendingInput): Promise<{ subscription: Subscription; created: boolean }> {
    requireText(input.studentId, "A student id");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO billing_subscriptions (id, student_id, plan_id, provider, status, amount_minor, currency, created_at, updated_at)
          VALUES (${input.id}, ${input.studentId}, ${input.planId}, ${input.provider}, 'pending', ${input.amountMinor}, ${input.currency}, ${input.now}::timestamp, ${input.now}::timestamp)
          ON CONFLICT (student_id, plan_id) WHERE status = 'pending' DO NOTHING
          RETURNING id`;
        if (inserted.length > 0) {
          const row = await this.prisma.billingSubscription.findUniqueOrThrow({ where: { id: input.id } });
          return { subscription: toSubscription(row), created: true };
        }
        const existing = await this.prisma.billingSubscription.findFirst({ where: { studentId: input.studentId, planId: input.planId, status: "pending" } });
        // The open checkout can finish between the conflict and this read; then there is nothing to reuse - try the insert again.
        if (existing) return { subscription: toSubscription(existing), created: false };
      } catch (error) {
        if (isForeignKeyViolation(error)) throw new PersistenceError("missing_reference", "No such student: a subscription can only be opened for an existing student.");
        throw error;
      }
    }
    throw new PersistenceError("conflict", "The checkout could not be opened; please retry.");
  }

  async attachProviderRef(subscriptionId: string, providerRef: string, now: string): Promise<AttachResult> {
    requireText(providerRef, "A provider reference");
    const row = await this.prisma.billingSubscription.findUnique({ where: { id: subscriptionId } });
    if (!row) throw new PersistenceError("missing_reference", "No such subscription.");
    if (row.providerRef === providerRef) return "already_attached_same";
    if (row.providerRef !== null) return "conflict";
    try {
      // Only a still-unattached row may be attached: a concurrent attach of another reference loses cleanly.
      const { count } = await this.prisma.billingSubscription.updateMany({ where: { id: subscriptionId, providerRef: null }, data: { providerRef, updatedAt: new Date(now) } });
      if (count === 1) return "attached";
      const again = await this.prisma.billingSubscription.findUnique({ where: { id: subscriptionId } });
      return again?.providerRef === providerRef ? "already_attached_same" : "conflict";
    } catch (error) {
      if (isUniqueViolation(error)) return "conflict";
      throw error;
    }
  }

  async listSubscriptionsForStudent(studentId: string): Promise<Subscription[]> {
    requireText(studentId, "A student id");
    const rows = await this.prisma.billingSubscription.findMany({ where: { studentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(toSubscription);
  }

  async getSubscriptionForStudent(studentId: string, subscriptionId: string): Promise<Subscription | null> {
    requireText(studentId, "A student id");
    const row = await this.prisma.billingSubscription.findFirst({ where: { id: subscriptionId, studentId } });
    return row ? toSubscription(row) : null;
  }

  async processEvent(input: ProcessEventInput): Promise<ProcessedEvent> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize everything that touches this subscription (a no-op when no subscription has the reference).
        await tx.$queryRaw`SELECT id FROM billing_subscriptions WHERE provider = ${input.provider} AND provider_ref = ${input.event.providerRef} FOR UPDATE`;
        const existing = await tx.billingEvent.findUnique({ where: { provider_eventId: { provider: input.provider, eventId: input.event.eventId } } });
        if (existing) return this.duplicateResult(tx, existing, input.digest);

        const row = await tx.billingSubscription.findUnique({ where: { provider_providerRef: { provider: input.provider, providerRef: input.event.providerRef } } });
        const decision = input.decide(row ? toSubscription(row) : null);
        let status: string | null = row?.status ?? null;
        if (row && "next" in decision && decision.outcome === "applied") {
          const next = decision.next;
          const updated = await tx.billingSubscription.update({
            where: { id: row.id },
            data: { status: next.status, paidThrough: next.paidThrough ? new Date(next.paidThrough) : null, lastEventAt: next.lastEventAt ? new Date(next.lastEventAt) : null, updatedAt: new Date(next.updatedAt) }
          });
          status = updated.status;
        }
        await tx.billingEvent.create({
          data: {
            provider: input.provider,
            eventId: input.event.eventId,
            type: input.event.type,
            occurredAt: new Date(input.event.occurredAt),
            receivedAt: new Date(input.receivedAt),
            digest: input.digest,
            subscriptionId: row?.id ?? null,
            outcome: decision.outcome
          }
        });
        return { outcome: decision.outcome as RecordedEventOutcome, duplicate: false, subscriptionId: row?.id ?? null, status: status as SubscriptionStatus | null };
      });
    } catch (error) {
      // Lost an insert race for the same event id (only possible when no subscription row existed to serialize on): it is a duplicate.
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.billingEvent.findUnique({ where: { provider_eventId: { provider: input.provider, eventId: input.event.eventId } } });
        if (existing) return this.duplicateResult(this.prisma, existing, input.digest);
      }
      throw error;
    }
  }

  private async duplicateResult(db: Pick<PrismaClient, "billingSubscription">, existing: { outcome: string; digest: string; subscriptionId: string | null }, digest: string): Promise<ProcessedEvent> {
    const sub = existing.subscriptionId ? await db.billingSubscription.findUnique({ where: { id: existing.subscriptionId }, select: { status: true } }) : null;
    const outcome: RecordedEventOutcome = existing.digest === digest ? (existing.outcome as RecordedEventOutcome) : "rejected_event_conflict";
    return { outcome, duplicate: true, subscriptionId: existing.subscriptionId, status: (sub?.status as SubscriptionStatus | undefined) ?? null };
  }

  // ---- OperatorBillingReader -------------------------------------------------------------------------------------------

  async getSubscription(subscriptionId: string): Promise<Subscription | null> {
    const row = await this.prisma.billingSubscription.findUnique({ where: { id: subscriptionId } });
    return row ? toSubscription(row) : null;
  }

  async listEventsForSubscription(subscriptionId: string): Promise<StoredBillingEvent[]> {
    const rows = await this.prisma.billingEvent.findMany({ where: { subscriptionId }, orderBy: [{ occurredAt: "asc" }, { eventId: "asc" }] });
    return rows.map(toStoredEvent);
  }

  async findEvent(provider: string, eventId: string): Promise<StoredBillingEvent | null> {
    const row = await this.prisma.billingEvent.findUnique({ where: { provider_eventId: { provider, eventId } } });
    return row ? toStoredEvent(row) : null;
  }
}

function toReservation(row: { id: string; studentId: string; meter: string; quantity: number; idempotencyKey: string; status: string; createdAt: Date }): UsageReservation {
  return { id: row.id, studentId: row.studentId, meter: row.meter as UsageReservation["meter"], quantity: row.quantity, idempotencyKey: row.idempotencyKey, status: row.status as UsageReservation["status"], createdAt: iso(row.createdAt) };
}

export class PrismaUsageStore implements UsageStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    requireText(input.studentId, "A student id");
    requireText(input.idempotencyKey, "An idempotency key");
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new PersistenceError("invalid_record", "quantity must be a whole number from 1 to 100.");
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serializes reservations for this (student, meter) until the transaction ends.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`usage:${input.studentId}:${input.meter}`}, 0))`;
        const sum = async (): Promise<number> => (await tx.usageEvent.aggregate({ _sum: { quantity: true }, where: { studentId: input.studentId, meter: input.meter, status: { in: ["reserved", "consumed"] }, createdAt: { gte: periodStart, lt: periodEnd } } }))._sum.quantity ?? 0;
        const existing = await tx.usageEvent.findUnique({ where: { studentId_meter_idempotencyKey: { studentId: input.studentId, meter: input.meter, idempotencyKey: input.idempotencyKey } } });
        if (existing) return { status: "duplicate" as const, reservation: toReservation(existing), usedAfter: await sum() };
        const used = await sum();
        if (input.limit !== "unlimited" && used + input.quantity > input.limit) return { status: "limit_reached" as const, used };
        const row = await tx.usageEvent.create({ data: { id: input.id, studentId: input.studentId, meter: input.meter, quantity: input.quantity, idempotencyKey: input.idempotencyKey, status: "reserved", createdAt: new Date(input.now) } });
        return { status: "reserved" as const, reservation: toReservation(row), usedAfter: used + input.quantity };
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) throw new PersistenceError("missing_reference", "No such student.");
      throw error;
    }
  }

  async settle(studentId: string, reservationId: string, status: "consumed" | "released"): Promise<void> {
    requireText(studentId, "A student id");
    // Scoped to the student and only moves a still-`reserved` unit: another student's reservation, or an already settled one, is untouched.
    await this.prisma.usageEvent.updateMany({ where: { id: reservationId, studentId, status: "reserved" }, data: { status, settledAt: this.clock() } });
  }

  async usedInPeriod(studentId: string, meter: string, periodStart: string, periodEnd: string): Promise<number> {
    requireText(studentId, "A student id");
    const result = await this.prisma.usageEvent.aggregate({ _sum: { quantity: true }, where: { studentId, meter, status: { in: ["reserved", "consumed"] }, createdAt: { gte: new Date(periodStart), lt: new Date(periodEnd) } } });
    return result._sum.quantity ?? 0;
  }
}

export class PrismaAiUsageSink implements AiUsageSink {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: AiUsageRecord): Promise<void> {
    await this.prisma.aiUsageRecord.create({
      data: {
        requestId: entry.requestId,
        studentRef: entry.studentRef,
        occurredAt: new Date(entry.occurredAt),
        provider: entry.provider.slice(0, 64),
        model: entry.model.slice(0, 128),
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        outcome: entry.outcome,
        failureCategory: entry.failureCategory,
        latencyMs: Math.max(0, Math.round(entry.latencyMs))
      }
    });
  }
}
