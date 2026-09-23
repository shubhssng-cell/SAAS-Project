import type { AutopsyQuestionContext, MasteryAttemptRecord, TrainingCandidateQuestion, TrainingPracticeBlockContext, TrainingSystemContext, ValidationState } from "@ipmat/training-systems";

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

/** Full control over every field a block-membership/ordering/validation test needs -- unlike sibling fixtures, `attemptId` and `finalizedAt` are always caller-supplied, never auto-generated, since ordering/duplication/correlation tests depend on precise values. */
export function makeAttemptRecord(input: {
  attemptId: string;
  studentId?: string;
  conceptName?: string;
  status?: "submitted" | "skipped" | "abandoned";
  isCorrect?: boolean | null;
  hintsUsed?: number;
  finalizedAt?: string | null;
  patternTaxonomyCellId?: string;
  questionId?: string;
}): MasteryAttemptRecord {
  const questionId = input.questionId ?? `${input.attemptId}-question`;
  return {
    contribution: {
      attemptId: input.attemptId,
      studentId: input.studentId ?? STUDENT,
      conceptId: input.conceptName ?? "Percentages",
      questionId,
      status: input.status ?? "submitted",
      isCorrect: input.isCorrect === undefined ? true : input.isCorrect,
      timeTakenSeconds: 60,
      expectedTimeSeconds: 90,
      hintsUsed: input.hintsUsed ?? 0,
      skipped: input.status === "skipped",
      finalizedAt: input.finalizedAt === undefined ? "2026-01-01T00:00:00.000Z" : input.finalizedAt
    },
    question: makeQuestion({ questionId, conceptName: input.conceptName ?? "Percentages", patternTaxonomyCellId: input.patternTaxonomyCellId ?? "cell-reverse-standard" })
  };
}

/**
 * A `TrainingPracticeBlockContext` with sensible, non-triggering defaults
 * (median gap well above `SHORT_RECOVERY_GAP_SECONDS`, no configured
 * budget) -- override only the fields a given test cares about, so each
 * test's intent stays legible.
 */
export function makeBlockContext(overrides: Partial<TrainingPracticeBlockContext> & { attemptIdsInOrder: string[] }): TrainingPracticeBlockContext {
  const n = overrides.attemptIdsInOrder.length;
  return {
    practiceBlockId: `block-${overrides.attemptIdsInOrder.join("-")}`,
    targetQuestionCount: null,
    blockTimeBudgetSeconds: null,
    wallClockDurationSeconds: null,
    activeSolvingTimeSeconds: 60 * n,
    interAttemptGapsSeconds: Array.from({ length: Math.max(0, n - 1) }, () => 30),
    ...overrides
  };
}

/** Builds `n` attempt records (ids `${prefix}-1..n`) all correct, all in the same concept, evenly spaced `finalizedAt` timestamps 60s apart starting at `startIsoMs`, plus a matching, non-triggering `TrainingPracticeBlockContext`. */
export function makeQualifyingBlock(
  prefix: string,
  n: number,
  options: { conceptName?: string; correctness?: boolean[]; startEpochMs?: number } = {}
): { attempts: MasteryAttemptRecord[]; block: TrainingPracticeBlockContext } {
  const conceptName = options.conceptName ?? "Percentages";
  const startEpochMs = options.startEpochMs ?? Date.parse("2026-01-01T00:00:00.000Z");
  const attempts: MasteryAttemptRecord[] = [];
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${prefix}-${i + 1}`;
    ids.push(id);
    const isCorrect = options.correctness ? options.correctness[i]! : true;
    attempts.push(makeAttemptRecord({ attemptId: id, conceptName, isCorrect, finalizedAt: new Date(startEpochMs + i * 60_000).toISOString() }));
  }
  const block = makeBlockContext({ practiceBlockId: `block-${prefix}`, attemptIdsInOrder: ids });
  return { attempts, block };
}

export function makeContext(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}
