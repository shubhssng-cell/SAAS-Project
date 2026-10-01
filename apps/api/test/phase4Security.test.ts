import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDevContentSeed, type DevContentSeed } from "../src/devContent.js";
import { createHypothesisDependencies } from "../src/hypothesisWiring.js";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";

/**
 * Phase 4 Unit 5 -- SECURITY / ABUSE audit of the whole Autopsy -> Repair chain over the REAL HTTP transport (no mocks of the server).
 * Every probe states the status convention it expects: 401 no session, 403 someone else's resource, 404 unknown, 409 wrong state / stale
 * token, 400 malformed input. Nothing a client sends can create or alter a diagnosis, a confirmation or a RepairPlan.
 */

const SECRET = "s".repeat(32);
let seed: DevContentSeed;
let url: string;
let urlOtherSecret: string;
const closers: Array<() => Promise<void>> = [];

async function listen(extra: object, shared?: object): Promise<string> {
  const server = createServer({ ...(shared ?? createInMemoryDependencies(seed)), ...extra } as never);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function call(base: string, method: string, path: string, body?: unknown, cookie?: string): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(raw) as Record<string, unknown>; } catch { /* non-JSON error body */ }
  return { status: res.status, json, raw };
}

let counter = 0;
async function student(base: string): Promise<string> {
  counter += 1;
  const res = await fetch(`${base}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `p4sec-${counter}@example.com`, password: "correct-horse" }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await fetch(`${base}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
  await fetch(`${base}/v1/enrollment`, { method: "POST", headers: { cookie } });
  return cookie;
}
async function wrongAttempt(base: string, cookie: string, submit = true) {
  const rec = await call(base, "POST", "/v1/recommendation", undefined, cookie);
  const questionId = rec.json.questionId as string;
  const canonical = seed.questions.find((q) => q.id === questionId)!;
  const started = await call(base, "POST", "/v1/attempts", { questionId }, cookie);
  const attemptId = started.json.attemptId as string;
  const wrong = canonical.options!.find((o) => o !== canonical.correctAnswer)!;
  if (submit) await call(base, "POST", `/v1/attempts/${attemptId}/submit`, { questionId, chosenAnswer: wrong }, cookie);
  return { questionId, attemptId, canonical, wrong, startedBody: started.raw };
}
async function offerFor(base: string, cookie: string, attemptId: string) {
  return (await call(base, "POST", `/v1/attempts/${attemptId}/hypothesis`, {}, cookie)).json as { status: string; token: string; hypothesis: { summary: string } };
}
const respond = (base: string, cookie: string | undefined, attemptId: string, body: Record<string, unknown>) => call(base, "POST", `/v1/attempts/${attemptId}/hypothesis/response`, body, cookie);

beforeAll(async () => {
  seed = await buildDevContentSeed();
  const deps = createInMemoryDependencies(seed);
  url = await listen(createHypothesisDependencies({ IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: SECRET }), deps);
  urlOtherSecret = await listen(createHypothesisDependencies({ IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: "q".repeat(32) }), deps);
});
afterAll(async () => {
  for (const close of closers) await close();
});

describe("authentication and ownership on every chain endpoint", () => {
  const endpoints: Array<[string, (id: string) => string, unknown]> = [
    ["POST", (id) => `/v1/attempts/${id}/hypothesis`, {}],
    ["POST", (id) => `/v1/attempts/${id}/hypothesis/response`, { token: "x", response: "confirmed" }],
    ["GET", (id) => `/v1/attempts/${id}/evidence`, undefined],
    ["GET", (id) => `/v1/attempts/${id}/result`, undefined],
    ["GET", (id) => `/v1/attempts/${id}/autopsy`, undefined]
  ];

  it("no session -> 401 on all of them", async () => {
    const owner = await student(url);
    const a = await wrongAttempt(url, owner);
    for (const [method, path, body] of endpoints) expect((await call(url, method, path(a.attemptId), body)).status, path(a.attemptId)).toBe(401);
  });

  it("another student -> 403 on all of them (and the owner's state is untouched); an unknown attempt -> 404", async () => {
    const owner = await student(url);
    const stranger = await student(url);
    const a = await wrongAttempt(url, owner);
    const offer = await offerFor(url, owner, a.attemptId);
    for (const [method, path, body] of endpoints) {
      const payload = body && typeof body === "object" && "token" in body ? { ...body, token: offer.token } : body;
      expect((await call(url, method, path(a.attemptId), payload, stranger)).status, path(a.attemptId)).toBe(403);
    }
    for (const [method, path, body] of endpoints) expect((await call(url, method, path("no-such-attempt"), body, owner)).status).toBe(404);
    expect((await offerFor(url, owner, a.attemptId)).status).toBe("ready"); // still awaiting: the stranger changed nothing
  });
});

describe("nothing before submission", () => {
  it("evidence, hypothesis and response are 409 for an open attempt; no response (including the start response) contains the answer key", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie, false);
    expect((await call(url, "GET", `/v1/attempts/${a.attemptId}/evidence`, undefined, cookie)).status).toBe(409);
    expect((await call(url, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie)).status).toBe(409);
    expect((await respond(url, cookie, a.attemptId, { token: "x", response: "confirmed" })).status).toBe(409);
    expect((await call(url, "GET", `/v1/attempts/${a.attemptId}/result`, undefined, cookie)).status).toBe(409);
    expect(a.startedBody).not.toMatch(/correctAnswer|solutionSteps|explanation/);
    const rec = await call(url, "POST", "/v1/recommendation", undefined, cookie);
    expect(rec.raw).not.toMatch(/correctAnswer|solutionSteps/);
  });
});

