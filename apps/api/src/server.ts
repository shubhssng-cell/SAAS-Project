import { AuthApiError, AuthApiService, type AuthApiDependencies } from "@ipmat/auth-api";
import { EnrollmentApiError, EnrollmentApiService, type EnrollmentApiDependencies } from "@ipmat/enrollment-api";
import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PracticeApiError, PracticeApiService, type PracticeApiDependencies, type StudentRequestClaim } from "@ipmat/practice-api";

/**
 * Product Phase 1 Unit 10 (real web/API integration) -- the six practice
 * routes below used to accept `studentId`/`enrollmentId` as plain,
 * unauthenticated request fields (`StudentRequestClaim` was, until this
 * unit, literally "whatever the caller says it is" -- documented in
 * `@ipmat/practice-api`'s own `StudentRequestClaim` doc comment as
 * "explicitly future work (D-004, still open)"). D-004 has since been
 * resolved (Unit 4) and every other authenticated route in this file
 * already derives identity from the session cookie -- this unit closes
 * that same gap here, the same way, rather than shipping a real HTTP
 * client that would otherwise have to send a browser-chosen studentId to
 * a production endpoint. `resolvePracticeClaim()` is the ONE place this
 * happens: it resolves `studentId` via the EXISTING `getCurrentSession()`
 * (identical to `resolveAuthenticatedStudentId()` below) and `enrollmentId`
 * via the EXISTING `EnrollmentApiService.getCurrentEnrollment()` -- no new
 * auth mechanism, no change to `@ipmat/practice-api`'s own `StudentRequestClaim`
 * shape or any of its six methods, which still receive exactly the same
 * claim shape as before, just from a trustworthy source now.
 */

/**
 * The ONE, minimal HTTP transport for the application/API boundary
 * (docs/project-memory/70_API_AND_APPLICATION_LAYER.md). This file
 * contains NO business logic — every route handler does exactly three
 * things: parse the request into a plain object, call one
 * `PracticeApiService` method, and serialize the result. Every actual
 * decision (what to recommend, whether an attempt transition is legal,
 * what a student may see) already happened inside `@ipmat/practice-api` —
 * this file never reaches into `@ipmat/training-recommendation`,
 * `@ipmat/practice-loop`, or any lower layer directly (K).
 *
 * Uses Node's built-in `node:http` only — no Express/Fastify/Next.js —
 * since no API framework existed anywhere in this repository before this
 * unit and none is required for a public contract this small (F). A
 * later unit is free to put a real framework or Next.js in front of this
 * same `PracticeApiService` without changing it at all.
 *
 * Versioned under `/v1` (F: "keep the public contract minimal and
 * versionable"). Every practice route below is now cookie-authenticated
 * (Product Phase 1 Unit 10, see the doc comment above) — `studentId`/
 * `enrollmentId` are resolved server-side via `resolvePracticeClaim()`,
 * never read from the request. `questionId`/`attemptId`/`chosenAnswer` are
 * still read as plain request fields; there is nothing sensitive about
 * trusting a caller's own claimed `questionId`/`chosenAnswer` the way
 * there was about trusting their claimed *identity* — `@ipmat/practice-api`
 * independently verifies ownership/state for every one of these.
 *
 * `now` is NEVER read from a request anywhere in this file — see
 * `@ipmat/practice-api`'s own `PracticeApiService` doc comment for why
 * accepting a client-supplied `now` would be a real, exploitable gap
 * (duration manipulation).
 *
 * Every raw field pulled off a request is read as a string ONLY (never
 * coerced, never trusted as non-empty) — malformed/missing input reaches
 * `PracticeApiService`'s own `assertValidClaim()`/`assertNonEmptyString()`
 * exactly as `""`, which those functions already reject with
 * `invalid_request` — this file performs no validation of its own.
 */

interface RouteParams {
  attemptId: string;
}

type Handler = (service: PracticeApiService, claim: StudentRequestClaim, body: Record<string, unknown>, query: URLSearchParams, params: RouteParams) => Promise<unknown>;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (raw === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new PracticeApiError("invalid_request", "The request body was not valid JSON.", 400));
      }
    });
    req.on("error", reject);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Reads one field as a string, defaulting to `""` when missing/non-string — never `undefined`, so every downstream `assertNonEmptyString()` call sees a consistent, always-rejectable shape for malformed input, and never throws on `undefined` itself. */
