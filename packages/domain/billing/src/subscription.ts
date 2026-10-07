import type { PlanDefinition } from "./catalog.js";

/**
 * Subscription state and its deterministic transitions (Phase 9 Unit 4, D-100).
 *
 * A subscription is the application's record of ONE student's agreement to a plan. Its status is changed ONLY by a verified
 * provider event passed to `applyBillingEvent` - never by a browser, a redirect, a query string or a model. A payment event is
 * evidence about money; whether the student currently has access is a separate, derived question (`entitlement.ts`) answered
 * from the status, `paidThrough` and the server clock on every read.
 */
export const SUBSCRIPTION_STATUSES = ["pending", "active", "past_due", "cancelled", "expired", "refunded", "failed"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription {
  id: string;
  /** `null` only after the student's account was deleted (the financial record outlives it; see D-100 on retention). */
  studentId: string | null;
  planId: string;
  provider: string;
  /** The provider's reference for the checkout/subscription; set once, then immutable. `null` until a checkout exists. */
  providerRef: string | null;
  status: SubscriptionStatus;
  /** Server-determined snapshot of what this checkout was created for. A payment event must match it exactly. */
  amountMinor: number;
  currency: string;
  /** End of the period paid for so far (ISO). `null` until the first verified payment. */
  paidThrough: string | null;
  /** Provider time of the latest event that changed this record (ISO). Used to ignore out-of-order state changes. */
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const BILLING_EVENT_TYPES = ["payment_succeeded", "payment_failed", "payment_past_due", "subscription_cancelled", "subscription_expired", "payment_refunded"] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

/** A provider event after the provider adapter verified its authenticity and normalized it. Contains no card data, no customer details, no raw payload. */
export interface BillingEvent {
  /** The provider's unique id for this event: the idempotency key. */
  eventId: string;
  type: BillingEventType;
  /** When the provider says it happened (ISO). */
  occurredAt: string;
  /** The provider reference of the checkout/subscription the event is about; mapped to a subscription by exact match. */
  providerRef: string;
  /** Our own subscription id, when the provider echoes it back (client reference). Cross-checked against the mapped record. */
  subscriptionId?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
}

export type TransitionOutcome =
  | "applied"
  | "ignored_stale"
  | "ignored_terminal"
  | "ignored_invalid_transition"
  | "rejected_amount_mismatch"
  | "rejected_reference_mismatch"
  | "rejected_unknown_plan";

export type RecordedEventOutcome = TransitionOutcome | "ignored_unknown_reference" | "rejected_event_conflict";

export interface TransitionResult {
  outcome: TransitionOutcome;
  next: Subscription;
}

const DAY_MS = 86_400_000;
const TERMINAL: readonly SubscriptionStatus[] = ["refunded", "failed", "expired"];

const ms = (iso: string | null): number => (iso === null ? Number.NEGATIVE_INFINITY : Date.parse(iso));
const iso = (t: number): string => new Date(t).toISOString();

/**
 * The one transition function. PURE: the same subscription, event and plan always give the same result, so a replay or a
 * concurrent re-delivery cannot produce a different state. Rules (also documented in docs/PHASE_9_UNIT_4_REVIEW.md):
 *
 *  - an event naming a different subscription than the one its provider reference maps to is rejected;
 *  - `refunded` is final: any later event is ignored, so a success that arrives after its own refund cannot restore access;
 *  - `payment_refunded` applies from every other status, in any order (revocation is safety-biased);
 *  - `payment_succeeded` must match the amount and currency snapshotted at checkout, and needs a known plan (its duration);
 *    it extends `paidThrough` to `max(paidThrough, occurredAt) + plan duration` - monotone, so re-ordering renewals never
 *    shortens access - and sets `active` unless a LATER event already moved the status (then it extends the paid period only);
 *  - `failed` and `expired` are final for that record (a new payment is a new checkout);
 *  - every other event changes the status only if it is not older than the last change (`ignored_stale` otherwise).
 */
export function applyBillingEvent(subscription: Subscription, event: BillingEvent, plan: PlanDefinition | null, now: string): TransitionResult {
  const keep = (outcome: TransitionOutcome): TransitionResult => ({ outcome, next: subscription });
  const at = ms(event.occurredAt);
  const stale = at < ms(subscription.lastEventAt);
  const stamp = (patch: Partial<Subscription>): Subscription => ({ ...subscription, ...patch, lastEventAt: iso(Math.max(ms(subscription.lastEventAt), at)), updatedAt: now });

  if (event.subscriptionId !== undefined && event.subscriptionId !== null && event.subscriptionId !== subscription.id) return keep("rejected_reference_mismatch");
  if (subscription.status === "refunded") return keep("ignored_terminal");

  switch (event.type) {
    case "payment_refunded":
      return { outcome: "applied", next: stamp({ status: "refunded" }) };

    case "payment_succeeded": {
      if (TERMINAL.includes(subscription.status)) return keep("ignored_terminal");
      if (event.amountMinor !== subscription.amountMinor || event.currency !== subscription.currency) return keep("rejected_amount_mismatch");
      if (!plan || plan.id !== subscription.planId) return keep("rejected_unknown_plan");
      const base = Math.max(ms(subscription.paidThrough), at);
      const paidThrough = iso(base + plan.durationDays * DAY_MS);
      const status = subscription.status === "cancelled" || stale ? subscription.status : "active";
      return { outcome: "applied", next: stamp({ status, paidThrough }) };
    }

    case "payment_failed":
      if (TERMINAL.includes(subscription.status)) return keep("ignored_terminal");
      if (stale) return keep("ignored_stale");
      if (subscription.status === "pending") return { outcome: "applied", next: stamp({ status: "failed" }) };
      if (subscription.status === "active" || subscription.status === "past_due") return { outcome: "applied", next: stamp({ status: "past_due" }) };
      return keep("ignored_invalid_transition");

    case "payment_past_due":
      if (TERMINAL.includes(subscription.status)) return keep("ignored_terminal");
      if (stale) return keep("ignored_stale");
      return subscription.status === "active" ? { outcome: "applied", next: stamp({ status: "past_due" }) } : keep("ignored_invalid_transition");

    case "subscription_cancelled":
      if (TERMINAL.includes(subscription.status)) return keep("ignored_terminal");
      if (stale) return keep("ignored_stale");
      return subscription.status === "cancelled" ? keep("ignored_invalid_transition") : { outcome: "applied", next: stamp({ status: "cancelled" }) };

    case "subscription_expired":
      if (TERMINAL.includes(subscription.status)) return keep("ignored_terminal");
      if (stale) return keep("ignored_stale");
      return { outcome: "applied", next: stamp({ status: "expired" }) };

    default:
      return keep("ignored_invalid_transition");
  }
}

/**
 * The status as a person should see it NOW: an `active`/`cancelled` subscription whose paid period has ended is `expired`
 * whether or not a provider "expired" event has arrived yet. Derived on every read; never stored.
 */
export function effectiveStatus(subscription: Subscription, now: Date): SubscriptionStatus {
  if ((subscription.status === "active" || subscription.status === "cancelled" || subscription.status === "past_due") && !periodRemaining(subscription, now)) return "expired";
  return subscription.status;
}

/** Whether the paid period still has time left. */
export function periodRemaining(subscription: Subscription, now: Date): boolean {
  return subscription.paidThrough !== null && now.getTime() < Date.parse(subscription.paidThrough);
}

/**
 * Whether this subscription grants access at `now`. `active` and `cancelled` (will not renew) keep access until the period that
 * was paid for ends; `past_due` also keeps it until then - the failed attempt was for the NEXT period, and this package invents
 * no grace beyond the paid period (an unresolved policy, D-100). `pending`, `failed`, `expired` and `refunded` never grant it.
 */
export function grantsAccess(subscription: Subscription, now: Date): boolean {
  return (subscription.status === "active" || subscription.status === "cancelled" || subscription.status === "past_due") && periodRemaining(subscription, now);
}
