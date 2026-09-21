import type { ConceptGraph } from "../src/types.js";

/**
 * Human-curated Percentages neighborhood for IPMAT > Quant (see
 * docs/QUESTION_ENGINE.md §1). This is deliberately a NEIGHBORHOOD, not a
 * single-chapter list: several concepts here belong to other chapters
 * (Ratio and Proportion, Data Interpretation, Algebra, ...) because
 * Percentages is a node in a larger exam knowledge network, not an
 * isolated topic (docs/MASTER_PLAN.md Phase 2).
 *
 * Every edge has a specific rationale — nothing is included because it
 * "sounds related." Where a relationship is a genuine but unverified
 * pattern rather than settled pedagogy, its `certainty` says so (see the
 * Percentages/Probability edge below) instead of asserting confidence we
 * don't have (docs/DECISIONS.md D-013).
 */
export const percentagesConceptGraph: ConceptGraph = {
  concepts: [
    {
      name: "Number Systems",
      chapterName: "Number Systems",
      description: "Fractions, decimals, place value, and basic arithmetic operations.",
      status: "curated"
    },
    {
      name: "Percentages",
      chapterName: "Percentages",
      description: "Expressing and manipulating quantities as parts per hundred.",
      status: "curated"
    },
    {
      name: "Ratio",
      chapterName: "Ratio and Proportion",
      description: "Comparing quantities by relative size.",
      status: "curated"
    },
    {
      name: "Averages",
      chapterName: "Averages",
      description: "Central tendency of a set of quantities.",
      status: "curated"
    },
    {
      name: "Profit and Loss",
      chapterName: "Profit and Loss",
      description: "Cost price, selling price, and gain/loss expressed in absolute and percentage terms.",
      status: "curated"
    },
    {
      name: "Discount",
      chapterName: "Percentages",
      description: "Marked price vs. selling price reductions, often expressed as a percentage.",
      status: "curated"
    },
    {
      name: "Simple and Compound Interest",
      chapterName: "Simple and Compound Interest",
      description: "Interest computed on a principal, either linearly (simple) or with compounding periods.",
      status: "curated"
    },
    {
      name: "Mixtures and Alligations",
      chapterName: "Mixtures and Alligations",
      description: "Blending two or more components of differing concentration, price, or ratio into one mixture.",
      status: "curated"
    },
    {
      name: "Population Growth and Decline",
      chapterName: "Percentages",
      description: "Repeated percentage change applied to a population figure across time periods.",
      status: "curated"
    },
    {
      name: "Data Interpretation",
      chapterName: "Data Interpretation",
      description: "Reading and computing over tabular, graphical, or textual data sets.",
      status: "curated"
    },
    {
      name: "Algebra",
      chapterName: "Algebra",
      description: "Symbolic manipulation and equation-solving.",
      status: "curated"
    },
    {
      name: "Probability",
      chapterName: "Probability",
      description: "Likelihood of events over a sample space.",
      status: "curated"
    }
  ],
  relations: [
    {
      from: "Number Systems",
      to: "Percentages",
      type: "foundational",
      rationale:
        "Percentage computation is built directly on fraction-decimal-percentage equivalence and basic arithmetic; this is a broad numeracy base the whole chapter sits on, not a single narrow skill.",
      sharedKnowledge: "Fraction/decimal/percentage conversion, place value, and basic arithmetic operations.",
      usefulForQuestionGeneration: false,
      requirementLevel: "required",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Ratio",
      to: "Percentages",
      type: "prerequisite",
      rationale:
        "A percentage is a ratio expressed as parts-per-hundred; understanding ratio comparison and simplification is required before percentage notation is meaningful.",
      sharedKnowledge: "Comparing two quantities as a fraction/ratio and converting between ratio and fractional forms.",
      usefulForQuestionGeneration: true,
      requirementLevel: "required",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Ratio",
      type: "dependent",
      rationale:
        "Advanced percentage problems (e.g. reconstructing an original ratio from percentage-change information) sometimes require re-applying ratio reasoning at a higher level than the basic prerequisite skill.",
      sharedKnowledge: "Recovering a ratio or proportion from percentage-change statements.",
      usefulForQuestionGeneration: true,
      requirementLevel: "contextual",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Averages",
      type: "directly_related",
      rationale:
        "Average-of-percentages and percentage-of-an-average problems share the same weighted-combination reasoning; neither is prerequisite to the other, but they are taught and tested side by side.",
      sharedKnowledge:
        "Weighted combination of quantities, and the distinction between averaging raw values vs. averaging rates/percentages.",
      usefulForQuestionGeneration: true,
      requirementLevel: "optional",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Ratio",
      to: "Averages",
      type: "directly_related",
      rationale:
        "The average of a group can be computed via ratio-weighted combination of subgroup averages (alligation-style reasoning).",
      sharedKnowledge: "Weighted mean as a ratio-driven combination of parts.",
      usefulForQuestionGeneration: true,
      requirementLevel: "optional",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Profit and Loss",
      type: "application",
      rationale:
        "Profit and loss expresses gain or loss as a percentage of cost price; the chapter introduces no new percentage theory of its own, it applies percentage computation to a buying/selling context.",
      sharedKnowledge: "Percentage-of-base computation, applied to cost price / selling price.",
      usefulForQuestionGeneration: true,
      requirementLevel: "required",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Discount",
      type: "application",
      rationale:
        "A discount is a percentage reduction applied to a marked price; mechanically identical to a percentage-decrease problem in a retail context.",
      sharedKnowledge: "Percentage decrease applied to a base value.",
      usefulForQuestionGeneration: true,
      requirementLevel: "required",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Profit and Loss",
      to: "Discount",
      type: "directly_related",
      rationale:
        "Both operate on the same cost-price/marked-price/selling-price relationships; a discount is frequently nested inside a profit-and-loss question as an intermediate step.",
      sharedKnowledge: "Cost price, marked price, selling price relationships.",
      usefulForQuestionGeneration: true,
      requirementLevel: "optional",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Simple and Compound Interest",
      type: "advanced_extension",
      rationale:
        "Compound interest generalizes repeated percentage change into a formalized exponential-growth formula; it extends percentage reasoning with compounding periods and formula machinery beyond a single percentage change.",
      sharedKnowledge: "Repeated percentage change applied over multiple periods.",
      usefulForQuestionGeneration: true,
      requirementLevel: "optional",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Mixtures and Alligations",
      type: "advanced_extension",
      rationale:
        "Alligation problems blend percentage concentrations of two or more components, extending single-quantity percentage change into a multi-component weighted system solved via the alligation rule.",
      sharedKnowledge: "Percentage concentration and weighted blending.",
      usefulForQuestionGeneration: true,
      requirementLevel: "optional",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Ratio",
      to: "Mixtures and Alligations",
      type: "prerequisite",
      rationale:
        "The alligation rule itself is an inverse ratio (of distances from the mean); without ratio fluency the rule cannot be derived or trusted, only memorized.",
      sharedKnowledge: "Inverse ratio reasoning.",
      usefulForQuestionGeneration: true,
      requirementLevel: "required",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Population Growth and Decline",
      type: "application",
      rationale:
        "Population growth/decline problems apply repeated percentage change to a population figure across time periods; the underlying computation is percentage change, contextualized as demographic growth.",
      sharedKnowledge: "Repeated percentage change applied over time.",
      usefulForQuestionGeneration: true,
      requirementLevel: "required",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Population Growth and Decline",
      to: "Simple and Compound Interest",
      type: "directly_related",
      rationale:
        "Population growth over multiple periods uses the identical compounding formula as compound interest (A = P(1+r)^n) with the variables relabeled; recognizing this equivalence is often the key insight.",
      sharedKnowledge: "The compound-growth formula A = P(1+r)^n.",
      usefulForQuestionGeneration: true,
      requirementLevel: "optional",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Data Interpretation",
      type: "commonly_combined",
      rationale:
        "DI tables and graphs frequently require computing percentage change, percentage share, and percentage comparison across rows or columns as the core skill being tested inside a data-reading wrapper.",
      sharedKnowledge: "Percentage change and percentage-share computation, applied to tabular/graphical data.",
      usefulForQuestionGeneration: true,
      requirementLevel: "contextual",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Algebra",
      type: "dependent",
      rationale:
        "Multi-step or reverse percentage problems with an unknown original value are most reliably solved by setting up and solving a linear equation; algebraic equation-setup becomes necessary once a problem resists direct substitution.",
      sharedKnowledge: "Translating a percentage-change statement into a solvable linear equation.",
      usefulForQuestionGeneration: true,
      requirementLevel: "contextual",
      certainty: "confirmed",
      source: "human"
    },
    {
      from: "Percentages",
      to: "Probability",
      type: "related_but_distinct",
      rationale:
        "Both are commonly expressed as numbers between 0 and 1 (or 0-100), and 'percentage chance' language invites students to apply percentage-arithmetic habits (like direct addition) to probability, where the underlying rules (sample space, independence) are entirely different.",
      sharedKnowledge: "Superficial 0-100 / 0-1 numeric framing only — the underlying rules do not transfer.",
      usefulForQuestionGeneration: false,
      requirementLevel: "optional",
      certainty: "probable",
      source: "human"
    }
  ]
};
