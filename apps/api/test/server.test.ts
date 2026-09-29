import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";

/**
 * HTTP-level integration tests — proves request parsing, routing, and
 * error->status-code mapping actually work end to end, on top of
 * deterministic in-memory dependencies (H: "do not require a live
 * production database for ordinary unit tests"). The bulk of business-
 * logic coverage lives in `packages/practice-api`'s own, much larger test
 * suite — this file exists to prove the TRANSPORT (this app's only real
 * job) is wired correctly, not to re-prove every domain rule again.
 *
 * Product Phase 1 Unit 10 -- every practice route below is now cookie-
 * authenticated (see `server.ts`'s own doc comment): `studentId`/
 * `enrollmentId` are resolved server-side, never accepted as a request
 * field. This file's own tests were rewritten accordingly, the same way
 * `enrollmentServer.test.ts` already tests `/v1/enrollment` — sign up a
 * real (disposable, in-memory) student, complete onboarding, enroll, then
 * exercise the practice routes with that student's real session cookie.
 */

const QUESTION = "question-1";
const ANSWER_KEY = "ANSWER-KEY-9042";

let baseUrl: string;
let close: () => Promise<void>;

interface JsonResponse {
  status: number;
  json: Record<string, unknown>;
}

/** Narrows `{ error: { code, message } }` out of an otherwise-`unknown` JSON body — the one shape `sendError()` (`../src/server.ts`) always produces for a non-2xx response. */
function errorCode(json: Record<string, unknown>): string {
  const error = json.error as { code: string } | undefined;
  return error?.code ?? "";
}

async function request(method: string, path: string, body?: unknown, cookie?: string): Promise<JsonResponse> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

/** Raw request whose body is passed through verbatim (not JSON.stringify'd) -- needed for the malformed-JSON test. */
async function rawRequest(method: string, path: string, rawBody: string, cookie?: string): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: rawBody });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function cookieHeaderFrom(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie.split(";")[0] ?? "";
}

