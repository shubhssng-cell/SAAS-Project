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
  computationalLoad?: number;
  testingModes?: AutopsyQuestionContext["testingModes"];
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
      timeTakenSeconds: 60,
      expectedTimeSeconds: 90,
      hintsUsed: 0,
      skipped: false,
      finalizedAt: "2026-01-01T00:00:00.000Z"
    },
    question: makeQuestion({
      questionId,
      conceptName: overrides.conceptName ?? "Percentages",
      difficultyDimensions: {
        conceptualLoad: 0.2,
        computationalLoad: overrides.computationalLoad ?? 0.2,
        trapDensity: 0.15,
        representationNovelty: 0.05,
        timePressure: 0.1,
        multiStepDepth: 0.1
      },
      testingModes: overrides.testingModes ?? ["direct"]
    })
  };
}

/** Builds N graded attempt records at a given computationalLoad/correctness, for slice-evidence tests. */
export function makeGradedBatch(
  count: number,
  correctCount: number,
  overrides: { studentId?: string; conceptName?: string; computationalLoad?: number; testingModes?: AutopsyQuestionContext["testingModes"] } = {}
): MasteryAttemptRecord[] {
  return Array.from({ length: count }, (_, i) => makeAttemptRecord({ ...overrides, isCorrect: i < correctCount }));
}
