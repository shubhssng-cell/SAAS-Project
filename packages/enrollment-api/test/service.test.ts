import { describe, expect, it } from "vitest";
import { EnrollmentApiError } from "../src/types.js";
import { EXAM_ID, IPMAT_EXAM, t, World } from "./fixtures.js";

describe("EnrollmentApiService.getCurrentEnrollment", () => {
  it("a student with no enrollment gets enrollment: null, prepPhase: null (a valid, ordinary state)", async () => {
    const service = new World().service();
    const result = await service.getCurrentEnrollment({ studentId: "student-1" }, { now: t(0) });
    expect(result).toEqual({ enrollment: null, prepPhase: null });
  });
});

describe("EnrollmentApiService.enroll", () => {
  it("creates an enrollment for the given studentId against the resolved IPMAT exam", async () => {
    const service = new World().service();
    const result = await service.enroll({ studentId: "student-1" }, { now: t(0) });
    expect(result.enrollment.examId).toBe(EXAM_ID);
    expect(result.enrollment.enrolledAt).toBe(t(0));
    expect(result.enrollment.id).toBeTruthy();
  });

  it("uses the EXISTING computePrepPhase() -- the returned prepPhase reflects the real curve/exam-date math", async () => {
    const service = new World().service();
    const result = await service.enroll({ studentId: "student-1" }, { now: t(0) });
    // Exam date 2027-01-15, "now" 2026-09-29 -- ~108 days out, which lands on the 150-day
    // curve point (the tightest already-crossed milestone, per selectPhasePoint()'s own
    // "eligible" rule) -- see packages/domain/prep-phase/src/curve.ts.
    expect(result.prepPhase.examId).toBe(EXAM_ID);
    expect(result.prepPhase.enrollmentDate).toBe(t(0));
    expect(result.prepPhase.expectedCoverageToday).toEqual({ Percentages: 0.25 });
    // Enrolling ~108 days out is FEWER than the curve's own 210-day start point -- late, by
    // this domain's existing definition (see packages/domain/prep-phase/test/prepPhase.test.ts).
    expect(result.prepPhase.enrolledLate).toBe(true);
  });

  it("is idempotent -- enrolling twice returns the SAME enrollment, never a duplicate or an error", async () => {
    const service = new World().service();
    const first = await service.enroll({ studentId: "student-1" }, { now: t(0) });
    const second = await service.enroll({ studentId: "student-1" }, { now: t(100) });
    expect(second.enrollment.id).toBe(first.enrollment.id);
    expect(second.enrollment.enrolledAt).toBe(first.enrollment.enrolledAt);
  });

  it("getCurrentEnrollment reflects a real enrollment after enroll() -- persistence across a fresh call", async () => {
    const world = new World();
    const service = world.service();
    const enrolled = await service.enroll({ studentId: "student-1" }, { now: t(0) });

    const result = await service.getCurrentEnrollment({ studentId: "student-1" }, { now: t(100) });
    expect(result.enrollment).toEqual(enrolled.enrollment);
    expect(result.prepPhase?.examId).toBe(EXAM_ID);
  });

  it("two different students enrolling independently get separate enrollments", async () => {
    const world = new World();
    const service = world.service();
    const a = await service.enroll({ studentId: "student-a" }, { now: t(0) });
    const b = await service.enroll({ studentId: "student-b" }, { now: t(0) });
    expect(a.enrollment.id).not.toBe(b.enrollment.id);
  });

  it("throws infrastructure_failure (never a validation error) if the IPMAT exam is not seeded", async () => {
    const world = new World();
    world.examReader = []; // simulate a genuine seed-data gap
    const service = world.service();
    await expect(service.enroll({ studentId: "student-1" }, { now: t(0) })).rejects.toMatchObject({ code: "infrastructure_failure" });
  });

  it("throws infrastructure_failure if the prep-phase template is missing for the exam", async () => {
    const world = new World();
    world.templates = [];
    const service = world.service();
    await expect(service.enroll({ studentId: "student-1" }, { now: t(0) })).rejects.toMatchObject({ code: "infrastructure_failure" });
  });

  it("throws infrastructure_failure (via ExamDateRuleError) for a malformed exam date rule -- never silently invents a date", async () => {
    const world = new World();
    world.examReader = [{ ...IPMAT_EXAM, examDateRule: { type: "unsupported_rule" } }];
    const service = world.service();
    let caught: EnrollmentApiError | undefined;
    try {
      await service.enroll({ studentId: "student-1" }, { now: t(0) });
    } catch (error) {
      caught = error as EnrollmentApiError;
    }
    expect(caught).toBeInstanceOf(EnrollmentApiError);
    expect(caught?.code).toBe("infrastructure_failure");
  });

  it("never leaks a raw persistence/internal error message to the client", async () => {
    const world = new World();
    world.examReader = [];
    const service = world.service();
    try {
      await service.enroll({ studentId: "student-1" }, { now: t(0) });
      expect.unreachable();
    } catch (error) {
      const apiError = error as EnrollmentApiError;
      expect(apiError.message).not.toMatch(/prisma|sql|stack|at .*\.ts:\d+/i);
    }
  });
});
