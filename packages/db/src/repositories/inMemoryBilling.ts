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
  UsageReservation,
  UsageStore
} from "@ipmat/billing";
import { PersistenceError } from "./errors.js";

/**
 * In-memory reference implementation of the billing, usage and AI-usage ports (Phase 9 Unit 4, D-100). The Prisma
 * implementation must satisfy the same contract (the shared contract tests run both). JavaScript is single-threaded and every
 * critical section below is synchronous, so each operation is atomic exactly as the database transaction is.
 * `knownStudentIds` plays the role of the `students` table: a student that is not in it fails like the foreign key does.
 */
const copy = <T>(v: T): T => structuredClone(v);

export class InMemoryBillingStore implements BillingStore, UsageStore, OperatorBillingReader, AiUsageSink {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly events = new Map<string, StoredBillingEvent & { digest: string }>();
  private readonly usage = new Map<string, UsageReservation & { createdAtMs: number }>();
  readonly aiUsage: AiUsageRecord[] = [];

  constructor(private readonly knownStudentIds: ReadonlySet<string> | null = null) {}

  private requireStudent(studentId: string): void {
    if (!studentId || studentId.trim() === "") throw new PersistenceError("invalid_record", "A student id is required.");
    if (this.knownStudentIds && !this.knownStudentIds.has(studentId)) throw new PersistenceError("missing_reference", "No such student.");
  }

  // ---- BillingStore ----------------------------------------------------------------------------------------------------

  async openPendingSubscription(input: OpenPendingInput): Promise<{ subscription: Subscription; created: boolean }> {
    this.requireStudent(input.studentId);
    for (const s of this.subscriptions.values()) {
      if (s.studentId === input.studentId && s.planId === input.planId && s.status === "pending") return { subscription: copy(s), created: false };
    }
    const subscription: Subscription = {
      id: input.id,
      studentId: input.studentId,
      planId: input.planId,
      provider: input.provider,
      providerRef: null,
      status: "pending",
      amountMinor: input.amountMinor,
      currency: input.currency,
      paidThrough: null,
      lastEventAt: null,
      createdAt: input.now,
      updatedAt: input.now
    };
    this.subscriptions.set(subscription.id, subscription);
    return { subscription: copy(subscription), created: true };
  }

  async attachProviderRef(subscriptionId: string, providerRef: string, now: string): Promise<AttachResult> {
    const s = this.subscriptions.get(subscriptionId);
    if (!s) throw new PersistenceError("missing_reference", "No such subscription.");
    if (s.providerRef === providerRef) return "already_attached_same";
    if (s.providerRef !== null) return "conflict";
    for (const other of this.subscriptions.values()) if (other.provider === s.provider && other.providerRef === providerRef) return "conflict";
    s.providerRef = providerRef;
    s.updatedAt = now;
    return "attached";
  }

  async listSubscriptionsForStudent(studentId: string): Promise<Subscription[]> {
    return [...this.subscriptions.values()].filter((s) => s.studentId === studentId).map(copy);
  }

  async getSubscriptionForStudent(studentId: string, subscriptionId: string): Promise<Subscription | null> {
    const s = this.subscriptions.get(subscriptionId);
    return s && s.studentId === studentId ? copy(s) : null;
  }

