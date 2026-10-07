import type { AiProvider } from "@ipmat/ai";
import { InMemoryBillingStore } from "@ipmat/db";
import { createLogger, createMetrics, runWithContext, studentRef } from "@ipmat/observability";
import { describe, expect, it } from "vitest";
import { HmacTestProvider } from "@ipmat/billing-api/testing";
import { resolveCommerceConfig } from "../src/commerceWiring.js";
import { observeProvider } from "../src/providerObservability.js";

/** Phase 9 Unit 4 (D-100): the commercial configuration is explicit and fail-closed, and AI usage records hold facts only. */
const CATALOG = JSON.stringify({ baseline: { exams: ["EXAM_A"], features: [], usageLimits: [] }, plans: [] });

describe("resolveCommerceConfig", () => {
  it("defaults to open access with no catalog and no provider outside production", () => {
    const c = resolveCommerceConfig({});
    expect(c).toMatchObject({ mode: "open", provider: null, returnUrl: null });
    expect(c.catalog.plans).toEqual([]);
  });

  it("production must choose explicitly: no silent default", () => {
    expect(() => resolveCommerceConfig({ NODE_ENV: "production" })).toThrow(/IPMAT_ENTITLEMENTS/);
    expect(resolveCommerceConfig({ NODE_ENV: "production", IPMAT_ENTITLEMENTS: "open" }).mode).toBe("open");
  });

  it("enforced mode requires a catalog: what is free is a business decision this repository does not make", () => {
    expect(() => resolveCommerceConfig({ IPMAT_ENTITLEMENTS: "enforced" })).toThrow(/IPMAT_BILLING_CATALOG/);
    expect(resolveCommerceConfig({ IPMAT_ENTITLEMENTS: "enforced", IPMAT_BILLING_CATALOG: CATALOG }).mode).toBe("enforced");
  });

  it("refuses unknown modes and malformed catalogs at startup, naming the problem without echoing the whole value", () => {
    expect(() => resolveCommerceConfig({ IPMAT_ENTITLEMENTS: "free-for-all" })).toThrow(/Unknown IPMAT_ENTITLEMENTS/);
    expect(() => resolveCommerceConfig({ IPMAT_ENTITLEMENTS: "ENFORCED", IPMAT_BILLING_CATALOG: "{nope" })).toThrow(/not valid JSON/);
    expect(() => resolveCommerceConfig({ IPMAT_BILLING_CATALOG: JSON.stringify({ plans: [{ id: "x" }] }) })).toThrow();
    expect(() => resolveCommerceConfig({ IPMAT_BILLING_CATALOG: JSON.stringify({ plans: [], surprise: true }) })).toThrow(/unexpected field/);
  });

  it("no payment provider adapter ships: any named provider is refused rather than silently ignored", () => {
    expect(() => resolveCommerceConfig({ IPMAT_PAYMENT_PROVIDER: "stripe" })).toThrow(/no adapter/);
    expect(() => resolveCommerceConfig({ IPMAT_PAYMENT_PROVIDER: "__proto__" })).toThrow(/no adapter/);
    expect(() => resolveCommerceConfig({ IPMAT_PAYMENT_PROVIDER: "constructor" })).toThrow(/no adapter/);
    expect(resolveCommerceConfig({ IPMAT_PAYMENT_PROVIDER: "none" }).provider).toBeNull();
  });

  it("builds a registered adapter from the environment (the extension point), passing only the environment", () => {
    const seen: Array<Record<string, string | undefined>> = [];
    const c = resolveCommerceConfig({ IPMAT_PAYMENT_PROVIDER: "test-provider", SOME_SECRET: "x" }, { "test-provider": (env) => (seen.push(env), new HmacTestProvider()) });
    expect(c.provider?.name).toBe("test-provider");
    expect(seen).toHaveLength(1);
  });

  it("the checkout return URL must be https without credentials (http only for localhost outside production)", () => {
    expect(resolveCommerceConfig({ IPMAT_CHECKOUT_RETURN_URL: "https://app.example.test/billing" }).returnUrl).toBe("https://app.example.test/billing");
    expect(resolveCommerceConfig({ IPMAT_CHECKOUT_RETURN_URL: "http://localhost:5173/billing" }).returnUrl).toBe("http://localhost:5173/billing");
    for (const bad of ["http://app.example.test/x", "https://u:p@app.example.test/x", "javascript:alert(1)", "/relative", "ftp://x.test/y"]) expect(() => resolveCommerceConfig({ IPMAT_CHECKOUT_RETURN_URL: bad }), bad).toThrow(/IPMAT_CHECKOUT_RETURN_URL/);
    expect(() => resolveCommerceConfig({ NODE_ENV: "production", IPMAT_ENTITLEMENTS: "open", IPMAT_CHECKOUT_RETURN_URL: "http://localhost:5173/x" })).toThrow(/IPMAT_CHECKOUT_RETURN_URL/);
  });
});

