import type { QuestionDnaData } from "../src/types.js";

/**
 * ONE fully worked demonstration question — not a question bank (docs/
 * MASTER_PLAN.md Phase 2 explicitly excludes large-scale content
 * generation this phase). Its purpose is to prove the finalized Question
 * DNA schema against a real, concrete example, and to give the Phase 2
 * demonstration something to inspect end-to-end.
 *
 * `dna` covers exactly the fields docs/QUESTION_ENGINE.md §4 requires;
 * `content` is the actual question body — deliberately a separate,
 * smaller shape, since content isn't part of Question DNA's own contract.
 */
export const percentagesReversePercentageExample: {
  dna: QuestionDnaData;
  content: {
    body: string;
    options: string[];
    correctAnswer: string;
    solutionSteps: string[];
    groundTruthDerivation: { steps: string[]; finalAnswer: string };
  };
} = {
  dna: {
    examCode: "IPMAT_INDORE",
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: "Percentages",
    subconcepts: ["Population Growth and Decline"],
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
    trapErrorTaxonomyCode: "base_confusion",
    provenanceSourceType: "original",
    validationState: "published"
  },
  content: {
    body:
      "The population of Town A increased by 20% and is now three times the population of Town B. " +
      "Town B has 8,000 people. What was the population of Town A before the increase?",
    options: ["16,000", "18,000", "20,000", "24,000"],
    correctAnswer: "20,000",
    solutionSteps: [
      "Town A's population after the increase = 3 x 8,000 = 24,000.",
      "That value is 120% of the original population (a 20% increase).",
      "Original population = 24,000 / 1.20 = 20,000."
    ],
    groundTruthDerivation: {
      steps: [
        "new_population = 3 * 8000 = 24000",
        "original_population = new_population / 1.20 = 24000 / 1.20",
        "original_population = 20000"
      ],
      finalAnswer: "20000"
    }
  }
};
