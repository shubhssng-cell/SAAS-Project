import {
  InMemoryAttemptRepository,
  InMemoryConceptReader,
  InMemoryEnrollmentReader,
  InMemoryQuestionContentReader,
  InMemoryQuestionReader,
  InMemoryTrainingQuestionReader,
  InMemoryTrainingSessionRepository,
  type CanonicalQuestion,
  type ConceptRecord,
  type EnrollmentRecord,
  type StudentQuestionRecord,
  type TrainingQuestionRecord
} from "@ipmat/db";
import { PracticeLoopService } from "@ipmat/practice-loop";
import { TrainingRecommendationService } from "@ipmat/training-recommendation";
import { PracticeApiService } from "../src/service.js";
import { TrainingApiService } from "../src/trainingService.js";
import type { StudentRequestClaim } from "../src/types.js";

export const STUDENT = "student-1";
export const OTHER_STUDENT = "student-2";
export const ENROLLMENT = "enrollment-1";
export const OTHER_ENROLLMENT = "enrollment-2";
export const EXAM = "exam-ipmat";
export const CLAIM: StudentRequestClaim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
export const OTHER_CLAIM: StudentRequestClaim = { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT };
/** Never a plausible number or word -- so a leak of any answer key into a view is unmistakable. */
export const ANSWER_KEY = "ANSWER-KEY-7731";
export const CORRECT = ANSWER_KEY;
export const WRONG = "WRONG-CHOICE";

