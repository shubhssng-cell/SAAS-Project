import { describe, expect, it } from "vitest";
import type { EnrollmentDto, EnrollmentState, PrepPhaseDto } from "../../src/enrollment/enrollmentState.js";
import { derivePrepStatus, formatEnrolledDate, greetingSubtext, practiceProgressNote } from "../../src/dashboard/prepStatus.js";

const ENROLLMENT: EnrollmentDto = { id: "enrollment-1", examId: "exam-1", enrolledAt: "2026-09-29T00:00:00.000Z" };
const PREP_PHASE: PrepPhaseDto = {
  examId: "exam-1",
  today: "2026-09-30T00:00:00.000Z",
  enrollmentDate: "2026-09-29T00:00:00.000Z",
  daysToExamToday: 107,
  daysToExamAtEnrollment: 108,
  expectedCoverageToday: { Percentages: 0.25 },
  expectedCoverageAtEnrollment: { Percentages: 0.25 },
  enrolledLate: true
};

describe("derivePrepStatus", () => {
  it("returns the enrolledAt/daysToExamToday facts for an enrolled student -- reading the server's own value, never recomputing it", () => {
    const state: EnrollmentState = { status: "enrolled", enrollment: ENROLLMENT, prepPhase: PREP_PHASE };
    expect(derivePrepStatus(state)).toEqual({ enrolledAt: "2026-09-29T00:00:00.000Z", daysToExamToday: 107 });
  });

  it("returns null for idle/loading/not-enrolled/error -- never guesses at a prep status", () => {
    const nonEnrolledStates: EnrollmentState[] = [{ status: "idle" }, { status: "loading" }, { status: "not-enrolled" }, { status: "error", message: "failed" }];
    for (const state of nonEnrolledStates) {
      expect(derivePrepStatus(state)).toBeNull();
    }
  });

  it("never leaks internal fields (examId, enrollment id, raw prepPhase) beyond enrolledAt/daysToExamToday", () => {
    const state: EnrollmentState = { status: "enrolled", enrollment: ENROLLMENT, prepPhase: PREP_PHASE };
    const result = derivePrepStatus(state);
    expect(Object.keys(result ?? {}).sort()).toEqual(["daysToExamToday", "enrolledAt"]);
  });
});

describe("formatEnrolledDate", () => {
  it("formats an ISO date as a readable long-form date, never a raw timestamp", () => {
    const formatted = formatEnrolledDate("2026-09-29T00:00:00.000Z");
    expect(formatted).not.toContain("T00:00:00");
    expect(formatted).not.toMatch(/^\d{4}-\d{2}-\d{2}$/); // not raw ISO either
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("greetingSubtext", () => {
  it("includes the student's own email, never an internal id", () => {
    expect(greetingSubtext("student@example.com")).toContain("student@example.com");
  });
});

describe("practiceProgressNote", () => {
  it("reports zero questions honestly, without a fabricated readiness claim", () => {
    const note = practiceProgressNote(0);
    expect(note).not.toMatch(/\d+%/); // no percentage/readiness figure
    expect(note.length).toBeGreaterThan(0);
  });

  it("reports a real count for a nonzero value", () => {
    expect(practiceProgressNote(1)).toContain("1 question");
    expect(practiceProgressNote(1)).not.toContain("1 questions");
    expect(practiceProgressNote(5)).toContain("5 questions");
  });

  it("never fabricates a confidence/readiness percentage or AI claim, for any input", () => {
    for (const count of [0, 1, 2, 10, 100]) {
      const note = practiceProgressNote(count);
      expect(note).not.toMatch(/\d+%/);
      expect(note.toLowerCase()).not.toMatch(/ai recommends|weakest|confidence|ready/);
    }
  });
});
