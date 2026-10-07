import { createHmac, timingSafeEqual } from "node:crypto";
import { MAX_AMOUNT_MINOR } from "./catalog.js";
import { BILLING_EVENT_TYPES, type BillingEvent, type BillingEventType } from "./subscription.js";

/**
 * The payment-provider boundary (Phase 9 Unit 4, D-100). The application talks to `PaymentProvider`; a concrete adapter
 * (Stripe, Razorpay, ...) implements it in the composition root and is the only place a provider SDK, API key or webhook secret
 * lives. No adapter is shipped: none is chosen, and no credential exists in this repository. Deployments without one report
 * checkout as unavailable and accept no webhook - there is no fake provider in production wiring.
 *
 * Payment collection is provider-hosted: this application never receives or stores card numbers, CVVs or bank credentials.
 */
export interface CheckoutRequest {
  /**
   * The provider MUST return the same session for the same key (every real provider supports idempotent creation), so a repeated
   * request - a double click, a retry after a timeout - cannot create a second charge session.
   */
  idempotencyKey: string;
  /** Our subscription id; the adapter should send it as the provider's client reference so the webhook echoes it back. */
  subscriptionId: string;
  planId: string;
  planName: string;
  /** Server-determined from the plan catalog. Never from a client. */
  amountMinor: number;
  currency: string;
  providerPriceRef: string | null;
  /** Where the provider returns the browser afterwards. Server configuration. Returning is NOT proof of payment. */
  returnUrl: string | null;
}

export interface CheckoutSession {
  /** The provider's reference. Webhook events are mapped to the subscription by exact match on this value. */
  providerRef: string;
  /** Provider-hosted payment page. Must be an https URL; it is not stored. */
  checkoutUrl: string;
}

export type ParsedWebhook = { kind: "event"; event: BillingEvent } | { kind: "ignored" };

export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Verifies authenticity (signature over the RAW body, replay window) and returns a normalized event, or `ignored` for a
   * genuine provider event this application does not act on. Throws `WebhookRejectedError` for anything unauthentic or malformed.
   * MUST NOT trust any field before the signature has been verified.
   */
  parseWebhook(input: { rawBody: string; headers: Readonly<Record<string, string | undefined>>; now: Date }): ParsedWebhook;
  /** Asks the provider to stop renewing. The resulting state change arrives later as a webhook event; this call never edits local state. */
  cancelSubscription(providerRef: string): Promise<void>;
}

export class WebhookRejectedError extends Error {
  constructor(readonly reason: "bad_signature" | "stale_timestamp" | "malformed") {
    super(`webhook rejected: ${reason}`);
    this.name = "WebhookRejectedError";
  }
}

/** The provider failed or could not be reached. Carries no provider text. */
export class ProviderUnavailableError extends Error {
  constructor() {
    super("payment provider unavailable");
    this.name = "ProviderUnavailableError";
  }
}

/** Default replay window for signed webhooks. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Verifies a `HMAC-SHA256(secret, "<timestamp>.<rawBody>")` signature in constant time and rejects a timestamp outside the
 * replay window. Provided as a building block for adapters whose provider signs this way; adapters for other schemes verify
 * theirs equivalently. Throws `WebhookRejectedError`.
 */
export function verifyHmacSha256Signature(input: { secret: string; timestamp: string; rawBody: string; signatureHex: string; now: Date; toleranceSeconds?: number }): void {
  const ts = Number(input.timestamp);
  if (!/^\d{9,12}$/.test(input.timestamp) || !Number.isFinite(ts)) throw new WebhookRejectedError("malformed");
  if (!/^[0-9a-f]{64}$/i.test(input.signatureHex)) throw new WebhookRejectedError("bad_signature");
  const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest();
  const given = Buffer.from(input.signatureHex, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new WebhookRejectedError("bad_signature");
  const skew = Math.abs(input.now.getTime() / 1000 - ts);
  if (skew > (input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) throw new WebhookRejectedError("stale_timestamp");
}

const EVENT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const REF = /^[A-Za-z0-9_.:-]{1,128}$/;
const SUBSCRIPTION_ID = /^[A-Za-z0-9-]{1,64}$/;
/** A provider clock may run slightly ahead of ours; anything further in the future is not a real event time. */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

/**
 * Strict normalization of an already-authenticated provider event into a `BillingEvent`. Adapters call this after verifying the
 * signature so every provider's events reach the application in one shape and obey one set of bounds. Throws
 * `WebhookRejectedError("malformed")`; never returns a partially valid event.
 */
export function normalizeBillingEvent(candidate: unknown, now: Date): BillingEvent {
  const bad = (): never => {
    throw new WebhookRejectedError("malformed");
  };
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return bad();
  const c = candidate as Record<string, unknown>;
  const allowed = ["eventId", "type", "occurredAt", "providerRef", "subscriptionId", "amountMinor", "currency"];
  for (const key of Object.keys(c)) if (!allowed.includes(key)) return bad();
  if (typeof c.eventId !== "string" || !EVENT_ID.test(c.eventId)) return bad();
  if (typeof c.type !== "string" || !(BILLING_EVENT_TYPES as readonly string[]).includes(c.type)) return bad();
  if (typeof c.occurredAt !== "string" || Number.isNaN(Date.parse(c.occurredAt))) return bad();
  const at = Date.parse(c.occurredAt);
  if (at > now.getTime() + MAX_FUTURE_SKEW_MS || at < Date.UTC(2020, 0, 1)) return bad();
  if (typeof c.providerRef !== "string" || !REF.test(c.providerRef)) return bad();
  if (c.subscriptionId !== undefined && c.subscriptionId !== null && (typeof c.subscriptionId !== "string" || !SUBSCRIPTION_ID.test(c.subscriptionId))) return bad();
  if (c.amountMinor !== undefined && c.amountMinor !== null && !(typeof c.amountMinor === "number" && Number.isInteger(c.amountMinor) && c.amountMinor >= 0 && c.amountMinor <= MAX_AMOUNT_MINOR)) return bad();
  if (c.currency !== undefined && c.currency !== null && !(typeof c.currency === "string" && /^[A-Z]{3}$/.test(c.currency))) return bad();
  return {
    eventId: c.eventId,
    type: c.type as BillingEventType,
    occurredAt: new Date(at).toISOString(),
    providerRef: c.providerRef,
    subscriptionId: (c.subscriptionId as string | null | undefined) ?? null,
    amountMinor: (c.amountMinor as number | null | undefined) ?? null,
    currency: (c.currency as string | null | undefined) ?? null
  };
}
