import type { ConceptDepthData } from "../src/depth.js";

/**
 * Full concept-depth content for Percentages — the vertical slice's actual
 * target concept. Ratio gets a deliberately LIGHT entry, included only to
 * prove the structure generalizes to a neighbor; the other ten concepts in
 * the neighborhood graph have no ConceptDepth entry yet. That's intentional
 * (docs/MASTER_PLAN.md Phase 2): this phase builds the STRUCTURE, not a
 * full curriculum — authoring real depth content for every concept is
 * future work, not an architecture gap.
 */

export const percentagesConceptDepth: ConceptDepthData = {
  conceptName: "Percentages",
  definition:
    "A percentage expresses a quantity as a fraction of 100 relative to a stated base (e.g. 20% of 150 means 20 parts out of every 100 parts of 150).",
  intuition:
    "Think of a percentage as a universal 'per hundred' ruler that lets you compare quantities of totally different sizes on the same scale, as long as you always know what the 100 refers to (the base).",
  formulas: [
    {
      label: "Percentage of a value",
      expression: "P% of X = (P / 100) * X",
      whenToUse: "Finding a stated percentage of a known base value."
    },
    {
      label: "Percentage change",
      expression: "% change = ((New - Original) / Original) * 100",
      whenToUse: "Comparing an original value to a new value after an increase or decrease."
    },
    {
      label: "Successive percentage change (compounded)",
      expression: "Net % change = a + b + (a*b)/100, for two successive changes of a% and b%",
      whenToUse: "Combining two or more percentage changes applied one after another, not added directly."
    },
    {
      label: "Reverse percentage",
      expression: "Original = New / (1 + P/100), for a P% increase (use 1 - P/100 for a decrease)",
      whenToUse: "Finding the original value when only the changed value and the percentage change are known."
    }
  ],
  methods: [
    {
      name: "Direct substitution",
      steps: [
        "Identify the base (the '100%' quantity).",
        "Convert the percentage to a fraction or decimal.",
        "Multiply the base by that fraction/decimal."
      ],
      bestFor: "Single-step 'find P% of X' questions with an explicit base."
    },
    {
      name: "Equation setup",
      steps: [
        "Assign a variable to the unknown quantity.",
        "Translate the percentage statement into an equation.",
        "Solve the equation algebraically."
      ],
      bestFor: "Reverse or multi-step problems where the base itself is unknown."
    }
  ],
  alternativeMethods: [
    {
      name: "Multiplying-factor shortcut",
      steps: [
        "Convert a P% increase to a single multiplying factor (1 + P/100), or a P% decrease to (1 - P/100).",
        "Chain multiplying factors for successive changes instead of adding percentages.",
        "Multiply the original value by the combined factor."
      ],
      bestFor: "Successive percentage changes, where directly adding percentages is a common trap."
    }
  ],
  shortcuts: [
    {
      name: "Common fraction-percentage equivalents",
      description: "Memorized equivalents like 1/8 = 12.5%, 1/3 ≈ 33.3%, 1/6 ≈ 16.67% avoid long division under time pressure.",
      validWhen: "The percentage corresponds to a common simple fraction."
    },
    {
      name: "10%-building block",
      description: "Compute 10% of a value by shifting the decimal point, then scale or combine to reach other percentages (e.g. 15% = 10% + 5%).",
      validWhen: "Mental-math estimation or exact computation with a round base value."
    }
  ],
  commonMisconceptions: [
    {
      description: "Treating two successive percentage changes as simply additive (e.g. +20% then -20% nets to 0%), when they actually compound against different bases.",
      errorTaxonomyCode: "successive_change_error"
    },
    {
      description: "Applying a percentage change to the wrong base — e.g. computing a decrease as a percentage of the new value instead of the original value.",
      errorTaxonomyCode: "base_confusion"
    }
  ],
  commonTraps: [
    {
      description: "A reverse-percentage question hides the original value and only states the final value plus the percentage change, tempting a direct (wrong-direction) percentage calculation on the final value.",
      errorTaxonomyCode: "base_confusion"
    },
    {
      description: "A question asks for the percentage POINT difference between two percentages, phrased to sound like it wants the percentage CHANGE (a relative figure), or vice versa.",
      errorTaxonomyCode: "percentage_point_confusion"
    }
  ],
  applicationAreas: [
    { name: "Profit and Loss", description: "Gain/loss expressed as a percentage of cost price." },
    { name: "Discount", description: "Price reduction expressed as a percentage of marked price." },
    { name: "Population Growth and Decline", description: "Repeated percentage change applied over time periods." },
    { name: "Data Interpretation", description: "Percentage share and percentage change read from tables/graphs." }
  ],
  difficultyProgression: [
    { tier: "standard", description: "Direct 'find P% of X' or single percentage-change computation with an explicit base." },
    { tier: "advanced", description: "Successive percentage changes, or a straightforward reverse-percentage problem." },
    { tier: "hard", description: "Reverse percentage combined with a second concept (e.g. ratio or profit/loss) in the same question." },
    { tier: "extreme", description: "Multi-step chains of successive changes across several combined concepts, solvable reliably only via equation setup." },
    { tier: "novel", description: "Percentage reasoning presented in an unfamiliar representation (e.g. embedded in a DI graph or a non-numeric contextual narrative) with no explicit 'percentage' cue in the question." }
  ]
};

export const ratioConceptDepth: ConceptDepthData = {
  conceptName: "Ratio",
  definition: "A ratio compares two or more quantities by expressing their relative sizes as a:b (or a:b:c).",
  intuition: "A ratio is a percentage's sibling with a different denominator convention — instead of always comparing 'out of 100', a ratio compares 'out of each other' directly.",
  formulas: [
    {
      label: "Dividing a total in a given ratio",
      expression: "Part = (ratio share / sum of ratio parts) * Total",
      whenToUse: "Splitting a known total into parts according to a stated ratio."
    }
  ],
  methods: [
    {
      name: "Common-multiple scaling",
      steps: ["Express both ratios with a common term.", "Scale the other terms proportionally."],
      bestFor: "Combining two ratios that share one common quantity (e.g. A:B and B:C into A:B:C)."
    }
  ],
  alternativeMethods: [],
  shortcuts: [],
  commonMisconceptions: [
    {
      description: "Treating a ratio a:b as if it directly gives percentages of a fixed 100 (e.g. reading 3:2 as '3% and 2%') instead of parts summing to the total.",
      errorTaxonomyCode: "base_confusion"
    }
  ],
  commonTraps: [],
  applicationAreas: [
    { name: "Mixtures and Alligations", description: "Blending components in a ratio derived from the alligation rule." },
    { name: "Averages", description: "Weighted averages computed via ratio-weighted combination of subgroups." }
  ],
  difficultyProgression: [
    { tier: "standard", description: "Divide a total in a given two-term ratio." },
    { tier: "advanced", description: "Combine two ratios sharing a common term into a three-term ratio." }
  ]
};
