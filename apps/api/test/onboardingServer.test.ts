import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";

/**
 * HTTP-level integration tests for `POST /v1/onboarding/complete` (Product
 * Phase 1 Unit 6). Business-logic coverage lives in
 * `packages/auth-api/test/onboarding.test.ts` — this file proves the
 * TRANSPORT: cookie-derived identity, no client-suppliable studentId,
 * unauthenticated rejection, and that the completed state round-trips
 * through the existing `/v1/auth/me` contract.
 */

let baseUrl: string;
let close: () => Promise<void>;

interface RawResponse {
  status: number;
  json: Record<string, unknown>;
  setCookie: string | null;
}

async function request(method: string, path: string, body?: unknown, cookie?: string): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

function cookieHeaderFrom(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie.split(";")[0] ?? "";
}

beforeAll(async () => {
  const deps = createInMemoryDependencies();
  const server = createServer(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await close();
});

describe("apps/api -- POST /v1/onboarding/complete HTTP transport", () => {
  it("a freshly signed-up student's /v1/auth/me shows onboarding incomplete", async () => {
    const signup = await request("POST", "/v1/auth/signup", { email: "onboard-new@example.com", password: "correct-horse" });
    const cookie = cookieHeaderFrom(signup.setCookie);

    const me = await request("GET", "/v1/auth/me", undefined, cookie);
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ student: { onboardingCompletedAt: null } });
  });

  it("completes onboarding for the cookie-authenticated student and returns the updated student", async () => {
    const signup = await request("POST", "/v1/auth/signup", { email: "onboard-complete@example.com", password: "correct-horse" });
    const cookie = cookieHeaderFrom(signup.setCookie);

    const res = await request("POST", "/v1/onboarding/complete", undefined, cookie);
    expect(res.status).toBe(200);
    const student = res.json.student as { onboardingCompletedAt: string | null };
    expect(student.onboardingCompletedAt).not.toBeNull();
  });

  it("completion persists across a fresh /v1/auth/me request (simulates a browser refresh)", async () => {
    const signup = await request("POST", "/v1/auth/signup", { email: "onboard-persist@example.com", password: "correct-horse" });
    const cookie = cookieHeaderFrom(signup.setCookie);
    await request("POST", "/v1/onboarding/complete", undefined, cookie);

    const me = await request("GET", "/v1/auth/me", undefined, cookie);
    expect(me.status).toBe(200);
    expect((me.json.student as { onboardingCompletedAt: string | null }).onboardingCompletedAt).not.toBeNull();
  });

  it("is idempotent -- completing twice does not move the timestamp or error", async () => {
    const signup = await request("POST", "/v1/auth/signup", { email: "onboard-idempotent@example.com", password: "correct-horse" });
    const cookie = cookieHeaderFrom(signup.setCookie);

    const first = await request("POST", "/v1/onboarding/complete", undefined, cookie);
    const second = await request("POST", "/v1/onboarding/complete", undefined, cookie);
    expect(second.status).toBe(200);
    expect((second.json.student as { onboardingCompletedAt: string }).onboardingCompletedAt).toBe((first.json.student as { onboardingCompletedAt: string }).onboardingCompletedAt);
  });

  it("rejects an unauthenticated (no cookie) completion attempt with 401 not_authenticated -- never mutates state", async () => {
    const res = await request("POST", "/v1/onboarding/complete");
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("rejects a bogus/garbage cookie the same way, never mutating any student's state", async () => {
    const res = await request("POST", "/v1/onboarding/complete", undefined, "session_token=0000000000000000000000000000000000000000000000000000000000000000");
    expect(res.status).toBe(401);
  });

  it("the request body cannot supply a studentId -- identity comes ONLY from the cookie", async () => {
    const signupA = await request("POST", "/v1/auth/signup", { email: "onboard-victim@example.com", password: "correct-horse" });
    const signupB = await request("POST", "/v1/auth/signup", { email: "onboard-attacker@example.com", password: "correct-horse" });
    const cookieB = cookieHeaderFrom(signupB.setCookie);
    const studentAId = (signupA.json.student as { id: string }).id;

    // Attacker sends their OWN valid cookie but tries to name student A's id in the body.
    const res = await request("POST", "/v1/onboarding/complete", { studentId: studentAId }, cookieB);
    expect(res.status).toBe(200);
    // The response is the ATTACKER's own student, never A's -- the body's studentId was never read.
    expect((res.json.student as { id: string }).id).not.toBe(studentAId);
    expect((res.json.student as { id: string }).id).toBe((signupB.json.student as { id: string }).id);

    // Confirm student A's own onboarding is still untouched.
    const cookieA = cookieHeaderFrom(signupA.setCookie);
    const meA = await request("GET", "/v1/auth/me", undefined, cookieA);
    expect((meA.json.student as { onboardingCompletedAt: string | null }).onboardingCompletedAt).toBeNull();
  });
});
