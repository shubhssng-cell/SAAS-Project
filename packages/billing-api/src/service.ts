import {
  effectiveStatus,
  findPurchasablePlan,
  findPlan,
  FEATURE_IDS,
  grantsAccess,
  type BillingStore,
  type EntitlementService,
  type FeatureId,
  type MeterId,
  type PaymentProvider,
  type PlanCatalog,
  type Subscription,
  type SubscriptionStatus,
  type UsagePeriod,
  type UsageService
} from "@ipmat/billing";
import { NOOP_LOGGER, NOOP_METRICS, type Logger, type Metrics } from "@ipmat/observability";
import { BillingApiError, infrastructureError, invalidRequest, isRecord, notAvailable, requireOnlyKeys } from "./errors.js";

/**
 * Student billing operations (Phase 9 Unit 4, D-100): read my billing state, start a checkout, ask to cancel. Identity is the
 * AUTHENTICATED student passed in by the transport; the exam is resolved server-side from that student's enrollment.
 *
 * What a client may name: a plan id, and only to be checked against the server's purchasable-plan allowlist. What a client can
 * never supply: an amount, a currency, a price reference, a duration, a student, an enrollment, an exam, an entitlement or a
 * subscription status. Every response is a closed student-safe DTO - never a provider object, reference, signature or secret.
 */
export interface BillingApiDependencies {
  store: BillingStore;
  entitlements: EntitlementService;
  usage: UsageService;
  catalog: PlanCatalog;
  /** `null` = no payment provider configured: checkout and cancellation answer `not_available`; the webhook accepts nothing. */
  provider: PaymentProvider | null;
  /** Server configuration: where the provider sends the browser afterwards. Never from a request. */
  returnUrl: string | null;
  now: () => Date;
  newId: () => string;
  metrics?: Metrics;
  logger?: Logger;
}

export interface PlanDto {
  id: string;
  name: string;
  description: string;
  /** True while this plan's terms are not final business policy. */
  provisional: boolean;
  durationDays: number;
  features: FeatureId[];
  price: { amountMinor: number; currency: string };
}

export interface SubscriptionDto {
  planId: string;
  planName: string;
  /** The status as it stands NOW (an elapsed paid period reads `expired`). */
  status: SubscriptionStatus;
  validUntil: string | null;
  /** True while the subscription is active and renewing. */
  renews: boolean;
  /** Whether access is currently granted by this subscription. */
  grantsAccess: boolean;
  canCancel: boolean;
}

export interface BillingSummaryDto {
  /** `open`: no commercial restriction applies in this deployment. `enforced`: access follows the plans below. */
  enforcement: "open" | "enforced";
  /** `null` when the student has no enrollment yet (entitlement and enrollment are separate facts). */
  access: { exam: boolean; features: Array<{ id: FeatureId; allowed: boolean }> } | null;
  subscription: SubscriptionDto | null;
  usage: Array<{ meter: MeterId; used: number; limit: number | "unlimited"; period: UsagePeriod; resetsAt: string }>;
  plans: PlanDto[];
  checkoutAvailable: boolean;
}

const CHECKOUT_URL_MAX = 2048;
const PROVIDER_REF = /^[A-Za-z0-9_.:-]{1,128}$/;

export class BillingApiService {
  private readonly metrics: Metrics;
  private readonly logger: Logger;

