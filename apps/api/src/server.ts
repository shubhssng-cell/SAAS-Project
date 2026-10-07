import { newRequestId, runWithContext, studentRef, updateContext, type RequestContext } from "@ipmat/observability";
import { HttpLimitError, SESSION_TOKEN_SHAPE, checkOrigin, clientAddress, createRuntime, isDatabaseUnavailable, readBoundedBody, routeTemplate, securityHeaders, type ApiRuntime, type RateBucket } from "./hardening.js";
import { AssistantApiError, type AssistantServices, type StudentClaim as AssistantClaim } from "@ipmat/assistant-api";
import { AuthApiError, AuthApiService, type AuthApiDependencies } from "@ipmat/auth-api";
import type { FeatureId, MeterId } from "@ipmat/billing";
import { BillingApiError, type CommerceServices } from "@ipmat/billing-api";
import { EnrollmentApiError, EnrollmentApiService, type EnrollmentApiDependencies } from "@ipmat/enrollment-api";
import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PracticeApiError, PracticeApiService, TrainingApiService, type PracticeApiDependencies, type StudentRequestClaim, type TrainingApiDependencies } from "@ipmat/practice-api";

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

/** The one path capture of a route: an attempt id for `/v1/attempts/:id/*`, a training session id for `/v1/training/sessions/:id/*`. */
interface RouteParams {
  id: string;
}

type Handler = (service: PracticeApiService, claim: StudentRequestClaim, body: Record<string, unknown>, query: URLSearchParams, params: RouteParams) => Promise<unknown>;

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const raw = await readBoundedBody(req, maxBytes);
  if (raw === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new PracticeApiError("invalid_request", "The request body was not valid JSON.", 400);
  }
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
        attemptId: params.id,
        questionId: stringField(body, query, "questionId"),
        chosenAnswer: stringField(body, query, "chosenAnswer")
      })
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts\/([^/]+)\/skip$/,
    handler: async (service, claim, body, query, params) => service.skipAttempt(claim, { attemptId: params.id, questionId: stringField(body, query, "questionId") })
  },
  {
    method: "GET",
    pattern: /^\/v1\/attempts\/([^/]+)\/result$/,
    handler: async (service, claim, body, query, params) => service.getAttemptResult(claim, { attemptId: params.id })
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts\/([^/]+)\/hypothesis$/,
    handler: async (service, claim, body, query, params) => service.generateHypothesis(claim, { attemptId: params.id })
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts\/([^/]+)\/hypothesis\/response$/,
    handler: async (service, claim, body, query, params) => {
      const type = stringField(body, query, "response");
      const response = type === "corrected" ? { type: "corrected" as const, correctedExplanation: stringField(body, query, "correctedExplanation") } : { type: type as "confirmed" | "rejected" };
      return service.respondToHypothesis(claim, { attemptId: params.id, token: stringField(body, query, "token"), response });
    }
  },
  {
    method: "GET",
    pattern: /^\/v1\/attempts\/([^/]+)\/evidence$/,
    handler: async (service, claim, body, query, params) => service.getAttemptEvidence(claim, { attemptId: params.id })
  },
  {
    method: "GET",
    pattern: /^\/v1\/attempts\/([^/]+)\/autopsy$/,
    handler: async (service, claim, body, query, params) => service.getAutopsyForConfirmation(claim, { attemptId: params.id })
  }
];

type TrainingHandler = (training: TrainingApiService, claim: StudentRequestClaim, body: Record<string, unknown>, query: URLSearchParams, params: RouteParams) => Promise<unknown>;

/**
 * Phase 5 Unit 1 -- the Training Session routes. Same cookie-derived claim as every practice route; `studentId`/`enrollmentId`
 * are never read from the request, and neither is a clock or a block id. A session's questions are answered through the
 * EXISTING `/v1/attempts/*` routes -- there is no second attempt endpoint.
 */
const TRAINING_ROUTES: Array<{ method: string; pattern: RegExp; handler: TrainingHandler }> = [
  { method: "GET", pattern: /^\/v1\/training\/systems$/, handler: async (training, claim) => training.getHub(claim) },
  {
    method: "POST",
    pattern: /^\/v1\/training\/sessions$/,
    handler: async (training, claim, body, query) => training.startSession(claim, { systemId: stringField(body, query, "systemId"), config: body.config })
  },
  { method: "GET", pattern: /^\/v1\/training\/sessions\/([^/]+)$/, handler: async (training, claim, _body, _query, params) => training.getSession(claim, { sessionId: params.id }) },
  { method: "POST", pattern: /^\/v1\/training\/sessions\/([^/]+)\/next$/, handler: async (training, claim, _body, _query, params) => training.nextQuestion(claim, { sessionId: params.id }) },
  { method: "POST", pattern: /^\/v1\/training\/sessions\/([^/]+)\/finish$/, handler: async (training, claim, _body, _query, params) => training.finishSession(claim, { sessionId: params.id }) }
];

