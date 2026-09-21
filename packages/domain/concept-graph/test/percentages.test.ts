import { describe, expect, it } from "vitest";
import { percentagesConceptGraph } from "../fixtures/percentages.js";
import { findRelation, getCombinableConcepts, getPrerequisites, hasConcept } from "../src/graph.js";

describe("seeded Percentages concept graph", () => {
  it("contains the core concept and its immediate neighbors", () => {
    expect(hasConcept(percentagesConceptGraph, "Percentages")).toBe(true);
    expect(hasConcept(percentagesConceptGraph, "Ratio")).toBe(true);
    expect(hasConcept(percentagesConceptGraph, "Profit and Loss")).toBe(true);
  });

  it("has a known prerequisite edge: Ratio is a prerequisite of Percentages", () => {
    const edge = findRelation(percentagesConceptGraph, "Ratio", "Percentages", "prerequisite_of");
    expect(edge).toBeDefined();
    expect(edge?.strength).toBe("strong");
    expect(getPrerequisites(percentagesConceptGraph, "Percentages")).toContain("Ratio");
  });

  it("has a known combination edge: Percentages combines with Profit and Loss", () => {
    const edge = findRelation(percentagesConceptGraph, "Percentages", "Profit and Loss", "combines_with");
    expect(edge).toBeDefined();
    expect(getCombinableConcepts(percentagesConceptGraph, "Percentages")).toContain("Profit and Loss");
  });

  it("keeps AI-suggested edges distinguishable from human-curated ones", () => {
    const aiEdge = findRelation(percentagesConceptGraph, "Percentages", "Algebra", "combines_with");
    expect(aiEdge?.source).toBe("ai_suggested");

    const humanEdge = findRelation(percentagesConceptGraph, "Ratio", "Percentages", "prerequisite_of");
    expect(humanEdge?.source).toBe("human");
  });
});
