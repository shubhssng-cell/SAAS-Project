import type { AutopsyQuestionContext, MasteryAttemptRecord, NoveltyLevel, TrainingCandidateQuestion, ValidationState } from "@ipmat/training-systems";

export const STUDENT = "student-1";

let questionIdCounter = 0;
export function makeQuestion(overrides: Partial<AutopsyQuestionContext> = {}): AutopsyQuestionContext {
  questionIdCounter += 1;
  return {
    questionId: `question-${questionIdCounter}`,
    examCode: "IPMAT_INDORE",
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: "Percentages",
    patternFamilyName: "Reverse Percentage",
    patternTaxonomyCellId: "cell-reverse-standard",
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

export function makeCandidate(
  questionOverrides: Partial<AutopsyQuestionContext> = {},
  candidateOverrides: Partial<Omit<TrainingCandidateQuestion, "question">> = {}
): TrainingCandidateQuestion {
  return { question: makeQuestion(questionOverrides), expectedTimeSeconds: 90, validationState: "published" as ValidationState, ...candidateOverrides };
}

let attemptIdCounter = 0;
export function makeAttemptRecord(overrides: {
  studentId?: string;
  questionId?: string;
  conceptName?: string;
  noveltyLevel?: NoveltyLevel;
  patternTaxonomyCellId?: string;
  patternFamilyName?: string;
  combinesWithConcepts?: string[];
  isCorrect?: boolean | null;
  status?: "submitted" | "skipped" | "abandoned";
} = {}): MasteryAttemptRecord {
  attemptIdCounter += 1;
  const questionId = overrides.questionId ?? `attempt-question-${attemptIdCounter}`;
  return {
    contribution: {
      attemptId: `attempt-${attemptIdCounter}`,
      studentId: overrides.studentId ?? STUDENT,
      conceptId: overrides.conceptName ?? "Percentages",
      questionId,
      status: overrides.status ?? "submitted",
      isCorrect: overrides.isCorrect === undefined ? true : overrides.isCorrect,
      timeTakenSeconds: 90,
      expectedTimeSeconds: 90,
      hintsUsed: 0,
      skipped: overrides.status === "skipped",
      finalizedAt: "2026-01-01T00:00:00.000Z"
    },
    question: makeQuestion({
      questionId,
      conceptName: overrides.conceptName ?? "Percentages",
      patternTaxonomyCellId: overrides.patternTaxonomyCellId ?? "cell-reverse-standard",
      patternFamilyName: overrides.patternFamilyName ?? "Reverse Percentage",
      noveltyLevel: overrides.noveltyLevel ?? "standard",
      combinesWithConcepts: overrides.combinesWithConcepts ?? []
    })
  };
}

/** N distinct attempt records at the given noveltyLevel (distinct questionIds) -- the standard way to build exposure counts in tests. */
export function makeExposureBatch(count: number, overrides: Parameters<typeof makeAttemptRecord>[0] = {}): MasteryAttemptRecord[] {
  return Array.from({ length: count }, () => makeAttemptRecord(overrides));
}
