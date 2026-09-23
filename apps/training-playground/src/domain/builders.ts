import type { AutopsyQuestionContext, MasteryAttemptRecord, TrainingCandidateQuestion, ValidationState } from "@ipmat/training-systems";
import type { RepairPlan } from "@ipmat/autopsy";

/**
 * Small, deterministic fixture builders shared by every scenario in
 * `scenarios.ts`. Clearly synthetic data only (`STUDENT`, `question-N`
 * ids, a fixed 2026 timestamp) -- never implying a real student's
 * history (docs/DECISIONS.md D-057).
 */
export const PLAYGROUND_STUDENT_ID = "playground-student";
const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

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
  computationalLoad?: number;
  conceptualLoad?: number;
  trapErrorTaxonomyCode?: string | null;
  patternTaxonomyCellId?: string;
  patternFamilyName?: string;
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
      studentId: overrides.studentId ?? PLAYGROUND_STUDENT_ID,
      conceptId: overrides.conceptName ?? "Percentages",
      questionId,
      status: overrides.status ?? "submitted",
      isCorrect: overrides.isCorrect === undefined ? true : overrides.isCorrect,
      timeTakenSeconds: overrides.timeTakenSeconds === undefined ? 90 : overrides.timeTakenSeconds,
      expectedTimeSeconds: overrides.expectedTimeSeconds === undefined ? 90 : overrides.expectedTimeSeconds,
      hintsUsed: overrides.hintsUsed ?? 0,
      skipped: overrides.status === "skipped",
      finalizedAt: FIXED_TIMESTAMP
    },
    question: makeQuestion({
      questionId,
      conceptName: overrides.conceptName ?? "Percentages",
      patternTaxonomyCellId: overrides.patternTaxonomyCellId ?? "cell-reverse-standard",
      patternFamilyName: overrides.patternFamilyName ?? "Reverse Percentage",
      trapErrorTaxonomyCode: overrides.trapErrorTaxonomyCode === undefined ? null : overrides.trapErrorTaxonomyCode,
      testingModes: overrides.testingModes ?? ["direct"],
      difficultyDimensions: {
        conceptualLoad: overrides.conceptualLoad ?? 0.2,
        computationalLoad: overrides.computationalLoad ?? 0.2,
        trapDensity: 0.15,
        representationNovelty: 0.05,
        timePressure: 0.1,
        multiStepDepth: 0.1
      }
    })
  };
}

export function makeConfirmedRepairPlan(overrides: Partial<RepairPlan> = {}): RepairPlan {
  return {
    targetConceptName: "Percentages",
    targetPatternFamilyName: "Reverse Percentage",
    targetTaxonomyCellId: "cell-reverse-standard",
    targetErrorCategory: "trap",
    targetErrorTaxonomyCode: "base_confusion",
    recommendedTrainingMode: "standard_practice",
    priority: "high",
    rationale: ["Repeated incorrect attempts on this taxonomy cell, confirmed by the student as a base-confusion trap."],
    prerequisites: [],
    confirmationSource: { attemptId: "attempt-original-diagnosis", hypothesisConfirmedAt: FIXED_TIMESTAMP },
    ...overrides
  };
}
