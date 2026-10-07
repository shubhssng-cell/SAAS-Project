/**
 * The application layer's one error type (Phase 9 Unit 2, docs/DECISIONS.md D-098). Every failure that leaves this package is one
 * of these: a stable `code`, a FIXED student-safe `message` and an HTTP status. A thrown message from a domain package, a
 * database or a provider is never copied into one (it could carry a stack, a Prisma error, an id or provider text).
 */
export type AssistantApiErrorCode = "invalid_request" | "forbidden" | "not_found" | "conflict" | "not_available" | "infrastructure_failure";

export class AssistantApiError extends Error {
  constructor(
    readonly code: AssistantApiErrorCode,
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "AssistantApiError";
  }
}

export const invalidRequest = (message: string): AssistantApiError => new AssistantApiError("invalid_request", message, 400);
export const notAvailable = (message: string): AssistantApiError => new AssistantApiError("not_available", message, 503);

/** The verified identity of a student request. Always derived from the session by the transport; never read from a request body. */
export interface StudentClaim {
  studentId: string;
  enrollmentId: string;
}

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Refuses any key outside `allowed`, echoing only a short, sanitized label of the offending key. */
export function requireOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalidRequest(`The field "${key.slice(0, 40).replace(/[^\w.-]/g, "?")}" is not accepted here.`);
  }
}
