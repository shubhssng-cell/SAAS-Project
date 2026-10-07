import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { apiGetBilling, apiRequestCancellation, apiStartCheckout, isSafeCheckoutUrl, readBillingSummary } from "../../src/billing/api.js";
import { BillingView, type BillingViewState } from "../../src/billing/BillingView.js";
import { describeSubscription, describeUsage, formatPrice } from "../../src/billing/copy.js";
import type { FetchLike } from "../../src/http.js";
import { pageTitleForPath } from "../../src/router/pageTitle.js";
import { ROUTE_TABLE } from "../../src/router/routeTable.js";
import { matchPath } from "../../src/router/match.js";
import { errorState } from "../../src/tutor/TutorPanel.js";
import { mapAuthApiErrorCode } from "../../src/auth/failureMapping.js";

/** Phase 9 Unit 4 (D-100), web side. Plans, amounts and names below are LABELLED TEST FIXTURES, not real pricing. */
type Recorded = { url: string; init?: RequestInit };
const fakeFetch = (status: number, body: unknown, seen: Recorded[] = []): FetchLike => async (url, init) => {
  seen.push({ url, init });
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

const SUMMARY = {
  enforcement: "enforced",
  access: { exam: true, features: [{ id: "tutor", allowed: true }, { id: "simulation", allowed: false }, { id: "advanced_training", allowed: false }] },
  subscription: null,
  usage: [{ meter: "tutor_request", used: 1, limit: 2, period: "day", resetsAt: "2026-10-16T00:00:00.000Z" }],
  plans: [{ id: "test_plus", name: "Test Plus (fixture)", description: "Fixture.", provisional: true, durationDays: 30, features: ["tutor", "simulation"], price: { amountMinor: 123456, currency: "INR" }, providerPriceRef: "price_SENTINEL", secret: "SECRET-SENTINEL" }],
  checkoutAvailable: true,
  // fields a buggy or hostile server might add - none may survive
  providerRef: "cs_SENTINEL",
  studentId: "STUDENT-SENTINEL"
};
const sub = (over: Record<string, unknown> = {}) => ({ planId: "test_plus", planName: "Test Plus (fixture)", status: "active", validUntil: "2026-11-10T00:00:00.000Z", renews: true, grantsAccess: true, canCancel: true, ...over });

describe("billing API client", () => {
  it("sends ONLY the plan id for a checkout: no amount, currency, duration, identity or status", async () => {
    const seen: Recorded[] = [];
    const r = await apiStartCheckout("test_plus", fakeFetch(200, { checkoutUrl: "https://pay.test.invalid/s/1" }, seen));
    expect(r).toEqual({ ok: true, checkoutUrl: "https://pay.test.invalid/s/1" });
    expect(seen[0]!.url).toMatch(/\/v1\/billing\/checkout$/);
    expect(seen[0]!.init?.method).toBe("POST");
    expect(seen[0]!.init?.credentials).toBe("include");
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ planId: "test_plus" });
  });

  it("cancellation sends an empty object; reading billing sends nothing", async () => {
    const seen: Recorded[] = [];
    expect(await apiRequestCancellation(fakeFetch(200, { requested: true }, seen))).toEqual({ ok: true });
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({});
    await apiGetBilling(fakeFetch(200, SUMMARY, seen));
    expect(seen[1]!.init?.method).toBe("GET");
    expect(seen[1]!.init?.body).toBeUndefined();
  });

  it("follows a checkout URL only if it is https without credentials", async () => {
    for (const url of ["http://pay.test.invalid/x", "javascript:alert(1)", "data:text/html,x", "https://u:p@pay.test.invalid/x", "/relative", "", 5, null, { href: "https://x" }]) {
      expect(isSafeCheckoutUrl(url), String(url)).toBe(false);
      expect(await apiStartCheckout("test_plus", fakeFetch(200, { checkoutUrl: url }))).toMatchObject({ ok: false });
    }
    expect(isSafeCheckoutUrl("https://pay.test.invalid/ok")).toBe(true);
    expect(await apiStartCheckout("test_plus", fakeFetch(200, null))).toMatchObject({ ok: false });
  });

  it("keeps only the closed, student-safe fields of the summary: nothing extra reaches the UI", async () => {
    const r = await apiGetBilling(fakeFetch(200, SUMMARY));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/SENTINEL|providerRef|providerPriceRef|studentId|secret/);
    if (r.ok) expect(Object.keys(r.summary.plans[0]!).sort()).toEqual(["description", "durationDays", "features", "id", "name", "price", "provisional"]);
  });

  it("treats a malformed 200 as an unexpected failure, never a half-trusted summary", () => {
    const bad = [null, {}, "x", { ...SUMMARY, enforcement: "free" }, { ...SUMMARY, checkoutAvailable: "yes" }, { ...SUMMARY, subscription: { status: "paid", planName: "x" } }, { ...SUMMARY, subscription: sub({ status: "wizard" }) }, { ...SUMMARY, usage: [{ meter: "coffee", used: 1, limit: 1, period: "day", resetsAt: "x" }] }, { ...SUMMARY, usage: [{ meter: "tutor_request", used: -1, limit: 1, period: "day", resetsAt: "x" }] }, { ...SUMMARY, plans: [{ id: "p" }] }, { ...SUMMARY, access: { exam: true, features: [{ id: "root", allowed: true }] } }];
    for (const b of bad) expect(readBillingSummary(b)).toBeNull();
  });

  it("maps refusals to fixed failure kinds without echoing the server's wording", async () => {
    const hostile = { error: { code: "x", message: "SQL SELECT * /srv/app SENTINEL" } };
    const entitled = await apiStartCheckout("p", fakeFetch(403, { error: { code: "not_entitled", message: "SERVER-WORDING-SENTINEL" } }));
    expect(entitled).toMatchObject({ ok: false, failure: { kind: "not_entitled" } });
    expect(JSON.stringify(entitled)).not.toContain("SENTINEL");
    expect(mapAuthApiErrorCode("usage_limit_reached", "SENTINEL").kind).toBe("usage_limit_reached");
    expect(mapAuthApiErrorCode("conflict", "SENTINEL")).toMatchObject({ kind: "conflict" });
    for (const status of [400, 500, 503]) expect(JSON.stringify(await apiGetBilling(fakeFetch(status, hostile)))).not.toMatch(/SQL|srv|SENTINEL/);
    expect(await apiGetBilling(fakeFetch(401, { error: { code: "not_authenticated", message: "x" } }))).toEqual({ ok: false, failure: { kind: "not_authenticated" } });
  });
});

