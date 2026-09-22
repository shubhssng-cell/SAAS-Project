import type { AttemptAutopsyEvidence } from "@ipmat/attempt";
import {
  buildAutopsyOutput,
  buildRepairPlan,
  confirmHypothesis,
  generateHypothesis,
  type AutopsyHypothesis,
  type AutopsyOutput,
  type AutopsyQuestionContext,
  type ErrorTaxonomyEntry,
  type HistoricalAttemptRecord,
  type RepairPlan
} from "@ipmat/autopsy";
import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import type { RepairCandidateQuestion } from "../src/types.js";

/**
 * Real Question DNA vocabulary — the SAME pattern-family names, trap
 * codes, and error-taxonomy entries used elsewhere in this codebase
 * (packages/domain/question-engine/fixtures/percentagesPatternFamilies.ts,
 * percentagesTaxonomyCells.ts; packages/domain/autopsy/fixtures/
 * errorTaxonomy.ts), not an invented parallel vocabulary (Phase 5C-2 §7).
 */

let attemptIdCounter = 0;
function nextAttemptId(): string {
  attemptIdCounter += 1;
  return `attempt-repair-fixture-${attemptIdCounter}`;
}

export function buildEvidence(overrides: Partial<AttemptAutopsyEvidence> = {}): AttemptAutopsyEvidence {
  return {
    attemptId: nextAttemptId(),
    studentId: "student-1",
    questionId: "question-reverse-percentage-1",
    conceptId: "concept-percentages",
    status: "submitted",
    correctAnswer: "480",
    finalAnswer: "480",
    isCorrect: true,
    answerChangeHistory: { initialAnswer: "480", finalAnswer: "480", changeCount: 0, sequence: [{ answer: "480", occurredAt: "2026-09-22T10:00:30.000Z" }] },
    timeTakenSeconds: 90,
    expectedTimeSeconds: 90,
    hintsUsed: 0,
    solutionOpenedAt: null,
    solutionOpenedBeforeFinalization: null,
    skipped: false,
    eventTimeline: [
      { type: "question_opened", occurredAt: "2026-09-22T10:00:00.000Z", payload: null },
      { type: "answer_selected", occurredAt: "2026-09-22T10:00:30.000Z", payload: { selectedAnswer: "480" } },
      { type: "answer_submitted", occurredAt: "2026-09-22T10:01:30.000Z", payload: { selectedAnswer: "480" } }
    ],
    ...overrides
  };
}

export const percentagesQuestionContext: AutopsyQuestionContext = {
  questionId: "question-reverse-percentage-1",
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  conceptName: "Percentages",
  patternFamilyName: "Reverse Percentage",
  patternTaxonomyCellId: "cell-percentages-reverse-advanced-1",
  difficultyTier: "advanced",
  difficultyDimensions: { conceptualLoad: 0.4, computationalLoad: 0.3, trapDensity: 0.5, representationNovelty: 0.2, timePressure: 0.3, multiStepDepth: 0.4 },
  noveltyLevel: "standard",
  examRelevance: "core",
  testingModes: ["reverse"],
  trapErrorTaxonomyCode: "base_confusion",
  combinesWithConcepts: ["Ratio"]
};

/** Same concept/pattern family/cell, but with a pressure-context testing mode and non-standard novelty — for history that drives `timed_pressure_drill`/`novelty_exposure`. */
export const percentagesNovelPressureQuestionContext: AutopsyQuestionContext = {
  ...percentagesQuestionContext,
  questionId: "question-percentages-novel-pressure-1",
  noveltyLevel: "novel_representation",
  testingModes: ["reverse", "time_pressured", "novel_representation"]
};

export const errorTaxonomyFixture: ErrorTaxonomyEntry[] = [
  { code: "base_confusion", label: "Base confusion", description: "Applied a percentage change to the wrong base quantity.", category: "misconception" },
  { code: "successive_change_error", label: "Successive change error", description: "Added/subtracted successive percentage changes instead of compounding.", category: "method_selection_mistake" },
  { code: "percentage_point_confusion", label: "Percentage point confusion", description: "Confused an absolute percentage-point difference with a relative change.", category: "interpretation_mistake" },
  { code: "misread_question", label: "Misread question", description: "Answered a different question than the one actually asked.", category: "interpretation_mistake" }
];

export function historicalRecord(overrides: Partial<AttemptAutopsyEvidence> = {}, question: AutopsyQuestionContext = percentagesQuestionContext): HistoricalAttemptRecord {
  return { evidence: buildEvidence({ questionId: question.questionId, ...overrides }), question };
}

// ---------------------------------------------------------------------
// Candidate question builders — reusing the SAME 4 real pattern families /
// trap codes as packages/domain/question-engine/fixtures/percentages*.ts
// ---------------------------------------------------------------------

let candidateIdCounter = 0;
function nextCandidateSuffix(): string {
  candidateIdCounter += 1;
  return String(candidateIdCounter);
}

export function makeCandidate(overrides: Partial<AutopsyQuestionContext & { expectedTimeSeconds: number; validationState: RepairCandidateQuestion["validationState"] }> = {}): RepairCandidateQuestion {
  const suffix = nextCandidateSuffix();
  const { expectedTimeSeconds, validationState, ...questionOverrides } = overrides;
  const question: AutopsyQuestionContext = {
    ...percentagesQuestionContext,
    questionId: `question-candidate-${suffix}`,
    patternTaxonomyCellId: `cell-candidate-${suffix}`,
    ...questionOverrides
  };
  return {
    question,
    expectedTimeSeconds: expectedTimeSeconds ?? 90,
    validationState: validationState ?? "published"
  };
}

export interface BuildConfirmedPlanOptions {
  currentEvidenceOverrides?: Partial<AttemptAutopsyEvidence>;
  currentQuestion?: AutopsyQuestionContext;
  priorAttempts?: HistoricalAttemptRecord[];
  aiOverrides?: Partial<AutopsyHypothesisAiOutput>;
}

/**
 * Runs the REAL Phase 5A/5B chain (`buildAutopsyOutput` -> `generateHypothesis`
 * via `FixtureProvider` -> `confirmHypothesis` -> `buildRepairPlan`) to
 * produce a genuinely confirmed `RepairPlan` — never a hand-constructed
 * object pretending to be one, so every selector test exercises the real
 * confirmation gate, not a shortcut around it.
 */
export async function buildConfirmedRepairPlan(options: BuildConfirmedPlanOptions = {}): Promise<{ plan: RepairPlan; output: AutopsyOutput; hypothesis: AutopsyHypothesis }> {
  const question = options.currentQuestion ?? percentagesQuestionContext;
  const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420", questionId: question.questionId, ...options.currentEvidenceOverrides });
  const output = buildAutopsyOutput({ evidence, question, errorTaxonomy: errorTaxonomyFixture, priorAttempts: options.priorAttempts });

  const aiHypothesis: AutopsyHypothesisAiOutput = {
    proposedErrorCategory: output.candidateErrorEvidence?.proposedErrorCategory ?? "misconception",
    proposedExplanation: "Applied the percentage change to the wrong base quantity.",
    supportingEvidence: ["Matched the designated trap."],
    contradictoryEvidence: [],
    missingEvidence: [],
    modelConfidence: 0.7,
    ...options.aiOverrides
  };
  const provider = new FixtureProvider([JSON.stringify(aiHypothesis)]);
  const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
  const confirmed = confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
  const plan = buildRepairPlan(confirmed, output);
  return { plan, output, hypothesis: confirmed };
}