type AssistantHandler = (services: AssistantServices, claim: AssistantClaim, body: Record<string, unknown>, params: string[]) => Promise<unknown>;

const notConfigured = (what: string): AssistantApiError => new AssistantApiError("not_available", `${what} isn't available right now.`, 503);
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AssistantApiError("invalid_request", "The request path is malformed.", 400);
  }
}
const simulationOf = (s: AssistantServices) => s.simulation ?? (() => { throw notConfigured("Simulations are"); })();

/**
 * Phase 9 Unit 2 (D-098) -- the tutor, preferences and simulation routes. Same cookie-derived claim as every practice route
 * (`resolvePracticeClaim`): `studentId`/`enrollmentId` are never read from a request, and neither is a clock, a task, a capability,
 * a workflow, an actor, a role or an exam code. Each handler calls ONE application-service method; there is no business logic here.
 * There is deliberately NO route for question generation (no staff identity exists to authorize one) and none for the Phase 7
 * intelligence results (no student-facing presentation is defined).
 */
/**
 * Phase 9 Unit 4 (D-100): which routes are commercially gated, declared as DATA next to the route. The handler never reads billing
 * state - `CommerceGuard` does, and only the existing application service runs once it says yes. `settle` decides, from the
 * service's own result, whether the reserved usage unit was delivered (`consumed`) or not (`released`).
 */
interface Commercial {
  feature: FeatureId;
  meter?: MeterId;
  settle?: (result: unknown) => "consumed" | "released";
}

/** A tutor reply that never reached the student because of the provider (not the student's usage) gives the unit back. */
const NOT_DELIVERED_CODES = new Set(["temporarily_unavailable", "not_available"]);
const settleTutor = (result: unknown): "consumed" | "released" => {
  const r = result as { status?: unknown; failure?: { code?: unknown } | null } | null;
  return r?.status === "answered" || !(typeof r?.failure?.code === "string" && NOT_DELIVERED_CODES.has(r.failure.code)) ? "consumed" : "released";
};

/** Starting while one is already in progress returns that simulation (`created: false`) -- not a new start, so the reserved unit is given back. */
const settleSimulationStart = (result: unknown): "consumed" | "released" => ((result as { created?: unknown } | null)?.created === false ? "released" : "consumed");

const ASSISTANT_ROUTES: Array<{ method: string; pattern: RegExp; handler: AssistantHandler; limit?: RateBucket; gate?: boolean; commercial?: Commercial }> = [
  { method: "POST", pattern: /^\/v1\/tutor\/ask$/, handler: async (s, claim, body) => s.tutor.ask(claim, body), limit: "tutor", gate: true, commercial: { feature: "tutor", meter: "tutor_request", settle: settleTutor } },
  { method: "GET", pattern: /^\/v1\/preferences$/, handler: async (s, claim) => s.preferences.get(claim) },
  { method: "PUT", pattern: /^\/v1\/preferences$/, handler: async (s, claim, body) => s.preferences.update(claim, body), limit: "preferences_write" },
  // Only STARTING a simulation is gated: one already begun can still be answered and submitted, so a lapse mid-exam never discards a student's work.
  { method: "POST", pattern: /^\/v1\/simulations$/, handler: async (s, claim) => simulationOf(s).start(claim), limit: "simulation_write", commercial: { feature: "simulation", meter: "simulation_start", settle: settleSimulationStart } },
  // Registered BEFORE the `:id` route below, or "availability" would be read as a simulation id.
  { method: "GET", pattern: /^\/v1\/simulations\/availability$/, handler: async (s, claim) => simulationOf(s).availability(claim) },
  { method: "GET", pattern: /^\/v1\/simulations\/([^/]+)$/, handler: async (s, claim, _b, p) => simulationOf(s).get(claim, p[0] ?? "") },
  { method: "GET", pattern: /^\/v1\/simulations\/([^/]+)\/questions\/([^/]+)$/, handler: async (s, claim, _b, p) => simulationOf(s).question(claim, p[0] ?? "", p[1]) },
  { method: "POST", pattern: /^\/v1\/simulations\/([^/]+)\/answers$/, handler: async (s, claim, body, p) => simulationOf(s).answer(claim, p[0] ?? "", body), limit: "simulation_write" },
  { method: "POST", pattern: /^\/v1\/simulations\/([^/]+)\/submit$/, handler: async (s, claim, _b, p) => simulationOf(s).submit(claim, p[0] ?? ""), limit: "simulation_write" }
];

