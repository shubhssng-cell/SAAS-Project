import { coverageExpansionFixtures, percentagesReversePercentageExample } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import { validateDnaClassification, type HistoricalDnaClassification, type HistoricalIssueCode } from "../src/index.js";
import { baseClassification, ipmatContext, otherExamPack } from "./fixtures.js";

const codes = (dna: HistoricalDnaClassification, ctx = ipmatContext()): HistoricalIssueCode[] => validateDnaClassification(dna, ctx).map((i) => i.code);

describe("Question DNA validation against the exam pack", () => {
  it("accepts the repository's own worked DNA example (existing vocabulary, nothing new)", () => {
    expect(validateDnaClassification(baseClassification(), ipmatContext())).toEqual([]);
  });

  it("accepts every existing Phase 3.5 candidate DNA (regression: the new rules do not reject real existing metadata)", () => {
    expect(coverageExpansionFixtures.length).toBeGreaterThan(0);
    for (const f of coverageExpansionFixtures) {
      const { questionDna, } = f.candidate;
      const dna = { ...questionDna, examCode: f.blueprint.examCode, sectionName: f.blueprint.sectionName, chapterName: f.blueprint.chapterName } as unknown as HistoricalDnaClassification;
      expect(validateDnaClassification(dna, ipmatContext()), f.label).toEqual([]);
    }
  });

  it("carries the same vocabulary as the existing DNA example: no field was invented", () => {
    const keys = Object.keys(baseClassification()).sort();
    const existing = Object.keys(percentagesReversePercentageExample.dna).filter((k) => !["provenanceSourceType", "validationState", "examRelevance"].includes(k)).sort();
    expect(keys).toEqual(existing);
  });

  describe("exam identity and location", () => {
    it("rejects DNA for another exam", () => expect(codes(baseClassification({ examCode: "OTHER_EXAM" }))).toContain("exam_mismatch"));
    it("rejects an unknown section and an unknown chapter", () => {
      expect(codes(baseClassification({ sectionName: "Verbal" }))).toContain("unknown_section");
      expect(codes(baseClassification({ chapterName: "Astrology" }))).toContain("unknown_chapter");
    });
    it("rejects a concept claimed under a chapter it is not located in", () => {
      expect(codes(baseClassification({ chapterName: "Probability" }))).toContain("concept_not_in_chapter");
    });
    it("matches names by normalization, never fuzzily (Percentage != Percentages)", () => {
      expect(codes(baseClassification({ conceptName: "  PERCENTAGES " }))).not.toContain("unknown_concept");
      expect(codes(baseClassification({ conceptName: "Percentage" }))).toContain("unknown_concept");
    });
  });

  describe("concept mapping", () => {
    it("rejects unknown subconcepts, prerequisites and combination concepts", () => {
      expect(codes(baseClassification({ subconcepts: ["Nope"] }))).toContain("unknown_concept");
      expect(codes(baseClassification({ prerequisites: ["Nope"] }))).toContain("unknown_concept");
      expect(codes(baseClassification({ combinesWithConcepts: ["Nope"] }))).toContain("unknown_concept");
    });
    it("rejects duplicates", () => {
      expect(codes(baseClassification({ combinesWithConcepts: ["Ratio", "ratio"] }))).toContain("duplicate_entries");
    });
  });

  describe("contradictory metadata (only claims that contradict themselves by definition)", () => {
    it("a concept cannot combine with, or be a prerequisite of, itself", () => {
      expect(codes(baseClassification({ combinesWithConcepts: ["Percentages"] }))).toContain("contradictory_metadata");
      expect(codes(baseClassification({ prerequisites: ["Percentages"] }))).toContain("contradictory_metadata");
    });
    it('"combined" testing mode and "novel_combination" novelty both require combination concepts', () => {
      expect(codes(baseClassification({ testingModes: ["combined"], combinesWithConcepts: [] }))).toContain("contradictory_metadata");
      expect(codes(baseClassification({ noveltyLevel: "novel_combination", combinesWithConcepts: [], testingModes: ["direct"] }))).toContain("contradictory_metadata");
      expect(codes(baseClassification({ noveltyLevel: "novel_combination", combinesWithConcepts: ["Ratio"], testingModes: ["combined"] }))).toEqual([]);
    });
    it("difficulty is NOT cross-checked against time, novelty or modes: long-but-easy, novel-but-easy and time-pressured-but-easy are all legal", () => {
      const easy = { conceptualLoad: 0.1, computationalLoad: 0.1, trapDensity: 0.1, representationNovelty: 0.1, timePressure: 0.1, multiStepDepth: 0.1 };
      expect(codes(baseClassification({ difficultyDimensions: easy, expectedTimeSeconds: 600 }))).toEqual([]);
      expect(codes(baseClassification({ difficultyDimensions: { ...easy, representationNovelty: 1 }, noveltyLevel: "novel_representation" }))).toEqual([]);
      expect(codes(baseClassification({ difficultyDimensions: easy, testingModes: ["time_pressured"] }))).toEqual([]);
      expect(codes(baseClassification({ difficultyDimensions: { ...easy, timePressure: 1 }, difficultyTier: "standard" }))).toEqual([]);
    });
  });

  describe("pattern family (structure) vs record (instance)", () => {
    it("requires a pattern family that exists for THAT concept", () => {
      expect(codes(baseClassification({ patternFamilyName: "No Such Pattern" }))).toContain("unknown_pattern_family");
      expect(codes(baseClassification({ conceptName: "Ratio", chapterName: "Ratio and Proportion" }))).toContain("unknown_pattern_family");
    });
    it("the classification names a family; it holds no description or numeric instance of one", () => {
      const keys = Object.keys(baseClassification());
      for (const forbidden of ["description", "body", "options", "correctAnswer", "solutionSteps"]) expect(keys).not.toContain(forbidden);
    });
  });

  describe("difficulty dimensions and expected time", () => {
    it.each(["conceptualLoad", "computationalLoad", "trapDensity", "representationNovelty", "timePressure", "multiStepDepth"] as const)("%s must be finite and within [0, 1]", (key) => {
      for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const dna = baseClassification();
        dna.difficultyDimensions = { ...dna.difficultyDimensions, [key]: bad };
        expect(codes(dna), `${key}=${bad}`).toContain("invalid_difficulty");
      }
    });
    it("rejects an unknown dimension (e.g. an invented 'transformationComplexity') and a missing struct", () => {
      const dna = baseClassification();
      (dna.difficultyDimensions as unknown as Record<string, number>).transformationComplexity = 0.5;
      expect(codes(dna)).toContain("invalid_difficulty");
      const missing = baseClassification() as unknown as Record<string, unknown>;
      delete missing.difficultyDimensions;
      expect(codes(missing as unknown as HistoricalDnaClassification)).toContain("missing_metadata");
    });
    it("expected time must be a positive whole number of seconds", () => {
      for (const bad of [0, -5, 1.5, Number.NaN]) expect(codes(baseClassification({ expectedTimeSeconds: bad })), String(bad)).toContain("invalid_expected_time");
    });
    it("rejects an unknown tier", () => expect(codes(baseClassification({ difficultyTier: "impossible" as never }))).toContain("invalid_difficulty"));
  });

  describe("novelty, testing modes (transformations) and traps", () => {
    it.each(["standard", "novel_representation", "novel_combination", "novel_context"] as const)("accepts existing novelty level %s", (level) => {
      expect(codes(baseClassification({ noveltyLevel: level, combinesWithConcepts: ["Ratio"], testingModes: ["combined"] }))).toEqual([]);
    });
    it("rejects an unknown novelty level", () => expect(codes(baseClassification({ noveltyLevel: "very_novel" as never }))).toContain("invalid_novelty"));
    it("requires at least one known, unique testing mode", () => {
      expect(codes(baseClassification({ testingModes: [] }))).toContain("invalid_testing_modes");
      expect(codes(baseClassification({ testingModes: ["bogus" as never] }))).toContain("invalid_testing_modes");
      expect(codes(baseClassification({ testingModes: ["reverse", "reverse"] }))).toContain("duplicate_entries");
    });
    it("a trap must be an existing ErrorTaxonomy code (no free-form trap strings); null is allowed", () => {
      expect(codes(baseClassification({ trapErrorTaxonomyCode: "made_up_trap" }))).toContain("unknown_trap");
      expect(codes(baseClassification({ trapErrorTaxonomyCode: null }))).toEqual([]);
    });
  });

  describe("missing metadata", () => {
    it("requires a skill and a pattern family", () => {
      expect(codes(baseClassification({ skill: " " }))).toContain("missing_metadata");
      expect(codes(baseClassification({ patternFamilyName: "" }))).toContain("missing_metadata");
    });
  });

  describe("exam isolation", () => {
    it("DNA valid for the IPMAT pack is rejected against another exam's pack even when concept names overlap", () => {
      const result = codes(baseClassification(), { ...ipmatContext(), pack: otherExamPack() });
      expect(result).toContain("exam_mismatch");
    });
  });
});
