import type { AuthFailure } from "../auth/failureMapping.js";
import { jsonRequest, type FetchLike } from "../http.js";

/**
 * The ONLY place `apps/web` talks to the billing endpoints (Phase 9 Unit 4, D-100). The browser is never a source of billing truth:
 *  - it sends ONE thing, a plan id to be checked against the server's allowlist -- never an amount, currency, duration, student,
 *    enrollment, exam, entitlement or status (the server would refuse any of them);
 *  - everything it shows (access, plan, status, usage, prices) is read field by field from the server's response into the closed
 *    shapes below, so anything extra a server might add is dropped here, not rendered;
 *  - a checkout URL is followed only if it is an https URL without credentials.
 * Coming back from the payment page proves nothing: access changes only when the server says so on the next read.
 */
export const FEATURE_IDS = ["tutor", "simulation", "advanced_training"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export const SUBSCRIPTION_STATUSES = ["pending", "active", "past_due", "cancelled", "expired", "refunded", "failed"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const METERS = ["tutor_request", "simulation_start"] as const;
export type Meter = (typeof METERS)[number];

export interface PlanView {
  id: string;
  name: string;
  description: string;
  provisional: boolean;
  durationDays: number;
  features: FeatureId[];
  price: { amountMinor: number; currency: string };
}

export interface SubscriptionView {
  planName: string;
  status: SubscriptionStatus;
  validUntil: string | null;
  renews: boolean;
  grantsAccess: boolean;
  canCancel: boolean;
}

export interface UsageView {
  meter: Meter;
  used: number;
  limit: number | "unlimited";
  period: "day" | "month";
  resetsAt: string;
}

export interface BillingSummary {
  enforcement: "open" | "enforced";
  access: { exam: boolean; features: Array<{ id: FeatureId; allowed: boolean }> } | null;
  subscription: SubscriptionView | null;
  usage: UsageView[];
  plans: PlanView[];
  checkoutAvailable: boolean;
}

export type BillingResult = { ok: true; summary: BillingSummary } | { ok: false; failure: AuthFailure };
export type CheckoutResult = { ok: true; checkoutUrl: string } | { ok: false; failure: AuthFailure };
export type CancelResult = { ok: true } | { ok: false; failure: AuthFailure };

const UNEXPECTED: AuthFailure = { kind: "unexpected", message: "Something went wrong. Please try again." };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const nonNegInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function readSubscription(v: unknown): SubscriptionView | null | undefined {
  if (v === null) return null;
  if (!isRecord(v)) return undefined;
  const status = oneOf(v.status, SUBSCRIPTION_STATUSES);
  const planName = str(v.planName);
  if (!status || planName === null) return undefined;
  const validUntil = v.validUntil === null ? null : str(v.validUntil);
  if (v.validUntil !== null && validUntil === null) return undefined;
  return { planName, status, validUntil, renews: v.renews === true, grantsAccess: v.grantsAccess === true, canCancel: v.canCancel === true };
}

/** Reads the server's summary into the closed shape; anything malformed is `null` (never half-trusted). */
export function readBillingSummary(body: unknown): BillingSummary | null {
  if (!isRecord(body)) return null;
  const enforcement = oneOf(body.enforcement, ["open", "enforced"] as const);
  if (!enforcement || typeof body.checkoutAvailable !== "boolean") return null;

  let access: BillingSummary["access"] = null;
  if (body.access !== null) {
    if (!isRecord(body.access) || typeof body.access.exam !== "boolean" || !Array.isArray(body.access.features)) return null;
    const features: Array<{ id: FeatureId; allowed: boolean }> = [];
    for (const f of body.access.features) {
      const id = isRecord(f) ? oneOf(f.id, FEATURE_IDS) : null;
      if (!id || !isRecord(f) || typeof f.allowed !== "boolean") return null;
      features.push({ id, allowed: f.allowed });
    }
    access = { exam: body.access.exam, features };
  }

  const subscription = readSubscription(body.subscription);
  if (subscription === undefined) return null;

  if (!Array.isArray(body.usage) || !Array.isArray(body.plans)) return null;
  const usage: UsageView[] = [];
  for (const u of body.usage) {
    if (!isRecord(u)) return null;
    const meter = oneOf(u.meter, METERS);
    const used = nonNegInt(u.used);
    const period = oneOf(u.period, ["day", "month"] as const);
    const resetsAt = str(u.resetsAt);
    const limit = u.limit === "unlimited" ? "unlimited" : nonNegInt(u.limit);
    if (!meter || used === null || !period || resetsAt === null || limit === null) return null;
    usage.push({ meter, used, limit, period, resetsAt });
  }
  const plans: PlanView[] = [];
  for (const p of body.plans) {
    if (!isRecord(p) || !isRecord(p.price)) return null;
    const id = str(p.id);
    const name = str(p.name);
    const description = str(p.description);
    const durationDays = nonNegInt(p.durationDays);
    const amountMinor = nonNegInt(p.price.amountMinor);
    const currency = str(p.price.currency);
    if (id === null || name === null || description === null || durationDays === null || amountMinor === null || currency === null || !/^[A-Z]{3}$/.test(currency) || typeof p.provisional !== "boolean" || !Array.isArray(p.features)) return null;
    plans.push({ id, name, description, provisional: p.provisional, durationDays, features: p.features.flatMap((f) => oneOf(f, FEATURE_IDS) ?? []), price: { amountMinor, currency } });
  }
  return { enforcement, access, subscription, usage, plans, checkoutAvailable: body.checkoutAvailable };
}

/** An https URL without embedded credentials: the only kind of address the browser will be sent to for payment. */
export function isSafeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export async function apiGetBilling(fetchImpl: FetchLike = fetch): Promise<BillingResult> {
  const result = await jsonRequest(fetchImpl, "GET", "/v1/billing");
  if (!result.ok) return result;
  const summary = readBillingSummary(result.body);
  return summary ? { ok: true, summary } : { ok: false, failure: UNEXPECTED };
}

/** Sends the plan id and nothing else. */
export async function apiStartCheckout(planId: string, fetchImpl: FetchLike = fetch): Promise<CheckoutResult> {
  const result = await jsonRequest(fetchImpl, "POST", "/v1/billing/checkout", { planId });
  if (!result.ok) return result;
  const url = isRecord(result.body) ? result.body.checkoutUrl : null;
  return isSafeCheckoutUrl(url) ? { ok: true, checkoutUrl: url } : { ok: false, failure: UNEXPECTED };
}

export async function apiRequestCancellation(fetchImpl: FetchLike = fetch): Promise<CancelResult> {
  const result = await jsonRequest(fetchImpl, "POST", "/v1/billing/cancel", {});
  if (!result.ok) return result;
  return isRecord(result.body) && result.body.requested === true ? { ok: true } : { ok: false, failure: UNEXPECTED };
}