function sendJson(res: ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}): void {
  const json = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(json);
}

/** E — the transport-level half of safe error mapping: takes whatever `PracticeApiError` the application layer already produced (or wraps an unrecognized throw the same defensive way) and writes it as `{ error: { code, message } }` — never a stack trace, never a raw Node/driver error string. */
function sendError(res: ServerResponse, error: unknown): void {
  if (!(error instanceof HttpLimitError) && (error as { httpStatus?: unknown } | null)?.httpStatus === 503) {
    sendJson(res, 503, { error: { code: (error as { code?: string }).code ?? "service_unavailable", message: (error as Error).message } }, { "retry-after": "5" });
    return;
  }
  if (error instanceof HttpLimitError) {
    const headers: Record<string, string> = error.retryAfterSeconds !== undefined ? { "retry-after": String(error.retryAfterSeconds) } : {};
    if (error.httpStatus === 413) headers.connection = "close";
    sendJson(res, error.httpStatus, { error: { code: error.code, message: error.message } }, headers);
    return;
  }
  if (isDatabaseUnavailable(error)) {
    sendJson(res, 503, { error: { code: "service_unavailable", message: "The service is temporarily unavailable. Please try again shortly." } }, { "retry-after": "5" });
    return;
  }
  if (error instanceof AssistantApiError) {
    sendJson(res, error.httpStatus, { error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof BillingApiError) {
    sendJson(res, error.httpStatus, { error: { code: error.code, message: error.message } }, error.httpStatus === 503 ? { "retry-after": "5" } : {});
    return;
  }
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
    if (name) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        // a malformed cookie value is simply not a usable credential
      }
    }
  }
  return cookies;
}

