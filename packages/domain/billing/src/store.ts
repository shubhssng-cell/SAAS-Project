import type { RecordedEventOutcome, BillingEvent, Subscription, SubscriptionStatus, TransitionResult } from "./subscription.js";

/**
 * Persistence ports (Phase 9 Unit 4, D-100). Implemented in `@ipmat/db` (in-memory and Postgres); this package never sees a
 * database. Every student-facing read is keyed by the AUTHENTICATED student id and filters on it in the query.
 */
export interface OpenPendingInput {
  id: string;
  studentId: string;
  planId: string;
  provider: string;
  amountMinor: number;
  currency: string;
  now: string;
}

export type AttachResult = "attached" | "already_attached_same" | "conflict";

export interface ProcessEventInput {
  provider: string;
  event: BillingEvent;
  /** SHA-256 of the raw (verified) body: lets a re-delivery be told apart from a different payload reusing an event id. */
  digest: string;
  receivedAt: string;
  /**
   * Decides the transition for the subscription the event maps to (`null` = no subscription has that provider reference).
   * Called INSIDE the store's atomic section with the row locked, so it must be synchronous and side-effect free.
   */
  decide: (subscription: Subscription | null) => TransitionResult | { outcome: "ignored_unknown_reference" };
}

export interface ProcessedEvent {
  outcome: RecordedEventOutcome;
  /** True when this provider event id had already been processed (nothing was applied again). */
  duplicate: boolean;
  subscriptionId: string | null;
  status: SubscriptionStatus | null;
}

export interface BillingStore {
  /** One open `pending` subscription per (student, plan): a repeated request returns the existing one (`created: false`) - never a second. Race-safe. */
  openPendingSubscription(input: OpenPendingInput): Promise<{ subscription: Subscription; created: boolean }>;
  /** Sets the provider reference once. The same reference again is `already_attached_same`; a different one is a `conflict` and changes nothing. */
  attachProviderRef(subscriptionId: string, providerRef: string, now: string): Promise<AttachResult>;
  listSubscriptionsForStudent(studentId: string): Promise<Subscription[]>;
  /** `null` for a missing subscription AND for another student's (indistinguishable). */
  getSubscriptionForStudent(studentId: string, subscriptionId: string): Promise<Subscription | null>;
  /**
   * Records a verified provider event and applies its transition in ONE atomic step: the event row (unique per provider event id)
   * is inserted first, so a concurrent or repeated delivery of the same id applies once; a different payload under a used id is
   * reported `rejected_event_conflict` and changes nothing.
   */
  processEvent(input: ProcessEventInput): Promise<ProcessedEvent>;
}

export interface StoredBillingEvent {
  provider: string;
  eventId: string;
  type: string;
  occurredAt: string;
  receivedAt: string;
  subscriptionId: string | null;
  outcome: RecordedEventOutcome;
}

/**
 * Operator reads. A DIFFERENT interface on purpose (as for the orchestration audit): code handed only a `BillingStore` cannot
 * reach another student's records by type. No route uses it today - there is no staff identity to authorize one - and it has
 * no write operation: granting or revoking access by hand is an unresolved policy (D-100).
 */
export interface OperatorBillingReader {
  getSubscription(subscriptionId: string): Promise<Subscription | null>;
  listEventsForSubscription(subscriptionId: string): Promise<StoredBillingEvent[]>;
  findEvent(provider: string, eventId: string): Promise<StoredBillingEvent | null>;
}
