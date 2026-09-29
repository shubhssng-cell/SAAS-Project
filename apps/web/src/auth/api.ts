import { API_BASE_URL } from "../config.js";
import { mapAuthApiErrorCode, NETWORK_FAILURE, type AuthFailure } from "./failureMapping.js";
import type { StudentAccountDto } from "./authState.js";

/**
 * The ONLY place `apps/web` talks to the auth/onboarding HTTP boundary
 * (`/v1/auth/*` from Product Phase 1 Unit 4, `/v1/onboarding/complete`
 * from Unit 6 -- both `@ipmat/auth-api` over `apps/api`, both
 * cookie-authenticated the same way). Uses the EXISTING endpoints
 * exactly, never a duplicate. The browser never reads or stores the
 * session token itself -- it is an
 * `HttpOnly` cookie the browser's own cookie jar handles automatically;
 * `credentials: "include"` is the only thing this file does with it.
 *
 * `fetchImpl` is an injectable seam (defaults to the real global `fetch`)
 * so this file's request-shape/response-mapping logic can be unit-tested
 * with a fake implementation, without a DOM or a real network call --
 * mirrors the "caller supplies `now`" testing-seam convention the backend
 * packages already use throughout this codebase.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type AuthApiResult = { ok: true; student: StudentAccountDto } | { ok: false; failure: AuthFailure };
export type LogoutResult = { ok: true } | { ok: false; failure: AuthFailure };

function readErrorBody(body: unknown): { code?: string; message?: string } {
  if (typeof body !== "object" || body === null) return {};
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return {};
  const { code, message } = error as { code?: unknown; message?: unknown };
  return { code: typeof code === "string" ? code : undefined, message: typeof message === "string" ? message : undefined };
}

async function request(fetchImpl: FetchLike, method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: true; body: unknown } | { ok: false; failure: AuthFailure }> {
  let res: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    res = await fetchImpl(`${API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    // A thrown fetch (offline, DNS failure, connection refused, CORS misconfiguration) is a
    // genuinely different problem than a 401 -- never silently treated as "not authenticated."
    return { ok: false, failure: NETWORK_FAILURE };
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = await res.json();
  } catch {
    parsedBody = null;
  }

  if (!res.ok) {
    const { code, message } = readErrorBody(parsedBody);
    return { ok: false, failure: mapAuthApiErrorCode(code, message) };
  }
  return { ok: true, body: parsedBody };
}

function readStudent(body: unknown): StudentAccountDto | null {
  if (typeof body !== "object" || body === null) return null;
  const student = (body as { student?: unknown }).student;
  if (typeof student !== "object" || student === null) return null;
  const { id, email, createdAt, onboardingCompletedAt } = student as Record<string, unknown>;
  if (typeof id !== "string" || typeof email !== "string" || typeof createdAt !== "string") return null;
  if (onboardingCompletedAt !== null && typeof onboardingCompletedAt !== "string") return null;
  return { id, email, createdAt, onboardingCompletedAt: onboardingCompletedAt ?? null };
}

async function authApiResult(fetchImpl: FetchLike, method: "GET" | "POST", path: string, body?: unknown): Promise<AuthApiResult> {
  const result = await request(fetchImpl, method, path, body);
  if (!result.ok) return result;
  const student = readStudent(result.body);
  if (!student) return { ok: false, failure: { kind: "unexpected", message: "Something went wrong. Please try again." } };
  return { ok: true, student };
}

export function apiSignup(input: { email: string; password: string }, fetchImpl: FetchLike = fetch): Promise<AuthApiResult> {
  return authApiResult(fetchImpl, "POST", "/v1/auth/signup", input);
}

export function apiLogin(input: { email: string; password: string }, fetchImpl: FetchLike = fetch): Promise<AuthApiResult> {
  return authApiResult(fetchImpl, "POST", "/v1/auth/login", input);
}

export function apiMe(fetchImpl: FetchLike = fetch): Promise<AuthApiResult> {
  return authApiResult(fetchImpl, "GET", "/v1/auth/me");
}

export async function apiLogout(fetchImpl: FetchLike = fetch): Promise<LogoutResult> {
  const result = await request(fetchImpl, "POST", "/v1/auth/logout");
  return result.ok ? { ok: true } : { ok: false, failure: result.failure };
}

/** Product Phase 1 Unit 6 -- the student is derived server-side from the session cookie; this call carries no body and no studentId of any kind. */
export function apiCompleteOnboarding(fetchImpl: FetchLike = fetch): Promise<AuthApiResult> {
  return authApiResult(fetchImpl, "POST", "/v1/onboarding/complete");
}