  async processEvent(input: ProcessEventInput): Promise<ProcessedEvent> {
    const key = `${input.provider}::${input.event.eventId}`;
    const existing = this.events.get(key);
    if (existing) {
      const sub = existing.subscriptionId ? this.subscriptions.get(existing.subscriptionId) : undefined;
      const outcome: RecordedEventOutcome = existing.digest === input.digest ? existing.outcome : "rejected_event_conflict";
      return { outcome, duplicate: true, subscriptionId: existing.subscriptionId, status: sub?.status ?? null };
    }
    const subscription = [...this.subscriptions.values()].find((s) => s.provider === input.provider && s.providerRef === input.event.providerRef) ?? null;
    const decision = input.decide(subscription ? copy(subscription) : null);
    if (subscription && "next" in decision && decision.outcome === "applied") this.subscriptions.set(subscription.id, copy(decision.next));
    const outcome = decision.outcome as RecordedEventOutcome;
    this.events.set(key, {
      provider: input.provider,
      eventId: input.event.eventId,
      type: input.event.type,
      occurredAt: input.event.occurredAt,
      receivedAt: input.receivedAt,
      subscriptionId: subscription?.id ?? null,
      outcome,
      digest: input.digest
    });
    const after = subscription ? this.subscriptions.get(subscription.id) : undefined;
    return { outcome, duplicate: false, subscriptionId: subscription?.id ?? null, status: after?.status ?? null };
  }

  // ---- OperatorBillingReader -------------------------------------------------------------------------------------------

  async getSubscription(subscriptionId: string): Promise<Subscription | null> {
    const s = this.subscriptions.get(subscriptionId);
    return s ? copy(s) : null;
  }

  async listEventsForSubscription(subscriptionId: string): Promise<StoredBillingEvent[]> {
    return [...this.events.values()].filter((e) => e.subscriptionId === subscriptionId).map(({ digest: _digest, ...rest }) => (void _digest, copy(rest)));
  }

  async findEvent(provider: string, eventId: string): Promise<StoredBillingEvent | null> {
    const e = this.events.get(`${provider}::${eventId}`);
    if (!e) return null;
    const { digest: _digest, ...rest } = e;
    void _digest;
    return copy(rest);
  }

  // ---- UsageStore ------------------------------------------------------------------------------------------------------

  private used(studentId: string, meter: string, startMs: number, endMs: number): number {
    let total = 0;
    for (const r of this.usage.values()) {
      if (r.studentId === studentId && r.meter === meter && r.status !== "released" && r.createdAtMs >= startMs && r.createdAtMs < endMs) total += r.quantity;
    }
    return total;
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    this.requireStudent(input.studentId);
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new PersistenceError("invalid_record", "quantity must be a whole number from 1 to 100.");
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") throw new PersistenceError("invalid_record", "An idempotency key is required.");
    const startMs = Date.parse(input.periodStart);
    const endMs = Date.parse(input.periodEnd);
    for (const r of this.usage.values()) {
      if (r.studentId === input.studentId && r.meter === input.meter && r.idempotencyKey === input.idempotencyKey) {
        const { createdAtMs: _ms, ...reservation } = r;
        void _ms;
        return { status: "duplicate", reservation: copy(reservation), usedAfter: this.used(input.studentId, input.meter, startMs, endMs) };
      }
    }
    const used = this.used(input.studentId, input.meter, startMs, endMs);
    if (input.limit !== "unlimited" && used + input.quantity > input.limit) return { status: "limit_reached", used };
    const record = { id: input.id, studentId: input.studentId, meter: input.meter, quantity: input.quantity, idempotencyKey: input.idempotencyKey, status: "reserved" as const, createdAt: input.now, createdAtMs: Date.parse(input.now) };
    this.usage.set(record.id, record);
    const { createdAtMs: _ms, ...reservation } = record;
    void _ms;
    return { status: "reserved", reservation: copy(reservation), usedAfter: used + input.quantity };
  }

  async settle(studentId: string, reservationId: string, status: "consumed" | "released"): Promise<void> {
    const r = this.usage.get(reservationId);
    if (r && r.studentId === studentId && r.status === "reserved") r.status = status;
  }

  async usedInPeriod(studentId: string, meter: string, periodStart: string, periodEnd: string): Promise<number> {
    return this.used(studentId, meter, Date.parse(periodStart), Date.parse(periodEnd));
  }

  // ---- AiUsageSink -----------------------------------------------------------------------------------------------------

  async record(entry: AiUsageRecord): Promise<void> {
    this.aiUsage.push(copy(entry));
  }
}
