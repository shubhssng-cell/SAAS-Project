import { createConcurrencyGate, createLogger, createMetrics, createRateLimiter, NOOP_LOGGER, NOOP_METRICS, type ConcurrencyGate, type Logger, type Metrics, type RateLimit, type RateLimiter } from "@ipmat/observability";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The transport-level hardening of `apps/api` (Phase 9 Unit 3, docs/DECISIONS.md D-099). Everything here is decided by the SERVER
 * from the connection and the verified session; nothing the client reports (a header, a body field, a claimed identity or usage)
 * is an input to a limit, a log field or a correlation id.
 */

/** Hard cap on a JSON request body. The largest legitimate body (a tutor request with a short prior interaction) is well under 4 KB. */
export const MAX_BODY_BYTES = 32 * 1024;

export class HttpLimitError extends Error {
  constructor(
    readonly code: "payload_too_large" | "unsupported_media_type" | "rate_limited" | "origin_not_allowed" | "service_unavailable",
    message: string,
    readonly httpStatus: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "HttpLimitError";
  }
}

// ---- rate limits ------------------------------------------------------------------------------------------------------

export type RateBucket = "ip" | "auth" | "auth_account" | "api" | "tutor" | "simulation_write" | "preferences_write";

/**
 * PROVISIONAL numbers (nothing in the repository calibrates them against real traffic). They are chosen to be invisible to a
 * person studying and to stop scripted abuse: a tutor call is a paid model call, so it is the tightest.
 */
export const DEFAULT_RATE_RULES: Readonly<Record<RateBucket, RateLimit>> = Object.freeze({
  ip: { limit: 600, windowMs: 60_000 },
  auth: { limit: 20, windowMs: 60_000 },
  auth_account: { limit: 10, windowMs: 15 * 60_000 },
  api: { limit: 300, windowMs: 60_000 },
  tutor: { limit: 12, windowMs: 60_000 },
  simulation_write: { limit: 150, windowMs: 60_000 },
  preferences_write: { limit: 20, windowMs: 60_000 }
});

/** At most this many tutor requests per student may be in flight at once (each is a paid, slow model call). */
export const TUTOR_MAX_IN_FLIGHT = 1;

export interface SecurityConfig {
  /** `null` = origin checking is off (development). In production the entry point refuses to start without a list. */
  allowedOrigins: readonly string[] | null;
  /** Trust `x-forwarded-for` for the client address. Only true behind a proxy that overwrites it. */
  trustProxy: boolean;
  production: boolean;
  maxBodyBytes: number;
}

export interface ApiRuntime {
  logger: Logger;
  metrics: Metrics;
  /** `null` = rate limiting disabled (tests that do not exercise it). The production runtime always supplies one. */
  limiter: RateLimiter | null;
  rules: Readonly<Record<RateBucket, RateLimit>>;
  tutorGate: ConcurrencyGate;
  security: SecurityConfig;
  /** Readiness probe: resolves true when the critical dependencies can serve traffic. Must not throw details. */
  readiness: () => Promise<boolean>;
}

export function createRuntime(overrides: Partial<ApiRuntime> = {}): ApiRuntime {
  return {
    logger: NOOP_LOGGER,
    metrics: NOOP_METRICS,
    limiter: null,
    rules: DEFAULT_RATE_RULES,
    tutorGate: createConcurrencyGate({ max: TUTOR_MAX_IN_FLIGHT }),
    security: { allowedOrigins: null, trustProxy: false, production: false, maxBodyBytes: MAX_BODY_BYTES },
    readiness: async () => true,
    ...overrides
  };
}

/** The runtime the real process uses: real logger, real metrics, rate limiting ON, and (in production) a mandatory origin allowlist. */
export function buildProductionRuntime(env: Record<string, string | undefined>, extras: { readiness?: () => Promise<boolean>; now?: () => number } = {}): ApiRuntime {
  const production = (env.NODE_ENV ?? "").toLowerCase() === "production";
  const origins = (env.IPMAT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
  for (const o of origins) {
    if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o)) throw new Error("IPMAT_ALLOWED_ORIGINS must be a comma-separated list of origins like https://app.example.com (no path, no wildcard).");
  }
  if (production && origins.length === 0) throw new Error("NODE_ENV=production requires IPMAT_ALLOWED_ORIGINS (the browser origins allowed to make state-changing requests). Refusing to start without it.");
  return createRuntime({
    logger: createLogger({ level: (env.IPMAT_LOG_LEVEL as "debug" | "info" | "warn" | "error" | undefined) ?? "info" }),
    metrics: createMetrics(),
    limiter: createRateLimiter({ now: extras.now }),
    security: { allowedOrigins: origins.length > 0 ? origins : null, trustProxy: (env.IPMAT_TRUST_PROXY ?? "").toLowerCase() === "true", production, maxBodyBytes: MAX_BODY_BYTES },
    readiness: extras.readiness ?? (async () => true)
  });
}