function stringField(body: Record<string, unknown>, query: URLSearchParams, field: string): string {
  const bodyValue = body[field];
  if (typeof bodyValue === "string") return bodyValue;
  return query.get(field) ?? "";
}

const ROUTES: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  {
    method: "POST",
    pattern: /^\/v1\/recommendation$/,
    handler: async (service, claim) => service.getNextRecommendation(claim)
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts$/,
    handler: async (service, claim, body, query) => service.startAttempt(claim, { questionId: stringField(body, query, "questionId") })
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts\/([^/]+)\/submit$/,
    handler: async (service, claim, body, query, params) =>
      service.submitAttempt(claim, {
        attemptId: params.attemptId,
        questionId: stringField(body, query, "questionId"),
        chosenAnswer: stringField(body, query, "chosenAnswer")
      })
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts\/([^/]+)\/skip$/,
    handler: async (service, claim, body, query, params) => service.skipAttempt(claim, { attemptId: params.attemptId, questionId: stringField(body, query, "questionId") })
  },
  {
    method: "GET",
    pattern: /^\/v1\/attempts\/([^/]+)\/result$/,
    handler: async (service, claim, body, query, params) => service.getAttemptResult(claim, { attemptId: params.attemptId })
  },
  {
    method: "GET",
    pattern: /^\/v1\/attempts\/([^/]+)\/autopsy$/,
    handler: async (service, claim, body, query, params) => service.getAutopsyForConfirmation(claim, { attemptId: params.attemptId })
  }
];

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

/** E — the transport-level half of safe error mapping: takes whatever `PracticeApiError` the application layer already produced (or wraps an unrecognized throw the same defensive way) and writes it as `{ error: { code, message } }` — never a stack trace, never a raw Node/driver error string. */
function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof AuthApiError || error instanceof EnrollmentApiError) {
    sendJson(res, error.httpStatus, { error: { code: error.code, message: error.message } });
    return;
  }
  const apiError = error instanceof PracticeApiError ? error : new PracticeApiError("infrastructure_failure", "An unexpected error occurred. Please try again.", 500);
  sendJson(res, apiError.httpStatus, { error: { code: apiError.code, message: apiError.message } });
}

/**
 * Product Phase 1 Unit 4 (Authentication Architecture) -- cookie handling
 * for the four `/v1/auth/*` routes below. See
 * docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md's Unit 4 architecture
 * section for the full session-model rationale (server-authoritative,
 * opaque bearer token, never a JWT). `SESSION_COOKIE_NAME`'s value is the
 * RAW session token -- `AuthApiService` itself never sees or stores it raw
 * beyond the one moment it issues it; only `hashSessionToken()`'s digest is
 * ever persisted.
 */
const SESSION_COOKIE_NAME = "session_token";

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const name = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

/** `Secure` is gated on `NODE_ENV === "production"` -- a real deployment sits behind TLS termination; requiring `Secure` unconditionally would break local `http://localhost` development. */
function cookieAttributes(maxAgeSeconds: number): string {
  const attrs = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

function sessionCookieHeader(token: string, expiresAt: string): string {
  const maxAgeSeconds = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(maxAgeSeconds)}`;
}

function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(0)}`;
}

function sendJsonWithCookie(res: ServerResponse, status: number, payload: unknown, setCookieHeader: string): void {
  const json = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "set-cookie": setCookieHeader });
  res.end(json);
}

/**
 * `enrollmentService` (Product Phase 1 Unit 7) is threaded through every
 * `AUTH_ROUTES` handler alongside `authService` — most ignore it, the two
 * `/v1/enrollment` handlers use it. Kept in the SAME route table/handler
 * shape as auth/onboarding rather than a parallel one, since every route
 * here shares the identical cookie-authentication mechanism.
 */
type AuthHandler = (
  authService: AuthApiService,
  enrollmentService: EnrollmentApiService,
  body: Record<string, unknown>,
  cookies: Record<string, string>
) => Promise<{ status: number; body: unknown; setCookieHeader?: string }>;

/** Reads a field from the JSON body only (never the query string — every auth route is a POST with a body, or a cookie-only GET) — same always-a-string, never-`undefined` shape `stringField()` gives the existing routes, so `assertNonEmptyString()` sees a consistently rejectable value for malformed input. */
function bodyStringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  return typeof value === "string" ? value : "";
}

