import type { EnrollmentRepository, ExamReader, PrepPhaseTemplateReader } from "@ipmat/db";

/**
 * The application/API boundary for IPMAT enrollment (Product Phase 1,
 * Unit 7). Mirrors `@ipmat/auth-api`'s own shape: every dependency is a
 * `@ipmat/db` PORT interface, never `@prisma/client` directly.
 *
 * Deliberately does NOT depend on `@ipmat/auth`/session machinery at all
 * -- identity is already verified ONCE, by `apps/api`'s transport layer,
 * via the existing `AuthApiService.getCurrentSession()` (Unit 4/6), before
 * this service is ever called. `enroll()`/`getCurrentEnrollment()` take an
 * already-resolved `studentId` as a plain, trusted parameter -- the exact
 * same "the API boundary verifies identity, the parameter is trusted from
 * there down" shape `@ipmat/practice-api`'s `PracticeApiService` already
 * has for `StudentRequestClaim`. This avoids re-implementing
 * session-token verification a third time.
 */
export interface EnrollmentApiDependencies {
  enrollments: EnrollmentRepository;
  examReader: ExamReader;
  prepPhaseTemplateReader: PrepPhaseTemplateReader;
}

export type EnrollmentApiErrorCode = "invalid_request" | "not_found" | "infrastructure_failure";

/** The ONE error type this boundary's callers ever need to branch on — mirrors `AuthApiError`/`PracticeApiError`. */
export class EnrollmentApiError extends Error {
  readonly code: EnrollmentApiErrorCode;
  readonly httpStatus: number;

  constructor(code: EnrollmentApiErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "EnrollmentApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** The ONLY shape a client-facing response may ever be built from. */
export interface EnrollmentView {
  id: string;
  examId: string;
  enrolledAt: string;
}

/**
 * The student-safe projection of `computePrepPhase()`'s own
 * `PrepPhaseResult` (`@ipmat/prep-phase`) — currently identical field-for-
 * field, kept as its OWN type (not a re-export) so a future addition to
 * the domain result never silently widens what a client receives without
 * an explicit decision here.
 */
export interface PrepPhaseView {
  examId: string;
  today: string;
  enrollmentDate: string;
  daysToExamToday: number;
  daysToExamAtEnrollment: number;
  expectedCoverageToday: Record<string, number>;
  expectedCoverageAtEnrollment: Record<string, number>;
  enrolledLate: boolean;
}

/** `enrollment`/`prepPhase` are both `null` together (not yet enrolled) or both present together (enrolled) — never one without the other. */
export interface EnrollmentStatusResult {
  enrollment: EnrollmentView | null;
  prepPhase: PrepPhaseView | null;
}

export interface EnrollResult {
  enrollment: EnrollmentView;
  prepPhase: PrepPhaseView;
}
