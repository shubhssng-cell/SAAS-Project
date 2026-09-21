import { describe, expect, it } from "vitest";
import { percentagesConceptDepth, ratioConceptDepth } from "../fixtures/percentagesDepth.js";

describe("ConceptDepth structure", () => {
  it("keeps depth content structured into typed sections, not one text blob", () => {
    expect(Array.isArray(percentagesConceptDepth.formulas)).toBe(true);
    expect(Array.isArray(percentagesConceptDepth.methods)).toBe(true);
    expect(Array.isArray(percentagesConceptDepth.commonMisconceptions)).toBe(true);
    expect(Array.isArray(percentagesConceptDepth.difficultyProgression)).toBe(true);
    expect(percentagesConceptDepth.formulas.length).toBeGreaterThan(0);
  });

  it("difficulty progression covers multiple tiers in increasing order of the standard scale", () => {
    const tiers = percentagesConceptDepth.difficultyProgression.map((step) => step.tier);
    expect(tiers).toContain("standard");
    expect(tiers).toContain("extreme");
  });

  it("common traps reference the same ErrorTaxonomy vocabulary used elsewhere in the system", () => {
    const codes = percentagesConceptDepth.commonTraps.map((trap) => trap.errorTaxonomyCode);
    expect(codes).toContain("base_confusion");
    expect(codes).toContain("percentage_point_confusion");
  });

  it("generalizes to a neighbor concept without a different shape", () => {
    expect(ratioConceptDepth.conceptName).toBe("Ratio");
    expect(Array.isArray(ratioConceptDepth.applicationAreas)).toBe(true);
  });
});
