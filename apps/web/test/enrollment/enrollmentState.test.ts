import { describe, expect, it } from "vitest";
import { enrollmentReducer, type EnrollmentDto, type EnrollmentState, type PrepPhaseDto } from "../../src/enrollment/enrollmentState.js";

const ENROLLMENT: EnrollmentDto = { id: "enrollment-1", examId: "exam-1", enrolledAt: "2026-09-29T00:00:00.000Z" };
const PREP_PHASE: PrepPhaseDto = {
  examId: "exam-1",
  today: "2026-09-29T00:00:00.000Z",
  enrollmentDate: "2026-09-29T00:00:00.000Z",
  daysToExamToday: 108,
  daysToExamAtEnrollment: 108,
  expectedCoverageToday: { Percentages: 0.25 },
  expectedCoverageAtEnrollment: { Percentages: 0.25 },
  enrolledLate: true
};
const IDLE: EnrollmentState = { status: "idle" };

describe("enrollmentReducer", () => {
  it("RESET -> idle, from any prior state", () => {
    const enrolled: EnrollmentState = { status: "enrolled", enrollment: ENROLLMENT, prepPhase: PREP_PHASE };
    expect(enrollmentReducer(enrolled, { type: "RESET" })).toEqual({ status: "idle" });
  });

  it("FETCH_START -> loading", () => {
    expect(enrollmentReducer(IDLE, { type: "FETCH_START" })).toEqual({ status: "loading" });
  });

  it("FETCH_NOT_ENROLLED -> not-enrolled", () => {
    const loading: EnrollmentState = { status: "loading" };
    expect(enrollmentReducer(loading, { type: "FETCH_NOT_ENROLLED" })).toEqual({ status: "not-enrolled" });
  });

  it("FETCH_ENROLLED -> enrolled with the enrollment and prepPhase", () => {
    const loading: EnrollmentState = { status: "loading" };
    expect(enrollmentReducer(loading, { type: "FETCH_ENROLLED", enrollment: ENROLLMENT, prepPhase: PREP_PHASE })).toEqual({ status: "enrolled", enrollment: ENROLLMENT, prepPhase: PREP_PHASE });
  });

  it("FETCH_ERROR -> error with the message, never silently becoming not-enrolled", () => {
    expect(enrollmentReducer(IDLE, { type: "FETCH_ERROR", message: "We couldn't reach the server." })).toEqual({ status: "error", message: "We couldn't reach the server." });
  });

  it("ENROLLED -> enrolled, from not-enrolled (the ordinary case: submitting the enrollment form)", () => {
    const notEnrolled: EnrollmentState = { status: "not-enrolled" };
    expect(enrollmentReducer(notEnrolled, { type: "ENROLLED", enrollment: ENROLLMENT, prepPhase: PREP_PHASE })).toEqual({ status: "enrolled", enrollment: ENROLLMENT, prepPhase: PREP_PHASE });
  });

  it("ENROLLED -> enrolled, even from a prior error state (recovers on successful enroll)", () => {
    const errorState: EnrollmentState = { status: "error", message: "prior failure" };
    expect(enrollmentReducer(errorState, { type: "ENROLLED", enrollment: ENROLLMENT, prepPhase: PREP_PHASE })).toEqual({ status: "enrolled", enrollment: ENROLLMENT, prepPhase: PREP_PHASE });
  });
});
