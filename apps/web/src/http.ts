import { API_BASE_URL } from "./config.js";
import { mapAuthApiErrorCode, NETWORK_FAILURE, type AuthFailure } from "./auth/failureMapping.js";

/**
 * The generic, shared fetch/error-mapping plumbing behind EVERY
 * `apps/web` -> `apps/api` call (`/v1/auth/*`, `/v1/onboarding/complete`,
 * `/v1/enrollment` — extracted here in Product Phase 1 Unit 7 so
 * `auth/api.ts` and the new `enrollment/api.ts` share one implementation
 * instead of two copies of the same cookie-inclusion/error-parsing logic).
 * `AuthFailure`'s codes are transport-level API error codes (`invalid_request`,
 * `not_authenticated`, `infrastructure_failure`, etc.) — general to this
 * whole HTTP boundary, not specific to authentication, despite living
 * next to `auth/`'s other files historically.
 *
 * `fetchImpl` is an injectable seam (defaults to the real global `fetch`)
 * so callers' request-shape/response-mapping logic can be unit-tested
 * with a fake implementation, without a DOM or a real network call.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type JsonRequestResult = { ok: true; body: unknown } | { ok: false; failure: AuthFailure };

function readErrorBody(body: unknown): { code?: string; message?: string } {
  if (typeof body !== "object" || body === null) return {};
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return {};
  const { code, message } = error as { code?: unknown; message?: unknown };
  return { code: typeof code === "string" ? code : undefined, message: typeof message === "string" ? message : undefined };
}

export async function jsonRequest(fetchImpl: FetchLike, method: "GET" | "POST", path: string, body?: unknown): Promise<JsonRequestResult> {
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