describe("tokens: forged, swapped, replayed, stale", () => {
  it("garbage, truncated, other-secret and oversize tokens are refused (409 / 400) and record nothing", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    const offer = await offerFor(url, cookie, a.attemptId);
    for (const token of ["garbage", offer.token.slice(0, -6), "a".repeat(40)]) expect((await respond(url, cookie, a.attemptId, { token, response: "confirmed" })).status).toBe(409);
    expect((await respond(url, cookie, a.attemptId, { token: "x".repeat(20_001), response: "confirmed" })).status).toBe(400);
    expect((await respond(urlOtherSecret, cookie, a.attemptId, { token: offer.token, response: "confirmed" })).status).toBe(409); // another deployment secret
    expect((await offerFor(url, cookie, a.attemptId)).status).toBe("ready"); // nothing was recorded by any of them
  });

  it("a token cannot be swapped onto another attempt (403) of the same student, or onto another student's attempt (403)", async () => {
    const cookie = await student(url);
    const other = await student(url);
    const first = await wrongAttempt(url, cookie);
    const second = await wrongAttempt(url, cookie);
    const theirs = await wrongAttempt(url, other);
    const offer = await offerFor(url, cookie, first.attemptId);
    expect((await respond(url, cookie, second.attemptId, { token: offer.token, response: "confirmed" })).status).toBe(403);
    expect((await respond(url, other, theirs.attemptId, { token: offer.token, response: "confirmed" })).status).toBe(403);
    expect((await respond(url, other, first.attemptId, { token: offer.token, response: "confirmed" })).status).toBe(403);
    expect((await offerFor(url, cookie, first.attemptId)).status).toBe("ready");
  });

  it("replaying a used token cannot create a second diagnosis or change the outcome: the first answer stands, with the same status code", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    const offer = await offerFor(url, cookie, a.attemptId);
    const first = await respond(url, cookie, a.attemptId, { token: offer.token, response: "confirmed" });
    expect(first.status).toBe(200);
    for (const response of ["confirmed", "rejected"]) {
      const again = await respond(url, cookie, a.attemptId, { token: offer.token, response });
      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({ status: "confirmed", alreadyRecorded: true });
    }
    expect((await call(url, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie)).json).toMatchObject({ status: "answered", result: { status: "confirmed" } });
  });
});

describe("forged diagnosis, confirmation and RepairPlan", () => {
  it("extra fields in a response body (diagnosis, plan, hypothesis text, student/attempt ids, status) are ignored: the stored offer decides everything", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    const offer = await offerFor(url, cookie, a.attemptId);
    const forged = await respond(url, cookie, a.attemptId, {
      token: offer.token,
      response: "rejected",
      status: "confirmed",
      diagnosis: { state: "confirmed" },
      repairPlan: { conceptName: "Forged", patternFamilyName: "Forged" },
      hypothesis: "a forged proposal",
      hypothesisSummary: "a forged proposal",
      studentId: "someone-else",
      attemptId: "someone-elses-attempt",
      confirmedAt: "2000-01-01T00:00:00.000Z"
    });
    expect(forged.status).toBe(200);
    expect(forged.json).toMatchObject({ status: "rejected", hypothesisSummary: offer.hypothesis.summary, diagnosis: { state: "not_confirmed" }, repairPlan: null, attemptId: a.attemptId });
    expect(forged.raw).not.toMatch(/Forged|forged|someone-else/);
  });

  it("a correction cannot be turned into a diagnosis: no body shape after it yields a confirmed state or a plan", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    const offer = await offerFor(url, cookie, a.attemptId);
    expect((await respond(url, cookie, a.attemptId, { token: offer.token, response: "corrected", correctedExplanation: "my words" })).json).toMatchObject({ diagnosis: { state: "awaiting_diagnosis" }, repairPlan: null });
    const after = await respond(url, cookie, a.attemptId, { token: offer.token, response: "confirmed", diagnosis: { state: "confirmed" } });
    expect(after.json).toMatchObject({ status: "corrected", studentCorrectionText: "my words", diagnosis: { state: "awaiting_diagnosis" }, repairPlan: null });
  });

  it("there is no endpoint through which a client could create, read or modify a diagnosis or RepairPlan directly (404)", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    for (const [method, path] of [["POST", "/v1/repair-plans"], ["GET", "/v1/repair-plans"], ["POST", "/v1/diagnoses"], ["GET", `/v1/attempts/${a.attemptId}/repair-plan`], ["POST", `/v1/attempts/${a.attemptId}/diagnosis`], ["PUT", `/v1/attempts/${a.attemptId}/hypothesis`], ["DELETE", `/v1/attempts/${a.attemptId}/hypothesis`]] as const) {
      const res = await call(url, method, path, method === "GET" ? undefined : { status: "confirmed" }, cookie);
      expect([404, 405], `${method} ${path}`).toContain(res.status);
    }
  });
});

