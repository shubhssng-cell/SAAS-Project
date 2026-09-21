import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { deriveCombinations } from "../src/deriveCombinations.js";
import type { ExaminerLensAnalysisData } from "../src/types.js";

/**
 * Deterministic, hand-authored Examiner Lens analysis for Percentages —
 * NOT AI-generated (docs/MASTER_PLAN.md Phase 2 explicitly excludes
 * large-scale AI content generation this phase). This fixture is both the
 * seed data for the demonstration and the domain layer's proof that the
 * structure is testable without a live AI provider (docs/QUESTION_
 * ENGINE.md §8).
 *
 * `combinations` is computed from the concept graph, never hand-listed —
 * see deriveCombinations().
 */
export const percentagesLens: ExaminerLensAnalysisData = {
  concept: "Percentages",
  version: 1,
  whatIsTested: {
    concept: "Percentages",
    subconcept: "Percentage change and reverse percentage",
    skill: "Converting between a base quantity and a percentage-derived quantity in either direction",
    prerequisite: "Ratio"
  },
  // "constrained" is deliberately excluded: answer-space constraints (e.g.
  // "the answer must be a whole number") are a Number Systems/Algebra-
  // flavored testing mode, not a primary way Percentages itself gets
  // tested — everything else in the 10-mode vocabulary genuinely applies.
  testingModes: [
    "direct",
    "reverse",
    "transformed",
    "combined",
    "contextualized",
    "represented_differently",
    "time_pressured",
    "multi_step",
    "novel_representation"
  ],
  combinations: deriveCombinations(percentagesConceptGraph, "Percentages"),
  errorModes: [
    {
      category: "misconception",
      errorTaxonomyCode: "successive_change_error",
      description: "Treats two successive percentage changes as additive instead of compounding multiplicatively."
    },
    {
      category: "misconception",
      errorTaxonomyCode: "base_confusion",
      description: "Applies a percentage change to the wrong base quantity (e.g. the new value instead of the original)."
    },
    {
      category: "interpretation_mistake",
      errorTaxonomyCode: "misread_question",
      description: "Answers a related-but-different quantity than the one actually asked for (e.g. discount amount instead of final price)."
    },
    {
      category: "interpretation_mistake",
      errorTaxonomyCode: "percentage_point_confusion",
      description: "Confuses an absolute percentage-point difference with a relative percentage change."
    },
    {
      category: "calculation_mistake",
      errorTaxonomyCode: "careless_arithmetic",
      description: "Correct method, but an arithmetic slip in computing the percentage value produces the wrong number."
    }
  ],
  // A calibration baseline for a STANDARD-tier Percentages question — harder
  // tiers are characterized by which of these dimensions they push up, not
  // by a single "harder" label (docs/QUESTION_ENGINE.md §2).
  difficultyDimensions: {
    conceptualLoad: 0.3,
    computationalLoad: 0.3,
    trapDensity: 0.2,
    representationNovelty: 0.1,
    timePressure: 0.2,
    multiStepDepth: 0.1
  },
  status: "reviewed"
};
