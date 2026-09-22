import type { AutopsyQuestionContext } from "../src/types.js";

/** A deterministic stand-in for a real Question DNA record, mirroring the Phase 2 Percentages demonstration question. */
export const percentagesQuestionContext: AutopsyQuestionContext = {
  questionId: "question-reverse-percentage-1",
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  conceptName: "Percentages",
  patternFamilyName: "Reverse Percentage",
  patternTaxonomyCellId: "cell-percentages-reverse-advanced-1",
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
  testingModes: ["reverse", "combined"],
  trapErrorTaxonomyCode: "base_confusion",
  combinesWithConcepts: ["Ratio"]
};

/** Same concept/pattern family, a harder taxonomy cell with novelty + time pressure — for novelty/pressure-aware tests. */
export const percentagesHardNovelPressureQuestionContext: AutopsyQuestionContext = {
  ...percentagesQuestionContext,
  questionId: "question-percentages-hard-novel-1",
  patternTaxonomyCellId: "cell-percentages-reverse-hard-2",
  difficultyTier: "hard",
  noveltyLevel: "novel_representation",
  testingModes: ["reverse", "time_pressured", "novel_representation"]
};

/** A question with no designated trap — for the "no trap to match against" error-evidence case. */
export const percentagesNoTrapQuestionContext: AutopsyQuestionContext = {
  ...percentagesQuestionContext,
  questionId: "question-percentages-no-trap-1",
  trapErrorTaxonomyCode: null
};

/** A question whose trap code is not present in the supplied error taxonomy — for the "unresolved trap" case. */
export const percentagesUnknownTrapQuestionContext: AutopsyQuestionContext = {
  ...percentagesQuestionContext,
  questionId: "question-percentages-unknown-trap-1",
  trapErrorTaxonomyCode: "not_a_real_taxonomy_code"
};

/** A different concept entirely — for proving historical signals are scoped correctly and don't cross-contaminate. */
export const ratioQuestionContext: AutopsyQuestionContext = {
  ...percentagesQuestionContext,
  questionId: "question-ratio-1",
  conceptName: "Ratio",
  patternFamilyName: "Ratio Simplification",
  patternTaxonomyCellId: "cell-ratio-simplification-standard-1",
  difficultyTier: "standard",
  combinesWithConcepts: []
};
