import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { describe, expect, it } from "vitest";
import { percentagesPatternFamilies } from "../fixtures/percentagesPatternFamilies.js";
import { percentagesReversePercentageExample } from "../fixtures/percentagesQuestionDnaExample.js";
import { validateQuestionDna } from "../src/questionDna.js";

describe("Question DNA — references valid concepts and patterns", () => {
  it("the worked example's DNA passes validation", () => {
    const result = validateQuestionDna(percentagesReversePercentageExample.dna, percentagesConceptGraph, percentagesPatternFamilies);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a DNA object naming a pattern family that doesn't exist for the concept", () => {
    const broken = { ...percentagesReversePercentageExample.dna, patternFamilyName: "Not A Real Pattern" };
    const result = validateQuestionDna(broken, percentagesConceptGraph, percentagesPatternFamilies);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.field === "patternFamilyName")).toBe(true);
  });

  it("rejects a DNA object referencing a nonexistent combination concept", () => {
    const broken = { ...percentagesReversePercentageExample.dna, combinesWithConcepts: ["Nonexistent Concept"] };
    const result = validateQuestionDna(broken, percentagesConceptGraph, percentagesPatternFamilies);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.field === "combinesWithConcepts")).toBe(true);
  });

  it("normalizes frequently-queried fields as their own typed properties, not one opaque blob", () => {
    const dna = percentagesReversePercentageExample.dna;
    expect(typeof dna.noveltyLevel).toBe("string");
    expect(typeof dna.examRelevance).toBe("string");
    expect(Array.isArray(dna.testingModes)).toBe(true);
    expect(typeof dna.trapErrorTaxonomyCode === "string" || dna.trapErrorTaxonomyCode === null).toBe(true);
  });
});