describe("malformed input", () => {
  it("unknown response types, non-string / empty / oversize corrections, missing token -> 400 and nothing is recorded", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    const offer = await offerFor(url, cookie, a.attemptId);
    for (const body of [
      { token: offer.token, response: "maybe" },
      { token: offer.token, response: 5 },
      { token: offer.token, response: "corrected" },
      { token: offer.token, response: "corrected", correctedExplanation: "   " },
      { token: offer.token, response: "corrected", correctedExplanation: 42 },
      { token: offer.token, response: "corrected", correctedExplanation: "x".repeat(501) },
      { response: "confirmed" }
    ]) {
      expect((await respond(url, cookie, a.attemptId, body as Record<string, unknown>)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect((await offerFor(url, cookie, a.attemptId)).status).toBe("ready");
  });
});

describe("duplicate submission and concurrency over HTTP", () => {
  it("20 concurrent identical confirmations -> exactly one wins; all 20 report the same confirmed outcome", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    const offer = await offerFor(url, cookie, a.attemptId);
    const results = await Promise.all(Array.from({ length: 20 }, () => respond(url, cookie, a.attemptId, { token: offer.token, response: "confirmed" })));
    expect(results.every((r) => r.status === 200 && r.json.status === "confirmed")).toBe(true);
    expect(results.filter((r) => r.json.alreadyRecorded === false)).toHaveLength(1);
  });

  it("concurrent conflicting responses (confirm / reject / correct) end in ONE consistent persisted outcome that every caller sees", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    const offer = await offerFor(url, cookie, a.attemptId);
    const bodies = [{ response: "confirmed" }, { response: "rejected" }, { response: "corrected", correctedExplanation: "my words" }];
    const results = await Promise.all(Array.from({ length: 18 }, (_, i) => respond(url, cookie, a.attemptId, { token: offer.token, ...bodies[i % 3]! })));
    const winner = (await call(url, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie)).json as { status: string; result: { status: string } };
    expect(winner.status).toBe("answered");
    expect(results.filter((r) => r.json.alreadyRecorded === false)).toHaveLength(1);
    for (const r of results) expect(r.json.status).toBe(winner.result.status);
  });
});

describe("leakage in the chain's responses", () => {
  it("after submission the offer, response and evidence expose no answer key or internal field", async () => {
    const cookie = await student(url);
    const a = await wrongAttempt(url, cookie);
    const offer = await call(url, "POST", `/v1/attempts/${a.attemptId}/hypothesis`, {}, cookie);
    const evidence = await call(url, "GET", `/v1/attempts/${a.attemptId}/evidence`, undefined, cookie);
    const done = await respond(url, cookie, a.attemptId, { token: (offer.json as { token: string }).token, response: "confirmed" });
    for (const r of [offer, evidence, done]) {
      const text = JSON.stringify(r.json, (key, v) => (key === "token" || key === "attemptId" || key === "questionId" ? undefined : v));
      expect(text).not.toMatch(/modelConfidence|generationMetadata|promptVersion|dev-scripted|proposedErrorCategory|errorTaxonomy|solutionSteps|"correctAnswer"|autopsyId|studentId|targetConceptId|followUp|priority|taxonomy/i);
      expect(text).not.toMatch(/confiden|motivat|intelligen|abilit|emotion|personalit|careless|unsure|you (felt|knew|thought)/i);
    }
    const lines = (offer.json.hypothesis as { supportingEvidence: string[] }).supportingEvidence;
    expect(lines).toContain(`Your selected answer was ${a.wrong}.`);
    expect(lines).not.toContain(`Your selected answer was ${a.canonical.correctAnswer as string}.`); // the key is never presented as the student answer
  });
});
