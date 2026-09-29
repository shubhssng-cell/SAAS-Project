import { describe, expect, it } from "vitest";
import { apiLogin, apiLogout, apiMe, apiSignup, type FetchLike } from "../../src/auth/api.js";

const STUDENT_BODY = { student: { id: "student-1", email: "student@example.com", createdAt: "2026-09-29T00:00:00.000Z" } };

function fakeFetch(response: { ok: boolean; status: number; body: unknown }): { calls: Array<{ url: string; init?: RequestInit }>; fetchImpl: FetchLike } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  return { calls, fetchImpl };
}

function throwingFetch(): { fetchImpl: FetchLike } {
  return {
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    }
  };
}

describe("apiMe", () => {
  it("returns ok:true with the student on 200", async () => {
    const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: STUDENT_BODY });
    const result = await apiMe(fetchImpl);
    expect(result).toEqual({ ok: true, student: STUDENT_BODY.student });
  });

  it("returns not_authenticated on 401", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 401, body: { error: { code: "not_authenticated", message: "You are not logged in." } } });
    const result = await apiMe(fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "not_authenticated" } });
  });

  it("returns network_error when fetch itself throws -- distinct from a 401, never silently 'unauthenticated'", async () => {
    const { fetchImpl } = throwingFetch();
    const result = await apiMe(fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "network_error" } });
  });

  it("sends credentials: 'include' -- relies on the browser's own cookie jar, never a manually-read token", async () => {
    const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: STUDENT_BODY });
    await apiMe(fetchImpl);
    expect(calls[0]?.init?.credentials).toBe("include");
  });

  it("makes a GET request with no body to /v1/auth/me", async () => {
    const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: STUDENT_BODY });
    await apiMe(fetchImpl);
    expect(calls[0]?.url).toMatch(/\/v1\/auth\/me$/);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.body).toBeUndefined();
  });
});

describe("apiSignup", () => {
  it("posts email/password as JSON to /v1/auth/signup with credentials included", async () => {
    const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: STUDENT_BODY });
    await apiSignup({ email: "student@example.com", password: "correct-horse" }, fetchImpl);

    expect(calls[0]?.url).toMatch(/\/v1\/auth\/signup$/);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ email: "student@example.com", password: "correct-horse" }));
  });

  it("maps a 409 to email_already_registered", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 409, body: { error: { code: "email_already_registered", message: "An account with this email already exists." } } });
    const result = await apiSignup({ email: "dup@example.com", password: "correct-horse" }, fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "email_already_registered", message: "An account with this email already exists." } });
  });

  it("maps a 400 to validation with the server's message", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 400, body: { error: { code: "invalid_request", message: "Enter a valid email address." } } });
    const result = await apiSignup({ email: "not-an-email", password: "x" }, fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "validation", message: "Enter a valid email address." } });
  });
});

describe("apiLogin", () => {
  it("returns ok:true with the student on success", async () => {
    const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: STUDENT_BODY });
    const result = await apiLogin({ email: "student@example.com", password: "correct-horse" }, fetchImpl);
    expect(result).toEqual({ ok: true, student: STUDENT_BODY.student });
  });

  it("maps a 401 to invalid_credentials with the generic message, regardless of the server's own message text", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 401, body: { error: { code: "invalid_credentials", message: "anything the server said" } } });
    const result = await apiLogin({ email: "student@example.com", password: "wrong" }, fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "invalid_credentials", message: "Incorrect email or password." } });
  });
});

describe("apiLogout", () => {
  it("posts to /v1/auth/logout with credentials included and no body", async () => {
    const { calls, fetchImpl } = fakeFetch({ ok: true, status: 200, body: { loggedOut: true } });
    const result = await apiLogout(fetchImpl);
    expect(result).toEqual({ ok: true });
    expect(calls[0]?.url).toMatch(/\/v1\/auth\/logout$/);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("reports network_error if the request itself fails", async () => {
    const { fetchImpl } = throwingFetch();
    const result = await apiLogout(fetchImpl);
    expect(result).toEqual({ ok: false, failure: { kind: "network_error" } });
  });
});
