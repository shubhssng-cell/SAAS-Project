import type { PatternTaxonomyCellData } from "../src/types.js";

/**
 * Concrete taxonomy cells derived from percentagesPatternFamilies.ts — each
 * one is a specific (combination x testing mode x trap x difficulty)
 * point in a family's space. Only ONE cell is `covered` here, because only
 * one demonstration question exists in this phase (see
 * percentagesQuestionDnaExample.ts and docs/MASTER_PLAN.md Phase 2's
 * explicit "no large-scale content generation yet"). The rest stay
 * `uncovered` — an honest, queryable coverage gap, not a hidden one.
 */
export const percentagesTaxonomyCells: PatternTaxonomyCellData[] = [
  {
    patternFamilyName: "Reverse Percentage",
    conceptName: "Percentages",
    combination: ["Ratio"],
    testingMode: "reverse",
    trapErrorTaxonomyCode: "base_confusion",
    difficultyTier: "advanced",
    targetTimeSeconds: 90,
    coverageStatus: "covered"
  },
  {
    patternFamilyName: "Reverse Percentage",
    conceptName: "Percentages",
    combination: ["Algebra"],
    testingMode: "transformed",
    trapErrorTaxonomyCode: "base_confusion",
    difficultyTier: "hard",
    targetTimeSeconds: 120,
    coverageStatus: "uncovered"
  },
  {
    patternFamilyName: "Successive Percentage Change",
    conceptName: "Percentages",
    combination: ["Profit and Loss"],
    testingMode: "combined",
    trapErrorTaxonomyCode: "successive_change_error",
    difficultyTier: "advanced",
    targetTimeSeconds: 75,
    coverageStatus: "uncovered"
  },
  {
    patternFamilyName: "Successive Percentage Change",
    conceptName: "Percentages",
    combination: ["Simple and Compound Interest"],
    testingMode: "multi_step",
    trapErrorTaxonomyCode: "successive_change_error",
    difficultyTier: "hard",
    targetTimeSeconds: 110,
    coverageStatus: "uncovered"
  },
  {
    patternFamilyName: "Percentage Point vs Percentage Change",
    conceptName: "Percentages",
    combination: ["Simple and Compound Interest"],
    testingMode: "contextualized",
    trapErrorTaxonomyCode: "percentage_point_confusion",
    difficultyTier: "hard",
    targetTimeSeconds: 60,
    coverageStatus: "uncovered"
  },
  {
    patternFamilyName: "Percentage Point vs Percentage Change",
    conceptName: "Percentages",
    combination: [],
    testingMode: "contextualized",
    trapErrorTaxonomyCode: "percentage_point_confusion",
    difficultyTier: "standard",
    targetTimeSeconds: 45,
    coverageStatus: "uncovered"
  },
  {
    patternFamilyName: "Percentage Share in Data Interpretation",
    conceptName: "Percentages",
    combination: ["Data Interpretation"],
    testingMode: "represented_differently",
    trapErrorTaxonomyCode: "misread_question",
    difficultyTier: "hard",
    targetTimeSeconds: 100,
    coverageStatus: "uncovered"
  },
  {
    patternFamilyName: "Percentage Share in Data Interpretation",
    conceptName: "Percentages",
    combination: ["Data Interpretation", "Averages"],
    testingMode: "combined",
    trapErrorTaxonomyCode: "base_confusion",
    difficultyTier: "extreme",
    targetTimeSeconds: 150,
    coverageStatus: "uncovered"
  }
];