describe("billing copy: never claims a result the server has not reported", () => {
  const copy = (over: Record<string, unknown>) => describeSubscription({ planName: "Test Plus (fixture)", status: "active", validUntil: "2026-11-10T00:00:00.000Z", renews: true, grantsAccess: true, canCancel: true, ...over } as never);

  it("pending is waiting, not success; only a server-reported active grants anything", () => {
    const c = copy({ status: "pending", validUntil: null, grantsAccess: false, renews: false, canCancel: false });
    expect(c.tone).toBe("wait");
    expect(`${c.headline} ${c.detail}`).not.toMatch(/success|paid|active|thank|complete/i);
    expect(`${c.headline} ${c.detail}`).toMatch(/confirm/i);
  });
  it("every status has distinct, non-judgemental copy and shows the end date only when access continues", () => {
    const seen = new Set<string>();
    for (const status of ["pending", "active", "past_due", "cancelled", "expired", "refunded", "failed"]) {
      const c = copy({ status, grantsAccess: status === "active" || status === "past_due" || status === "cancelled" });
      seen.add(c.headline);
      expect(`${c.headline} ${c.detail}`).not.toMatch(/confidence|ability|lazy|weak|score/i);
    }
    expect(seen.size).toBe(7);
    expect(copy({ status: "cancelled", grantsAccess: true }).detail).toContain("November");
    expect(copy({ status: "cancelled", grantsAccess: false }).detail).not.toContain("November");
    expect(copy({ status: "expired", grantsAccess: false }).detail).toMatch(/ended|over/i);
  });
  it("usage lines come straight from the server's numbers; unlimited is stated", () => {
    expect(describeUsage({ meter: "tutor_request", used: 1, limit: 2, period: "day", resetsAt: "" })).toBe("Tutor requests: 1 of 2 used today");
    expect(describeUsage({ meter: "simulation_start", used: 3, limit: "unlimited", period: "month", resetsAt: "" })).toBe("Simulations started: 3 used this month (no limit)");
  });
  it("prices are formatted from the server's minor units and currency; the code holds no price", () => {
    expect(formatPrice({ amountMinor: 123456, currency: "INR" })).toMatch(/1,234\.56/);
    expect(formatPrice({ amountMinor: 500, currency: "JPY" })).toMatch(/500/);
    expect(formatPrice({ amountMinor: 5, currency: "ZZZ" })).toBeTruthy();
  });
});

