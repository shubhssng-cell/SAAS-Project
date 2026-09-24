import type { AttemptQuestionContext } from "@ipmat/attempt";
import type { AutopsyHypothesisAiOutput } from "@ipmat/ai";
import type { AutopsyQuestionContext, ErrorTaxonomyEntry } from "@ipmat/autopsy";

/**
 * Deterministic, clearly-synthetic fixture data standing in for real
 * persisted student/question state until the Training Recommendation
 * Composition Layer exists. This is data only — no decision logic lives
 * here. Mirrors the shape (never the code) of
 * apps/training-playground/src/domain/builders.ts; this file is NOT an
 * import of that app's internals, per the requirement that apps/web never
 * depend on the playground.
 */

export const STUDENT_ID = "web-demo-student";
export const ENROLLMENT_ID = "web-demo-enrollment";
export const CONCEPT_ID = "concept-percentages";
export const CONCEPT_NAME = "Percentages";

export const ERROR_TAXONOMY: ErrorTaxonomyEntry[] = [
  {
    code: "base_confusion",
    label: "Reference-base confusion",
    description: "Applying a percentage change to the wrong base value, especially when two changes are applied one after another.",
    category: "trap"
  }
];

export interface FixtureQuestion {
  attemptContext: AttemptQuestionContext;
  dna: AutopsyQuestionContext;
  prompt: string;
  solutionSteps: string[];
  /** Only questions with a designed trap participate in the autopsy/confirmation loop in this first slice — see adapter/service.ts. */
  hypothesisOnWrongAnswer: AutopsyHypothesisAiOutput | null;
}

const SHARED_DIFFICULTY = { conceptualLoad: 0.35, computationalLoad: 0.3, trapDensity: 0.5, representationNovelty: 0.15, timePressure: 0.25, multiStepDepth: 0.35 };

