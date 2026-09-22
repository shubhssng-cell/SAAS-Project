import type { AnswerReverificationAiOutput, QuestionCandidateAiOutput, ValidationJudgeAiOutput } from "@ipmat/ai";
import { buildBlueprintFromCell } from "../src/blueprint.js";
import { percentagesPatternFamilies } from "./percentagesPatternFamilies.js";
import { percentagesTaxonomyCells } from "./percentagesTaxonomyCells.js";

/**
 * Deterministic fixtures for the generation pipeline demonstration and
 * tests (docs/QUESTION_ENGINE.md §5c / Phase 3 §13) — built from the SAME
 * real, `covered` Percentages taxonomy cell from Phase 2, since "start
 * with one taxonomy cell" (Phase 3 §5) should mean a cell that actually
 * exists in the seeded data, not an invented one.
 */
const coveredCell = percentagesTaxonomyCells.find((cell) => cell.coverageStatus === "covered");
if (!coveredCell) throw new Error("Expected a covered taxonomy cell in percentagesTaxonomyCells for the pipeline demo");
const family = percentagesPatternFamilies.find((f) => f.name === coveredCell.patternFamilyName);
if (!family) throw new Error(`Expected pattern family "${coveredCell.patternFamilyName}" to exist`);

export const demoBlueprint = buildBlueprintFromCell(coveredCell, family, {
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  answerFormat: "multiple_choice",
  transformationDescription: "Hide the original value; express it only via a ratio multiple of a second, stated quantity.",
  idSuffix: "phase3-demo-1"
});

export const existingQuestionStems: string[] = [
  "The population of Town A increased by 20% and is now three times the population of Town B. Town B has 8,000 people. What was the population of Town A before the increase?"
];

// --- Valid path -----------------------------------------------------------

export const validGeneratedCandidate: QuestionCandidateAiOutput = {
  blueprintId: demoBlueprint.id,
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
  groundTruthDerivation: { computation: "4 * 150 / 1.25", expectedAnswer: 480 },
  questionDna: {
    conceptName: "Percentages",
    subconcepts: [],
    prerequisites: ["Ratio"],
    combinesWithConcepts: ["Ratio"],
    patternFamilyName: "Reverse Percentage",
    skill: family.skill,
    difficultyTier: "advanced",
    difficultyDimensions: demoBlueprint.difficultyDimensions,
    noveltyLevel: "standard",
    examRelevance: "core",
    expectedTimeSeconds: demoBlueprint.expectedTimeSeconds,
    testingModes: ["reverse", "combined"],
    trapErrorTaxonomyCode: "base_confusion"
  }
};

export const validReverification: AnswerReverificationAiOutput = {
  derivedAnswer: "480",
  derivationSteps: ["New price = 4 x 150 = 600", "600 is 125% of the original", "Original = 600 / 1.25 = 480"]
};

export const passingJudge: ValidationJudgeAiOutput = {
  syllabusRelevant: true,
  hasExactlyOneDefensibleAnswer: true,
  isAmbiguous: false,
  hasContradictoryConditions: false,
  difficultyTierIsHonest: true,
  issues: [],
  verdict: "pass"
};

// --- Rejected path: candidate's stated answer disagrees with its OWN computation, and with an independent re-derivation ---

export const wrongAnswerGeneratedCandidate: QuestionCandidateAiOutput = {
  ...validGeneratedCandidate,
  correctAnswer: "450",
  groundTruthDerivation: { computation: "4 * 150 / 1.25", expectedAnswer: 450 } // computation actually evaluates to 480, not 450
};

export const disagreeingReverification: AnswerReverificationAiOutput = {
  derivedAnswer: "480",
  derivationSteps: ["New price = 4 x 150 = 600", "600 is 125% of the original", "Original = 600 / 1.25 = 480"]
};
