import type { ConceptGraph } from "../src/types.js";

/**
 * Human-curated seed for IPMAT > Quant > Percentages (see
 * docs/QUESTION_ENGINE.md §1). A small, correct graph is worth more than a
 * large noisy one at bootstrap — this is deliberately not exhaustive.
 *
 * Edges with source "ai_suggested" represent AI-proposed relations that a
 * human has already reviewed and approved for this fixture; in the real
 * authoring flow, ai_suggested edges start unapproved and don't affect
 * question generation until a human flips them (see QUESTION_ENGINE.md §1).
 */
export const percentagesConceptGraph: ConceptGraph = {
  chapterName: "Percentages",
  concepts: [
    {
      name: "Percentages",
      description: "Expressing and manipulating quantities as parts per hundred.",
      status: "curated"
    },
    {
      name: "Ratio",
      description: "Comparing quantities by relative size.",
      status: "curated"
    },
    {
      name: "Averages",
      description: "Central tendency of a set of quantities.",
      status: "curated"
    },
    {
      name: "Profit and Loss",
      description: "Cost price, selling price, and gain/loss expressed in absolute and percentage terms.",
      status: "curated"
    },
    {
      name: "Discount",
      description: "Marked price vs. selling price reductions, often expressed as a percentage.",
      status: "curated"
    },
    {
      name: "Data Interpretation",
      description: "Reading and computing over tabular, graphical, or textual data sets.",
      status: "curated"
    },
    {
      name: "Algebra",
      description: "Symbolic manipulation and equation-solving.",
      status: "curated"
    }
  ],
  relations: [
    { from: "Ratio", to: "Percentages", type: "prerequisite_of", strength: "strong", source: "human" },
    { from: "Percentages", to: "Profit and Loss", type: "prerequisite_of", strength: "strong", source: "human" },
    { from: "Percentages", to: "Discount", type: "prerequisite_of", strength: "strong", source: "human" },
    { from: "Percentages", to: "Averages", type: "related_to", strength: "moderate", source: "human" },
    { from: "Ratio", to: "Averages", type: "related_to", strength: "moderate", source: "human" },
    { from: "Percentages", to: "Profit and Loss", type: "combines_with", strength: "strong", source: "human" },
    { from: "Percentages", to: "Discount", type: "combines_with", strength: "strong", source: "human" },
    { from: "Percentages", to: "Data Interpretation", type: "combines_with", strength: "moderate", source: "human" },
    { from: "Percentages", to: "Algebra", type: "combines_with", strength: "weak", source: "ai_suggested" }
  ]
};
