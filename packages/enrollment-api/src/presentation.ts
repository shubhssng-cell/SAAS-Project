import type { PrepPhaseResult } from "@ipmat/prep-phase";
import type { StudentEnrollmentRecord } from "@ipmat/db";
import type { EnrollmentView, PrepPhaseView } from "./types.js";

export function toEnrollmentView(record: StudentEnrollmentRecord): EnrollmentView {
  return { id: record.id, examId: record.examId, enrolledAt: record.enrolledAt };
}

export function toPrepPhaseView(result: PrepPhaseResult): PrepPhaseView {
  return {
    examId: result.examId,
    today: result.today,
    enrollmentDate: result.enrollmentDate,
    daysToExamToday: result.daysToExamToday,
    daysToExamAtEnrollment: result.daysToExamAtEnrollment,
    expectedCoverageToday: result.expectedCoverageToday,
    expectedCoverageAtEnrollment: result.expectedCoverageAtEnrollment,
    enrolledLate: result.enrolledLate
  };
}