describe("BillingView states", () => {
  const view = (state: BillingViewState, over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(BillingView, { state, returning: false, startingPlanId: null, cancelling: false, notice: null, onStartCheckout: () => undefined, onCancel: () => undefined, onRefresh: () => undefined, onBack: () => undefined, ...over } as never));
  const ready = (over: Record<string, unknown> = {}): BillingViewState => ({ status: "ready", summary: readBillingSummary({ ...SUMMARY, ...over })! });

  it("no plan: shows what the student can use, usage, and the plans the server offers, marked as not final", () => {
    const html = view(ready());
    expect(html).toContain("You don&#x27;t have a paid plan.");
    expect(html).toContain("AI tutor");
    expect(html).toMatch(/Full exam simulations<\/span><span class="fact-value">Not included/);
    expect(html).toContain("Tutor requests: 1 of 2 used today");
    expect(html).toContain("Test Plus (fixture)");
    expect(html).toContain("These terms are not final.");
    expect(html).toContain("We never see or store your card details");
    expect(html).not.toMatch(/SENTINEL|price_|providerRef/);
  });

  it("pending after returning from the payment page: says it is confirming, not that it worked", () => {
    const html = view(ready({ subscription: sub({ status: "pending", validUntil: null, grantsAccess: false, renews: false, canCancel: false }) }), { returning: true });
    expect(html).toContain("Waiting for payment confirmation");
    expect(html).toContain("confirming your payment");
    expect(html).not.toMatch(/successful|payment received|you(&#x27;|')re all set/i);
  });

  it("returning from the payment page with NO subscription still grants nothing and shows the plan list", () => {
    const html = view(ready(), { returning: true });
    expect(html).toContain("confirming your payment");
    expect(html).toContain("You don&#x27;t have a paid plan.");
    expect(html).toMatch(/Full exam simulations<\/span><span class="fact-value">Not included/);
  });

  it("active: shows validity and a cancel action only when the server says it can be cancelled", () => {
    expect(view(ready({ subscription: sub() }))).toContain("Stop renewing");
    expect(view(ready({ subscription: sub({ canCancel: false }) }))).not.toContain("Stop renewing");
  });

  it("failed, expired and refunded offer the plans again", () => {
    for (const status of ["failed", "expired", "refunded"]) {
      const html = view(ready({ subscription: sub({ status, grantsAccess: false, renews: false, canCancel: false }) }));
      expect(html).toContain("Choose this plan");
    }
  });

  it("disables the buttons while an action is in flight and when payments are unavailable", () => {
    const busy = view(ready(), { startingPlanId: "test_plus" });
    expect(busy).toContain("Opening payment page");
    expect(busy).toMatch(/<button[^>]*disabled[^>]*>Opening payment page/);
    const none = view(ready({ checkoutAvailable: false }));
    expect(none).toContain("Payments aren&#x27;t available right now.");
    expect(none).toMatch(/<button[^>]*disabled[^>]*>Choose this plan/);
  });

  it("open access mode shows no plan list and no payment prompt", () => {
    const html = view(ready({ enforcement: "open", plans: [] }));
    expect(html).toContain("Nothing is limited");
    expect(html).not.toContain("Choose this plan");
  });

  it("a student without an enrollment sees an honest note instead of an access table", () => {
    expect(view(ready({ access: null }))).toContain("Finish enrollment");
  });

  it("an error state is an alert with student-safe copy and a retry", () => {
    const html = view({ status: "error", message: "We couldn't reach the server. Check your connection and try again." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
  });

  it("shows a notice the route sets (for example after a cancellation request)", () => {
    expect(view(ready({ subscription: sub() }), { notice: "We've asked the payment provider to stop renewing." })).toContain("asked the payment provider");
  });
});

describe("tutor refusals and routing", () => {
  it("a plan or usage refusal is fixed copy plus a link to the billing page; other failures never offer it", () => {
    expect(errorState({ kind: "not_entitled", message: "SENTINEL" })).toEqual({ status: "error", message: "The tutor isn't part of your current access.", billing: true });
    expect(errorState({ kind: "usage_limit_reached", message: "SENTINEL" })).toMatchObject({ billing: true });
    expect(JSON.stringify(errorState({ kind: "not_entitled", message: "SENTINEL" }))).not.toContain("SENTINEL");
    expect(errorState({ kind: "network_error" }).billing).toBeUndefined();
    expect(errorState({ kind: "unexpected", message: "x" }).billing).toBeUndefined();
  });

  it("/billing is a route with a title, and does not collide with another route", () => {
    expect(ROUTE_TABLE.find((r) => r.id === "billing")?.pattern).toBe("/billing");
    expect(ROUTE_TABLE.filter((r) => matchPath(r.pattern, "/billing"))).toHaveLength(1);
    expect(pageTitleForPath("/billing")).toContain("Your plan");
  });
});
