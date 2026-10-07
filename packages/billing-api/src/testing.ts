import { createHash, createHmac } from "node:crypto";
import {
  normalizeBillingEvent,
  parsePlanCatalog,
  ProviderUnavailableError,
  verifyHmacSha256Signature,
  WebhookRejectedError,
  type BillingEvent,
  type CheckoutRequest,
  type CheckoutSession,
  type ParsedWebhook,
  type PaymentProvider,
  type PlanCatalog
} from "@ipmat/billing";

/**
 * TEST DOUBLES for the billing application layer (Phase 9 Unit 4, D-100). NOT part of the package's public entry point and never
 * imported by production wiring (an architecture test enforces that). Every value here is a LABELLED TEST FIXTURE: the plan
 * names, limits, durations and prices are made up for tests and are not a business proposal.
 */

/** TEST DATA ONLY - not real pricing. */
export const TEST_CATALOG_SOURCE = {
  baseline: { exams: ["IPMAT_INDORE"], features: ["tutor"], usageLimits: [{ meter: "tutor_request", limit: 2, period: "day" }] },
  plans: [
    {
      id: "test_plus",
      name: "Test Plus (fixture)",
      description: "Fixture plan used only by tests.",
      active: true,
      provisional: true,
      exams: ["IPMAT_INDORE"],
      features: ["tutor", "simulation", "advanced_training"],
      usageLimits: [
        { meter: "tutor_request", limit: 5, period: "day" },
        { meter: "simulation_start", limit: 2, period: "month" }
      ],
      durationDays: 30,
      price: { amountMinor: 123456, currency: "INR", providerPriceRef: "price_test_plus" }
    },
    {
      id: "test_unlimited",
      name: "Test Unlimited (fixture)",
      description: "Fixture plan with unlimited tutor use.",
      active: true,
      provisional: true,
      exams: ["IPMAT_INDORE"],
      features: ["tutor"],
      usageLimits: [{ meter: "tutor_request", limit: "unlimited", period: "month" }],
      durationDays: 7,
      price: { amountMinor: 5000, currency: "INR", providerPriceRef: null }
    },
    { id: "test_retired", name: "Retired (fixture)", description: "Inactive plan.", active: false, provisional: true, exams: ["IPMAT_INDORE"], features: ["tutor"], usageLimits: [{ meter: "tutor_request", limit: 9, period: "day" }], durationDays: 30, price: { amountMinor: 100, currency: "INR", providerPriceRef: null } },
    { id: "test_unpriced", name: "Unpriced (fixture)", description: "No price configured.", active: true, provisional: true, exams: ["IPMAT_INDORE"], features: ["simulation"], usageLimits: [{ meter: "simulation_start", limit: 1, period: "month" }], durationDays: 30, price: null }
  ]
};

export function testCatalog(): PlanCatalog {
  return parsePlanCatalog(structuredClone(TEST_CATALOG_SOURCE));
}

export const TEST_WEBHOOK_SECRET = "whsec_TEST_ONLY_not_a_real_secret_0001";

export interface SignedWebhook {
  rawBody: string;
  headers: Record<string, string>;
}

/** A deterministic provider double speaking an invented signed-JSON scheme. It honours the idempotent-checkout contract unless told not to. */
export class HmacTestProvider implements PaymentProvider {
  readonly name = "test-provider";
  readonly checkouts: CheckoutRequest[] = [];
  readonly cancelled: string[] = [];
  failCheckout = false;
  failCancel = false;
  /** When true, a repeated idempotency key yields a NEW session (a contract-violating provider). */
  breakIdempotency = false;
  private calls = 0;

  constructor(private readonly secret: string = TEST_WEBHOOK_SECRET) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    if (this.failCheckout) throw new ProviderUnavailableError();
    this.checkouts.push(request);
    this.calls += 1;
    const seed = this.breakIdempotency ? `${request.idempotencyKey}:${this.calls}` : request.idempotencyKey;
    const providerRef = `cs_test_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
    return { providerRef, checkoutUrl: `https://pay.test.invalid/session/${providerRef}` };
  }

  async cancelSubscription(providerRef: string): Promise<void> {
    if (this.failCancel) throw new ProviderUnavailableError();
    this.cancelled.push(providerRef);
  }

  parseWebhook(input: { rawBody: string; headers: Readonly<Record<string, string | undefined>>; now: Date }): ParsedWebhook {
    verifyHmacSha256Signature({ secret: this.secret, timestamp: input.headers["x-test-timestamp"] ?? "", rawBody: input.rawBody, signatureHex: input.headers["x-test-signature"] ?? "", now: input.now });
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      throw new WebhookRejectedError("malformed");
    }
    if (!body || typeof body !== "object") throw new WebhookRejectedError("malformed");
    if ((body as { ignore?: unknown }).ignore === true) return { kind: "ignored" };
    return { kind: "event", event: normalizeBillingEvent(body, input.now) };
  }
}

/** Signs a body the way `HmacTestProvider` expects. `at` is the signature timestamp (epoch seconds). */
export function signWebhook(body: unknown, options: { secret?: string; at: number; rawBody?: string }): SignedWebhook {
  const rawBody = options.rawBody ?? JSON.stringify(body);
  const timestamp = String(Math.floor(options.at));
  const signature = createHmac("sha256", options.secret ?? TEST_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
  return { rawBody, headers: { "x-test-timestamp": timestamp, "x-test-signature": signature, "content-type": "application/json" } };
}

export function eventBody(over: Partial<BillingEvent> & Pick<BillingEvent, "eventId" | "type" | "providerRef" | "occurredAt">): Record<string, unknown> {
  return { subscriptionId: null, amountMinor: null, currency: null, ...over };
}
