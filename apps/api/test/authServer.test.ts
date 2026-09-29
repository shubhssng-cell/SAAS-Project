import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";

/**
 * HTTP-level integration tests for `/v1/auth/*` (Product Phase 1 Unit 4).
 * Business-logic coverage (signup/login/session validation itself) lives
 * in `packages/auth-api`'s own, much larger test suite — this file proves
 * the TRANSPORT (cookie parsing/issuance, route dispatch, error->status
 * mapping) is wired correctly, mirroring `server.test.ts`'s own scope.
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

/** Extracts just the `session_token=<value>` pair from a raw Set-Cookie header, suitable for sending back as a `Cookie` request header. */
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

describe("apps/api -- /v1/auth/* HTTP transport", () => {
  it("POST /v1/auth/signup creates an account, sets an HttpOnly session cookie, and never returns a passwordHash", async () => {
    const res = await request("POST", "/v1/auth/signup", { email: "student@example.com", password: "correct-horse" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ student: { email: "student@example.com" } });
    expect(JSON.stringify(res.json)).not.toContain("passwordHash");
    expect(res.setCookie).toBeTruthy();
    expect(res.setCookie).toContain("HttpOnly");
    expect(res.setCookie).toContain("SameSite=Lax");
    expect(res.setCookie).toContain("session_token=");
  });

  it("POST /v1/auth/signup rejects a duplicate email with 409 email_already_registered", async () => {
    await request("POST", "/v1/auth/signup", { email: "duplicate@example.com", password: "correct-horse" });
    const res = await request("POST", "/v1/auth/signup", { email: "duplicate@example.com", password: "another-password" });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: { code: "email_already_registered", message: expect.any(String) } });
  });

  it("POST /v1/auth/login with correct credentials returns 200 and a fresh session cookie", async () => {
    await request("POST", "/v1/auth/signup", { email: "login-test@example.com", password: "correct-horse" });
    const res = await request("POST", "/v1/auth/login", { email: "login-test@example.com", password: "correct-horse" });
    expect(res.status).toBe(200);
    expect(res.setCookie).toContain("session_token=");
  });

  it("POST /v1/auth/login with a wrong password returns 401 invalid_credentials", async () => {
    await request("POST", "/v1/auth/signup", { email: "wrong-pw@example.com", password: "correct-horse" });
    const res = await request("POST", "/v1/auth/login", { email: "wrong-pw@example.com", password: "totally-wrong" });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: { code: "invalid_credentials", message: expect.any(String) } });
  });

  it("GET /v1/auth/me with no cookie returns 401 not_authenticated (never invalid_request)", async () => {
    const res = await request("GET", "/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: { code: "not_authenticated", message: expect.any(String) } });
  });

  it("GET /v1/auth/me with a valid session cookie returns the authenticated student", async () => {
    const signup = await request("POST", "/v1/auth/signup", { email: "me-test@example.com", password: "correct-horse" });
    const cookie = cookieHeaderFrom(signup.setCookie);

    const res = await request("GET", "/v1/auth/me", undefined, cookie);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ student: { email: "me-test@example.com" } });
  });

  it("GET /v1/auth/me with a garbage cookie value returns 401 not_authenticated", async () => {
    const res = await request("GET", "/v1/auth/me", undefined, "session_token=not-a-real-token");
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("POST /v1/auth/logout invalidates the session -- a subsequent /v1/auth/me fails", async () => {
    const signup = await request("POST", "/v1/auth/signup", { email: "logout-test@example.com", password: "correct-horse" });
    const cookie = cookieHeaderFrom(signup.setCookie);

    const logoutRes = await request("POST", "/v1/auth/logout", undefined, cookie);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.json).toEqual({ loggedOut: true });
    expect(logoutRes.setCookie).toContain("Max-Age=0");

    const meRes = await request("GET", "/v1/auth/me", undefined, cookie);
    expect(meRes.status).toBe(401);
  });

  it("POST /v1/auth/logout with no cookie at all is a no-op 200 success, never an error", async () => {
    const res = await request("POST", "/v1/auth/logout");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ loggedOut: true });
  });

  it("no auth response ever leaks a raw session token twice, or any password-related field", async () => {
    const signup = await request("POST", "/v1/auth/signup", { email: "leak-test@example.com", password: "correct-horse" });
    const bodyText = JSON.stringify(signup.json);
    expect(bodyText).not.toContain("password");
    expect(bodyText).not.toContain("sessionToken");
    expect(bodyText).not.toContain("tokenHash");
  });

  it("an unrelated /v1/* route is unaffected by the auth route table (no regression)", async () => {
    const res = await request("GET", "/v1/does-not-exist");
    expect(res.status).toBe(404);
  });
});
