/**
 * Server-authoritative shapes only -- the frontend never computes any of
 * this itself (see `PrepPhaseDto`'s doc comment). Mirrors
 * `@ipmat/enrollment-api`'s `EnrollmentView`/`PrepPhaseView` field-for-field.
 */
export interface EnrollmentDto {
  id: string;
  examId: string;
  enrolledAt: string;
}

/** A direct projection of the server's `PrepPhaseView` (itself a projection of `computePrepPhase()`'s real, existing output) -- the frontend never runs this calculation itself, only displays what the server already computed. */
export interface PrepPhaseDto {
  examId: string;
  today: string;
  enrollmentDate: string;
  daysToExamToday: number;
  daysToExamAtEnrollment: number;
  expectedCoverageToday: Record<string, number>;
  expectedCoverageAtEnrollment: Record<string, number>;
  enrolledLate: boolean;
}

/**
 * `"idle"` is distinct from `"loading"`: idle means "auth isn't
 * authenticated yet, so there is nothing to fetch" (before hydration ever
 * starts); loading means a real `/v1/enrollment` request is in flight.
 * `EnrollmentGate` treats both as "not yet resolved," but the distinction
 * matters for `EnrollmentProvider`'s own effect (it must not fetch while
 * idle).
 */
export type EnrollmentState = { status: "idle" } | { status: "loading" } | { status: "not-enrolled" } | { status: "enrolled"; enrollment: EnrollmentDto; prepPhase: PrepPhaseDto } | { status: "error"; message: string };

export type EnrollmentEvent =
  | { type: "RESET" }
  | { type: "FETCH_START" }
  | { type: "FETCH_NOT_ENROLLED" }
  | { type: "FETCH_ENROLLED"; enrollment: EnrollmentDto; prepPhase: PrepPhaseDto }
  | { type: "FETCH_ERROR"; message: string }
  | { type: "ENROLLED"; enrollment: EnrollmentDto; prepPhase: PrepPhaseDto };

/** Pure state transition function -- no I/O, no React, fully unit-testable on its own, mirroring `authReducer()`'s own shape. */
export function enrollmentReducer(_state: EnrollmentState, event: EnrollmentEvent): EnrollmentState {
  switch (event.type) {
    case "RESET":
      return { status: "idle" };
    case "FETCH_START":
      return { status: "loading" };
    case "FETCH_NOT_ENROLLED":
      return { status: "not-enrolled" };
    case "FETCH_ENROLLED":
    case "ENROLLED":
      return { status: "enrolled", enrollment: event.enrollment, prepPhase: event.prepPhase };
    case "FETCH_ERROR":
      return { status: "error", message: event.message };
  }
}
