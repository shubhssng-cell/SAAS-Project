import type { AutopsyQuestionContext, ErrorTaxonomyEntry, MasteryAttemptRecord, TrainingCandidateQuestion, ValidationState } from "@ipmat/training-systems";

export const STUDENT = "student-1";
export const TRAP_CODE = "base_confusion";

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
    trapErrorTaxonomyCode: TRAP_CODE,
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
  trapErrorTaxonomyCode?: string | null;
  patternTaxonomyCellId?: string;
  patternFamilyName?: string;
  isCorrect?: boolean | null;
  status?: "submitted" | "skipped" | "abandoned";
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
      isCorrect: overrides.isCorrect === undefined ? false : overrides.isCorrect,
      timeTakenSeconds: 90,
      expectedTimeSeconds: 90,
      hintsUsed: overrides.hintsUsed ?? 0,
      skipped: overrides.status === "skipped",
      finalizedAt: "2026-01-01T00:00:00.000Z"
    },
    question: makeQuestion({
      questionId,
      conceptName: overrides.conceptName ?? "Percentages",
      patternTaxonomyCellId: overrides.patternTaxonomyCellId ?? "cell-reverse-standard",
      patternFamilyName: overrides.patternFamilyName ?? "Reverse Percentage",
      trapErrorTaxonomyCode: overrides.trapErrorTaxonomyCode === undefined ? TRAP_CODE : overrides.trapErrorTaxonomyCode
    })
  };
}

/** N distinct incorrect trap-tagged attempts (distinct questionIds) for the given code -- the standard way to establish recurrence in tests. */
export function makeFailingBatch(count: number, overrides: Parameters<typeof makeAttemptRecord>[0] = {}): MasteryAttemptRecord[] {
  return Array.from({ length: count }, () => makeAttemptRecord({ isCorrect: false, ...overrides }));
}

export function makeErrorTaxonomyEntry(overrides: Partial<ErrorTaxonomyEntry> = {}): ErrorTaxonomyEntry {
  return { code: TRAP_CODE, label: "Base confusion", description: "Confuses the base of a percentage change.", category: "trap", ...overrides };
}