/** Signs up a fresh disposable student, completes onboarding, and enrolls -- the real, minimum precondition every practice route now requires (Product Phase 1 Unit 10). */
async function signupOnboardEnroll(email: string): Promise<{ cookie: string; studentId: string }> {
  const signupRes = await fetch(`${baseUrl}/v1/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse" })
  });
  const signupJson = (await signupRes.json()) as { student: { id: string } };
  const cookie = cookieHeaderFrom(signupRes.headers.get("set-cookie"));
  const studentId = signupJson.student.id;

  await fetch(`${baseUrl}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
  await fetch(`${baseUrl}/v1/enrollment`, { method: "POST", headers: { cookie } });

  return { cookie, studentId };
}

beforeAll(async () => {
  const deps = createInMemoryDependencies({
    questions: [{ id: QUESTION, conceptId: "concept-percentages", options: null, correctAnswer: ANSWER_KEY, expectedTimeSeconds: 90, validationState: "published" }],
    questionContent: [{ id: QUESTION, chapterName: "Percentages", conceptName: "Percentages", prompt: "Find the base.", answerFormat: "numeric_entry", options: null, expectedTimeSeconds: 90 }]
  });

  const server = createServer(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await close();
});

describe("apps/api -- HTTP transport", () => {
  it("POST /v1/recommendation returns a student-safe recommendation for the cookie-authenticated student", async () => {
    const { cookie } = await signupOnboardEnroll("practice-recommend@example.com");
    const res = await request("POST", "/v1/recommendation", undefined, cookie);
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty("headline");
    expect(JSON.stringify(res.json)).not.toContain("diagnostics");
  });

  it("rejects an unauthenticated (no cookie) practice request with 401, never mutating state", async () => {
    const res = await request("POST", "/v1/recommendation");
    expect(res.status).toBe(401);
    expect(errorCode(res.json)).toBe("not_authenticated");
  });

  it("rejects a practice request from an onboarded-but-not-yet-enrolled student with 409 invalid_state, never a crash or a fabricated enrollment", async () => {
    const signupRes = await fetch(`${baseUrl}/v1/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "practice-unenrolled@example.com", password: "correct-horse" })
    });
    const cookie = cookieHeaderFrom(signupRes.headers.get("set-cookie"));
    await fetch(`${baseUrl}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });

    const res = await request("POST", "/v1/recommendation", undefined, cookie);
    expect(res.status).toBe(409);
    expect(errorCode(res.json)).toBe("invalid_state");
  });

  it("a body-supplied studentId/enrollmentId cannot select another student's identity -- it comes ONLY from the cookie", async () => {
    const victim = await signupOnboardEnroll("practice-victim@example.com");
    const attacker = await signupOnboardEnroll("practice-attacker@example.com");

    const res = await request("POST", "/v1/attempts", { studentId: victim.studentId, questionId: QUESTION }, attacker.cookie);
    expect(res.status).toBe(200);

    // The attempt was started for the ATTACKER's own session, never the victim's, regardless of the spoofed body field.
    const attemptId = res.json.attemptId as string;
    const resultAsAttacker = await request("GET", `/v1/attempts/${attemptId}/result`, undefined, attacker.cookie);
    expect(resultAsAttacker.status).toBe(409); // not yet finalized (invalid_state), but reachable by the attacker -- its real, session-derived owner
    const resultAsVictim = await request("GET", `/v1/attempts/${attemptId}/result`, undefined, victim.cookie);
    expect(resultAsVictim.status).toBe(403);
    expect(errorCode(resultAsVictim.json)).toBe("ownership_mismatch");
  });

  it("rejects a malformed JSON body with 400 invalid_request", async () => {
    const { cookie } = await signupOnboardEnroll("practice-malformed@example.com");
    const res = await rawRequest("POST", "/v1/attempts", "{not json", cookie);
    expect(res.status).toBe(400);
    expect(errorCode(res.json)).toBe("invalid_request");
  });

  it("rejects a request missing a required field with 400 invalid_request", async () => {
    const { cookie } = await signupOnboardEnroll("practice-missing-field@example.com");
    const res = await request("POST", "/v1/attempts", {}, cookie);
    expect(res.status).toBe(400);
    expect(errorCode(res.json)).toBe("invalid_request");
  });

  it("rejects an unknown route with 404", async () => {
    const res = await request("GET", "/v1/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("full start -> submit -> result round trip returns correctAnswer only after submission", async () => {
    const { cookie } = await signupOnboardEnroll("practice-roundtrip@example.com");

    const started = await request("POST", "/v1/attempts", { questionId: QUESTION }, cookie);
    expect(started.status).toBe(200);
    expect(JSON.stringify(started.json)).not.toContain(ANSWER_KEY);
    const attemptId = started.json.attemptId as string;

    const submitted = await request("POST", `/v1/attempts/${attemptId}/submit`, { questionId: QUESTION, chosenAnswer: ANSWER_KEY }, cookie);
    expect(submitted.status).toBe(200);
    expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: true, correctAnswer: ANSWER_KEY });

    const result = await request("GET", `/v1/attempts/${attemptId}/result`, undefined, cookie);
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: "submitted", correctAnswer: ANSWER_KEY });
  });

  it("skip -> autopsy round trip reports pending: false (a valid ordinary state)", async () => {
    const { cookie } = await signupOnboardEnroll("practice-skip@example.com");

    const started = await request("POST", "/v1/attempts", { questionId: QUESTION }, cookie);
    const attemptId = started.json.attemptId as string;

    const skipped = await request("POST", `/v1/attempts/${attemptId}/skip`, { questionId: QUESTION }, cookie);
    expect(skipped.status).toBe(200);
    expect(skipped.json.status).toBe("skipped");

    const autopsy = await request("GET", `/v1/attempts/${attemptId}/autopsy`, undefined, cookie);
    expect(autopsy.status).toBe(200);
    expect(autopsy.json).toEqual({ attemptId, pending: false, hypothesis: null });
  });

  it("rejects a cross-student attempt submission with 403, never grading another student's attempt -- real, session-derived identity, not a spoofable body field", async () => {
    const owner = await signupOnboardEnroll("practice-owner@example.com");
    const attacker = await signupOnboardEnroll("practice-attacker-2@example.com");

    const started = await request("POST", "/v1/attempts", { questionId: QUESTION }, owner.cookie);
    const attemptId = started.json.attemptId as string;

    const res = await request("POST", `/v1/attempts/${attemptId}/submit`, { questionId: QUESTION, chosenAnswer: ANSWER_KEY }, attacker.cookie);
    expect(res.status).toBe(403);
    expect(errorCode(res.json)).toBe("ownership_mismatch");
  });

  it("never leaks a raw internal error/stack trace", async () => {
    const { cookie } = await signupOnboardEnroll("practice-safe-error@example.com");
    const res = await request("POST", "/v1/recommendation", undefined, cookie);
    expect(JSON.stringify(res.json)).not.toMatch(/at .*\.ts:\d+/);
  });
});
