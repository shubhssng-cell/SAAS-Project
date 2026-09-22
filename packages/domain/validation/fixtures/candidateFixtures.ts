import type { QuestionCandidateAiOutput } from "@ipmat/ai";
import type { BlueprintExpectation } from "../src/qualityValidators.js";

/**
 * Deterministic fixtures for every rejection path (docs/QUESTION_ENGINE.md
 * §10 / Phase 3 §10). Each one is designed to fail exactly one validator
 * so tests can assert the specific rejection reason, not just "it failed."
 */

export const demoBlueprintExpectation: BlueprintExpectation = {
  id: "bp-percentages-reverse-ratio-advanced-1",
  conceptName: "Percentages",
  patternFamilyName: "Reverse Percentage",
  difficultyTier: "advanced",
  requiredTestingModes: ["reverse"],
  trapErrorTaxonomyCode: "base_confusion",
  combinationConcepts: ["Ratio"]
};

export const existingQuestionStems: string[] = [
  "The population of Town A increased by 20% and is now three times the population of Town B. Town B has 8,000 people. What was the population of Town A before the increase?"
];

function baseCandidate(overrides: Partial<QuestionCandidateAiOutput> = {}): QuestionCandidateAiOutput {
  return {
    blueprintId: demoBlueprintExpectation.id,
    stem:
      "A shop increased the price of a jacket by 25%, after which it became four times the price of a notebook priced at ₹150. What was the jacket's price before the increase?",
    answerFormat: "multiple_choice",
    options: ["420", "450", "480", "500"],
    correctAnswer: "480",
    explanation:
      "The jacket's new price is 4 x 150 = 600, which represents a 25% increase over the original, so dividing by 1.25 recovers the original price.",
    solutionSteps: [
      "New price of the jacket = 4 x 150 = 600.",
      "That is 125% of the original (a 25% increase).",
      "Original price = 600 / 1.25 = 480."
    ],
    reasoning: "Set up the new value as a ratio multiple of the notebook's price, then divide by the growth factor to recover the original.",
    groundTruthDerivation: {
      computation: "4 * 150 / 1.25",
      expectedAnswer: 480
    },
    questionDna: {
      conceptName: "Percentages",
      subconcepts: [],
      prerequisites: ["Ratio"],
      combinesWithConcepts: ["Ratio"],
      patternFamilyName: "Reverse Percentage",
      skill: "Reverse inference: recovering an original quantity from a stated percentage change and its result",
      difficultyTier: "advanced",
      difficultyDimensions: {
        conceptualLoad: 0.4,
        computationalLoad: 0.3,
        trapDensity: 0.5,
        representationNovelty: 0.2,
        timePressure: 0.3,
        multiStepDepth: 0.4
      },
      noveltyLevel: "standard",
      examRelevance: "core",
      expectedTimeSeconds: 90,
      testingModes: ["reverse", "combined"],
      trapErrorTaxonomyCode: "base_confusion"
    },
    ...overrides
  };
}

export const validCandidate: QuestionCandidateAiOutput = baseCandidate();

/** Not valid JSON at all — exercises @ipmat/ai's safeJsonParse + retry path. */
export const malformedRawOutput = '{ "stem": "missing closing quote and brace, this is not JSON';

/** Two options equal the stated correct answer — no single defensible choice. */
export const multipleCorrectAnswerCandidate: QuestionCandidateAiOutput = baseCandidate({
  options: ["480", "480", "420", "500"]
});

/** The stated answer disagrees with the candidate's OWN computation — independent recomputation catches this deterministically. */
export const wrongAnswerCandidate: QuestionCandidateAiOutput = baseCandidate({
  correctAnswer: "450",
  groundTruthDerivation: { computation: "4 * 150 / 1.25", expectedAnswer: 450 }
});

/** Targets a different pattern family than the blueprint specified — the generator silently changed the blueprint. */
export const blueprintViolationCandidate: QuestionCandidateAiOutput = baseCandidate({
  questionDna: { ...baseCandidate().questionDna, patternFamilyName: "Successive Percentage Change" }
});

/** Claims a different difficulty tier than the blueprint specified (Phase 3.1 §7). */
export const difficultyTierViolationCandidate: QuestionCandidateAiOutput = baseCandidate({
  questionDna: { ...baseCandidate().questionDna, difficultyTier: "standard" }
});

/** Drops the testing mode the blueprint required, even though it added a different one (Phase 3.1 §7). */
export const testingModeViolationCandidate: QuestionCandidateAiOutput = baseCandidate({
  questionDna: { ...baseCandidate().questionDna, testingModes: ["direct"] }
});

/** Builds in a different trap than the blueprint required (Phase 3.1 §7). */
export const trapViolationCandidate: QuestionCandidateAiOutput = baseCandidate({
  questionDna: { ...baseCandidate().questionDna, trapErrorTaxonomyCode: "careless_arithmetic" }
});

/** Combines with a concept the blueprint never specified, instead of the one it did (Phase 3.1 §7). */
export const combinationViolationCandidate: QuestionCandidateAiOutput = baseCandidate({
  questionDna: { ...baseCandidate().questionDna, combinesWithConcepts: ["Algebra"] }
});

/** References a concept that does not exist anywhere in the seeded graph. */
export const outOfSyllabusCandidate: QuestionCandidateAiOutput = baseCandidate({
  questionDna: { ...baseCandidate().questionDna, combinesWithConcepts: ["Trigonometry"] }
});

/** Near-verbatim reuse of an existing question, with only the numbers and place names swapped. */
export const duplicateCandidate: QuestionCandidateAiOutput = baseCandidate({
  stem:
    "The population of Town A increased by 20% and is now three times the population of Town B. Town B has 8,000 people. What was the population of Town A before the increase, before this increase happened?"
});

/** Asserts literal completeness — banned regardless of how confident the phrasing sounds. */
export const unsupportedCompletenessClaimCandidate: QuestionCandidateAiOutput = baseCandidate({
  explanation:
    baseCandidate().explanation +
    " This single method covers every possible question of this type, so no other approach is ever needed."
});

/**
 * The correct answer appears exactly once (so `multiple_or_no_correct_answer`
 * does NOT fire), but two of the WRONG options are identical — a real,
 * distinct question-quality defect the `distractor_quality` branch exists
 * to catch (Phase 3.1.1 §6). Before this fixture, no test reached this
 * branch, because the only prior "duplicate options" fixture also
 * duplicated the correct answer, which returns early on a different check.
 */
export const duplicateDistractorCandidate: QuestionCandidateAiOutput = baseCandidate({
  options: ["480", "420", "420", "500"]
});

/** The stem states the claimed correct answer's value verbatim, making the MCQ trivial (Phase 3.1.1 §3). */
export const answerLeakedInStemCandidate: QuestionCandidateAiOutput = baseCandidate({
  stem:
    "A shop increased the price of a jacket by 25%, after which it became four times the price of a notebook priced at ₹150. The original price was 480. What was the jacket's price before the increase?"
});

/** The stem leaks the internal blueprintId, which is metadata and must never reach student-facing text (Phase 3.1.1 §3). */
export const blueprintIdLeakedInStemCandidate: QuestionCandidateAiOutput = baseCandidate({
  stem: baseCandidate().stem + ` (ref: ${demoBlueprintExpectation.id})`
});