/** A fixed, controllable clock: seconds after a base instant. */
export const t = (offsetSeconds: number): string => new Date(Date.parse("2026-10-01T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

type NoveltyLevel = "standard" | "novel_representation" | "novel_context" | "novel_combination";

export interface WorldQuestion {
  id: string;
  noveltyLevel: NoveltyLevel;
  validationState?: "published" | "ai_validated";
  cell?: string;
  /** `difficultyDimensions.computationalLoad` (default 0.2). */
  load?: number;
  /** `difficultyDimensions.conceptualLoad` (default 0.2). */
  conceptual?: number;
  /** `testingModes` (default `["direct"]`). */
  modes?: Array<"direct" | "multi_step" | "time_pressured">;
  /** `trapErrorTaxonomyCode` (default none). */
  trap?: string | null;
  /** Concept name (default "Percentages"). */
  concept?: string;
  /** A structurally malformed candidate: no `difficultyDimensions` at all (the provider must exclude it, never crash or serve it). */
  malformed?: boolean;
}

function trainingRecord(q: WorldQuestion): TrainingQuestionRecord {
  return {
    question: {
      questionId: q.id,
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      conceptName: q.concept ?? "Percentages",
      patternFamilyName: "Reverse Percentage",
      patternTaxonomyCellId: q.cell ?? `cell-${q.id}`,
      difficultyTier: "standard",
      difficultyDimensions: q.malformed ? undefined : { conceptualLoad: q.conceptual ?? 0.2, computationalLoad: q.load ?? 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
      noveltyLevel: q.noveltyLevel,
      examRelevance: "core",
      testingModes: q.modes ?? ["direct"],
      trapErrorTaxonomyCode: q.trap ?? null,
      combinesWithConcepts: []
    },
    expectedTimeSeconds: 90,
    validationState: q.validationState ?? "published"
  } as TrainingQuestionRecord;
}

/**
 * One persisted in-memory world (the real `@ipmat/db` in-memory repositories, shared the way `apps/api`'s wiring shares them) with a
 * published question pool shaped so Novelty Training is applicable: 9 history questions (3 each at standard / novel_representation /
 * novel_context, to be answered by `seedHistory()`) and `novelCount` unattempted `novel_combination` questions -- the one underexposed level.
 */
export class TrainingWorld {
  readonly enrollments: EnrollmentRecord[] = [
    { id: ENROLLMENT, studentId: STUDENT, examId: EXAM },
    { id: OTHER_ENROLLMENT, studentId: OTHER_STUDENT, examId: EXAM }
  ];
  readonly trainingSessions = new InMemoryTrainingSessionRepository({
    resolveStudentId: async (enrollmentId) => this.enrollments.find((e) => e.id === enrollmentId)?.studentId ?? null
  });
  readonly attempts = new InMemoryAttemptRepository({ practiceBlocks: this.trainingSessions.blockOwnership, enforceSingleOpenAttempt: true });
  readonly historyIds: string[] = [];
  readonly novelIds: string[] = [];
  readonly pool: WorldQuestion[] = [];
  /** Extra questions that must never be served (unpublished). */
  readonly drafts: WorldQuestion[] = [];

  constructor(novelCount = 4, customPool?: WorldQuestion[]) {
    if (customPool) {
      this.pool.push(...customPool);
      return;
    }
    for (const [level, prefix] of [["standard", "h-std"], ["novel_representation", "h-rep"], ["novel_context", "h-ctx"]] as const) {
      for (let i = 1; i <= 3; i += 1) {
        const id = `${prefix}-${i}`;
        this.historyIds.push(id);
        this.pool.push({ id, noveltyLevel: level });
      }
    }
    for (let i = 1; i <= novelCount; i += 1) {
      const id = `novel-${i}`;
      this.novelIds.push(id);
      this.pool.push({ id, noveltyLevel: "novel_combination" });
    }
  }

  addDraft(id: string): void {
    this.drafts.push({ id, noveltyLevel: "novel_combination", validationState: "ai_validated" });
  }

  private allQuestions(): WorldQuestion[] {
    return [...this.pool, ...this.drafts];
  }

  private canonical(): CanonicalQuestion[] {
    return this.allQuestions().map((q) => ({
      id: q.id,
      conceptId: `concept-${(q.concept ?? "Percentages").toLowerCase()}`,
      options: null,
      correctAnswer: ANSWER_KEY,
      expectedTimeSeconds: 90,
      validationState: q.validationState === "ai_validated" ? "ai_validated" : "published"
    })) as CanonicalQuestion[];
  }

  private content(): StudentQuestionRecord[] {
    return this.pool.map((q) => ({ id: q.id, chapterName: "Percentages", conceptName: q.concept ?? "Percentages", prompt: `Prompt for ${q.id}`, answerFormat: "numeric_entry", options: null, expectedTimeSeconds: 90 }));
  }

  /** A fresh set of services over the SAME persisted state -- what a restart (or a second API instance) looks like. */
  boot(): { practice: PracticeApiService; training: TrainingApiService } {
    const questionReader = new InMemoryQuestionReader(this.canonical());
    const enrollmentReader = new InMemoryEnrollmentReader(this.enrollments);
    const concepts: ConceptRecord[] = [...new Set(this.allQuestions().map((q) => q.concept ?? "Percentages"))].map((name) => ({ id: `concept-${name.toLowerCase()}`, name, chapterId: "chapter-1" }));
    const recommendation = new TrainingRecommendationService({
      enrollmentReader,
      attemptHistoryReader: this.attempts,
      repairPlanReader: { findConfirmedActiveByStudentId: async () => [] },
      trainingQuestionReader: new InMemoryTrainingQuestionReader(new Map([[EXAM, this.allQuestions().map(trainingRecord)]])),
      questionReader,
      conceptReader: new InMemoryConceptReader(new Map([[EXAM, concepts]])),
      practiceSessionReader: this.trainingSessions.practiceSessions,
      practiceBlockReader: this.trainingSessions.practiceBlocks,
      now: () => t(100_000)
    });
    const practice = new PracticeApiService({
      trainingRecommendationService: recommendation,
      practiceLoopService: new PracticeLoopService(this.attempts, questionReader, this.trainingSessions.blockReader),
      inProgressAttemptReader: this.attempts,
      enrollmentReader,
      questionReader,
      questionContentReader: new InMemoryQuestionContentReader(this.content()),
      autopsyReader: { findByAttemptId: async () => null }
    });
    const training = new TrainingApiService({
      trainingRecommendationService: recommendation,
      trainingSessionRepository: this.trainingSessions,
      attemptHistoryReader: this.attempts,
      enrollmentReader,
      questionContentReader: new InMemoryQuestionContentReader(this.content()),
      practiceApi: practice
    });
    return { practice, training };
  }

  /** Answers the named questions, in order, as ordinary (ungrouped) practice; `correct` decides whether the correct answer or a wrong one is submitted. */
  async answer(practice: PracticeApiService, plan: Array<{ id: string; correct: boolean; seconds?: number }>, claim: StudentRequestClaim = CLAIM, startSecond = 0): Promise<void> {
    let second = startSecond;
    for (const step of plan) {
      const started = await practice.startAttempt(claim, { questionId: step.id, now: t(second) });
      await practice.submitAttempt(claim, { attemptId: started.attemptId, questionId: step.id, chosenAnswer: step.correct ? CORRECT : WRONG, now: t(second + (step.seconds ?? 60)) });
      second += Math.max(120, (step.seconds ?? 60) + 60);
    }
  }

  /** Answers every history question (ordinary, ungrouped practice) so Novelty Training becomes applicable. */
  async seedHistory(practice: PracticeApiService, claim: StudentRequestClaim = CLAIM): Promise<void> {
    let second = 0;
    for (const questionId of this.historyIds) {
      const started = await practice.startAttempt(claim, { questionId, now: t(second) });
      await practice.submitAttempt(claim, { attemptId: started.attemptId, questionId, chosenAnswer: CORRECT, now: t(second + 60) });
      second += 120;
    }
  }
}

export const COMPLETE_5 = { completion: { kind: "fixed_question_count", questionCount: 5 } } as const;
export const COMPLETE_2 = { completion: { kind: "fixed_question_count", questionCount: 2 } } as const;
export const TIMED_10_MIN = { completion: { kind: "fixed_duration", durationSeconds: 600 } } as const;
