import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readBillingSummary } from "../../src/billing/api.js";
import { BillingView } from "../../src/billing/BillingView.js";
import { SimulationCardView } from "../../src/components/SimulationCard.js";
import type { FetchLike } from "../../src/http.js";
import { apiGetSimulationAvailability } from "../../src/simulation/api.js";

/** Phase 9 Unit 5 (D-101), web side: the simulation status card, the no-plans state and the onboarding promises. Fixtures are synthetic. */
const fakeFetch = (status: number, body: unknown): FetchLike => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const SUMMARY = { enforcement: "enforced", access: { exam: true, features: [{ id: "tutor", allowed: true }, { id: "simulation", allowed: false }, { id: "advanced_training", allowed: false }] }, subscription: null, usage: [], plans: [], checkoutAvailable: false };
const view = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BillingView, { state: { status: "ready", summary: readBillingSummary({ ...SUMMARY, ...over })! }, returning: false, startingPlanId: null, cancelling: false, notice: null, onStartCheckout: () => undefined, onCancel: () => undefined, onRefresh: () => undefined, onBack: () => undefined } as never));

describe("simulation availability (the server decides)", () => {
  it("reads one boolean and nothing else; a malformed or failed response is a failure, never 'available'", async () => {
    expect(await apiGetSimulationAvailability(fakeFetch(200, { available: false, extra: "SENTINEL" }))).toEqual({ ok: true, available: false });
    expect(await apiGetSimulationAvailability(fakeFetch(200, { available: true }))).toEqual({ ok: true, available: true });
    for (const body of [null, {}, { available: "yes" }, { available: 1 }, "x"]) expect(await apiGetSimulationAvailability(fakeFetch(200, body))).toMatchObject({ ok: false });
    expect(await apiGetSimulationAvailability(fakeFetch(401, { error: { code: "not_authenticated", message: "x" } }))).toEqual({ ok: false, failure: { kind: "not_authenticated" } });
  });

  it("not configured: an honest explanation, no start button, nothing about an exam format invented", () => {
    const html = renderToStaticMarkup(createElement(SimulationCardView, { state: { status: "unavailable" } }));
    expect(html).toContain("Not available yet.");
    expect(html).toContain("Nothing is wrong with your account");
    expect(html).not.toMatch(/<button|Start simulation|\b\d+ (minutes|questions|sections)\b/i);
  });

  it("configured: still honest that the in-app screens are not part of this release; loading and error are calm", () => {
    expect(renderToStaticMarkup(createElement(SimulationCardView, { state: { status: "configured" } }))).toContain("not part of this release");
    expect(renderToStaticMarkup(createElement(SimulationCardView, { state: { status: "loading" } }))).toContain("Checking");
    expect(renderToStaticMarkup(createElement(SimulationCardView, { state: { status: "error" } }))).toContain("couldn&#x27;t check");
  });
});

describe("billing when the catalog has no plans", () => {
  it("says plans have not been set up instead of showing an empty list or a fake price", () => {
    const html = view();
    expect(html).toContain("Paid plans haven&#x27;t been set up yet");
    expect(html).not.toMatch(/Choose this plan|₹|\$\d/);
  });

  it("open mode with no plans shows no plan section at all", () => {
    const html = view({ enforcement: "open" });
    expect(html).not.toContain("Paid plans haven");
    expect(html).not.toContain("Choose this plan");
  });
});

describe("simulation card state mapping", () => {
  it("maps the server's answer; a failure is an error state, never 'configured'", async () => {
    const { simulationCardState } = await import("../../src/components/SimulationCard.js");
    expect(simulationCardState({ ok: true, available: true })).toEqual({ status: "configured" });
    expect(simulationCardState({ ok: true, available: false })).toEqual({ status: "unavailable" });
    expect(simulationCardState({ ok: false })).toEqual({ status: "error" });
  });
});
