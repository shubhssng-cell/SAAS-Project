import { getCombinationCandidates, percentagesConceptGraph } from "@ipmat/concept-graph";
import { describe, expect, it } from "vitest";
import { deriveCombinations } from "../src/deriveCombinations.js";
import { ALL_ERROR_CATEGORIES, ALL_TESTING_MODES } from "../src/types.js";
import { findCompletenessClaims, validateExaminerLensAnalysis } from "../src/validate.js";
import { percentagesLens } from "../fixtures/percentagesLens.js";

describe("Examiner Lens — structural validity", () => {
  it("the Percentages fixture passes structural validation", () => {
    const result = validateExaminerLensAnalysis(percentagesLens, percentagesConceptGraph);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an analysis that references a concept outside the supplied graph", () => {
    const broken = {
      ...percentagesLens,
      combinations: [
        ...percentagesLens.combinations,
        {
          concept: "Nonexistent Concept",
          relation: percentagesLens.combinations[0]!.relation
        }
      ]
    };
    const result = validateExaminerLensAnalysis(broken, percentagesConceptGraph);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.field === "combinations")).toBe(true);
  });

  it("rejects an empty testingModes list", () => {
    const result = validateExaminerLensAnalysis({ ...percentagesLens, testingModes: [] }, percentagesConceptGraph);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.field === "testingModes")).toBe(true);
  });

  it("only uses testing modes and error categories from the controlled vocabulary", () => {
    for (const mode of percentagesLens.testingModes) {
      expect(ALL_TESTING_MODES).toContain(mode);
    }
    for (const errorMode of percentagesLens.errorModes) {
      expect(ALL_ERROR_CATEGORIES).toContain(errorMode.category);
    }
  });
});

describe("Examiner Lens — combinations come from the concept graph, never hand-duplicated", () => {
  it("deriveCombinations matches getCombinationCandidates on the same graph", () => {
    const derived = deriveCombinations(percentagesConceptGraph, "Percentages");
    const candidates = getCombinationCandidates(percentagesConceptGraph, "Percentages");
    expect(derived.length).toBe(candidates.length);
    expect(derived.map((c) => c.concept).sort()).toEqual(
      candidates.map((edge) => (edge.from === "Percentages" ? edge.to : edge.from)).sort()
    );
  });

  it("the fixture's stored combinations are exactly what the graph currently supports (no drift)", () => {
    const freshlyDerived = deriveCombinations(percentagesConceptGraph, "Percentages");
    expect(percentagesLens.combinations.map((c) => c.concept).sort()).toEqual(
      freshlyDerived.map((c) => c.concept).sort()
    );
  });
});

describe("Examiner Lens — no false completeness claim is encoded", () => {
  it("finds nothing in the Percentages fixture's text fields", () => {
    const allText = [
      percentagesLens.whatIsTested.skill,
      ...percentagesLens.errorModes.map((mode) => mode.description),
      ...percentagesLens.combinations.map((c) => c.relation.rationale)
    ].join(" ");
    expect(findCompletenessClaims(allText)).toEqual([]);
  });

  it("the guard actually catches a deliberately bad completeness claim", () => {
    expect(findCompletenessClaims("this covers every possible question on the topic")).toContain(
      "every possible question"
    );
    const result = validateExaminerLensAnalysis(
      {
        ...percentagesLens,
        whatIsTested: { ...percentagesLens.whatIsTested, skill: "This is mathematically complete." }
      },
      percentagesConceptGraph
    );
    expect(result.valid).toBe(false);
  });
});