/** `Secure` is gated on `NODE_ENV === "production"` -- a real deployment sits behind TLS termination; requiring `Secure` unconditionally would break local `http://localhost` development. */
function cookieAttributes(maxAgeSeconds: number): string {
  const attrs = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

/** The session token from the cookies, or `undefined` unless it has the exact shape the server issues (64 hex chars): anything else is rejected without a database lookup. */
function sessionTokenFrom(cookies: Record<string, string>): string | undefined {
  const token = cookies[SESSION_COOKIE_NAME];
  return token !== undefined && SESSION_TOKEN_SHAPE.test(token) ? token : undefined;
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
  const sessionToken = sessionTokenFrom(cookies);
  if (!sessionToken) {
    throw new AuthApiError("not_authenticated", "You are not logged in.", 401);
  }
  const { student } = await authService.getCurrentSession({ sessionToken });
  updateContext({ actorKind: "student", studentRef: studentRef(student.id) });
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
      const sessionToken = sessionTokenFrom(cookies);
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
      const sessionToken = sessionTokenFrom(cookies);
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
      const sessionToken = sessionTokenFrom(cookies);
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
export function createServer(deps: PracticeApiDependencies & AuthApiDependencies & EnrollmentApiDependencies & Pick<TrainingApiDependencies, "trainingSessionRepository" | "attemptHistoryReader"> & { assistant?: AssistantServices | null; commerce?: CommerceServices | null; runtime?: ApiRuntime }) {
  const service = new PracticeApiService(deps);
  const trainingService = new TrainingApiService({
    trainingRecommendationService: deps.trainingRecommendationService,
    trainingSessionRepository: deps.trainingSessionRepository,
    attemptHistoryReader: deps.attemptHistoryReader,
    enrollmentReader: deps.enrollmentReader,
    questionContentReader: deps.questionContentReader,
    practiceApi: service
  });
  const authService = new AuthApiService(deps);
  const enrollmentService = new EnrollmentApiService(deps);

  const runtime = deps.runtime ?? createRuntime();
  const { logger, metrics, limiter, rules, security } = runtime;

  /** Counts one request against a server-derived key; throws a 429 (with Retry-After) when over the bucket's limit. */
  function enforce(bucket: RateBucket, key: string): void {
    if (!limiter) return;
    const decision = limiter.hit(bucket, key, rules[bucket]);
    if (decision.allowed) return;
    metrics.inc("rate_limited_total", { bucket });
    logger.warn("http.rate_limited", { bucket, retryAfterSeconds: decision.retryAfterSeconds, failureCategory: "rate_limited" });
    throw new HttpLimitError("rate_limited", "Too many requests. Please wait a moment and try again.", 429, decision.retryAfterSeconds);
  }

  const server = createNodeServer((req, res) => {
    const method = req.method ?? "GET";
    let pathname = "/";
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      // an unparsable URL is handled as an unmatched route below
    }
    const started = Date.now();
    const context: RequestContext = { requestId: newRequestId(), method, route: routeTemplate(method, pathname), actorKind: "anonymous", studentRef: null, examCode: null, startedAtMs: started };
    securityHeaders(res, context.requestId, security.production);

    res.on("finish", () => {
      const latencyMs = Date.now() - started;
      metrics.inc("http_requests_total", { route: context.route, status: res.statusCode });
      metrics.observeMs("http_request_latency_ms", latencyMs, { route: context.route });
      logger.info("http.request", { requestId: context.requestId, method, route: context.route, status: res.statusCode, actorKind: context.actorKind, studentRef: context.studentRef, latencyMs });
      if (res.statusCode === 413) req.destroy();
    });

    runWithContext(context, () => {
      void (async () => {
        let releaseGate: (() => void) | null = null;
        try {
          if (method === "GET" && pathname === "/healthz") {
            sendJson(res, 200, { status: "ok" });
            return;
          }
          if (method === "GET" && pathname === "/readyz") {
            const ready = await Promise.race([runtime.readiness().catch(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000).unref())]);
            sendJson(res, ready ? 200 : 503, { status: ready ? "ready" : "not_ready" });
            return;
          }

          checkOrigin(req, security);
          const ip = clientAddress(req, security.trustProxy);
          enforce("ip", ip);

          const url = new URL(req.url ?? "/", "http://localhost");
          const authRoute = AUTH_ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));
          if (authRoute) {
            if (/^\/v1\/auth\/(signup|login)$/.test(url.pathname)) enforce("auth", ip);
            const cookies = parseCookies(req.headers.cookie);
            const body = method === "GET" ? {} : asRecord(await readJsonBody(req, security.maxBodyBytes));
            if (url.pathname === "/v1/auth/login" && typeof body.email === "string") enforce("auth_account", body.email.trim().toLowerCase().slice(0, 200));
            const result = await authRoute.handler(authService, enrollmentService, body, cookies);
            if (result.setCookieHeader) {
              sendJsonWithCookie(res, result.status, result.body, result.setCookieHeader);
            } else {
              sendJson(res, result.status, result.body);
            }
            return;
          }

          // ---- Phase 9 Unit 4: billing. Session-authenticated like every student route, but it needs only a student (not an enrollment):
          // entitlement and enrollment are separate facts. The webhook is the exception: its caller is the payment provider, authenticated
          // by the provider's signature over the raw body, never by a cookie.
          if (url.pathname === "/v1/billing/webhook" && method === "POST") {
            enforce("webhook", ip);
            const rawBody = await readBoundedBody(req, security.maxBodyBytes, { preserve: true });
            if (!deps.commerce) throw new BillingApiError("not_available", "This endpoint isn't available.", 503);
            const headers: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
            sendJson(res, 200, await deps.commerce.webhook.handle({ rawBody, headers }));
            return;
          }
          if (/^\/v1\/billing(\/(checkout|cancel))?$/.test(url.pathname) && (method === "GET" || method === "POST")) {
            const isRead = url.pathname === "/v1/billing";
            if (isRead !== (method === "GET")) {
              sendError(res, new PracticeApiError("not_found", "No matching route.", 404));
              return;
            }
            const body = method === "GET" ? {} : asRecord(await readJsonBody(req, security.maxBodyBytes));
            const studentId = await resolveAuthenticatedStudentId(authService, parseCookies(req.headers.cookie));
            enforce("api", studentId);
            if (!isRead) enforce("billing_write", studentId);
            const commerce = deps.commerce;
            if (!commerce) throw new BillingApiError("not_available", "Billing isn't available right now.", 503);
            if (url.pathname === "/v1/billing/checkout") sendJson(res, 200, await commerce.billing.startCheckout(studentId, body));
            else if (url.pathname === "/v1/billing/cancel") sendJson(res, 200, await commerce.billing.requestCancellation(studentId, body));
            else {
              const { enrollment } = await enrollmentService.getCurrentEnrollment({ studentId });
              sendJson(res, 200, await commerce.billing.getSummary(studentId, enrollment ? await commerce.examScope(studentId, enrollment.id) : null));
            }
            return;
          }

          const assistantRoute = ASSISTANT_ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));
          if (assistantRoute) {
            const match = assistantRoute.pattern.exec(url.pathname);
            const body = method === "GET" ? {} : asRecord(await readJsonBody(req, security.maxBodyBytes));
            const claim = await resolvePracticeClaim(authService, enrollmentService, parseCookies(req.headers.cookie));
            enforce("api", claim.studentId);
            if (assistantRoute.limit) enforce(assistantRoute.limit, claim.studentId);
            await deps.commerce?.guard.requireExam(claim);
            if (assistantRoute.gate) {
              releaseGate = runtime.tutorGate.acquire(claim.studentId);
              if (!releaseGate) {
                metrics.inc("rate_limited_total", { bucket: "tutor_in_flight" });
                logger.warn("http.rate_limited", { bucket: "tutor_in_flight", failureCategory: "rate_limited" });
                throw new HttpLimitError("rate_limited", "Please wait for your previous tutor request to finish.", 429, 2);
              }
            }
            if (!deps.assistant) throw notConfigured("This feature is");
            const assistant = deps.assistant;
            const run = (): Promise<unknown> => assistantRoute.handler(assistant, claim, body, match ? match.slice(1).map(safeDecode) : []);
            const commercial = assistantRoute.commercial;
            if (commercial && deps.commerce) {
              const guard = deps.commerce.guard;
              if (commercial.meter) {
                sendJson(res, 200, await guard.metered(claim, commercial.feature, commercial.meter, run, commercial.settle ?? (() => "consumed")));
              } else {
                await guard.requireFeature(claim, commercial.feature);
                sendJson(res, 200, await run());
              }
            } else {
              sendJson(res, 200, await run());
            }
            return;
          }

          const trainingRoute = TRAINING_ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));
          if (trainingRoute) {
            const match = trainingRoute.pattern.exec(url.pathname);
            const body = method === "GET" ? {} : asRecord(await readJsonBody(req, security.maxBodyBytes));
            const claim = await resolvePracticeClaim(authService, enrollmentService, parseCookies(req.headers.cookie));
            enforce("api", claim.studentId);
            await deps.commerce?.guard.requireExam(claim);
            // Starting a training session is the advanced-training feature; continuing or finishing one already begun is not re-gated.
            if (method === "POST" && url.pathname === "/v1/training/sessions") await deps.commerce?.guard.requireFeature(claim, "advanced_training");
            sendJson(res, 200, await trainingRoute.handler(trainingService, claim, body, url.searchParams, { id: match?.[1] ?? "" }));
            return;
          }

          const route = ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));

          if (!route) {
            sendError(res, new PracticeApiError("not_found", "No matching route.", 404));
            return;
          }

          const match = route.pattern.exec(url.pathname);
          const params: RouteParams = { id: match?.[1] ?? "" };
          const body = method === "GET" ? {} : asRecord(await readJsonBody(req, security.maxBodyBytes));
          const cookies = parseCookies(req.headers.cookie);
          const claim = await resolvePracticeClaim(authService, enrollmentService, cookies);
          enforce("api", claim.studentId);
          await deps.commerce?.guard.requireExam(claim);

          const result = await route.handler(service, claim, body, url.searchParams, params);
          sendJson(res, 200, result);
        } catch (error) {
          const e = error as { name?: unknown; code?: unknown; httpStatus?: unknown } | null;
          const status = typeof e?.httpStatus === "number" ? e.httpStatus : 500;
          if (status >= 500 || !(error instanceof Error)) {
            const category = isDatabaseUnavailable(error) || status === 503 ? "dependency_unavailable" : "unhandled";
            // Internal diagnostics keep the error's NAME and CODE only - never its message (it can carry SQL, paths or secrets).
            logger.error("http.error", { errorName: typeof e?.name === "string" ? e.name : "unknown", errorCode: typeof e?.code === "string" ? e.code : null, failureCategory: category });
            metrics.inc("http_errors_total", { category });
          }
          sendError(res, error);
        } finally {
          releaseGate?.();
        }
      })();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}
