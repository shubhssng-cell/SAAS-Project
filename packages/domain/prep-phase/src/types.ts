/**
 * A single milestone on an exam's preparation curve: "with this many days
 * left before the exam, a student should have reached this much expected
 * coverage per chapter." Curves are sorted descending by daysToExam — the
 * first entry is the earliest phase, the entry with daysToExam near 0 is
 * exam week.
 */
export interface PhaseCurvePoint {
  daysToExam: number;
  expectedCoverage: Record<string, number>;
}

/**
 * Plain data mirror of the `PrepPhaseTemplate` row (see docs/DATABASE.md).
 * `examDate` is a resolved concrete date for the cycle being tracked —
 * resolving `Exam.exam_date_rule` into a concrete date per cycle is not
 * built in Phase 1 (see docs/DECISIONS.md and the Phase 1 report); a
 * concrete date is enough for a single-cycle vertical slice.
 */
export interface PrepPhaseTemplateData {
  examId: string;
  examDate: string;
  phaseCurve: PhaseCurvePoint[];
}

export interface PrepPhaseInput {
  examId: string;
  enrollmentDate: string;
  today: string;
  template: PrepPhaseTemplateData;
}

/**
 * The output of computePrepPhase. Deliberately contains nothing derived
 * from Attempt/MasteryState — see the "calendar phase and mastery are
 * independent concepts" test in test/prepPhase.test.ts.
 */
export interface PrepPhaseResult {
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
 * Plain data mirror of a `CatchUpPlan.overlay` value (see docs/DATABASE.md).
 * Deliberately simple for Phase 1: prioritize some chapters and compress
 * the pace at which their expected coverage is considered "on track."
 */
export interface CatchUpOverlayData {
  studentId: string;
  enrollmentId: string;
  priorityChapters: string[];
  paceMultiplier: number;
}

export interface CatchUpResult extends PrepPhaseResult {
  catchUpApplied: boolean;
  adjustedCoverage: Record<string, number>;
}