/**
 * The ONE place a session cookie is turned into a verified `studentId` for
 * a route OTHER than `/v1/auth/*` itself (Product Phase 1 Unit 7) —
 * reuses the EXISTING `AuthApiService.getCurrentSession()` rather than
 * re-implementing session verification a second time. Every downstream
 * service (here, `EnrollmentApiService`) then receives only this
 * already-verified `studentId` as a plain, trusted parameter — never a
 * client-supplied one from the request body.
 */
async function resolveAuthenticatedStudentId(authService: AuthApiService, cookies: Record<string, string>): Promise<string> {
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (!sessionToken) {
    throw new AuthApiError("not_authenticated", "You are not logged in.", 401);
  }
  const { student } = await authService.getCurrentSession({ sessionToken });
  return student.id;
}

/**
 * The ONE place a session cookie is turned into a verified `StudentRequestClaim`
 * for the six practice routes (Product Phase 1 Unit 10) — reuses
 * `resolveAuthenticatedStudentId()` for `studentId` (identical mechanism to
 * `/v1/enrollment`) and the EXISTING `EnrollmentApiService.getCurrentEnrollment()`
 * for `enrollmentId` — never a client-supplied value for either field. A
 * student with no current enrollment gets a clean `invalid_state` (409),
 * never a crash or a fabricated enrollment id; the frontend's own
 * `EnrollmentGate` already prevents an unenrolled student from reaching
 * these routes in the ordinary product flow, so this is a defensive
 * boundary, not the primary one.
 */
async function resolvePracticeClaim(authService: AuthApiService, enrollmentService: EnrollmentApiService, cookies: Record<string, string>): Promise<StudentRequestClaim> {
  const studentId = await resolveAuthenticatedStudentId(authService, cookies);
  const { enrollment } = await enrollmentService.getCurrentEnrollment({ studentId });
  if (!enrollment) {
    throw new PracticeApiError("invalid_state", "You need to complete enrollment before practicing.", 409);
  }
  return { studentId, enrollmentId: enrollment.id };
}

const AUTH_ROUTES: Array<{ method: string; pattern: RegExp; handler: AuthHandler }> = [
  {
    method: "POST",
    pattern: /^\/v1\/auth\/signup$/,
    handler: async (authService, _enrollmentService, body) => {
      const result = await authService.signup({ email: bodyStringField(body, "email"), password: bodyStringField(body, "password") });
      return { status: 200, body: { student: result.student }, setCookieHeader: sessionCookieHeader(result.sessionToken, result.expiresAt) };
    }
  },
  {
    method: "POST",
    pattern: /^\/v1\/auth\/login$/,
    handler: async (authService, _enrollmentService, body) => {
      const result = await authService.login({ email: bodyStringField(body, "email"), password: bodyStringField(body, "password") });
      return { status: 200, body: { student: result.student }, setCookieHeader: sessionCookieHeader(result.sessionToken, result.expiresAt) };
    }
  },
  {
    method: "GET",
    pattern: /^\/v1\/auth\/me$/,
    handler: async (authService, _enrollmentService, _body, cookies) => {
      const sessionToken = cookies[SESSION_COOKIE_NAME];
      // No cookie at all is the ordinary "not logged in" case -- handled here,
      // before the service, so it never reaches AuthApiService.getCurrentSession()'s
      // own `assertNonEmptyString()` guard (which exists for a malformed/blank
      // token, a different case) and never produces `invalid_request` for what is
      // simply an unauthenticated visitor.
      if (!sessionToken) {
        throw new AuthApiError("not_authenticated", "You are not logged in.", 401);
      }
      const result = await authService.getCurrentSession({ sessionToken });
      return { status: 200, body: { student: result.student } };
    }
  },
  {
    method: "POST",
    pattern: /^\/v1\/auth\/logout$/,
    handler: async (authService, _enrollmentService, _body, cookies) => {
      const sessionToken = cookies[SESSION_COOKIE_NAME];
      // No cookie at all: already logged out, a no-op success -- same principle
      // as logging out an already-invalid token (see AuthApiService.logout()'s
      // own doc comment), just short-circuited before the service since there is
      // no token to even hash and look up.
      if (!sessionToken) {
        return { status: 200, body: { loggedOut: true }, setCookieHeader: clearSessionCookieHeader() };
      }
      await authService.logout({ sessionToken });
      return { status: 200, body: { loggedOut: true }, setCookieHeader: clearSessionCookieHeader() };
    }
  },
  {
    // Product Phase 1 Unit 6 (Onboarding) -- not literally under /v1/auth/*, but
    // authenticated by the EXACT SAME session cookie mechanism as every route
    // above, so it lives in this same table rather than a parallel one. The
    // student being updated is derived entirely from the verified session
    // (AuthApiService.completeOnboarding() -> resolveAuthenticatedStudent()) --
    // the request body is never read for an identity.
    method: "POST",
    pattern: /^\/v1\/onboarding\/complete$/,
    handler: async (authService, _enrollmentService, _body, cookies) => {
      const sessionToken = cookies[SESSION_COOKIE_NAME];
      if (!sessionToken) {
        throw new AuthApiError("not_authenticated", "You are not logged in.", 401);
      }
      const result = await authService.completeOnboarding({ sessionToken });
      return { status: 200, body: { student: result.student } };
    }
  },
  {
    // Product Phase 1 Unit 7 (IPMAT Enrollment) -- same cookie-authentication
    // mechanism as every route above. `resolveAuthenticatedStudentId()` reuses
    // the EXISTING `getCurrentSession()` call, never a client-supplied
    // studentId from the request body (there is none to read -- POST /v1/enrollment
    // takes no body at all).
    method: "GET",
    pattern: /^\/v1\/enrollment$/,
    handler: async (authService, enrollmentService, _body, cookies) => {
      const studentId = await resolveAuthenticatedStudentId(authService, cookies);
      const result = await enrollmentService.getCurrentEnrollment({ studentId });
      return { status: 200, body: result };
    }
  },
  {
    method: "POST",
    pattern: /^\/v1\/enrollment$/,
    handler: async (authService, enrollmentService, _body, cookies) => {
      const studentId = await resolveAuthenticatedStudentId(authService, cookies);
      const result = await enrollmentService.enroll({ studentId });
      return { status: 200, body: result };
    }
  }
];

