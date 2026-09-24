import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt, type AttemptState } from "@ipmat/attempt";
import {
  InMemoryAttemptRepository,
  InMemoryConceptReader,
  InMemoryEnrollmentReader,
  InMemoryPracticeBlockRepository,
  InMemoryPracticeSessionRepository,
  InMemoryQuestionReader,
  InMemoryTrainingQuestionReader,
  type CanonicalQuestion,
  type ConceptRecord,
  type EnrollmentRecord,
  type StoredRepairPlan,
  type TrainingQuestionRecord
} from "@ipmat/db";
import type { AutopsyQuestionContext } from "@ipmat/training-orchestration";
import type { TrainingRecommendationDependencies } from "../src/types.js";

export const STUDENT = "student-1";
export const OTHER_STUDENT = "student-2";
export const ENROLLMENT = "enrollment-1";
export const OTHER_ENROLLMENT = "enrollment-2";
export const EXAM = "exam-ipmat";
export const OTHER_EXAM = "exam-other";
export const NOW = "2026-09-24T12:00:00.000Z";
/** A deliberately unique answer key, so a test can prove it never leaks into composed input or orchestration output. */
export const ANSWER_KEY = "ANSWER-KEY-7731";

export const PERCENTAGES: ConceptRecord = { id: "concept-percentages", name: "Percentages", chapterId: "chapter-percentages" };
export const RATIO: ConceptRecord = { id: "concept-ratio", name: "Ratio", chapterId: "chapter-ratio" };

export const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

export function dna(questionId: string, overrides: Partial<AutopsyQuestionContext> = {}): AutopsyQuestionContext {
  return {
    questionId,
    examCode: "IPMAT_INDORE",
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: PERCENTAGES.name,
    patternFamilyName: "Reverse Percentage",
    patternTaxonomyCellId: "cell-reverse-standard",
    difficultyTier: "standard",
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard",
    examRelevance: "core",
    testingModes: ["reverse"],
    trapErrorTaxonomyCode: "base_confusion",
    combinesWithConcepts: [],
    ...overrides
  };
}

export function storedRepairPlan(overrides: Partial<StoredRepairPlan> = {}): StoredRepairPlan {
  return {
    id: "repair-plan-1",
    autopsyId: "autopsy-1",
    studentId: STUDENT,
    targetConceptId: PERCENTAGES.id,
    targetErrorTaxonomyId: "taxonomy-base-confusion",
    followUpQuestionIds: [],
    status: "pending",
    createdAt: t(5_000),
    confirmedAt: t(4_000),
    attemptId: "diagnosed-attempt",
    targetConceptName: PERCENTAGES.name,
    targetPatternFamilyName: "Reverse Percentage",
    targetTaxonomyCellId: "cell-reverse-standard",
    targetErrorCategory: "misconception",
    recommendedTrainingMode: "guided_hint_first",
    priority: "high",
    targetErrorTaxonomyCode: "base_confusion",
    ...overrides
  };
}

/**
 * A small persisted "world" backed by `@ipmat/db`'s own exported in-memory
 * readers/repositories (the same classes other packages' tests use) plus
 * a plain RepairPlan reader (the in-memory RepairPlan double lives in
 * `@ipmat/db`'s own test directory, which this package must not reach into).
 */
export class World {
  readonly enrollments: EnrollmentRecord[] = [
    { id: ENROLLMENT, studentId: STUDENT, examId: EXAM },
    { id: OTHER_ENROLLMENT, studentId: OTHER_STUDENT, examId: EXAM }
  ];
  readonly attempts = new InMemoryAttemptRepository();
  readonly sessions = new InMemoryPracticeSessionRepository();
  readonly blocks = new InMemoryPracticeBlockRepository();
  readonly questionRecordsByExam = new Map<string, TrainingQuestionRecord[]>();
  readonly canonicals: CanonicalQuestion[] = [];
  readonly conceptsByExam = new Map<string, ConceptRecord[]>([[EXAM, [PERCENTAGES, RATIO]]]);
  repairPlans: StoredRepairPlan[] = [];

