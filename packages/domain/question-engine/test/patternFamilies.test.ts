import { hasConcept, percentagesConceptGraph } from "@ipmat/concept-graph";
import { findCompletenessClaims } from "@ipmat/examiner-lens";
import { describe, expect, it } from "vitest";
import { percentagesPatternFamilies } from "../fixtures/percentagesPatternFamilies.js";
import { percentagesTaxonomyCells } from "../fixtures/percentagesTaxonomyCells.js";

describe("Question Pattern Family — belongs to the correct concept domain", () => {
  it("every family's conceptName is a real concept in the graph", () => {
    for (const family of percentagesPatternFamilies) {
      expect(hasConcept(percentagesConceptGraph, family.conceptName)).toBe(true);
    }
  });

  it("every family's potential combination concepts are real concepts in the graph", () => {
    for (const family of percentagesPatternFamilies) {
      for (const combo of family.potentialCombinationConcepts) {
        expect(hasConcept(percentagesConceptGraph, combo)).toBe(true);
      }
    }
  });

  it("describes the STRUCTURE of a question, not a numerical instance (no digits in the description)", () => {
    for (const family of percentagesPatternFamilies) {
      expect(/\d/.test(family.description)).toBe(false);
    }
  });
});

describe("PatternTaxonomyCell — belongs to a real pattern family", () => {
  it("every cell references a family that actually exists for the same concept", () => {
    const familyKeys = new Set(percentagesPatternFamilies.map((f) => `${f.conceptName}::${f.name}`));
    for (const cell of percentagesTaxonomyCells) {
      expect(familyKeys.has(`${cell.conceptName}::${cell.patternFamilyName}`)).toBe(true);
    }
  });

  it("every cell's combination concepts are real concepts in the graph", () => {
    for (const cell of percentagesTaxonomyCells) {
      for (const concept of cell.combination) {
        expect(hasConcept(percentagesConceptGraph, concept)).toBe(true);
      }
    }
  });
});

describe("no false completeness claim is encoded in pattern family content", () => {
  it("finds nothing in any family's skill/description text", () => {
    const allText = percentagesPatternFamilies.map((f) => `${f.skill} ${f.description}`).join(" ");
    expect(findCompletenessClaims(allText)).toEqual([]);
  });
});
