import type { ExaminerLensAnalysisAiOutput } from "@ipmat/ai";

/**
 * A deterministic, hand-written stand-in for what an AI regeneration of
 * the Percentages Examiner Lens might plausibly return — used because no
 * AI provider is reachable in this environment (see the Phase 3 report).
 * Deliberately imperfect in realistic ways: it under-discovers some
 * testing modes, invents one relationship ("Time and Work") that has no
 * corresponding edge anywhere in the seeded graph, and misses three real,
 * useful combination concepts (Discount, Population Growth and Decline,
 * Algebra) — exactly the kind of gaps docs/MASTER_PLAN.md Phase 3 §9
 * expects the comparison report to surface, not paper over.
 */
export const aiLensRegenerationOutput: ExaminerLensAnalysisAiOutput = {
  concept: "Percentages",
  whatIsTested: {
    concept: "Percentages",
    subconcept: "Percentage change",
    skill: "Computing and comparing percentage changes relative to a base value",
    prerequisite: "Ratio"
  },
  testingModes: ["direct", "reverse", "combined", "time_pressured"],
  suggestedCombinations: [
    { concept: "Ratio", rationale: "Percentages are often expressed as ratios of a base quantity." },
    { concept: "Profit and Loss", rationale: "Profit/loss percentages are a direct application of percentage change." },
    { concept: "Data Interpretation", rationale: "DI tables frequently require percentage-of-total or percentage-change reading." },
    { concept: "Time and Work", rationale: "Work-rate problems sometimes express completed work as a percentage." }
  ],
  errorModes: [
    { category: "misconception", description: "Adds successive percentage changes instead of compounding them." },
    { category: "interpretation_mistake", description: "Answers a different quantity than the one the question actually asked for." }
  ],
  difficultyDimensions: {
    conceptualLoad: 0.35,
    computationalLoad: 0.25,
    trapDensity: 0.3,
    representationNovelty: 0.15,
    timePressure: 0.2,
    multiStepDepth: 0.15
  }
};

/** Same as above, but with an explicit false-completeness claim injected — for exercising the "does validation catch this" check. */
export const aiLensRegenerationOutputWithCompletenessClaim: ExaminerLensAnalysisAiOutput = {
  ...aiLensRegenerationOutput,
  whatIsTested: {
    ...aiLensRegenerationOutput.whatIsTested,
    skill: "A single unified method for solving every possible question of this type"
  }
};
