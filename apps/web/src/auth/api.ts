import { jsonRequest, type FetchLike } from "../http.js";
import type { AuthFailure } from "./failureMapping.js";
import type { StudentAccountDto } from "./authState.js";

/**
 * The ONLY place `apps/web` talks to the auth/onboarding HTTP boundary
 * (`/v1/auth/*` from Product Phase 1 Unit 4, `/v1/onboarding/complete`
 * from Unit 6 -- both `@ipmat/auth-api` over `apps/api`, both
 * cookie-authenticated the same way). Uses the EXISTING endpoints
 * exactly, never a duplicate. The browser never reads or stores the
 * session token itself -- it is an `HttpOnly` cookie the browser's own
 * cookie jar handles automatically; `credentials: "include"` (in the
 * shared `jsonRequest()`, `../http.ts`) is the only thing ever done with
 * it. The generic fetch/error-mapping plumbing lives in `../http.ts`,
 * shared with `../enrollment/api.ts` (Unit 7) rather than duplicated.
 */
export type { FetchLike };

export type AuthApiResult = { ok: true; student: StudentAccountDto } | { ok: false; failure: AuthFailure };
export type LogoutResult = { ok: true } | { ok: false; failure: AuthFailure };

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
  const result = await jsonRequest(fetchImpl, method, path, body);
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
  const result = await jsonRequest(fetchImpl, "POST", "/v1/auth/logout");
  return result.ok ? { ok: true } : { ok: false, failure: result.failure };
}

/** Product Phase 1 Unit 6 -- the student is derived server-side from the session cookie; this call carries no body and no studentId of any kind. */
export function apiCompleteOnboarding(fetchImpl: FetchLike = fetch): Promise<AuthApiResult> {
  return authApiResult(fetchImpl, "POST", "/v1/onboarding/complete");
}
