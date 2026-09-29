import { InMemoryEnrollmentRepository, InMemoryExamReader, InMemoryPrepPhaseTemplateReader, type ExamRecord, type PrepPhaseTemplateRecord } from "@ipmat/db";
import { EnrollmentApiService } from "../src/service.js";
import type { EnrollmentApiDependencies } from "../src/types.js";

export const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-29T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

export const EXAM_ID = "exam-ipmat-indore";

/** Mirrors the REAL seeded IPMAT exam/prep-phase-template data (packages/db/prisma/seed.ts, packages/domain/prep-phase/fixtures/ipmatTemplate.ts) -- never invented values. */
export const IPMAT_EXAM: ExamRecord = { id: EXAM_ID, code: "IPMAT_INDORE", examDateRule: { type: "fixed_date", date: "2027-01-15" } };

export const IPMAT_TEMPLATE: PrepPhaseTemplateRecord = {
  examId: EXAM_ID,
  phaseCurve: [
    { daysToExam: 210, expectedCoverage: { Percentages: 0.0 } },
    { daysToExam: 150, expectedCoverage: { Percentages: 0.25 } },
    { daysToExam: 90, expectedCoverage: { Percentages: 0.5 } },
    { daysToExam: 45, expectedCoverage: { Percentages: 0.75 } },
    { daysToExam: 14, expectedCoverage: { Percentages: 0.9 } },
    { daysToExam: 0, expectedCoverage: { Percentages: 1.0 } }
  ]
};

/** A small, real (in-memory) persisted "world," following the `packages/auth-api/test/fixtures.ts` precedent. */
export class World {
  readonly enrollments = new InMemoryEnrollmentRepository();
  examReader: ExamRecord[] = [IPMAT_EXAM];
  templates: PrepPhaseTemplateRecord[] = [IPMAT_TEMPLATE];

  service(): EnrollmentApiService {
    const deps: EnrollmentApiDependencies = {
      enrollments: this.enrollments,
      examReader: new InMemoryExamReader(this.examReader),
      prepPhaseTemplateReader: new InMemoryPrepPhaseTemplateReader(this.templates)
    };
    return new EnrollmentApiService(deps);
  }
}
