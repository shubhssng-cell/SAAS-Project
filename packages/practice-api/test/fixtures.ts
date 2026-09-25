import {
  InMemoryAttemptRepository,
  InMemoryEnrollmentReader,
  InMemoryQuestionContentReader,
  InMemoryQuestionReader,
  type CanonicalQuestion,
  type EnrollmentRecord,
  type StoredAutopsy,
  type StudentQuestionRecord
} from "@ipmat/db";
import { PracticeLoopService } from "@ipmat/practice-loop";
import { TrainingRecommendationService, type TrainingRecommendationDependencies } from "@ipmat/training-recommendation";
import { PracticeApiService } from "../src/service.js";
import type { PracticeApiDependencies } from "../src/types.js";

export const STUDENT = "student-1";
export const OTHER_STUDENT = "student-2";
export const ENROLLMENT = "enrollment-1";
export const OTHER_ENROLLMENT = "enrollment-2";
export const EXAM = "exam-ipmat";
/** A deliberately unique answer-key sentinel (never a plausible number that could accidentally collide with real question text) — the same "prove it never leaks" convention `packages/training-recommendation/test/fixtures.ts` already uses. */
export const ANSWER_KEY = "ANSWER-KEY-7731";

export const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

export const publishedQuestion: CanonicalQuestion = {
  id: "question-1",
  conceptId: "concept-percentages",
  options: null,
  correctAnswer: ANSWER_KEY,
  expectedTimeSeconds: 90,
  validationState: "published"
};

export const publishedQuestionContent: StudentQuestionRecord = {
  id: "question-1",
  chapterName: "Percentages",
  conceptName: "Percentages",
  prompt: "480 is 20% more than what number?",
  answerFormat: "numeric_entry",
  options: null,
  expectedTimeSeconds: 90
};

export const draftQuestion: CanonicalQuestion = {
  id: "question-draft",
  conceptId: "concept-percentages",
  options: null,
  correctAnswer: "100",
  expectedTimeSeconds: 60,
  validationState: "draft"
};

/**
 * A minimal, local test double for `Pick<AutopsyRepository, "findByAttemptId">`
 * — deliberately NOT `@ipmat/db`'s own `InMemoryAutopsyRepository` (that
 * class lives in `packages/db/test/fixtures/`, a different package's OWN
 * test directory, which this package must not reach into — the same
 * boundary `packages/db/test/fixtures/inMemoryRepositories.ts`'s own
 * comment describes). Seeded directly with `StoredAutopsy`-shaped records.
 */
export class FakeAutopsyReader {
  private readonly byAttemptId = new Map<string, StoredAutopsy>();

  seed(record: StoredAutopsy): void {
    this.byAttemptId.set(record.attemptId, record);
  }

  async findByAttemptId(attemptId: string): Promise<StoredAutopsy | null> {
    return this.byAttemptId.get(attemptId) ?? null;
  }
}

export function makeStoredAutopsy(overrides: Partial<StoredAutopsy> = {}): StoredAutopsy {
  return {
    id: "autopsy-1",
    createdAt: t(200),
    attemptId: "attempt-1",
    hypothesisText: "You may have added the percentage instead of finding the original base.",
    errorTaxonomyId: "taxonomy-1",
    likelyRootCause: "misconception",
    evidenceUsed: { supportingEvidence: ["You changed your answer once before submitting."], modelConfidence: "high" },
    confirmed: null,
    confirmedAt: null,
    studentCorrectionText: null,
    generatedByProvider: "fixture",
    promptVersion: "autopsy-hypothesis-v1",
    ...overrides
  };
}

/**
 * A small persisted "world," built entirely from `@ipmat/db`'s own
 * exported production in-memory readers/repositories (never a Prisma
 * client), following the `packages/training-recommendation/test/fixtures.ts`
 * precedent.
 */
export class World {
  readonly enrollments: EnrollmentRecord[] = [
    { id: ENROLLMENT, studentId: STUDENT, examId: EXAM },
    { id: OTHER_ENROLLMENT, studentId: OTHER_STUDENT, examId: EXAM }
  ];
  readonly attempts = new InMemoryAttemptRepository();
  readonly autopsy = new FakeAutopsyReader();
  questions: CanonicalQuestion[] = [publishedQuestion];
  questionContent: StudentQuestionRecord[] = [publishedQuestionContent];

  /** Injected so a test can prove `recommendNextTrainingAction()` failures/results propagate through this boundary unchanged, without needing a full published-question pool for every test. */
  trainingRecommendationOverrides: Partial<TrainingRecommendationDependencies> = {};

  service(): PracticeApiService {
    const questionReader = new InMemoryQuestionReader(this.questions);
    const enrollmentReader = new InMemoryEnrollmentReader(this.enrollments);
    const practiceLoopService = new PracticeLoopService(this.attempts, questionReader);

    const trainingRecommendationDeps: TrainingRecommendationDependencies = {
      enrollmentReader,
      attemptHistoryReader: this.attempts,
      repairPlanReader: { findConfirmedActiveByStudentId: async () => [] },
      trainingQuestionReader: { findPublishedByExamId: async () => [] },
      questionReader,
      conceptReader: { findWithPublishedQuestionsByExamId: async () => [] },
      practiceSessionReader: { findActiveByEnrollmentId: async () => null },
      practiceBlockReader: { findBySessionId: async () => [] },
      now: () => t(100_000),
      ...this.trainingRecommendationOverrides
    };

    const deps: PracticeApiDependencies = {
      trainingRecommendationService: new TrainingRecommendationService(trainingRecommendationDeps),
      practiceLoopService,
      enrollmentReader,
      questionReader,
      questionContentReader: new InMemoryQuestionContentReader(this.questionContent),
      autopsyReader: this.autopsy
    };

    return new PracticeApiService(deps);
  }
}
