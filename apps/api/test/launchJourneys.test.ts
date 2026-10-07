import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_WEBHOOK_SECRET, eventBody, signWebhook } from "@ipmat/billing-api/testing";
import { KEY, PROVIDER_SECRET, SOLUTION_STEP } from "./assistantFixtures.js";
import { Q, buildApp, type App } from "./securityHarness.js";

/**
 * Phase 9 Unit 5 (docs/DECISIONS.md D-101) -- the six launch JOURNEYS and the final cross-cutting SECURITY pass, over the real HTTP
 * transport with the real services. The payment provider is a deterministic signed-event double and the model a scripted double
 * (neither is live: no credential exists). Plans, limits and amounts are LABELLED TEST FIXTURES.
 */
const clock = { now: new Date("2026-10-15T12:00:00.000Z") };
const sec = (): number => Math.floor(clock.now.getTime() / 1000);
const ago = (m: number): string => new Date(clock.now.getTime() - m * 60_000).toISOString();
const PLUS = { amountMinor: 123456, currency: "INR" };
let seq = 0;
const eid = (l: string): string => `evt_${l}_${++seq}_${Math.random().toString(36).slice(2, 7)}`;

const hook = (app: App, body: unknown, opts: { secret?: string } = {}) => {
  const s = signWebhook(body, { at: sec(), secret: opts.secret });
  return app.call("POST", "/v1/billing/webhook", undefined, undefined, s.headers, s.rawBody);
};
const subOf = async (app: App, studentId: string, plan = "test_plus") => (await app.billing!.listSubscriptionsForStudent(studentId)).filter((s) => s.planId === plan).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!;
async function pay(app: App, s: { cookie: string; studentId: string }, plan = "test_plus", amount = PLUS) {
  expect((await app.call("POST", "/v1/billing/checkout", { planId: plan }, s.cookie)).status).toBe(200);
  const sub = await subOf(app, s.studentId, plan);
  expect((await hook(app, eventBody({ eventId: eid("pay"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: ago(5), subscriptionId: sub.id, ...amount }))).status).toBe(200);
  return sub;
}
const FORBIDDEN = [KEY, SOLUTION_STEP, PROVIDER_SECRET, TEST_WEBHOOK_SECRET, "cs_test_", "providerRef", "stack", "node_modules", "Prisma", "capability", "workflow", "tutor_response"];

describe("launch journeys", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildApp({ commerce: { mode: "enforced", now: () => clock.now }, limiter: false });
  });
  afterAll(() => app.close());
  beforeEach(() => {
    clock.now = new Date("2026-10-15T12:00:00.000Z");
    app.payments.failCheckout = false;
    app.provider.mode = "compliant";
    app.provider.intent = "give_hint";
  });

  it("J1 new student: account -> onboarding -> enrollment -> dashboard recommendation -> practice -> tutor (AI-labelled, no key before an attempt)", async () => {
    const email = `j1-${Date.now()}@example.com`;
    const signup = await app.call("POST", "/v1/auth/signup", { email, password: "correct-horse-battery-1" });
    expect(signup.status).toBe(200);
    const setCookie = signup.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const cookie = setCookie.split(";")[0]!;
    app.known.add((signup.json.student as { id: string }).id);
    expect((await app.call("GET", "/v1/enrollment", undefined, cookie)).json.enrollment).toBeNull(); // not enrolled yet: an ordinary state, not an error
    expect((await app.call("POST", "/v1/recommendation", {}, cookie)).status).toBe(409); // practice needs enrollment (the web gates it first)
    expect((await app.call("POST", "/v1/onboarding/complete", undefined, cookie)).status).toBe(200);
    expect((await app.call("POST", "/v1/enrollment", undefined, cookie)).status).toBe(200);
    expect((await app.call("POST", "/v1/recommendation", {}, cookie)).status).toBe(200);
    const attempt = await app.call("POST", "/v1/attempts", { questionId: Q }, cookie);
    expect(attempt.status).toBe(200);
    const hint = await app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }, cookie);
    expect(hint.status).toBe(200);
    expect(hint.json).toMatchObject({ status: "answered", failure: null });
    for (const bad of FORBIDDEN) expect(hint.raw, bad).not.toContain(bad);
    // a hint never carries the answer key, and nothing before a submitted attempt unlocks it
    expect(app.provider.prompts.at(-1)!.userPrompt).not.toContain(KEY);
  });

  it("J2 billing: plan -> checkout -> pending -> verified provider event -> entitlement -> protected feature", async () => {
    const s = await app.student();
    const before = await app.call("GET", "/v1/billing", undefined, s.cookie);
    expect(before.json.plans).not.toEqual([]);
    expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    const checkout = await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie);
    expect(checkout.status).toBe(200);
    expect(await app.call("GET", "/v1/billing", undefined, s.cookie).then((r) => r.json.subscription)).toMatchObject({ status: "pending", grantsAccess: false });
    expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403); // pending grants nothing
    const sub = await subOf(app, s.studentId);
    expect((await hook(app, eventBody({ eventId: eid("j2"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: ago(2), subscriptionId: sub.id, ...PLUS }))).status).toBe(200);
    expect(await app.call("GET", "/v1/billing", undefined, s.cookie).then((r) => r.json.subscription)).toMatchObject({ status: "active", grantsAccess: true });
    expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(200);
  });

  it("J3 usage limit: a denied expensive operation leaves a visible path to the billing page, and the plan raises the limit", async () => {
    const s = await app.student();
    const ask = () => app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }, s.cookie);
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(200);
    const denied = await ask();
    expect(denied.status).toBe(403);
    expect(denied.json).toEqual({ error: { code: "usage_limit_reached", message: "You've reached your limit for this feature for now." } });
    const summary = await app.call("GET", "/v1/billing", undefined, s.cookie);
    expect(summary.json.usage).toEqual([expect.objectContaining({ meter: "tutor_request", used: 2, limit: 2 })]);
    expect((summary.json.plans as unknown[]).length).toBeGreaterThan(0); // the upgrade path exists
    await pay(app, s);
    expect((await ask()).status).toBe(200); // the plan's higher limit applies
  });

  it("J4 expired / revoked entitlement: protected features are denied safely, with the reason visible", async () => {
    const lapsing = await app.student();
    await pay(app, lapsing);
    expect((await app.call("POST", "/v1/training/sessions", { systemId: "x" }, lapsing.cookie)).json).not.toMatchObject({ error: { code: "not_entitled" } });
    clock.now = new Date(clock.now.getTime() + 31 * 86_400_000);
    const expired = await app.call("GET", "/v1/billing", undefined, lapsing.cookie);
    expect(expired.json.subscription).toMatchObject({ status: "expired", grantsAccess: false });
    expect((await app.call("POST", "/v1/simulations", undefined, lapsing.cookie)).json).toMatchObject({ error: { code: "not_entitled" } });
    clock.now = new Date("2026-10-15T12:00:00.000Z");
    const refunded = await app.student();
    const sub = await pay(app, refunded);
    await hook(app, eventBody({ eventId: eid("rf"), type: "payment_refunded", providerRef: sub.providerRef!, occurredAt: ago(1), subscriptionId: sub.id }));
    expect((await app.call("POST", "/v1/simulations", undefined, refunded.cookie)).json).toMatchObject({ error: { code: "not_entitled" } });
  });

  it("J5 malicious client: identity, price, entitlement and subscription manipulation are all rejected, and the account stays unentitled", async () => {
    const victim = await app.student();
    const attacker = await app.student();
    const attempts: Array<[string, string, unknown, Record<string, string>?]> = [
      ["POST", "/v1/billing/checkout", { planId: "test_plus", amountMinor: 1 }],
      ["POST", "/v1/billing/checkout", { planId: "test_plus", currency: "USD" }],
      ["POST", "/v1/billing/checkout", { planId: "test_plus", studentId: victim.studentId }],
      ["POST", "/v1/billing/checkout", { planId: "test_plus", returnUrl: "https://evil.example/ok" }],
      ["POST", "/v1/billing/checkout", { planId: "test_plus", status: "active", entitlement: "all" }],
      ["POST", "/v1/billing/checkout", { planId: ["test_plus", "test_unlimited"] }],
      ["POST", "/v1/billing/cancel", { subscriptionId: "x" }],
      ["POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q, studentId: victim.studentId, plan: "test_plus" }],
      ["POST", "/v1/simulations", { entitled: true }, { "x-entitlement": "pro", "x-plan-id": "test_plus", "x-student-id": victim.studentId }],
      ["PUT", "/v1/preferences", { plan: "test_plus", entitled: true }]
    ];
    for (const [method, path, body, headers] of attempts) {
      const r = await app.call(method, path, body, attacker.cookie, headers ?? {});
      expect([400, 403], `${method} ${path} ${JSON.stringify(body)}`).toContain(r.status);
    }
    // a forged / replayed / tampered payment callback
    const checkout = await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, attacker.cookie);
    expect(checkout.status).toBe(200);
    const sub = await subOf(app, attacker.studentId);
    const good = eventBody({ eventId: eid("forge"), type: "payment_succeeded", providerRef: sub.providerRef!, occurredAt: ago(1), subscriptionId: sub.id, ...PLUS });
    expect((await hook(app, good, { secret: "whsec_attacker_guess" })).status).toBe(400);
    expect((await app.call("POST", "/v1/billing/webhook", good, attacker.cookie)).status).toBe(400); // unsigned, with a real session
    expect((await hook(app, { ...good, amountMinor: 1 })).status).toBe(200); // validly signed, wrong amount: acknowledged, grants nothing
    for (const s of [attacker, victim]) expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    expect((await subOf(app, attacker.studentId)).status).toBe("pending");
    expect(await app.billing!.listSubscriptionsForStudent(victim.studentId)).toEqual([]);
  });

  it("J6 provider unavailable: checkout fails safely, nothing is granted, state stays retryable, and recovery works", async () => {
    const s = await app.student();
    app.payments.failCheckout = true;
    const r = await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie);
    expect(r.status).toBe(503);
    for (const bad of FORBIDDEN) expect(r.raw, bad).not.toContain(bad);
    expect((await app.call("POST", "/v1/simulations", undefined, s.cookie)).status).toBe(403);
    expect((await app.call("GET", "/v1/billing", undefined, s.cookie)).json.subscription).toMatchObject({ status: "pending", grantsAccess: false });
    app.payments.failCheckout = false;
    expect((await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie)).status).toBe(200);
  });
});

