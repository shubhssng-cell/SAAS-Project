import type { MeterId, UsagePeriod } from "./catalog.js";
import type { EntitlementService, EffectiveLimit } from "./entitlement.js";

/**
 * Usage metering (Phase 9 Unit 4, D-100). The SERVER decides what counts as one unit and when; a browser can neither add to nor
 * reset a counter. A unit is RESERVED before the metered work starts (so simultaneous requests cannot all pass a check that
 * only one of them should) and then SETTLED: `consumed` when the work was delivered, `released` when it was not (a provider
 * outage is not the student's usage). Reservations are idempotent per key and are a ledger: nothing is edited or deleted.
 */
export type UsageStatus = "reserved" | "consumed" | "released";

export interface UsageReservation {
  id: string;
  studentId: string;
  meter: MeterId;
  quantity: number;
  /** Idempotency key: the request's server-generated correlation id. */
  idempotencyKey: string;
  status: UsageStatus;
  createdAt: string;
}

export type ReserveResult =
  | { status: "reserved"; reservation: UsageReservation; usedAfter: number }
  /** The same idempotency key was already reserved: no second unit is counted. */
  | { status: "duplicate"; reservation: UsageReservation; usedAfter: number }
  | { status: "limit_reached"; used: number };

export interface ReserveInput {
  id: string;
  studentId: string;
  meter: MeterId;
  quantity: number;
  idempotencyKey: string;
  limit: number | "unlimited";
  periodStart: string;
  periodEnd: string;
  now: string;
}

/** Persistence port. `reserve` MUST be atomic per (student, meter): the sum check and the insert cannot interleave with another reserve. */
export interface UsageStore {
  reserve(input: ReserveInput): Promise<ReserveResult>;
  /** Moves a `reserved` unit to `consumed` or `released`. Idempotent; scoped to the student; a settled unit is never changed again. */
  settle(studentId: string, reservationId: string, status: "consumed" | "released"): Promise<void>;
  /** Units counted in a period: `reserved` + `consumed` (released units do not count). */
  usedInPeriod(studentId: string, meter: MeterId, periodStart: string, periodEnd: string): Promise<number>;
}

/** One provider call's usage FACTS. No prompt, no output text, no answer key, no cost (no authoritative pricing exists in this deployment). */
export interface AiUsageRecord {
  requestId: string | null;
  /** One-way student reference from the request context (never the raw id); `null` outside a request. */
  studentRef: string | null;
  occurredAt: string;
  provider: string;
  model: string;
  /** Token counts exactly as the provider reported them; `null` when the provider reported none (e.g. a failed call). */
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: "ok" | "error";
  failureCategory: string | null;
  latencyMs: number;
}

export interface AiUsageSink {
  record(entry: AiUsageRecord): Promise<void>;
}

/** The calendar period (UTC) containing `now`. */
export function periodBounds(period: UsagePeriod, now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const start = period === "day" ? Date.UTC(y, m, d) : Date.UTC(y, m, 1);
  const end = period === "day" ? Date.UTC(y, m, d + 1) : Date.UTC(y, m + 1, 1);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

export type UsageDecision =
  | { allowed: true; metered: false; reservation: null }
  | { allowed: true; metered: true; reservation: UsageReservation; used: number; limit: number | "unlimited"; period: UsagePeriod }
  | { allowed: false; reason: "no_limit_defined" | "usage_limit_reached"; used: number; limit: number | "unlimited" | null; period: UsagePeriod | null };

export interface UsageDependencies {
  store: UsageStore;
  entitlements: EntitlementService;
  now: () => Date;
  newId: () => string;
}

export class UsageService {
  constructor(private readonly deps: UsageDependencies) {}

  /**
   * Reserves one unit. In `open` mode nothing is metered. Otherwise the limit comes from the entitlement service; a meter with
   * no defined limit is denied (the feature check should already have refused, this is the fail-closed backstop).
   */
  async reserve(studentId: string, examCode: string, meter: MeterId, idempotencyKey: string, quantity = 1): Promise<UsageDecision> {
    if (this.deps.entitlements.mode === "open") return { allowed: true, metered: false, reservation: null };
    const limit = await this.deps.entitlements.getUsageLimit(studentId, meter, examCode);
    if (!limit) return { allowed: false, reason: "no_limit_defined", used: 0, limit: null, period: null };
    const now = this.deps.now();
    const bounds = periodBounds(limit.period, now);
    const result = await this.deps.store.reserve({ id: this.deps.newId(), studentId, meter, quantity, idempotencyKey, limit: limit.limit, periodStart: bounds.start, periodEnd: bounds.end, now: now.toISOString() });
    if (result.status === "limit_reached") return { allowed: false, reason: "usage_limit_reached", used: result.used, limit: limit.limit, period: limit.period };
    return { allowed: true, metered: true, reservation: result.reservation, used: result.usedAfter, limit: limit.limit, period: limit.period };
  }

  async settle(studentId: string, reservation: UsageReservation | null, status: "consumed" | "released"): Promise<void> {
    if (reservation) await this.deps.store.settle(studentId, reservation.id, status);
  }

  /** Usage against limits the caller already computed (one snapshot): one count per meter, nothing else. */
  async statusForLimits(studentId: string, limits: readonly EffectiveLimit[]): Promise<Array<{ meter: MeterId; used: number; limit: number | "unlimited"; period: UsagePeriod; resetsAt: string }>> {
    const out: Array<{ meter: MeterId; used: number; limit: number | "unlimited"; period: UsagePeriod; resetsAt: string }> = [];
    for (const limit of limits) {
      const bounds = periodBounds(limit.period, this.deps.now());
      out.push({ meter: limit.meter, used: await this.deps.store.usedInPeriod(studentId, limit.meter, bounds.start, bounds.end), limit: limit.limit, period: limit.period, resetsAt: bounds.end });
    }
    return out;
  }
}
