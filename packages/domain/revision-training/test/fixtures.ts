import type { AutopsyQuestionContext, MasteryAttemptRecord, TrainingCandidateQuestion, TrainingSystemContext, ValidationState } from "@ipmat/training-systems";

export const STUDENT = "student-1";
export const NOW = "2026-03-15T12:00:00.000Z";
export const MS_PER_DAY = 86_400_000;

/** An ISO timestamp `days` (may be fractional) before NOW. */
export function daysAgo(days: number, now: string = NOW): string {
  return new Date(Date.parse(now) - days * MS_PER_DAY).toISOString();
}

let questionIdCounter = 0;
export function makeQuestion(overrides: Partial<AutopsyQuestionContext> = {}): AutopsyQuestionContext {
  questionIdCounter += 1;
  return {
    questionId: `question-${String(questionIdCounter).padStart(4, "0")}`,
    examCode: "IPMAT_INDORE",
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: "Percentages",
    patternFamilyName: "Reverse Percentage",
    patternTaxonomyCellId: "cell-a",
    difficultyTier: "standard",
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard",
    examRelevance: "core",
    testingModes: ["direct"],
    trapErrorTaxonomyCode: null,
    combinesWithConcepts: [],
    ...overrides
  };
}

export function makeCandidate(questionOverrides: Partial<AutopsyQuestionContext> = {}, candidateOverrides: Partial<Omit<TrainingCandidateQuestion, "question">> = {}): TrainingCandidateQuestion {
  return { question: makeQuestion(questionOverrides), expectedTimeSeconds: 90, validationState: "published" as ValidationState, ...candidateOverrides };
}

let attemptIdCounter = 0;
export function makeAttemptRecord(overrides: {
  studentId?: string;
  questionId?: string;
  conceptName?: string;
  cell?: string;
  isCorrect?: boolean | null;
  status?: "submitted" | "skipped" | "abandoned";
  finalizedAt?: string | null;
} = {}): MasteryAttemptRecord {
  attemptIdCounter += 1;
  const questionId = overrides.questionId ?? `attempt-question-${attemptIdCounter}`;
  const status = overrides.status ?? "submitted";
  return {
    contribution: {
      attemptId: `attempt-${attemptIdCounter}`,
      studentId: overrides.studentId ?? STUDENT,
      conceptId: overrides.conceptName ?? "Percentages",
      questionId,
      status,
      isCorrect: status === "submitted" ? (overrides.isCorrect === undefined ? true : overrides.isCorrect) : null,
      timeTakenSeconds: 90,
      expectedTimeSeconds: 90,
      hintsUsed: 0,
      skipped: status === "skipped",
      finalizedAt: overrides.finalizedAt === undefined ? daysAgo(30) : overrides.finalizedAt
    },
    question: makeQuestion({ questionId, conceptName: overrides.conceptName ?? "Percentages", patternTaxonomyCellId: overrides.cell ?? "cell-a" })
  };
}

/** `count` graded attempts on one concept whose LATEST finalized time is `latestDaysAgo` (earlier ones are progressively older). */
export function makeConceptHistory(conceptName: string, count: number, latestDaysAgo: number, extra: Parameters<typeof makeAttemptRecord>[0] = {}): MasteryAttemptRecord[] {
  return Array.from({ length: count }, (_, i) => makeAttemptRecord({ conceptName, finalizedAt: daysAgo(latestDaysAgo + i), ...extra }));
}

export function makeContext(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], now: NOW, ...overrides };
}
