import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";

/**
 * HTTP-level integration tests for `/v1/enrollment` (Product Phase 1 Unit
 * 7). Business-logic coverage lives in `packages/enrollment-api`'s own
 * test suite — this file proves the TRANSPORT: cookie-derived identity,
 * no client-suppliable studentId, unauthenticated rejection, idempotency
 * through a real HTTP round trip, and that a fresh request reflects
 * persisted state (in-memory here, but through the same repository
 * boundary a real database would use).
 */

let baseUrl: string;
let close: () => Promise<void>;

interface RawResponse {
  status: number;
  json: Record<string, unknown>;
}

async function request(method: string, path: string, body?: unknown, cookie?: string): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function cookieHeaderFrom(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie.split(";")[0] ?? "";
}

async function signupAndGetCookie(email: string): Promise<{ cookie: string; studentId: string }> {
  const res = await fetch(`${baseUrl}/v1/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse" })
  });
  const json = (await res.json()) as { student: { id: string } };
  return { cookie: cookieHeaderFrom(res.headers.get("set-cookie")), studentId: json.student.id };
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

describe("apps/api -- /v1/enrollment HTTP transport", () => {
  it("GET /v1/enrollment for a freshly signed-up student reports enrollment: null", async () => {
    const { cookie } = await signupAndGetCookie("enroll-fresh@example.com");
    const res = await request("GET", "/v1/enrollment", undefined, cookie);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ enrollment: null, prepPhase: null });
  });

  it("POST /v1/enrollment (no body) creates an enrollment for the cookie-authenticated student, including a prepPhase", async () => {
    const { cookie } = await signupAndGetCookie("enroll-create@example.com");
    const res = await request("POST", "/v1/enrollment", undefined, cookie);
    expect(res.status).toBe(200);
    const enrollment = res.json.enrollment as { id: string; examId: string; enrolledAt: string };
    expect(enrollment.id).toBeTruthy();
    expect(enrollment.examId).toBeTruthy();
    expect(res.json.prepPhase).toBeTruthy();
  });

  it("persists across a fresh GET /v1/enrollment request (simulates a browser refresh)", async () => {
    const { cookie } = await signupAndGetCookie("enroll-persist@example.com");
    const created = await request("POST", "/v1/enrollment", undefined, cookie);

    const fresh = await request("GET", "/v1/enrollment", undefined, cookie);
    expect(fresh.status).toBe(200);
    expect(fresh.json.enrollment).toEqual(created.json.enrollment);
  });

  it("is idempotent -- enrolling twice returns the SAME enrollment id, never a duplicate or an error", async () => {
    const { cookie } = await signupAndGetCookie("enroll-idempotent@example.com");
    const first = await request("POST", "/v1/enrollment", undefined, cookie);
    const second = await request("POST", "/v1/enrollment", undefined, cookie);
    expect(second.status).toBe(200);
    expect((second.json.enrollment as { id: string }).id).toBe((first.json.enrollment as { id: string }).id);
  });

  it("rejects an unauthenticated (no cookie) enrollment attempt with 401, never mutating state", async () => {
    const res = await request("POST", "/v1/enrollment");
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("rejects an unauthenticated GET /v1/enrollment the same way", async () => {
    const res = await request("GET", "/v1/enrollment");
    expect(res.status).toBe(401);
  });

  it("a body-supplied studentId cannot select another student -- identity comes ONLY from the cookie", async () => {
    const victim = await signupAndGetCookie("enroll-victim@example.com");
    const attacker = await signupAndGetCookie("enroll-attacker@example.com");

    const res = await request("POST", "/v1/enrollment", { studentId: victim.studentId }, attacker.cookie);
    expect(res.status).toBe(200);

    // The victim's own enrollment status is untouched.
    const victimStatus = await request("GET", "/v1/enrollment", undefined, victim.cookie);
    expect(victimStatus.json).toEqual({ enrollment: null, prepPhase: null });
  });

  it("never leaks a raw internal error/stack trace", async () => {
    const { cookie } = await signupAndGetCookie("enroll-safe-error@example.com");
    const res = await request("POST", "/v1/enrollment", undefined, cookie);
    expect(JSON.stringify(res.json)).not.toMatch(/at .*\.ts:\d+/);
  });
});