describe("simulation availability (no exam rules are invented)", () => {
  it("reports the server's truth: configured vs not, per student; a start is an honest 503 when nothing is configured", async () => {
    const none = await buildApp({ simulationConfigured: false, limiter: false });
    const yes = await buildApp({ limiter: false });
    try {
      const a = await none.student();
      expect((await none.call("GET", "/v1/simulations/availability", undefined, a.cookie)).json).toEqual({ available: false });
      expect((await none.call("POST", "/v1/simulations", undefined, a.cookie)).status).toBe(503);
      const b = await yes.student();
      expect((await yes.call("GET", "/v1/simulations/availability", undefined, b.cookie)).json).toEqual({ available: true });
      expect((await none.call("GET", "/v1/simulations/availability")).status).toBe(401);
      // it uses no allowance and starts nothing
      expect(await yes.assistant.simulation!.get(b as never, "nope").catch((e: { code?: string }) => e.code)).toBeDefined();
    } finally {
      await none.close();
      await yes.close();
    }
  });
});

describe("final security pass over the whole product", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildApp({ commerce: { mode: "enforced", now: () => clock.now }, limiter: false, allowedOrigins: ["https://app.example.test"], maxBodyBytes: 4096 });
  });
  afterAll(() => app.close());

  it("every protected route refuses an anonymous caller (direct access), and none leaks a stack, driver or capability name", async () => {
    const routes: Array<[string, string, unknown?]> = [
      ["POST", "/v1/recommendation", {}], ["POST", "/v1/attempts", { questionId: Q }], ["POST", "/v1/attempts/a/submit", { questionId: Q, chosenAnswer: "x" }], ["POST", "/v1/attempts/a/skip", { questionId: Q }],
      ["GET", "/v1/attempts/a/result"], ["POST", "/v1/attempts/a/hypothesis"], ["GET", "/v1/attempts/a/evidence"], ["GET", "/v1/attempts/a/autopsy"],
      ["GET", "/v1/training/systems"], ["POST", "/v1/training/sessions", { systemId: "x" }], ["GET", "/v1/training/sessions/s"], ["POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q }],
      ["GET", "/v1/preferences"], ["PUT", "/v1/preferences", { language: "hindi" }], ["POST", "/v1/simulations"], ["GET", "/v1/simulations/availability"], ["GET", "/v1/simulations/x"],
      ["GET", "/v1/billing"], ["POST", "/v1/billing/checkout", { planId: "test_plus" }], ["POST", "/v1/billing/cancel", {}], ["GET", "/v1/enrollment"], ["POST", "/v1/enrollment"], ["POST", "/v1/onboarding/complete"]
    ];
    for (const [method, path, body] of routes) {
      const r = await app.call(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(401);
      for (const bad of FORBIDDEN) expect(r.raw, `${method} ${path} ${bad}`).not.toContain(bad);
    }
  });

  it("an extra cookie next to a valid session changes nothing: it grants no role, plan or entitlement", async () => {
    const s = await app.student();
    const r = await app.call("GET", "/v1/billing", undefined, `${s.cookie}; admin=true; plan=test_plus; role=staff`);
    expect(r.status).toBe(200);
    expect(r.json.subscription).toBeNull();
    expect((await app.call("POST", "/v1/simulations", undefined, `${s.cookie}; entitled=true`)).status).toBe(403);
  });

  it("a manipulated session cookie is refused everywhere: flipped, truncated, wrong shape, injected, or from a logged-out session", async () => {
    const s = await app.student();
    const token = s.cookie.split("=")[1]!;
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    const bad = [flipped, token.slice(0, 63), `${token}0`, "x".repeat(64), `${token}%3Badmin%3Dtrue`, "../../etc/passwd", "' OR 1=1 --", ""];
    for (const t of bad) {
      for (const path of ["/v1/billing", "/v1/auth/me", "/v1/preferences"]) expect((await app.call("GET", path, undefined, `session_token=${t}`)).status, `${path} ${t.slice(0, 12)}`).toBe(401);
    }
    expect((await app.call("POST", "/v1/auth/logout", undefined, s.cookie)).status).toBe(200);
    expect((await app.call("GET", "/v1/billing", undefined, s.cookie)).status).toBe(401); // the logged-out token is dead
    expect((await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie)).status).toBe(401);
  });

  it("state-changing billing requests from a disallowed origin are refused (CSRF), an allowed or absent origin is not", async () => {
    const s = await app.student();
    for (const [path, body] of [["/v1/billing/checkout", { planId: "test_plus" }], ["/v1/billing/cancel", {}]] as const) {
      expect((await app.call("POST", path, body, s.cookie, { origin: "https://evil.example" })).status, path).toBe(403);
      expect((await app.call("POST", path, body, s.cookie, { origin: "https://app.example.test" })).status, path).not.toBe(403);
    }
    expect((await app.call("GET", "/v1/billing", undefined, s.cookie, { origin: "https://evil.example" })).status).toBe(200); // reads are not state-changing
  });

  it("request-size abuse is refused with 413 on billing, tutor and preference writes, and the connection survives the next request", async () => {
    const s = await app.student();
    const big = { planId: "test_plus", pad: "x".repeat(8000) };
    expect((await app.call("POST", "/v1/billing/checkout", big, s.cookie)).status).toBe(413);
    expect((await app.call("POST", "/v1/tutor/ask", { operation: "give_hint", questionId: Q, focus: "y".repeat(8000) }, s.cookie)).status).toBe(413);
    expect((await app.call("PUT", "/v1/preferences", { language: "z".repeat(8000) }, s.cookie)).status).toBe(413);
    expect((await app.call("GET", "/v1/billing", undefined, s.cookie)).status).toBe(200);
  });

  it("billing and webhook rate limits cannot be dodged by a forged forwarded address or a changed header", async () => {
    const limited = await buildApp({ commerce: { mode: "enforced", now: () => clock.now }, rules: { billing_write: { limit: 2, windowMs: 60_000 }, webhook: { limit: 3, windowMs: 60_000 } } });
    try {
      const s = await limited.student();
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) statuses.push((await limited.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie, { "x-forwarded-for": `203.0.113.${i + 1}`, "x-real-ip": `198.51.100.${i + 1}` })).status);
      expect(statuses).toEqual([200, 200, 429, 429]);
      const hooks: number[] = [];
      for (let i = 0; i < 5; i += 1) hooks.push((await limited.call("POST", "/v1/billing/webhook", undefined, undefined, { "x-forwarded-for": `203.0.113.${i + 9}`, "content-type": "application/json" }, "{}")).status);
      expect(hooks.slice(0, 3)).toEqual([400, 400, 400]);
      expect(hooks.slice(3)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });

  it("a student cannot read or act on another student's billing, usage, preferences or simulation availability", async () => {
    const a = await app.student();
    const b = await app.student();
    await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, a.cookie);
    const subA = await subOf(app, a.studentId);
    const rb = await app.call("GET", `/v1/billing?studentId=${a.studentId}&subscriptionId=${subA.id}`, undefined, b.cookie);
    expect(rb.json.subscription).toBeNull();
    expect(rb.raw).not.toContain(subA.id);
    expect((await app.call("POST", "/v1/billing/cancel", { subscriptionId: subA.id }, b.cookie)).status).toBe(400);
    await app.call("PUT", "/v1/preferences", { language: "hindi" }, a.cookie);
    expect((await app.call("GET", `/v1/preferences?studentId=${a.studentId}`, undefined, b.cookie)).json.preferences).toMatchObject({ language: null });
  });

  it("no response across the billing and assistant surface carries a secret, a provider reference, an answer key or a stack", async () => {
    const s = await app.student();
    const outputs = [
      await app.call("GET", "/v1/billing", undefined, s.cookie),
      await app.call("POST", "/v1/billing/checkout", { planId: "test_plus" }, s.cookie),
      await app.call("POST", "/v1/billing/checkout", { planId: "nope" }, s.cookie),
      await app.call("POST", "/v1/billing/cancel", {}, s.cookie),
      await app.call("POST", "/v1/tutor/ask", { operation: "explain_question", questionId: Q }, s.cookie),
      await app.call("POST", "/v1/tutor/ask", { operation: "nonsense", questionId: Q }, s.cookie),
      await app.call("GET", "/v1/simulations/availability", undefined, s.cookie)
    ];
    for (const r of outputs) for (const bad of [KEY, SOLUTION_STEP, PROVIDER_SECRET, TEST_WEBHOOK_SECRET, "providerRef", "providerPriceRef", "price_test_plus", "stack", "node_modules", "Prisma"]) expect(r.raw, bad).not.toContain(bad);
  });

  it("the server logs of the whole run hold no secret, signature, reference or password", async () => {
    const text = app.logs.join("\n");
    for (const bad of [TEST_WEBHOOK_SECRET, "whsec_", "cs_test_", "pay.test.invalid", "x-test-signature", "correct-horse", "session_token", PROVIDER_SECRET, KEY]) expect(text, bad).not.toContain(bad);
  });
});
