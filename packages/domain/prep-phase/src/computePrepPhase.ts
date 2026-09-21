import { curveStartPoint, diffInDays, selectPhasePoint } from "./curve.js";
import type { PrepPhaseInput, PrepPhaseResult } from "./types.js";

/**
 * Pure function: the calendar phase a student is in, given only their exam,
 * enrollment date, and today's date against the exam's phase template.
 *
 * Deliberately does NOT accept or read anything about a student's attempts
 * or MasteryState — calendar phase and demonstrated mastery are computed
 * from disjoint inputs (see docs/PRODUCT_SPEC.md §4.8 and
 * docs/ARCHITECTURE.md §6). A caller who wants to reconcile phase with
 * mastery does so at a layer above this function, never inside it.
 */
export function computePrepPhase(input: PrepPhaseInput): PrepPhaseResult {
  const daysToExamToday = diffInDays(input.template.examDate, input.today);
  const daysToExamAtEnrollment = diffInDays(input.template.examDate, input.enrollmentDate);

  const pointToday = selectPhasePoint(input.template.phaseCurve, daysToExamToday);
  const pointAtEnrollment = selectPhasePoint(input.template.phaseCurve, daysToExamAtEnrollment);
  const start = curveStartPoint(input.template.phaseCurve);

  return {
    examId: input.examId,
    today: input.today,
    enrollmentDate: input.enrollmentDate,
    daysToExamToday,
    daysToExamAtEnrollment,
    expectedCoverageToday: { ...pointToday.expectedCoverage },
    expectedCoverageAtEnrollment: { ...pointAtEnrollment.expectedCoverage },
    enrolledLate: daysToExamAtEnrollment < start.daysToExam
  };
}
