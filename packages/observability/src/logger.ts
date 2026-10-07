import { currentContext } from "./context.js";

/**
 * Structured, REDACTING logger (Phase 9 Unit 3, D-099). A log line can only contain the allowlisted fields below, so a prompt, a
 * model response, an answer key, a password, a token, free text typed by a student, or an error message cannot be logged by
 * passing it in: an unknown field is dropped (and counted), a string is truncated and stripped of control characters, and any
 * value that looks like a credential, a bearer token, a session cookie or a database URL is replaced.
 *
 * Observability here exists to diagnose production problems; it must never become a data-leak mechanism.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const LOG_FIELDS = [
  "requestId",
  "method",
  "route",
  "status",
  "actorKind",
  "studentRef",
  "examCode",
  "operation",
  "capability",
  "workflow",
  "outcome",
  "failureCategory",
  "latencyMs",
  "provider",
  "model",
  "attempts",
  "bucket",
  "retryAfterSeconds",
  "errorName",
  "errorCode",
  "dependency",
  "check",
  "count",
  // Phase 9 Unit 4 (billing): configuration ids and coarse states only - never an amount, a reference, a signature or a payload.
  "feature",
  "meter",
  "planId",
  "eventType",
  "subscriptionStatus"
] as const;
export type LogField = (typeof LOG_FIELDS)[number];
export type LogFields = Partial<Record<LogField, string | number | boolean | null | undefined>>;

const SECRET_PATTERN = /sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~+/=-]{8,}|postgres(?:ql)?:\/\/\S+|session_token=\S+|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+/i;
const MAX_STRING = 120;

export function sanitizeValue(value: string | number | boolean | null | undefined): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  const stripped = [...value].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join("");
  if (SECRET_PATTERN.test(stripped)) return "[redacted]";
  return stripped.length > MAX_STRING ? `${stripped.slice(0, MAX_STRING)}…` : stripped;
}

export interface LogRecord {
  ts: string;
  level: LogLevel;
  event: string;
  droppedFields?: number;
  [field: string]: string | number | boolean | null | undefined;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Receives one finished, sanitized JSON line. The default writes to stdout. */
  sink?: (line: string) => void;
  now?: () => Date;
  level?: LogLevel;
}

const EVENT_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const min = LEVELS[options.level ?? "info"];

  function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (LEVELS[level] < min) return;
    const ctx = currentContext();
    const merged: Record<string, unknown> = {
      ...(ctx ? { requestId: ctx.requestId, method: ctx.method, route: ctx.route, actorKind: ctx.actorKind, studentRef: ctx.studentRef, examCode: ctx.examCode } : {}),
      ...fields
    };
    const record: LogRecord = { ts: now().toISOString(), level, event: EVENT_PATTERN.test(event) ? event : "invalid_event_name" };
    let dropped = 0;
    for (const [key, value] of Object.entries(merged)) {
      if (!(LOG_FIELDS as readonly string[]).includes(key) || (value !== undefined && value !== null && typeof value === "object")) {
        dropped += 1;
        continue;
      }
      if (value === undefined || value === null) continue;
      record[key] = sanitizeValue(value as string | number | boolean);
    }
    if (dropped > 0) record.droppedFields = dropped;
    try {
      sink(JSON.stringify(record));
    } catch {
      // logging must never break a request
    }
  }

  return { debug: (e, f) => emit("debug", e, f), info: (e, f) => emit("info", e, f), warn: (e, f) => emit("warn", e, f), error: (e, f) => emit("error", e, f) };
}

export const NOOP_LOGGER: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
