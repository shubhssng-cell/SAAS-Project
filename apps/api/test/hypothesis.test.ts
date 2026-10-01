import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDevContentSeed, type DevContentSeed } from "../src/devContent.js";
import { DevScriptedProvider, createHypothesisDependencies, createHypothesisSealer, resolveAiConfig } from "../src/hypothesisWiring.js";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";

/**
 * Phase 4 Unit 2 -- configuration, the sealed token, and the hypothesis/confirmation endpoints over the REAL HTTP transport.
 * No paid model is called anywhere: the "dev-scripted" provider is a development scaffold that quotes the observed facts.
 */

const SECRET = "s".repeat(32);
const PSYCH = /confiden|motivat|anxi|lazy|careless|struggl|intelligen|ability|emotion|afraid|feel|understand|confus|unsure|guess|weak|thought|knew/i;

describe("AI configuration is explicit and fails closed", () => {
  it("defaults to NO model; 'none' is the same", () => {
    expect(resolveAiConfig({})).toEqual({ kind: "none" });
    expect(resolveAiConfig({ IPMAT_AI_PROVIDER: "none" })).toEqual({ kind: "none" });
    expect(createHypothesisDependencies({}).hypothesisGenerator).toBeNull();
  });

  it("the real provider needs a key AND an explicit model, or the server refuses to start (never a silent fake)", () => {
    expect(() => resolveAiConfig({ IPMAT_AI_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => resolveAiConfig({ IPMAT_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toThrow(/IPMAT_AI_MODEL/);
    expect(resolveAiConfig({ IPMAT_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", IPMAT_AI_MODEL: "some-model" })).toEqual({ kind: "anthropic", model: "some-model" });
  });

  it("the development scaffold is refused in production; an unknown provider is an error", () => {
    expect(resolveAiConfig({ IPMAT_AI_PROVIDER: "dev-scripted" })).toEqual({ kind: "dev-scripted" });
    expect(() => resolveAiConfig({ IPMAT_AI_PROVIDER: "dev-scripted", NODE_ENV: "production" })).toThrow(/production/);
    expect(() => resolveAiConfig({ IPMAT_AI_PROVIDER: "gpt" })).toThrow(/Unknown IPMAT_AI_PROVIDER/);
  });

  it("the scaffold is named as what it is", () => {
    expect(new DevScriptedProvider().name).toBe("dev-scripted");
    expect(new DevScriptedProvider().model).toMatch(/not-a-model/);
  });
});

describe("the sealed confirmation token", () => {
  it("round-trips, is opaque, and any alteration, other secret, truncation or garbage opens as null", () => {
    const sealer = createHypothesisSealer(SECRET);
    const payload = { v: 2, hypothesisText: "may be a secret-internal-note" };
    const token = sealer.seal(payload);
    expect(sealer.open(token)).toEqual(payload);
    expect(token).not.toContain("secret-internal-note"); // confidential, not merely signed
    expect(sealer.seal(payload)).not.toBe(token); // fresh nonce each time
    expect(createHypothesisSealer(SECRET).open(token)).toEqual(payload); // another instance with the shared secret opens it
    expect(createHypothesisSealer("z".repeat(32)).open(token)).toBeNull();
    const mid = Math.floor(token.length / 2);
    const flipped = token.slice(0, mid) + (token[mid] === "A" ? "B" : "A") + token.slice(mid + 1); // a middle character: trailing base64 chars can carry unused bits

    for (const bad of [flipped, token.slice(0, 20), "", "not-a-token", token.slice(0, -4)]) expect(sealer.open(bad)).toBeNull();
  });
});

let seed: DevContentSeed;
let baseUrl: string;
let baseUrlB: string;
let baseUrlOtherSecret: string;
let baseUrlNoModel: string;
const closers: Array<() => Promise<void>> = [];

async function listen(extra: object): Promise<string> {
  const server = createServer({ ...createInMemoryDependencies(seed), ...extra } as never);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function request(url: string, method: string, path: string, body?: unknown, cookie?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${url}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  seed = await buildDevContentSeed();
  const dev = createHypothesisDependencies({ IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: SECRET });
  baseUrl = await listen(dev);
  baseUrlB = await listen(dev); // a second API instance sharing the secret
  baseUrlOtherSecret = await listen(createHypothesisDependencies({ IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: "q".repeat(32) }));
  baseUrlNoModel = await listen(createHypothesisDependencies({}));
});
afterAll(async () => {
  for (const close of closers) await close();
});

/** Each server above has its OWN in-memory store, so a student/attempt exists on one server only. */
async function student(url: string, email: string): Promise<string> {
  const res = await fetch(`${url}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "correct-horse" }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await fetch(`${url}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
  await fetch(`${url}/v1/enrollment`, { method: "POST", headers: { cookie } });
  return cookie;
}
async function wrongAttempt(url: string, cookie: string) {
  const rec = await request(url, "POST", "/v1/recommendation", undefined, cookie);
  const questionId = rec.json.questionId as string;
  const canonical = seed.questions.find((q) => q.id === questionId)!;
  const started = await request(url, "POST", "/v1/attempts", { questionId }, cookie);
  const attemptId = started.json.attemptId as string;
  const wrong = canonical.options!.find((o) => o !== canonical.correctAnswer)!;
  return { questionId, attemptId, canonical, wrong, submit: () => request(url, "POST", `/v1/attempts/${attemptId}/submit`, { questionId, chosenAnswer: wrong }, cookie) };
}

describe("hypothesis + confirmation over the real HTTP path", () => {
  it("offers a possible explanation only AFTER submission (409 before), from the observation evidence, with nothing internal in the response", async () => {
    const cookie = await student(baseUrl, "hyp-flow@example.com");
    const a = await wrongAttempt(baseUrl, cookie);

    const early = await request(baseUrl, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie);
    expect(early.status).toBe(409);
    expect(Object.keys(early.json)).toEqual(["error"]);

    await a.submit();
    const offer = await request(baseUrl, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie);
    expect(offer.status).toBe(200);
    expect(offer.json.status).toBe("ready");
    expect(Object.keys(offer.json).sort()).toEqual(["attemptId", "hypothesis", "status", "token"]);
    const hypothesis = offer.json.hypothesis as { summary: string; supportingEvidence: string[] };
    expect(hypothesis.summary).toMatch(/\bmay\b/);

    // the evidence it cites is verbatim from what the student can see in "What was recorded"
    const evidence = await request(baseUrl, "GET", `/v1/attempts/${a.attemptId}/evidence`, undefined, cookie);
    const shown = evidence.json.observations as string[];
    for (const line of hypothesis.supportingEvidence) expect(shown.includes(line) || line === "This question was designed around a common wrong-answer pattern.").toBe(true);
    expect(hypothesis.supportingEvidence).toContain(`Your selected answer was ${a.wrong}.`);

    const text = JSON.stringify(offer.json);
    expect(text).not.toMatch(/modelConfidence|generationMetadata|promptVersion|dev-scripted|proposedErrorCategory|solutionSteps|correctAnswer|apiKey|ANTHROPIC/i);
    expect(hypothesis.summary + hypothesis.supportingEvidence.join(" ")).not.toMatch(PSYCH);
    expect(hypothesis.supportingEvidence).not.toContain(`Your selected answer was ${a.canonical.correctAnswer}.`); // the key is never stated as the student's answer
  });

  it("confirm, reject and correct are each PERSISTED once; the correction comes back exactly; the first response wins; only confirm yields a RepairPlan", async () => {
    const cookie = await student(baseUrl, "hyp-respond@example.com");
    const flow = async () => {
      const a = await wrongAttempt(baseUrl, cookie);
      await a.submit();
      const offer = (await request(baseUrl, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie)).json as { token: string; hypothesis: { summary: string } };
      const respond = (body: Record<string, unknown>) => request(baseUrl, "POST", `/v1/attempts/${a.attemptId}/hypothesis/response`, { token: offer.token, ...body }, cookie);
      return { a, offer, respond };
    };

    const c = await flow();
    const confirmed = await c.respond({ response: "confirmed" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json).toMatchObject({ attemptId: c.a.attemptId, status: "confirmed", studentCorrectionText: null, hypothesisSummary: c.offer.hypothesis.summary, persisted: true, alreadyRecorded: false, diagnosis: { state: "confirmed" } });
    expect(Object.keys(confirmed.json).sort()).toEqual(["alreadyRecorded", "attemptId", "diagnosis", "hypothesisSummary", "persisted", "repairPlan", "status", "studentCorrectionText"]);
    // a second, different response cannot change it
    expect((await c.respond({ response: "rejected" })).json).toMatchObject({ status: "confirmed", alreadyRecorded: true });
    // asking for the offer again returns the persisted answer, not a new offer
    expect((await request(baseUrl, "POST", `/v1/attempts/${c.a.attemptId}/hypothesis`, {}, cookie)).json).toMatchObject({ status: "answered", result: { status: "confirmed" } });

    const r = await flow();
    expect((await r.respond({ response: "rejected" })).json).toMatchObject({ status: "rejected", studentCorrectionText: null, persisted: true, diagnosis: { state: "not_confirmed" }, repairPlan: null });

    const k = await flow();
    const words = "  I used the new value — not the original.\nSecond line ✓ ";
    expect((await k.respond({ response: "corrected", correctedExplanation: words })).json).toMatchObject({ status: "corrected", studentCorrectionText: words, persisted: true, diagnosis: { state: "awaiting_diagnosis" }, repairPlan: null });
    expect((await request(baseUrl, "POST", `/v1/attempts/${k.a.attemptId}/hypothesis`, {}, cookie)).json).toMatchObject({ status: "answered", result: { status: "corrected", studentCorrectionText: words } });

    const m = await flow();
    expect((await m.respond({ response: "corrected", correctedExplanation: "   " })).status).toBe(400);
    expect((await m.respond({ response: "maybe" })).status).toBe(400);
    expect((await m.respond({ response: "corrected", correctedExplanation: "x".repeat(501) })).status).toBe(400);
    // the refusals recorded nothing: the offer is still answerable
    expect((await m.respond({ response: "rejected" })).json).toMatchObject({ status: "rejected", alreadyRecorded: false });
  });

  it("a correct or skipped attempt has nothing to explain (not_applicable)", async () => {
    const cookie = await student(baseUrl, "hyp-na@example.com");
    const rec = await request(baseUrl, "POST", "/v1/recommendation", undefined, cookie);
    const questionId = rec.json.questionId as string;
    const canonical = seed.questions.find((q) => q.id === questionId)!;
    const started = await request(baseUrl, "POST", "/v1/attempts", { questionId }, cookie);
    await request(baseUrl, "POST", `/v1/attempts/${started.json.attemptId as string}/submit`, { questionId, chosenAnswer: canonical.correctAnswer }, cookie);
    expect((await request(baseUrl, "POST", `/v1/attempts/${started.json.attemptId as string}/hypothesis`, {}, cookie)).json).toMatchObject({ status: "not_applicable" });
  });

  it("ownership and auth: another student gets 403 (offer and response), no session gets 401, an unknown attempt 404", async () => {
    const cookie = await student(baseUrl, "hyp-own-a@example.com");
    const other = await student(baseUrl, "hyp-own-b@example.com");
    const a = await wrongAttempt(baseUrl, cookie);
    await a.submit();
    const offer = (await request(baseUrl, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie)).json as { token: string };

    expect((await request(baseUrl, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, other)).status).toBe(403);
    expect((await request(baseUrl, "POST", `/v1/attempts/${a.attemptId}/hypothesis/response`, { token: offer.token, response: "confirmed" }, other)).status).toBe(403);
    expect((await request(baseUrl, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {})).status).toBe(401);
    expect((await request(baseUrl, "POST", "/v1/attempts/no-such-attempt/hypothesis", {}, cookie)).status).toBe(404);
  });

  it("a second instance sharing the secret accepts a token issued by the first; one with another secret refuses it as expired (409)", async () => {
    // all three servers read the same seed but keep their own stores, so the SAME persisted state is simulated by a shared in-memory dependency set
    const shared = createInMemoryDependencies(seed);
    const dev = createHypothesisDependencies({ IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: SECRET });
    const other = createHypothesisDependencies({ IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: "q".repeat(32) });
    const urlA = await listen({ ...shared, ...dev });
    const urlB = await listen({ ...shared, ...dev });
    const urlC = await listen({ ...shared, ...other });
    void baseUrlB; void baseUrlOtherSecret;
    const cookie = await student(urlA, "hyp-multi@example.com");
    const a = await wrongAttempt(urlA, cookie);
    await request(urlA, "POST", `/v1/attempts/${a.attemptId}/submit`, { questionId: a.questionId, chosenAnswer: a.wrong }, cookie);
    const offerA = (await request(urlA, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie)).json as { token: string; hypothesis: { summary: string } };
    const offerB = (await request(urlB, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie)).json as { hypothesis: { summary: string; supportingEvidence: string[] } };
    expect(offerB.hypothesis.summary).toBe(offerA.hypothesis.summary); // same persisted state + same evidence -> same hypothesis input -> same (deterministic) proposal

    expect((await request(urlB, "POST", `/v1/attempts/${a.attemptId}/hypothesis/response`, { token: offerA.token, response: "confirmed" }, cookie)).json).toMatchObject({ status: "confirmed" });
    const stale = await request(urlC, "POST", `/v1/attempts/${a.attemptId}/hypothesis/response`, { token: offerA.token, response: "confirmed" }, cookie);
    expect(stale.status).toBe(409);
  });

  it("with no model configured the offer is 'unavailable' -- never a fabricated explanation -- and the result still works", async () => {
    const cookie = await student(baseUrlNoModel, "hyp-nomodel@example.com");
    const a = await wrongAttempt(baseUrlNoModel, cookie);
    await a.submit();
    const offer = await request(baseUrlNoModel, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie);
    expect(offer.json).toEqual({ status: "unavailable", attemptId: a.attemptId });
    expect((await request(baseUrlNoModel, "GET", `/v1/attempts/${a.attemptId}/result`, undefined, cookie)).status).toBe(200);
    expect((await request(baseUrlNoModel, "GET", `/v1/attempts/${a.attemptId}/evidence`, undefined, cookie)).status).toBe(200);
  });
});
