import { describe, expect, it } from "vitest";
import { percentagesConceptGraph } from "../fixtures/percentages.js";
import {
  findRelation,
  getCombinationCandidates,
  getDistinctButRelated,
  getFoundations,
  getPrerequisites,
  hasConcept
} from "../src/graph.js";
import type { RelationType } from "../src/types.js";

const ALL_RELATION_TYPES: RelationType[] = [
  "prerequisite",
  "foundational",
  "directly_related",
  "commonly_combined",
  "application",
  "dependent",
  "advanced_extension",
  "related_but_distinct"
];

describe("seeded Percentages neighborhood graph", () => {
  it("contains the core concept and neighbors across multiple chapters", () => {
    expect(hasConcept(percentagesConceptGraph, "Percentages")).toBe(true);
    expect(hasConcept(percentagesConceptGraph, "Ratio")).toBe(true);
    expect(hasConcept(percentagesConceptGraph, "Data Interpretation")).toBe(true);
    expect(hasConcept(percentagesConceptGraph, "Mixtures and Alligations")).toBe(true);

    const percentages = percentagesConceptGraph.concepts.find((c) => c.name === "Percentages");
    const ratio = percentagesConceptGraph.concepts.find((c) => c.name === "Ratio");
    expect(percentages?.chapterName).toBe("Percentages");
    expect(ratio?.chapterName).toBe("Ratio and Proportion");
  });

  it("uses every one of the 8 relationship types at least once, not a flattened 'related'", () => {
    const usedTypes = new Set(percentagesConceptGraph.relations.map((edge) => edge.type));
    for (const type of ALL_RELATION_TYPES) {
      expect(usedTypes.has(type)).toBe(true);
    }
  });

  it("every relationship carries a rationale and shared-knowledge explanation, not just a label", () => {
    for (const edge of percentagesConceptGraph.relations) {
      expect(edge.rationale.length).toBeGreaterThan(20);
      expect(edge.sharedKnowledge.length).toBeGreaterThan(5);
    }
  });

  it("prerequisite relationships are directional: Ratio -> Percentages, not the reverse", () => {
    const forward = findRelation(percentagesConceptGraph, "Ratio", "Percentages", "prerequisite");
    const backward = findRelation(percentagesConceptGraph, "Percentages", "Ratio", "prerequisite");
    expect(forward).toBeDefined();
    expect(forward?.requirementLevel).toBe("required");
    expect(backward).toBeUndefined();
    expect(getPrerequisites(percentagesConceptGraph, "Percentages")).toContain("Ratio");
    expect(getPrerequisites(percentagesConceptGraph, "Ratio")).not.toContain("Percentages");
  });

  it("supports a foundational relationship distinct from a narrow prerequisite", () => {
    const edge = findRelation(percentagesConceptGraph, "Number Systems", "Percentages", "foundational");
    expect(edge).toBeDefined();
    expect(getFoundations(percentagesConceptGraph, "Percentages")).toContain("Number Systems");
    // Foundational is broader numeracy, not itself a combination-question source.
    expect(edge?.usefulForQuestionGeneration).toBe(false);
  });

  it("combination candidates exclude related_but_distinct edges", () => {
    const candidates = getCombinationCandidates(percentagesConceptGraph, "Percentages");
    const candidateConcepts = candidates.map((edge) => (edge.from === "Percentages" ? edge.to : edge.from));
    expect(candidateConcepts).toContain("Profit and Loss");
    expect(candidateConcepts).toContain("Data Interpretation");
    expect(candidateConcepts).not.toContain("Probability");
  });

  it("flags related-but-distinct concepts for teaching, marked with honest (non-confirmed) certainty where appropriate", () => {
    const distinct = getDistinctButRelated(percentagesConceptGraph, "Percentages");
    expect(distinct.length).toBeGreaterThan(0);
    const probabilityEdge = distinct.find((edge) => edge.to === "Probability" || edge.from === "Probability");
    expect(probabilityEdge).toBeDefined();
    expect(probabilityEdge?.usefulForQuestionGeneration).toBe(false);
    // This is a plausible but not empirically confirmed claim — certainty must say so.
    expect(probabilityEdge?.certainty).toBe("probable");
  });

  it("keeps AI-suggested edges distinguishable from human-curated ones via source, independent of certainty", () => {
    for (const edge of percentagesConceptGraph.relations) {
      expect(["human", "ai_suggested"]).toContain(edge.source);
      expect(["confirmed", "probable", "speculative"]).toContain(edge.certainty);
    }
  });
});
