import type { SessionRepository, StudentAccountRepository } from "@ipmat/db";

/**
 * The application/API boundary for authentication (Product Phase 1, Unit 4
 * -- see docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md's Unit 4
 * architecture section). Mirrors `@ipmat/practice-api`'s own shape: every
 * dependency is a `@ipmat/db` PORT interface, never `@prisma/client`
 * directly; a concrete HTTP transport (`apps/api`) wires this once.
 */
export interface AuthApiDependencies {
  studentAccounts: StudentAccountRepository;
  sessions: SessionRepository;
}

export type AuthApiErrorCode = "invalid_request" | "email_already_registered" | "invalid_credentials" | "not_authenticated" | "infrastructure_failure";

/**
 * The ONE error type this boundary's callers ever need to branch on.
 * `message` is always a safe, generic, hand-authored string -- never a raw
 * repository/driver error's own text. `httpStatus` is a suggested mapping
 * only; a transport is free to use its own.
 */
export class AuthApiError extends Error {
  readonly code: AuthApiErrorCode;
  readonly httpStatus: number;

  constructor(code: AuthApiErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * The ONLY shape a client-facing response may ever be built from --
 * structurally excludes `passwordHash` (D-020's "narrow, allowlisted view"
 * discipline, applied here to credentials instead of question answer keys).
 * `onboardingCompletedAt` (Product Phase 1 Unit 6) is `null` until the
 * student completes the one-time onboarding sequence -- this is the ONE
 * server-authoritative fact `apps/web` reads to decide whether to show
 * `/onboarding`, never a frontend-only flag.
 */
export interface StudentAccountView {
  id: string;
  email: string;
  createdAt: string;
  onboardingCompletedAt: string | null;
}

/**
 * `sessionToken` is the RAW, one-time bearer token -- present ONLY in this
 * result, returned exactly once, at the moment a session is created
 * (signup/login). A transport sets it as an `HttpOnly` cookie and then
 * never needs (or is able) to read it back from anywhere; it is never
 * persisted anywhere in this shape, and `StudentAccountView`/
 * `getCurrentSession()`'s result never carry it again.
 */
export interface AuthApiSessionResult {
  student: StudentAccountView;
  sessionToken: string;
  expiresAt: string;
}

export interface CurrentSessionResult {
  student: StudentAccountView;
}