  addQuestion(input: {
    id: string;
    exam?: string;
    concept?: ConceptRecord;
    dna?: Partial<AutopsyQuestionContext>;
    validationState?: TrainingQuestionRecord["validationState"];
    expectedTimeSeconds?: number;
    canonical?: boolean;
  }): void {
    const concept = input.concept ?? PERCENTAGES;
    const exam = input.exam ?? EXAM;
    const expectedTimeSeconds = input.expectedTimeSeconds ?? 90;
    const record: TrainingQuestionRecord = {
      question: dna(input.id, { conceptName: concept.name, ...input.dna }),
      expectedTimeSeconds,
      validationState: input.validationState ?? "published"
    };
    this.questionRecordsByExam.set(exam, [...(this.questionRecordsByExam.get(exam) ?? []), record]);
    if (input.canonical !== false) {
      this.canonicals.push({
        id: input.id,
        conceptId: concept.id,
        options: null,
        correctAnswer: ANSWER_KEY,
        expectedTimeSeconds,
        validationState: input.validationState ?? "published"
      });
    }
  }

  /** A real attempt lifecycle (start -> answer -> submit, or start -> skip), persisted via `InMemoryAttemptRepository.save()`. */
  async finalizedAttempt(input: {
    id: string;
    questionId: string;
    correct?: boolean;
    skip?: boolean;
    start: number;
    finalize: number;
    studentId?: string;
    enrollmentId?: string;
    practiceBlockId?: string;
  }): Promise<AttemptState> {
    const studentId = input.studentId ?? STUDENT;
    const claim = { studentId, questionId: input.questionId };
    const started = startAttempt({ id: input.id, studentId, questionId: input.questionId, enrollmentId: input.enrollmentId ?? ENROLLMENT, now: t(input.start) });
    const allocation = input.practiceBlockId ? { practiceBlockId: input.practiceBlockId } : undefined;
    await this.attempts.save(started, allocation);
    const persisted = await this.attempts.findById(input.id);

    let finalized: AttemptState;
    if (input.skip) {
      finalized = skipAttempt(persisted, claim, { now: t(input.finalize) });
    } else {
      const answer = input.correct === false ? "WRONG" : ANSWER_KEY;
      const answered = recordAttemptEvent(persisted, { type: "answer_selected", occurredAt: t(input.start + 1), selectedAnswer: answer }, claim);
      finalized = submitAttempt(
        answered,
        claim,
        { questionId: input.questionId, conceptId: "unused-for-grading", answerFormat: "numeric_entry", options: null, correctAnswer: ANSWER_KEY, expectedTimeSeconds: 90 },
        { now: t(input.finalize) }
      );
    }
    return this.attempts.save(finalized);
  }

  async openAttempt(input: { id: string; questionId: string; start: number; practiceBlockId?: string }): Promise<AttemptState> {
    const started = startAttempt({ id: input.id, studentId: STUDENT, questionId: input.questionId, enrollmentId: ENROLLMENT, now: t(input.start) });
    return this.attempts.save(started, input.practiceBlockId ? { practiceBlockId: input.practiceBlockId } : undefined);
  }

  deps(overrides: Partial<TrainingRecommendationDependencies> = {}): TrainingRecommendationDependencies {
    const repairPlans = () => this.repairPlans;
    return {
      enrollmentReader: new InMemoryEnrollmentReader(this.enrollments),
      attemptHistoryReader: this.attempts,
      repairPlanReader: {
        async findConfirmedActiveByStudentId(studentId: string) {
          return repairPlans().filter((plan) => plan.studentId === studentId);
        }
      },
      trainingQuestionReader: new InMemoryTrainingQuestionReader(this.questionRecordsByExam),
      questionReader: new InMemoryQuestionReader(this.canonicals),
      conceptReader: new InMemoryConceptReader(this.conceptsByExam),
      practiceSessionReader: this.sessions,
      practiceBlockReader: this.blocks,
      now: () => NOW,
      ...overrides
    };
  }
}