/**
 * Constructs a plain `http.Server` for the given, already-wired
 * dependencies — this function performs NO wiring of its own (see
 * `wiring.ts` for that; `createServer` never imports `@ipmat/db`'s
 * concrete repository classes directly, only the port interfaces
 * `PracticeApiDependencies`/`AuthApiDependencies`/`EnrollmentApiDependencies`
 * already require).
 *
 * `/v1/auth/*` (Product Phase 1 Unit 4) is checked as a SEPARATE route
 * table from `ROUTES` — the two never overlap in pattern.
 * `/v1/onboarding/complete` (Unit 6) and `/v1/enrollment` (Unit 7) share
 * that same table, since both are cookie-authenticated the same way.
 * `ROUTES` (the six practice operations) is its own dispatch branch below —
 * each one is ALSO cookie-authenticated as of Product Phase 1 Unit 10, via
 * `resolvePracticeClaim()`, but keeps its own `Handler` shape (still
 * receives `body`/`query`/`params` for `questionId`/`attemptId`/
 * `chosenAnswer`, unlike the auth/enrollment table) rather than being
 * folded into `AUTH_ROUTES`.
 */
export function createServer(deps: PracticeApiDependencies & AuthApiDependencies & EnrollmentApiDependencies) {
  const service = new PracticeApiService(deps);
  const authService = new AuthApiService(deps);
  const enrollmentService = new EnrollmentApiService(deps);

  return createNodeServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const method = req.method ?? "GET";

        const authRoute = AUTH_ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));
        if (authRoute) {
          const cookies = parseCookies(req.headers.cookie);
          const body = method === "GET" ? {} : asRecord(await readJsonBody(req));
          const result = await authRoute.handler(authService, enrollmentService, body, cookies);
          if (result.setCookieHeader) {
            sendJsonWithCookie(res, result.status, result.body, result.setCookieHeader);
          } else {
            sendJson(res, result.status, result.body);
          }
          return;
        }

        const route = ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));

        if (!route) {
          sendError(res, new PracticeApiError("not_found", "No matching route.", 404));
          return;
        }

        const match = route.pattern.exec(url.pathname);
        const params: RouteParams = { attemptId: match?.[1] ?? "" };
        const body = method === "GET" ? {} : asRecord(await readJsonBody(req));
        const cookies = parseCookies(req.headers.cookie);
        const claim = await resolvePracticeClaim(authService, enrollmentService, cookies);

        const result = await route.handler(service, claim, body, url.searchParams, params);
        sendJson(res, 200, result);
      } catch (error) {
        sendError(res, error);
      }
    })();
  });
}