  constructor(private readonly deps: BillingApiDependencies) {
    this.metrics = deps.metrics ?? NOOP_METRICS;
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  async getSummary(studentId: string, examCode: string | null): Promise<BillingSummaryDto> {
    try {
      const now = this.deps.now();
      const subscriptions = await this.deps.store.listSubscriptionsForStudent(studentId);
      const chosen = chooseSubscription(subscriptions, now);
      let access: BillingSummaryDto["access"] = null;
      let usage: BillingSummaryDto["usage"] = [];
      if (examCode !== null) {
        const exam = (await this.deps.entitlements.canAccessExam(studentId, examCode)).allowed;
        const features: Array<{ id: FeatureId; allowed: boolean }> = [];
        for (const id of FEATURE_IDS) features.push({ id, allowed: (await this.deps.entitlements.decide(studentId, id, examCode)).allowed });
        access = { exam, features };
        usage = await this.deps.usage.status(studentId, examCode);
      }
      return {
        enforcement: this.deps.entitlements.mode,
        access,
        subscription: chosen ? this.subscriptionDto(chosen, now) : null,
        usage,
        plans: this.deps.catalog.plans.flatMap((p) => (p.active && p.price ? [{ id: p.id, name: p.name, description: p.description, provisional: p.provisional, durationDays: p.durationDays, features: [...p.features], price: { amountMinor: p.price.amountMinor, currency: p.price.currency } }] : [])),
        checkoutAvailable: this.deps.provider !== null
      };
    } catch (error) {
      throw infrastructureError(error, "Your billing details couldn't be loaded.");
    }
  }

  /** Starts (or resumes) a checkout for a plan the SERVER allows. Returns only the provider-hosted URL. */
  async startCheckout(studentId: string, body: unknown): Promise<{ checkoutUrl: string }> {
    if (!isRecord(body)) throw invalidRequest("The request body must be a JSON object.");
    requireOnlyKeys(body, ["planId"]);
    const plan = findPurchasablePlan(this.deps.catalog, body.planId);
    if (!plan) {
      this.metrics.inc("billing_checkout_total", { outcome: "plan_refused" });
      throw invalidRequest("That plan isn't available.");
    }
    const provider = this.deps.provider;
    if (!provider) throw notAvailable("Payments aren't available right now.");

    try {
      const now = this.deps.now();
      const existing = await this.deps.store.listSubscriptionsForStudent(studentId);
      if (existing.some((s) => s.planId === plan.id && grantsAccess(s, now))) {
        this.metrics.inc("billing_checkout_total", { outcome: "already_subscribed" });
        throw new BillingApiError("conflict", "You already have this plan.", 409);
      }
      const { subscription } = await this.deps.store.openPendingSubscription({ id: this.deps.newId(), studentId, planId: plan.id, provider: provider.name, amountMinor: plan.price.amountMinor, currency: plan.price.currency, now: now.toISOString() });

      let session;
      try {
        session = await provider.createCheckout({ idempotencyKey: subscription.id, subscriptionId: subscription.id, planId: plan.id, planName: plan.name, amountMinor: subscription.amountMinor, currency: subscription.currency, providerPriceRef: plan.price.providerPriceRef, returnUrl: this.deps.returnUrl });
      } catch (error) {
        this.metrics.inc("billing_checkout_total", { outcome: "provider_failure" });
        this.logger.error("billing.checkout_failed", { provider: provider.name, errorName: error instanceof Error ? error.name : "unknown", failureCategory: "provider_unavailable" });
        throw notAvailable("Payments are temporarily unavailable. Please try again shortly.");
      }
      if (!PROVIDER_REF.test(session.providerRef) || !isHttpsUrl(session.checkoutUrl)) {
        this.metrics.inc("billing_checkout_total", { outcome: "provider_invalid_response" });
        this.logger.error("billing.checkout_invalid_session", { provider: provider.name, failureCategory: "provider_invalid_response" });
        throw notAvailable("Payments are temporarily unavailable. Please try again shortly.");
      }
      const attached = await this.deps.store.attachProviderRef(subscription.id, session.providerRef, now.toISOString());
      if (attached === "conflict") {
        // A provider that returns a different session for the same idempotency key breaks the contract; refuse rather than orphan a payment.
        this.metrics.inc("billing_checkout_total", { outcome: "reference_conflict" });
        this.logger.error("billing.checkout_reference_conflict", { provider: provider.name, failureCategory: "provider_invalid_response" });
        throw notAvailable("Payments are temporarily unavailable. Please try again shortly.");
      }
      this.metrics.inc("billing_checkout_total", { outcome: "created" });
      this.logger.info("billing.checkout_created", { provider: provider.name, planId: plan.id, outcome: "created" });
      return { checkoutUrl: session.checkoutUrl };
    } catch (error) {
      throw infrastructureError(error, "Checkout couldn't be started. Please try again.");
    }
  }

  /**
   * Asks the provider to stop renewing the student's own subscription. Local state is NOT changed here: the provider confirms
   * with an event, which is the only thing that moves a subscription's status.
   */
  async requestCancellation(studentId: string, body: unknown): Promise<{ requested: true }> {
    if (!isRecord(body)) throw invalidRequest("The request body must be a JSON object.");
    requireOnlyKeys(body, []);
    const provider = this.deps.provider;
    if (!provider) throw notAvailable("Payments aren't available right now.");
    try {
      const now = this.deps.now();
      const mine = (await this.deps.store.listSubscriptionsForStudent(studentId)).filter((s) => s.studentId === studentId && s.providerRef !== null && (s.status === "active" || s.status === "past_due") && grantsAccess(s, now));
      const target = mine.sort((a, b) => Date.parse(b.paidThrough ?? "") - Date.parse(a.paidThrough ?? ""))[0];
      if (!target?.providerRef) throw new BillingApiError("not_found", "There is no active subscription to cancel.", 404);
      try {
        await provider.cancelSubscription(target.providerRef);
      } catch (error) {
        this.metrics.inc("billing_cancel_total", { outcome: "provider_failure" });
        this.logger.error("billing.cancel_failed", { provider: provider.name, errorName: error instanceof Error ? error.name : "unknown", failureCategory: "provider_unavailable" });
        throw notAvailable("Cancellation is temporarily unavailable. Please try again shortly.");
      }
      this.metrics.inc("billing_cancel_total", { outcome: "requested" });
      this.logger.info("billing.cancel_requested", { provider: provider.name, outcome: "requested" });
      return { requested: true };
    } catch (error) {
      throw infrastructureError(error, "Your cancellation couldn't be requested. Please try again.");
    }
  }

  private subscriptionDto(s: Subscription, now: Date): SubscriptionDto {
    const plan = findPlan(this.deps.catalog, s.planId);
    const status = effectiveStatus(s, now);
    return {
      planId: s.planId,
      planName: plan?.name ?? "Your plan",
      status,
      validUntil: s.paidThrough,
      renews: status === "active",
      grantsAccess: grantsAccess(s, now),
      canCancel: this.deps.provider !== null && s.providerRef !== null && (status === "active" || status === "past_due")
    };
  }
}

/** The subscription a person should see: one that grants access now (latest end), else the newest pending, else the newest. Deterministic. */
export function chooseSubscription(subscriptions: readonly Subscription[], now: Date): Subscription | null {
  const byEnd = (a: Subscription, b: Subscription): number => Date.parse(b.paidThrough ?? "") - Date.parse(a.paidThrough ?? "");
  const byNewest = (a: Subscription, b: Subscription): number => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1);
  const granting = subscriptions.filter((s) => grantsAccess(s, now)).sort(byEnd);
  if (granting[0]) return granting[0];
  const pending = subscriptions.filter((s) => s.status === "pending").sort(byNewest);
  if (pending[0]) return pending[0];
  return [...subscriptions].sort(byNewest)[0] ?? null;
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > CHECKOUT_URL_MAX) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
