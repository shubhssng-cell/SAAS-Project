import type { AutopsyQuestionContext, MasteryAttemptRecord, TrainingCandidateQuestion, ValidationState } from "@ipmat/training-systems";

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
    trapErrorTaxonomyCode: "base_confusion",
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
  conceptualLoad?: number;
  testingModes?: AutopsyQuestionContext["testingModes"];
  isCorrect?: boolean | null;
  status?: "submitted" | "skipped" | "abandoned";
  timeTakenSeconds?: number | null;
  expectedTimeSeconds?: number | null;
  hintsUsed?: number;
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
      timeTakenSeconds: overrides.timeTakenSeconds === undefined ? 90 : overrides.timeTakenSeconds,
      expectedTimeSeconds: overrides.expectedTimeSeconds === undefined ? 90 : overrides.expectedTimeSeconds,
      hintsUsed: overrides.hintsUsed ?? 0,
      skipped: overrides.status === "skipped",
      finalizedAt: "2026-01-01T00:00:00.000Z"
    },
    question: makeQuestion({
      questionId,
      conceptName: overrides.conceptName ?? "Percentages",
      difficultyDimensions: {
        conceptualLoad: overrides.conceptualLoad ?? 0.2,
        computationalLoad: 0.2,
        trapDensity: 0.15,
        representationNovelty: 0.05,
        timePressure: 0.1,
        multiStepDepth: 0.1
      },
      testingModes: overrides.testingModes ?? ["direct"]
    })
  };
}

/** N correct-and-slow (speedRatio 1.5) attempts by default -- override timeTakenSeconds/expectedTimeSeconds for other ratios. */
export function makeSlowCorrectBatch(count: number, overrides: Parameters<typeof makeAttemptRecord>[0] = {}): MasteryAttemptRecord[] {
  return Array.from({ length: count }, () => makeAttemptRecord({ isCorrect: true, timeTakenSeconds: 135, expectedTimeSeconds: 90, ...overrides }));
}

/** N correct-and-fast (speedRatio 0.6) attempts by default. */
export function makeFastCorrectBatch(count: number, overrides: Parameters<typeof makeAttemptRecord>[0] = {}): MasteryAttemptRecord[] {
  return Array.from({ length: count }, () => makeAttemptRecord({ isCorrect: true, timeTakenSeconds: 54, expectedTimeSeconds: 90, ...overrides }));
}
