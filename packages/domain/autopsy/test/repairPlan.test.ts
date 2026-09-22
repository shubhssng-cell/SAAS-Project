import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import type { ConceptGraph } from "@ipmat/concept-graph";
import { describe, expect, it } from "vitest";
import { buildAutopsyOutput } from "../src/autopsyOutput.js";
import { confirmHypothesis, correctHypothesis, generateHypothesis, rejectHypothesis } from "../src/hypothesis.js";
import { buildRepairPlan } from "../src/repairPlan.js";
import { HypothesisError } from "../src/types.js";
import { buildEvidence } from "../fixtures/evidence.js";
import { errorTaxonomyFixture } from "../fixtures/errorTaxonomy.js";
import { percentagesQuestionContext, ratioQuestionContext } from "../fixtures/questionContext.js";

const validAiHypothesis: AutopsyHypothesisAiOutput = {
  proposedErrorCategory: "misconception",
  proposedExplanation: "This pattern is consistent with applying the percentage change to the wrong base quantity.",
  supportingEvidence: ["The candidate error evidence matched the question's designated trap (base_confusion)."],
  contradictoryEvidence: [],
  missingEvidence: [],
  modelConfidence: 0.6
};

const output = buildAutopsyOutput({
  evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
  question: percentagesQuestionContext,
  errorTaxonomy: errorTaxonomyFixture
});

const miniGraph: ConceptGraph = {
  concepts: [
    { name: "Percentages", chapterName: "Percentages", description: "", status: "published" },
    { name: "Ratio", chapterName: "Ratio", description: "", status: "published" }
  ],
  relations: [
    {
      from: "Ratio",
      to: "Percentages",
      type: "prerequisite",
      rationale: "test fixture",
      sharedKnowledge: "test",
      usefulForQuestionGeneration: true,
      requirementLevel: "required",
      certainty: "confirmed",
      source: "human"
    }
  ]
};

async function confirmedHypothesis() {
  const provider = new FixtureProvider([JSON.stringify(validAiHypothesis)]);
  const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
  return confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
}

describe("buildRepairPlan — only from a CONFIRMED diagnosis, never selects/generates questions (Phase 5B §6)", () => {
  it("builds a plan from a confirmed hypothesis", async () => {
    const hypothesis = await confirmedHypothesis();
    const plan = buildRepairPlan(hypothesis, output);

    expect(plan.targetConceptName).toBe("Percentages");
    expect(plan.targetPatternFamilyName).toBe("Reverse Percentage");
    expect(plan.targetTaxonomyCellId).toBe(percentagesQuestionContext.patternTaxonomyCellId);
    expect(plan.targetErrorCategory).toBe("misconception");
    expect(plan.targetErrorTaxonomyCode).toBe("base_confusion");
    expect(plan.confirmationSource.attemptId).toBe(hypothesis.attemptId);
    expect(plan.confirmationSource.hypothesisConfirmedAt).toBe("2026-09-22T11:00:00.000Z");
  });

  it("has no followUpQuestionIds field — selecting/generating questions remains out of scope", async () => {
    const hypothesis = await confirmedHypothesis();
    const plan = buildRepairPlan(hypothesis, output);
    expect(Object.keys(plan)).not.toContain("followUpQuestionIds");
  });

  it("prerequisites are [] when no ConceptGraph is supplied", async () => {
    const hypothesis = await confirmedHypothesis();
    const plan = buildRepairPlan(hypothesis, output);
    expect(plan.prerequisites).toEqual([]);
  });

  it("prerequisites are resolved from a real ConceptGraph when supplied", async () => {
    const hypothesis = await confirmedHypothesis();
    const plan = buildRepairPlan(hypothesis, output, { graph: miniGraph });
    expect(plan.prerequisites).toEqual(["Ratio"]);
  });

  it("throws not_confirmed for an awaiting_confirmation hypothesis", async () => {
    const provider = new FixtureProvider([JSON.stringify(validAiHypothesis)]);
    const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
    expect(() => buildRepairPlan(hypothesis, output)).toThrow(HypothesisError);
    try {
      buildRepairPlan(hypothesis, output);
    } catch (error) {
      expect((error as HypothesisError).code).toBe("not_confirmed");
    }
  });

  it("throws not_confirmed for a rejected hypothesis", async () => {
    const provider = new FixtureProvider([JSON.stringify(validAiHypothesis)]);
    const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
    const rejected = rejectHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    expect(() => buildRepairPlan(rejected, output)).toThrow(HypothesisError);
  });

  it("a 'corrected' hypothesis is deliberately NOT accepted — no structured category to target from free text alone", async () => {
    const provider = new FixtureProvider([JSON.stringify(validAiHypothesis)]);
    const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
    const corrected = correctHypothesis(hypothesis, "It was actually a sign error.", { now: "2026-09-22T11:00:00.000Z" });
    try {
      buildRepairPlan(corrected, output);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as HypothesisError).code).toBe("not_confirmed");
    }
  });

  it("throws mismatched_attempt when the hypothesis and output disagree on which attempt they're for", async () => {
    const hypothesis = await confirmedHypothesis();
    const otherOutput = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "1" }),
      question: ratioQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    try {
      buildRepairPlan(hypothesis, otherOutput);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as HypothesisError).code).toBe("mismatched_attempt");
    }
  });

  it("throws no_error_category when the confirmed hypothesis proposed no category", async () => {
    const noCategoryHypothesis: AutopsyHypothesisAiOutput = { ...validAiHypothesis, proposedErrorCategory: null };
    const provider = new FixtureProvider([JSON.stringify(noCategoryHypothesis)]);
    const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
    const confirmed = confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    try {
      buildRepairPlan(confirmed, output);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as HypothesisError).code).toBe("no_error_category");
    }
  });
});
