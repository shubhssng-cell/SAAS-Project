import type { FeatureId, Meter, PlanView, SubscriptionView, UsageView } from "./api.js";

/**
 * Student-facing wording for billing states (Phase 9 Unit 4, D-100). Pure functions of what the SERVER reported. Rules:
 * nothing here says a payment "succeeded" or access is "active" except when the server's own `grantsAccess` is true; "pending" is
 * described as waiting for the payment provider's confirmation, never as a result; nothing is a score or a judgement of the student.
 */
export const FEATURE_LABELS: Readonly<Record<FeatureId, string>> = Object.freeze({ tutor: "AI tutor", simulation: "Full exam simulations", advanced_training: "Advanced training sessions" });
export const METER_LABELS: Readonly<Record<Meter, string>> = Object.freeze({ tutor_request: "Tutor requests", simulation_start: "Simulations started" });

export interface StatusCopy {
  headline: string;
  detail: string;
  tone: "good" | "wait" | "problem" | "neutral";
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function describeSubscription(s: SubscriptionView): StatusCopy {
  const until = s.validUntil ? formatDate(s.validUntil) : "";
  switch (s.status) {
    case "pending":
      return { headline: "Waiting for payment confirmation", detail: "We haven't heard back from the payment provider yet. Your access changes only when the provider confirms the payment; this page checks again automatically.", tone: "wait" };
    case "active":
      return { headline: `${s.planName} is active`, detail: until ? `Your access runs until ${until}.` : "Your access is active.", tone: "good" };
    case "past_due":
      return { headline: `${s.planName}: a payment didn't go through`, detail: s.grantsAccess && until ? `You keep your access until ${until}. After that it ends unless a payment is received.` : "Your access has ended unless a payment is received.", tone: "problem" };
    case "cancelled":
      return { headline: `${s.planName} won't renew`, detail: s.grantsAccess && until ? `You keep your access until ${until}.` : "Your access has ended.", tone: s.grantsAccess ? "neutral" : "problem" };
    case "expired":
      return { headline: `${s.planName} has ended`, detail: "Your paid period is over. Choose a plan to get access again.", tone: "problem" };
    case "refunded":
      return { headline: `${s.planName} was refunded`, detail: "Access from this purchase has ended.", tone: "problem" };
    case "failed":
      return { headline: "That payment didn't complete", detail: "Nothing was charged for access. You can try again.", tone: "problem" };
  }
}

export function describeUsage(u: UsageView): string {
  const label = METER_LABELS[u.meter];
  const per = u.period === "day" ? "today" : "this month";
  return u.limit === "unlimited" ? `${label}: ${u.used} used ${per} (no limit)` : `${label}: ${u.used} of ${u.limit} used ${per}`;
}

/** Formats a server-provided amount (minor units) for display. The exponent comes from the currency itself; no price exists in this code. */
export function formatPrice(price: PlanView["price"]): string {
  try {
    const formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: price.currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(price.amountMinor / 10 ** digits);
  } catch {
    return `${price.amountMinor} ${price.currency}`;
  }
}

export function describePlanTerms(p: PlanView): string {
  return `${formatPrice(p.price)} for ${p.durationDays} days`;
}
