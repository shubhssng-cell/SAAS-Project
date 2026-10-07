import type { TutorAttemptPort, TutorAttemptRecord, TutorEnrollmentScope, TutorOwnershipPort, TutorQuestionPort, TutorQuestionRecord } from "@ipmat/tutor";
import type { PrismaClient } from "@prisma/client";

/**
 * Production bindings for the AI Tutor's read ports (Phase 9 Unit 2, docs/DECISIONS.md D-098). The tutor package keeps its own
 * ports so it never sees Prisma; these classes are the only place they meet the database. They add no policy: the tutor's
 * context builder RE-VERIFIES every result (exam, publication state, student) and the intent's policy decides what may reach a
 * prompt. What is read here is what the tutor's contract names - nothing else is selected.
 */

/** Resolves an enrollment ONLY when it belongs to the student; the same `null` for "no such enrollment" and "not yours". */
export class PrismaTutorOwnershipPort implements TutorOwnershipPort {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveEnrollment(studentId: string, enrollmentId: string): Promise<TutorEnrollmentScope | null> {
    const row = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { id: true, studentId: true, exam: { select: { code: true } } } });
    if (!row || row.studentId !== studentId) return null;
    return { studentId: row.studentId, enrollmentId: row.id, examCode: row.exam.code };
  }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/**
 * One question of ONE exam, with the internal fields the tutor's policy may or may not authorize (`correctAnswer`,
 * `solutionSteps`). Scoped by exam code in the query, so another exam's question is `null`. Publication state is returned, not
 * filtered: the tutor's context builder refuses anything unpublished.
 */
export class PrismaTutorQuestionPort implements TutorQuestionPort {
  constructor(private readonly prisma: PrismaClient) {}

  async getQuestion(examCode: string, questionId: string): Promise<TutorQuestionRecord | null> {
    const row = await this.prisma.question.findFirst({
      where: { id: questionId, exam: { code: examCode } },
      select: {
        id: true,
        validationState: true,
        body: true,
        options: true,
        correctAnswer: true,
        solutionSteps: true,
        skill: true,
        difficultyTier: true,
        noveltyLevel: true,
        expectedTimeSeconds: true,
        testingModes: true,
        patternTaxonomyCellId: true,
        concept: { select: { name: true } },
        patternTaxonomyCell: { select: { patternFamily: { select: { name: true } } } },
        trapErrorTaxonomy: { select: { code: true, label: true } }
      }
    });
    if (!row) return null;
    const options = strings(row.options);
    return {
      questionId: row.id,
      examCode,
      validationState: row.validationState,
      conceptName: row.concept.name,
      stem: row.body,
      options: options.length > 0 ? options : null,
      correctAnswer: row.correctAnswer,
      solutionSteps: strings(row.solutionSteps),
      patternFamilyName: row.patternTaxonomyCell.patternFamily.name,
      skill: row.skill,
      difficultyTier: row.difficultyTier,
      noveltyLevel: row.noveltyLevel,
      expectedTimeSeconds: row.expectedTimeSeconds,
      testingModes: [...row.testingModes],
      trapLabel: row.trapErrorTaxonomy?.label ?? null,
      // identifiers the model must never repeat; used only by the tutor's leakage check
      internalTokens: [row.patternTaxonomyCellId, ...(row.trapErrorTaxonomy ? [row.trapErrorTaxonomy.code] : [])]
    };
  }
}

const workingText = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (Array.isArray(value)) {
    const lines = value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
    return lines.length > 0 ? lines.join("\n") : null;
  }
  return null;
};

/** The student's OWN latest attempt on a question: scoped by student id in the query, observable facts only. */
export class PrismaTutorAttemptPort implements TutorAttemptPort {
  constructor(private readonly prisma: PrismaClient) {}

  async getLatestAttempt(studentId: string, questionId: string): Promise<TutorAttemptRecord | null> {
    const row = await this.prisma.attempt.findFirst({
      where: { studentId, questionId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true, studentId: true, questionId: true, status: true, chosenAnswer: true, isCorrect: true, hintsUsed: true, timeSpentSeconds: true, workingSteps: true, reasoningText: true }
    });
    if (!row) return null;
    const answerChanges = await this.prisma.attemptEvent.count({ where: { attemptId: row.id, eventType: "answer_changed" } });
    return {
      attemptId: row.id,
      studentId: row.studentId,
      questionId: row.questionId,
      status: row.status,
      finalAnswer: row.chosenAnswer,
      isCorrect: row.isCorrect,
      hintsUsed: row.hintsUsed,
      answerChanges,
      timeTakenSeconds: row.timeSpentSeconds,
      workingSteps: workingText(row.workingSteps),
      reasoningText: row.reasoningText
    };
  }
}
