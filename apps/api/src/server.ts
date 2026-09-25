import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PracticeApiError, PracticeApiService, type PracticeApiDependencies, type StudentRequestClaim } from "@ipmat/practice-api";

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
 * versionable"). No auth middleware — resolving a real, authenticated
 * identity remains D-004's own open decision; `studentId`/`enrollmentId`
 * are accepted as explicit request fields, the SAME trust boundary
 * `@ipmat/training-recommendation`/`@ipmat/practice-loop` already have as
 * plain function parameters. This transport adds no new trust assumption.
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

type Handler = (service: PracticeApiService, body: Record<string, unknown>, query: URLSearchParams, params: RouteParams) => Promise<unknown>;

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

function claimFrom(body: Record<string, unknown>, query: URLSearchParams): StudentRequestClaim {
  return { studentId: stringField(body, query, "studentId"), enrollmentId: stringField(body, query, "enrollmentId") };
}

const ROUTES: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  {
    method: "POST",
    pattern: /^\/v1\/recommendation$/,
    handler: async (service, body, query) => service.getNextRecommendation(claimFrom(body, query))
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts$/,
    handler: async (service, body, query) => service.startAttempt(claimFrom(body, query), { questionId: stringField(body, query, "questionId") })
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts\/([^/]+)\/submit$/,
    handler: async (service, body, query, params) =>
      service.submitAttempt(claimFrom(body, query), {
        attemptId: params.attemptId,
        questionId: stringField(body, query, "questionId"),
        chosenAnswer: stringField(body, query, "chosenAnswer")
      })
  },
  {
    method: "POST",
    pattern: /^\/v1\/attempts\/([^/]+)\/skip$/,
    handler: async (service, body, query, params) => service.skipAttempt(claimFrom(body, query), { attemptId: params.attemptId, questionId: stringField(body, query, "questionId") })
  },
  {
    method: "GET",
    pattern: /^\/v1\/attempts\/([^/]+)\/result$/,
    handler: async (service, body, query, params) => service.getAttemptResult(claimFrom(body, query), { attemptId: params.attemptId })
  },
  {
    method: "GET",
    pattern: /^\/v1\/attempts\/([^/]+)\/autopsy$/,
    handler: async (service, body, query, params) => service.getAutopsyForConfirmation(claimFrom(body, query), { attemptId: params.attemptId })
  }
];

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

/** E — the transport-level half of safe error mapping: takes whatever `PracticeApiError` the application layer already produced (or wraps an unrecognized throw the same defensive way) and writes it as `{ error: { code, message } }` — never a stack trace, never a raw Node/driver error string. */
function sendError(res: ServerResponse, error: unknown): void {
  const apiError = error instanceof PracticeApiError ? error : new PracticeApiError("infrastructure_failure", "An unexpected error occurred. Please try again.", 500);
  sendJson(res, apiError.httpStatus, { error: { code: apiError.code, message: apiError.message } });
}

/**
 * Constructs a plain `http.Server` for the given, already-wired
 * dependencies — this function performs NO wiring of its own (see
 * `wiring.ts` for that; `createServer` never imports `@ipmat/db`'s
 * concrete repository classes directly, only the port interfaces
 * `PracticeApiDependencies` already requires).
 */
export function createServer(deps: PracticeApiDependencies) {
  const service = new PracticeApiService(deps);

  return createNodeServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const method = req.method ?? "GET";
        const route = ROUTES.find((r) => r.method === method && r.pattern.test(url.pathname));

        if (!route) {
          sendError(res, new PracticeApiError("not_found", "No matching route.", 404));
          return;
        }

        const match = route.pattern.exec(url.pathname);
        const params: RouteParams = { attemptId: match?.[1] ?? "" };
        const body = method === "GET" ? {} : asRecord(await readJsonBody(req));

        const result = await route.handler(service, body, url.searchParams, params);
        sendJson(res, 200, result);
      } catch (error) {
        sendError(res, error);
      }
    })();
  });
}
