import type { QuestionPatternFamilyData } from "../src/types.js";

/**
 * Four concrete pattern families for Percentages — each describes the
 * STRUCTURE of a question, not a specific numerical instance (docs/
 * QUESTION_ENGINE.md §3), and each can generate many valid questions.
 * This is a deliberately small, curated starting set (docs/MASTER_PLAN.md
 * Phase 2) — more families get mapped over time via the coverage model in
 * coverage.ts, not by inflating this fixture speculatively now.
 */
export const percentagesPatternFamilies: QuestionPatternFamilyData[] = [
  {
    name: "Reverse Percentage",
    conceptName: "Percentages",
    skill: "Reverse inference: recovering an original quantity from a stated percentage change and its result",
    description:
      "States a final/changed value and the percentage change applied to reach it, and asks for the original value — solvable by dividing by the appropriate multiplying factor, not by re-applying the percentage forward.",
    expectedDifficultyTier: "advanced",
    potentialCombinationConcepts: ["Ratio", "Algebra"],
    potentialTrapErrorTaxonomyCodes: ["base_confusion"],
    potentialTestingModes: ["reverse", "transformed"],
    status: "reviewed"
  },
  {
    name: "Successive Percentage Change",
    conceptName: "Percentages",
    skill: "Compounding two or more sequential percentage changes multiplicatively rather than additively",
    description:
      "Two or more percentage changes are applied one after another to the same evolving quantity (e.g. a price rises by X% then falls by Y%), and the question asks for the net effect or the final value.",
    expectedDifficultyTier: "advanced",
    potentialCombinationConcepts: ["Profit and Loss", "Simple and Compound Interest"],
    potentialTrapErrorTaxonomyCodes: ["successive_change_error"],
    potentialTestingModes: ["combined", "multi_step"],
    status: "reviewed"
  },
  {
    name: "Percentage Point vs Percentage Change",
    conceptName: "Percentages",
    skill: "Distinguishing an absolute percentage-point difference from a relative percentage change",
    description:
      "Two percentages are compared (e.g. an interest rate moving from one stated level to a higher one), and the question specifically probes whether the student reports the point difference or the relative change — whichever was NOT asked for.",
    expectedDifficultyTier: "hard",
    potentialCombinationConcepts: ["Simple and Compound Interest"],
    potentialTrapErrorTaxonomyCodes: ["percentage_point_confusion"],
    potentialTestingModes: ["contextualized"],
    status: "reviewed"
  },
  {
    name: "Percentage Share in Data Interpretation",
    conceptName: "Percentages",
    skill: "Extracting percentage share and percentage change directly from a tabular or graphical data set",
    description:
      "A DI table or chart presents raw figures, not pre-computed percentages; the question asks for a percentage share, a percentage change between periods, or a cross-category comparison, requiring correct extraction before percentage skill applies.",
    expectedDifficultyTier: "hard",
    potentialCombinationConcepts: ["Data Interpretation", "Averages"],
    potentialTrapErrorTaxonomyCodes: ["misread_question", "base_confusion"],
    potentialTestingModes: ["contextualized", "represented_differently", "combined"],
    status: "reviewed"
  }
];
