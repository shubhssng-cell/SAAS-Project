import type { AttemptMasteryContribution } from "@ipmat/attempt";
import type { AutopsyQuestionContext } from "@ipmat/autopsy";
import type { MasteryAttemptRecord, PatternTaxonomyCellData } from "../src/types.js";

export const STUDENT_ID = "student-1";
export const CONCEPT_ID = "concept-percentages";
export const CONCEPT_NAME = "Percentages";

export const standardQuestion: AutopsyQuestionContext = {
  questionId: "question-standard-1",
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  conceptName: CONCEPT_NAME,
  patternFamilyName: "Reverse Percentage",
  patternTaxonomyCellId: "cell-standard-1",
  difficultyTier: "standard",
  difficultyDimensions: {
    conceptualLoad: 0.2,
    computationalLoad: 0.2,
    trapDensity: 0.15,
    representationNovelty: 0.05,
    timePressure: 0.1,
    multiStepDepth: 0.1
  },
  noveltyLevel: "standard",
  examRelevance: "core",
  testingModes: ["direct"],
  trapErrorTaxonomyCode: null,
  combinesWithConcepts: []
};

export const hardNovelQuestion: AutopsyQuestionContext = {
  ...standardQuestion,
  questionId: "question-hard-novel-1",
  patternTaxonomyCellId: "cell-hard-novel-1",
  difficultyTier: "hard",
  noveltyLevel: "novel_representation",
  testingModes: ["reverse", "novel_representation"]
};

export const pressureQuestion: AutopsyQuestionContext = {
  ...standardQuestion,
  questionId: "question-pressure-1",
  patternTaxonomyCellId: "cell-pressure-1",
  difficultyTier: "advanced",
  testingModes: ["direct", "time_pressured"]
};

export const otherPatternFamilyQuestion: AutopsyQuestionContext = {
  ...standardQuestion,
  questionId: "question-other-family-1",
  patternFamilyName: "Successive Percentage Change",
  patternTaxonomyCellId: "cell-other-family-1"
};

let attemptCounter = 0;
function nextAttemptId(): string {
  attemptCounter += 1;
  return `mastery-attempt-${attemptCounter}`;
}

const BASE_MS = Date.parse("2026-09-22T10:00:00.000Z");

export function buildContribution(overrides: Partial<AttemptMasteryContribution> = {}): AttemptMasteryContribution {
  return {
    attemptId: nextAttemptId(),
    studentId: STUDENT_ID,
    conceptId: CONCEPT_ID,
    questionId: standardQuestion.questionId,
    status: "submitted",
    isCorrect: true,
    timeTakenSeconds: 60,
    expectedTimeSeconds: 90,
    hintsUsed: 0,
    skipped: false,
    finalizedAt: new Date(BASE_MS).toISOString(),
    ...overrides
  };
}

/** Builds a record at a given minute offset (for deterministic finalizedAt ordering across many fixtures). */
export function record(
  offsetMinutes: number,
  contributionOverrides: Partial<AttemptMasteryContribution> = {},
  question: AutopsyQuestionContext = standardQuestion
): MasteryAttemptRecord {
  return {
    contribution: buildContribution({
      questionId: question.questionId,
      finalizedAt: new Date(BASE_MS + offsetMinutes * 60_000).toISOString(),
      ...contributionOverrides
    }),
    question
  };
}

export const percentagesTaxonomyCells: PatternTaxonomyCellData[] = [
  {
    patternFamilyName: "Reverse Percentage",
    conceptName: CONCEPT_NAME,
    combination: [],
    testingMode: "direct",
    trapErrorTaxonomyCode: null,
    difficultyTier: "standard",
    targetTimeSeconds: 90,
    coverageStatus: "covered"
  },
  {
    patternFamilyName: "Reverse Percentage",
    conceptName: CONCEPT_NAME,
    combination: [],
    testingMode: "reverse",
    trapErrorTaxonomyCode: null,
    difficultyTier: "hard",
    targetTimeSeconds: 120,
    coverageStatus: "uncovered"
  },
  {
    patternFamilyName: "Successive Percentage Change",
    conceptName: CONCEPT_NAME,
    combination: [],
    testingMode: "combined",
    trapErrorTaxonomyCode: null,
    difficultyTier: "advanced",
    targetTimeSeconds: 100,
    coverageStatus: "uncovered"
  },
  {
    patternFamilyName: "Successive Percentage Change",
    conceptName: CONCEPT_NAME,
    combination: [],
    testingMode: "time_pressured",
    trapErrorTaxonomyCode: null,
    difficultyTier: "advanced",
    targetTimeSeconds: 100,
    coverageStatus: "uncovered"
  }
];
