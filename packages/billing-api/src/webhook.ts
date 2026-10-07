import { createHash } from "node:crypto";
import { applyBillingEvent, findPlan, WebhookRejectedError, type BillingStore, type PaymentProvider, type PlanCatalog, type RecordedEventOutcome } from "@ipmat/billing";
import { NOOP_LOGGER, NOOP_METRICS, type Logger, type Metrics } from "@ipmat/observability";
import { BillingApiError, infrastructureError } from "./errors.js";

/**
 * The provider webhook (Phase 9 Unit 4, D-100): the ONLY inbound channel that can change a subscription. It trusts nothing
 * before the provider adapter has verified the signature over the RAW body; it then normalizes the event and hands it to the
 * store's atomic, idempotent `processEvent`, with the pure `applyBillingEvent` deciding the transition.
 *
 * It never reads a session or a cookie (the caller is the provider, not a student), never accepts a student id or an amount from
 * anywhere but the verified event, and answers with a generic body: a caller learns nothing about which subscriptions exist or
 * what was decided. A processed, duplicate or ignored event is `200` (so the provider stops retrying); an unauthentic or
 * malformed one is `400`; a database failure propagates as a retryable `503` so the provider redelivers.
 */
export interface WebhookDependencies {
  store: BillingStore;
  provider: PaymentProvider | null;
  catalog: PlanCatalog;
  now: () => Date;
  metrics?: Metrics;
  logger?: Logger;
}

export interface WebhookInput {
  rawBody: string;
  headers: Readonly<Record<string, string | undefined>>;
}

/** Outcomes that mean money or state needs a human look (logged at error level; never returned to the caller). */
const NEEDS_ATTENTION: readonly RecordedEventOutcome[] = ["rejected_amount_mismatch", "rejected_unknown_plan", "rejected_reference_mismatch", "rejected_event_conflict"];

export class BillingWebhookService {
  private readonly metrics: Metrics;
  private readonly logger: Logger;

  constructor(private readonly deps: WebhookDependencies) {
    this.metrics = deps.metrics ?? NOOP_METRICS;
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  async handle(input: WebhookInput): Promise<{ received: true }> {
    const provider = this.deps.provider;
    if (!provider) throw new BillingApiError("not_available", "This endpoint isn't available.", 503);
    const now = this.deps.now();

    let parsed;
    try {
      parsed = provider.parseWebhook({ rawBody: input.rawBody, headers: input.headers, now });
    } catch (error) {
      const reason = error instanceof WebhookRejectedError ? error.reason : "malformed";
      this.metrics.inc("billing_webhook_total", { outcome: `rejected_${reason}`, provider: provider.name });
      this.logger.warn("billing.webhook_rejected", { provider: provider.name, outcome: `rejected_${reason}`, failureCategory: "webhook_rejected" });
      // Fixed wording for every rejection reason: a caller must not be able to tell a bad signature from a stale timestamp.
      throw new BillingApiError("invalid_webhook", "The request was not accepted.", 400);
    }
    if (parsed.kind === "ignored") {
      this.metrics.inc("billing_webhook_total", { outcome: "ignored", provider: provider.name });
      return { received: true };
    }

    const event = parsed.event;
    const digest = createHash("sha256").update(input.rawBody).digest("hex");
    try {
      const processed = await this.deps.store.processEvent({
        provider: provider.name,
        event,
        digest,
        receivedAt: now.toISOString(),
        decide: (subscription) => (subscription ? applyBillingEvent(subscription, event, findPlan(this.deps.catalog, subscription.planId), now.toISOString()) : { outcome: "ignored_unknown_reference" })
      });
      // A repeat of the same payload is a plain duplicate; a DIFFERENT payload under a used event id keeps its own label (it needs a human).
      const label = processed.duplicate && processed.outcome !== "rejected_event_conflict" ? "duplicate" : processed.outcome;
      this.metrics.inc("billing_webhook_total", { outcome: label, provider: provider.name });
      const fields = { provider: provider.name, eventType: event.type, outcome: label, subscriptionStatus: processed.status };
      if (NEEDS_ATTENTION.includes(processed.outcome)) this.logger.error("billing.webhook_needs_attention", { ...fields, failureCategory: "reconcile" });
      else if (processed.outcome === "ignored_unknown_reference") this.logger.warn("billing.webhook_unknown_reference", fields);
      else this.logger.info("billing.webhook_processed", fields);
      if (processed.outcome === "applied" && !processed.duplicate) this.logger.info("billing.subscription_transition", { provider: provider.name, eventType: event.type, subscriptionStatus: processed.status });
      return { received: true };
    } catch (error) {
      this.metrics.inc("billing_webhook_total", { outcome: "store_failure", provider: provider.name });
      throw infrastructureError(error, "The event couldn't be processed.");
    }
  }
}
