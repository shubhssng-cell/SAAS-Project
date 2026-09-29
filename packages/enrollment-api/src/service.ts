import { computePrepPhase, resolveExamDate } from "@ipmat/prep-phase";
import { toEnrollmentApiError } from "./errors.js";
import { toEnrollmentView, toPrepPhaseView } from "./presentation.js";
import type { EnrollmentApiDependencies, EnrollmentStatusResult, EnrollResult } from "./types.js";
import { EnrollmentApiError } from "./types.js";

/**
 * The application/API boundary's one entry point for IPMAT enrollment
 * (docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md's Unit 7 architecture
 * section has the full design rationale). `SUPPORTED_EXAM_CODE` is the
 * one, explicit Product Phase 0 scope decision (IPMAT only) -- resolved
 * against the real, seeded `Exam` row by CODE, never a hardcoded id, and
 * never a client-supplied value (no exam-selection UI exists or is in
 * scope). `studentId` throughout is an ALREADY-VERIFIED value the caller
 * (`apps/api`) resolved from the session before calling this service --
 * see `types.ts`'s own doc comment for why this service does not verify
 * sessions itself.
 */
const SUPPORTED_EXAM_CODE = "IPMAT_INDORE";

export class EnrollmentApiService {
  constructor(private readonly deps: EnrollmentApiDependencies) {}

  /**
   * Idempotent: enrolling a student who is already enrolled returns their
   * EXISTING enrollment (via `EnrollmentRepository.create()`'s own
   * idempotency), never a duplicate and never an error — visiting `/enroll`
   * or re-submitting is always safe.
   */
  async enroll(input: { studentId: string }, opts: { now?: string } = {}): Promise<EnrollResult> {
    const now = opts.now ?? new Date().toISOString();

    try {
      const exam = await this.resolveSupportedExam();
      const enrollment = await this.deps.enrollments.create({ studentId: input.studentId, examId: exam.id, now });
      const prepPhase = await this.computePrepPhaseFor(exam, enrollment.enrolledAt, now);
      return { enrollment: toEnrollmentView(enrollment), prepPhase: toPrepPhaseView(prepPhase) };
    } catch (error) {
      if (error instanceof EnrollmentApiError) throw error;
      throw toEnrollmentApiError(error);
    }
  }

  /** `enrollment: null, prepPhase: null` is a valid, ordinary "not yet enrolled" state — never an error (the same "false means an ordinary state" discipline `@ipmat/auth-api`'s `PendingAutopsyView` already uses). */
  async getCurrentEnrollment(input: { studentId: string }, opts: { now?: string } = {}): Promise<EnrollmentStatusResult> {
    const now = opts.now ?? new Date().toISOString();

    try {
      const exam = await this.resolveSupportedExam();
      const enrollment = await this.deps.enrollments.findByStudentAndExam(input.studentId, exam.id);
      if (!enrollment) return { enrollment: null, prepPhase: null };

      const prepPhase = await this.computePrepPhaseFor(exam, enrollment.enrolledAt, now);
      return { enrollment: toEnrollmentView(enrollment), prepPhase: toPrepPhaseView(prepPhase) };
    } catch (error) {
      if (error instanceof EnrollmentApiError) throw error;
      throw toEnrollmentApiError(error);
    }
  }

  private async resolveSupportedExam() {
    const exam = await this.deps.examReader.findByCode(SUPPORTED_EXAM_CODE);
    if (!exam) {
      // A real infrastructure/seed gap (IPMAT must always be seeded for this product to
      // function at all) -- never a validation error, never silently invented.
      throw new EnrollmentApiError("infrastructure_failure", "Enrollment is not available right now. Please try again.", 500);
    }
    return exam;
  }

  private async computePrepPhaseFor(exam: { id: string; examDateRule: unknown }, enrollmentDate: string, now: string) {
    const template = await this.deps.prepPhaseTemplateReader.findByExamId(exam.id);
    if (!template) {
      throw new EnrollmentApiError("infrastructure_failure", "Your preparation timeline could not be calculated right now. Please try again.", 500);
    }
    const examDate = resolveExamDate(exam.examDateRule);
    return computePrepPhase({ examId: exam.id, enrollmentDate, today: now, template: { examId: exam.id, examDate, phaseCurve: template.phaseCurve } });
  }
}
