import { describe, expect, it } from "vitest";
import { buildAutopsyOutput } from "../src/autopsyOutput.js";
import { buildRepairContext } from "../src/repairContext.js";
import { buildEvidence } from "../fixtures/evidence.js";
import { errorTaxonomyFixture } from "../fixtures/errorTaxonomy.js";
import { percentagesHardNovelPressureQuestionContext, percentagesQuestionContext } from "../fixtures/questionContext.js";
import type { HistoricalAttemptRecord } from "../src/types.js";

describe("buildRepairContext — identifies a target, never selects or generates follow-up questions (Phase 5A §11)", () => {
  it("has no followUpQuestionIds field at all — selecting content is explicitly out of scope", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    const context = buildRepairContext(output);
    expect(Object.keys(context)).not.toContain("followUpQuestionIds");
  });

  it("priority is 'high' when a repeated failure pattern exists", () => {
    const prior: HistoricalAttemptRecord[] = [
      { evidence: buildEvidence({ isCorrect: false }), question: percentagesQuestionContext },
      { evidence: buildEvidence({ isCorrect: false }), question: percentagesQuestionContext }
    ];
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture,
      priorAttempts: prior
    });
    expect(buildRepairContext(output).priority).toBe("high");
  });

  it("priority is 'medium' for a single incorrect attempt with a candidate error but no repeated pattern", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    expect(buildRepairContext(output).priority).toBe("medium");
  });

  it("priority is 'low' for a correct attempt", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: true }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    expect(buildRepairContext(output).priority).toBe("low");
  });

  it("recommends timed_pressure_drill when repeated pressure difficulty is present", () => {
    const prior: HistoricalAttemptRecord[] = [
      { evidence: buildEvidence({ isCorrect: false }), question: percentagesHardNovelPressureQuestionContext }
    ];
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesHardNovelPressureQuestionContext,
      errorTaxonomy: errorTaxonomyFixture,
      priorAttempts: prior
    });
    expect(buildRepairContext(output).recommendedTrainingMode).toBe("timed_pressure_drill");
  });

  it("defaults to standard_practice with no special signals present", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: true }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    expect(buildRepairContext(output).recommendedTrainingMode).toBe("standard_practice");
  });

  it("targets the concept/pattern-family/cell from questionFacts directly, not re-derived", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    const context = buildRepairContext(output);
    expect(context.targetConceptName).toBe(percentagesQuestionContext.conceptName);
    expect(context.targetPatternFamilyName).toBe(percentagesQuestionContext.patternFamilyName);
    expect(context.targetTaxonomyCellId).toBe(percentagesQuestionContext.patternTaxonomyCellId);
  });
});