export const QUESTIONS: Record<string, FixtureQuestion> = {
  "q-reverse-1": {
    attemptContext: {
      questionId: "q-reverse-1",
      conceptId: CONCEPT_ID,
      answerFormat: "multiple_choice",
      options: ["₹480", "₹500", "₹450", "₹520"],
      correctAnswer: "₹500",
      expectedTimeSeconds: 75
    },
    dna: {
      questionId: "q-reverse-1",
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      conceptName: CONCEPT_NAME,
      patternFamilyName: "Reverse Percentage",
      patternTaxonomyCellId: "cell-reverse-percentage-trap",
      difficultyTier: "standard",
      difficultyDimensions: SHARED_DIFFICULTY,
      noveltyLevel: "standard",
      examRelevance: "core",
      testingModes: ["reverse"],
      trapErrorTaxonomyCode: "base_confusion",
      combinesWithConcepts: []
    },
    prompt:
      "A shop increases the price of an item by 20%, then offers a 20% discount on the new price. The final price is ₹480. What was the original price?",
    solutionSteps: [
      "Let the original price be P.",
      "After a 20% increase, the price becomes 1.2P.",
      "The 20% discount is applied to the NEW price, not the original: 1.2P × 0.8 = 0.96P.",
      "0.96P = ₹480, so P = ₹500.",
      "The two changes don't cancel out — the discount is a percentage of a different (larger) base than the increase was."
    ],
    hypothesisOnWrongAnswer: {
      proposedErrorCategory: "trap",
      proposedExplanation:
        "The two percentage changes were likely treated as canceling each other out, rather than compounding on different bases — a 20% increase followed by a 20% decrease does not return to the original value.",
      supportingEvidence: ["The chosen answer equals the price after the increase but before the discount, consistent with assuming the changes cancel."],
      contradictoryEvidence: [],
      missingEvidence: [],
      modelConfidence: 0.74
    }
  },
  "q-percentage-repair-1": {
    attemptContext: {
      questionId: "q-percentage-repair-1",
      conceptId: CONCEPT_ID,
      answerFormat: "multiple_choice",
      options: ["₹990", "₹1,000", "₹980", "₹1,010"],
      correctAnswer: "₹1,000",
      expectedTimeSeconds: 75
    },
    dna: {
      questionId: "q-percentage-repair-1",
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      conceptName: CONCEPT_NAME,
      // Same taxonomy cell + trap code as q-reverse-1 -- this is deliberate: it is
      // what makes this question a real, tier-1 repair-selection match once a
      // RepairPlan is confirmed against q-reverse-1's diagnosis (@ipmat/repair-selection
      // matches on targetTaxonomyCellId/targetErrorTaxonomyCode first).
      patternFamilyName: "Reverse Percentage",
      patternTaxonomyCellId: "cell-reverse-percentage-trap",
      difficultyTier: "standard",
      difficultyDimensions: SHARED_DIFFICULTY,
      noveltyLevel: "standard",
      examRelevance: "core",
      testingModes: ["reverse"],
      trapErrorTaxonomyCode: "base_confusion",
      combinesWithConcepts: []
    },
    prompt: "A laptop's price is reduced by 10%, then increased by 10% during a restock. The current price is ₹990. What was the original price?",
    solutionSteps: [
      "Let the original price be P.",
      "After a 10% reduction, the price becomes 0.9P.",
      "The 10% increase is applied to the reduced price: 0.9P × 1.1 = 0.99P.",
      "0.99P = ₹990, so P = ₹1,000.",
      "As before, a percentage decrease followed by the same percentage increase does not return to the original value."
    ],
    hypothesisOnWrongAnswer: {
      proposedErrorCategory: "trap",
      proposedExplanation: "The same reference-base pattern as before: a percentage decrease and a later increase of the same size were treated as canceling out.",
      supportingEvidence: ["The chosen answer equals the current price itself, consistent with assuming the two changes offset exactly."],
      contradictoryEvidence: [],
      missingEvidence: [],
      modelConfidence: 0.7
    }
  },
  "q-direct-1": {
    attemptContext: {
      questionId: "q-direct-1",
      conceptId: CONCEPT_ID,
      answerFormat: "multiple_choice",
      options: ["70%", "75%", "80%", "65%"],
      correctAnswer: "75%",
      expectedTimeSeconds: 60
    },
    dna: {
      questionId: "q-direct-1",
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      conceptName: CONCEPT_NAME,
      patternFamilyName: "Direct Percentage",
      patternTaxonomyCellId: "cell-direct-percentage-basic",
      difficultyTier: "standard",
      difficultyDimensions: { conceptualLoad: 0.15, computationalLoad: 0.2, trapDensity: 0.05, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
      noveltyLevel: "standard",
      examRelevance: "core",
      testingModes: ["direct"],
      trapErrorTaxonomyCode: null,
      combinesWithConcepts: []
    },
    prompt: "A student scored 45 marks out of 60 on a test. What percentage did the student score?",
    solutionSteps: ["Percentage = (marks obtained / total marks) × 100.", "= (45 / 60) × 100 = 75%."],
    hypothesisOnWrongAnswer: null
  },
  "q-combined-1": {
    attemptContext: {
      questionId: "q-combined-1",
      conceptId: CONCEPT_ID,
      answerFormat: "multiple_choice",
      options: ["+5%", "0%", "-5%", "+10%"],
      correctAnswer: "0%",
      expectedTimeSeconds: 70
    },
    dna: {
      questionId: "q-combined-1",
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      conceptName: CONCEPT_NAME,
      patternFamilyName: "Successive Percentage Change",
      patternTaxonomyCellId: "cell-successive-change-basic",
      difficultyTier: "standard",
      difficultyDimensions: { conceptualLoad: 0.3, computationalLoad: 0.25, trapDensity: 0.2, representationNovelty: 0.1, timePressure: 0.15, multiStepDepth: 0.25 },
      noveltyLevel: "standard",
      examRelevance: "core",
      testingModes: ["combined"],
      trapErrorTaxonomyCode: null,
      combinesWithConcepts: []
    },
    prompt: "A number is increased by 25% and then decreased by 20%. What is the net percentage change?",
    solutionSteps: [
      "Let the number be N.",
      "After a 25% increase: 1.25N.",
      "After a 20% decrease on the new value: 1.25N × 0.8 = 1.00N.",
      "Net change = 0%."
    ],
    hypothesisOnWrongAnswer: null
  }
};

export const QUESTION_ORDER = ["q-reverse-1", "q-direct-1", "q-combined-1", "q-percentage-repair-1"] as const;

export function getQuestion(questionId: string): FixtureQuestion {
  const question = QUESTIONS[questionId];
  if (!question) throw new Error(`Unknown fixture question id: "${questionId}"`);
  return question;
}