// ---- request helpers --------------------------------------------------------------------------------------------------

/** The client address the SERVER observed. `x-forwarded-for` counts only when `trustProxy` is set, and then only its last hop. */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const raw = Array.isArray(xff) ? xff[xff.length - 1] : xff;
    const last = raw?.split(",").pop()?.trim();
    if (last && /^[0-9a-fA-F:.]{3,45}$/.test(last)) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Rejects a state-changing request whose `Origin` is not allowed. A missing `Origin` (a non-browser client) is not a CSRF vector and passes. */
export function checkOrigin(req: IncomingMessage, config: SecurityConfig): void {
  if (SAFE_METHODS.has(req.method ?? "GET")) return;
  const origin = req.headers.origin;
  if (origin === undefined || config.allowedOrigins === null) return;
  if (typeof origin !== "string" || !config.allowedOrigins.includes(origin)) throw new HttpLimitError("origin_not_allowed", "This request is not allowed from this origin.", 403);
}

export function securityHeaders(res: ServerResponse, requestId: string, production: boolean): void {
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  if (production) res.setHeader("strict-transport-security", "max-age=15552000; includeSubDomains");
}

/** Reads a JSON body with a hard size cap and a content-type requirement (when there is a body). */
export function readBoundedBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpLimitError("payload_too_large", "The request is too large.", 413));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        chunks.length = 0;
        reject(new HttpLimitError("payload_too_large", "The request is too large.", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (raw !== "") {
        const type = String(req.headers["content-type"] ?? "").toLowerCase();
        if (!type.startsWith("application/json")) {
          reject(new HttpLimitError("unsupported_media_type", "Requests must be sent as application/json.", 415));
          return;
        }
      }
      resolve(raw);
    });
    req.on("error", (e) => reject(e));
  });
}

/**
 * The route TEMPLATE for metrics/logs: a closed whitelist. A concrete path carries resource ids, and an arbitrary unmatched path
 * would let a caller mint unlimited distinct label values, so anything not in this table is reported as `/unmatched`.
 */
const ROUTE_TEMPLATES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/healthz$/, "/healthz"],
  [/^\/readyz$/, "/readyz"],
  [/^\/v1\/auth\/(signup|login|me|logout)$/, "/v1/auth/$1"],
  [/^\/v1\/onboarding\/complete$/, "/v1/onboarding/complete"],
  [/^\/v1\/enrollment$/, "/v1/enrollment"],
  [/^\/v1\/recommendation$/, "/v1/recommendation"],
  [/^\/v1\/attempts$/, "/v1/attempts"],
  [/^\/v1\/attempts\/[^/]+\/(submit|skip|result|hypothesis|evidence|autopsy)$/, "/v1/attempts/:id/$1"],
  [/^\/v1\/attempts\/[^/]+\/hypothesis\/response$/, "/v1/attempts/:id/hypothesis/response"],
  [/^\/v1\/training\/systems$/, "/v1/training/systems"],
  [/^\/v1\/training\/sessions$/, "/v1/training/sessions"],
  [/^\/v1\/training\/sessions\/[^/]+$/, "/v1/training/sessions/:id"],
  [/^\/v1\/training\/sessions\/[^/]+\/(next|finish)$/, "/v1/training/sessions/:id/$1"],
  [/^\/v1\/tutor\/ask$/, "/v1/tutor/ask"],
  [/^\/v1\/preferences$/, "/v1/preferences"],
  [/^\/v1\/simulations$/, "/v1/simulations"],
  [/^\/v1\/simulations\/[^/]+$/, "/v1/simulations/:id"],
  [/^\/v1\/simulations\/[^/]+\/questions\/[^/]+$/, "/v1/simulations/:id/questions/:position"],
  [/^\/v1\/simulations\/[^/]+\/(answers|submit)$/, "/v1/simulations/:id/$1"]
];

export function routeTemplate(method: string, pathname: string): string {
  for (const [pattern, template] of ROUTE_TEMPLATES) {
    const m = pattern.exec(pathname);
    if (m) return `${method} ${template.replace("$1", m[1] ?? "")}`;
  }
  return `${method} /unmatched`;
}

const DB_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
/** Whether an unexpected error is the database being unreachable/overloaded (-> a retryable 503) rather than a bug (-> 500). */
export function isDatabaseUnavailable(error: unknown): boolean {
  const e = error as { name?: unknown; code?: unknown } | null;
  return e?.name === "PrismaClientInitializationError" || (typeof e?.code === "string" && DB_UNAVAILABLE_CODES.has(e.code));
}

export const SESSION_TOKEN_SHAPE = /^[0-9a-f]{64}$/;