describe("AI usage facts (observeProvider -> AiUsageSink)", () => {
  const SECRET_PROMPT = "SYSTEM-PROMPT-SENTINEL answer is ANSWER-KEY-7731";
  const SECRET_COMPLETION = "COMPLETION-SENTINEL private reasoning";
  const ok: AiProvider = { name: "p", model: "m-1", complete: async () => ({ rawText: SECRET_COMPLETION, usage: { inputTokens: 11, outputTokens: 22 }, latencyMs: 5 }) };
  const failing = (status: number): AiProvider => ({ name: "p", model: "m-1", complete: async () => { throw Object.assign(new Error(`${SECRET_PROMPT} sk-test-SECRETKEY0001`), { status }); } });
  const ctx = { requestId: "req-1", method: "POST", route: "POST /v1/tutor/ask", actorKind: "student" as const, studentRef: studentRef("student-1"), examCode: null, startedAtMs: 0 };
  const settle = () => new Promise((r) => setTimeout(r, 10));

  it("records provider, model, tokens, outcome, latency and correlation -- and nothing else", async () => {
    const store = new InMemoryBillingStore();
    const p = observeProvider(ok, { usage: store });
    await runWithContext(ctx, () => p.complete({ systemPrompt: SECRET_PROMPT, userPrompt: SECRET_PROMPT }));
    await settle();
    expect(store.aiUsage).toHaveLength(1);
    const r = store.aiUsage[0]!;
    expect(r).toMatchObject({ requestId: "req-1", studentRef: ctx.studentRef, provider: "p", model: "m-1", inputTokens: 11, outputTokens: 22, outcome: "ok", failureCategory: null });
    expect(typeof r.latencyMs).toBe("number");
    expect(Object.keys(r).sort()).toEqual(["failureCategory", "inputTokens", "latencyMs", "model", "occurredAt", "outcome", "outputTokens", "provider", "requestId", "studentRef"]);
    const text = JSON.stringify(r);
    for (const bad of [SECRET_PROMPT, SECRET_COMPLETION, "ANSWER-KEY", "student-1", "cost", "usd"]) expect(text, bad).not.toContain(bad);
  });

  it("a failed call records no tokens (none were reported) and only a coarse category, never the provider's message", async () => {
    const store = new InMemoryBillingStore();
    const p = observeProvider(failing(429), { usage: store });
    await expect(runWithContext(ctx, () => p.complete({ systemPrompt: "s", userPrompt: "u" }))).rejects.toThrow();
    await settle();
    expect(store.aiUsage[0]).toMatchObject({ outcome: "error", failureCategory: "rate_limited", inputTokens: null, outputTokens: null });
    expect(JSON.stringify(store.aiUsage)).not.toMatch(/SENTINEL|sk-test|ANSWER-KEY/);
  });

  it("outside a request there is no correlation, and a provider that reports no usage records null tokens", async () => {
    const store = new InMemoryBillingStore();
    const p = observeProvider({ name: "p", model: "m", complete: async () => ({ rawText: "x", usage: null, latencyMs: 1 }) }, { usage: store });
    await p.complete({ systemPrompt: "s", userPrompt: "u" });
    await settle();
    expect(store.aiUsage[0]).toMatchObject({ requestId: null, studentRef: null, inputTokens: null, outputTokens: null, outcome: "ok" });
  });

  it("a failing sink never changes the model call's result: it is logged and counted, without its error text", async () => {
    const logs: string[] = [];
    const metrics = createMetrics();
    const p = observeProvider(ok, { logger: createLogger({ sink: (l) => logs.push(l) }), metrics, usage: { record: async () => { throw new Error("db down password=hunter2"); } } });
    const out = await p.complete({ systemPrompt: "s", userPrompt: "u" });
    expect(out.rawText).toBe(SECRET_COMPLETION);
    await settle();
    expect(logs.join("\n")).toContain("billing.ai_usage_record_failed");
    expect(logs.join("\n")).not.toMatch(/hunter2|db down/);
    expect(metrics.snapshot().counters.find((c) => c.name === "ai_usage_record_failures_total")?.value).toBe(1);
  });

  it("without a sink the decorator behaves exactly as before", async () => {
    const out = await observeProvider(ok).complete({ systemPrompt: "s", userPrompt: "u" });
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
  });
});
