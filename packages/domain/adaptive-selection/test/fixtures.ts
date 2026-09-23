import { computeMasteryState } from "@ipmat/mastery";
import type { AdaptiveCandidateQuestion, AutopsyQuestionContext, MasteryAttemptRecord, MasteryStateResult } from "../src/types.js";

export const STUDENT = "student-1";
export const CONCEPT = "Percentages";
export const CONCEPT_ID = "concept-percentages";

export const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

function conceptIdFor(conceptName: string): string {
  return `concept-${conceptName.toLowerCase().replace(/\s+/g, "-")}`;
}

let questionIdCounter = 0;
export function makeQuestion(overrides: Partial<AutopsyQuestionContext> = {}): AutopsyQuestionContext {
  questionIdCounter += 1;
  return {
    questionId: `question-${questionIdCounter}`,
    examCode: "IPMAT_INDORE",
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: CONCEPT,
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

export function makeCandidate(
  questionOverrides: Partial<AutopsyQuestionContext> = {},
  candidateOverrides: Partial<Omit<AdaptiveCandidateQuestion, "question">> = {}
): AdaptiveCandidateQuestion {
  return {
    question: makeQuestion(questionOverrides),
    expectedTimeSeconds: 90,
    validationState: "published",
    ...candidateOverrides
  };
}

let attemptIdCounter = 0;
export function makeAttemptRecord(input: {
  isCorrect: boolean | null;
  question?: Partial<AutopsyQuestionContext>;
  timeTakenSeconds?: number | null;
  expectedTimeSeconds?: number | null;
  offsetSeconds?: number;
  status?: "submitted" | "skipped" | "abandoned";
  questionId?: string;
  studentId?: string;
}): MasteryAttemptRecord {
  attemptIdCounter += 1;
  const question = makeQuestion({ questionId: input.questionId ?? `history-question-${attemptIdCounter}`, ...input.question });
  return {
    contribution: {
      attemptId: `attempt-${attemptIdCounter}`,
      studentId: input.studentId ?? STUDENT,
      conceptId: conceptIdFor(question.conceptName),
      questionId: question.questionId,
      status: input.status ?? "submitted",
      isCorrect: input.isCorrect,
      timeTakenSeconds: input.timeTakenSeconds ?? 90,
      expectedTimeSeconds: input.expectedTimeSeconds ?? 90,
      hintsUsed: 0,
      skipped: input.status === "skipped",
      finalizedAt: t(input.offsetSeconds ?? attemptIdCounter * 60)
    },
    question
  };
}

export function computeMasteryFor(records: MasteryAttemptRecord[], conceptName: string = CONCEPT): MasteryStateResult {
  return computeMasteryState(records, { studentId: STUDENT, conceptId: conceptIdFor(conceptName), conceptName, now: t(1_000_000) });
}
