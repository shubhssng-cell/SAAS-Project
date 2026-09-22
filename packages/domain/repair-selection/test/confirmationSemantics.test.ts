import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { buildAutopsyOutput, buildRepairPlan, correctHypothesis, generateHypothesis, HypothesisError, rejectHypothesis } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { selectRepairQuestion } from "../src/selectRepairQuestion.js";
import { RepairSelectionError } from "../src/types.js";
import { buildEvidence, errorTaxonomyFixture, makeCandidate, percentagesQuestionContext } from "./fixtures.js";

/**
 * Proves that this package STRUCTURALLY cannot produce a repair
 * prescription except from a genuinely confirmed diagnosis (Phase 5C-2
 * §3, K/L/M). `selectRepairQuestion()`'s only diagnosis-side input is a
 * `RepairPlan` — and `buildRepairPlan()` (`@ipmat/autopsy`, Phase 5B, D-039)
 * is the ONLY function that constructs one, refusing for every status
 * except `"confirmed"`. There is no code path in this package, or in
 * `@ipmat/autopsy`, through which an awaiting/rejected/corrected
 * hypothesis could reach a repair selection.
 */
async function freshHypothesis() {
  const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420" });
  const output = buildAutopsyOutput({ evidence, question: percentagesQuestionContext, errorTaxonomy: errorTaxonomyFixture });
  const aiHypothesis: AutopsyHypothesisAiOutput = {
    proposedErrorCategory: "misconception",
    proposedExplanation: "Applied the percentage change to the wrong base quantity.",
    supportingEvidence: ["Matched the designated trap."],
    contradictoryEvidence: [],
    missingEvidence: [],
    modelConfidence: 0.7
  };
  const provider = new FixtureProvider([JSON.stringify(aiHypothesis)]);
  const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
  return { hypothesis, output };
}

describe("Confirmation semantics — only a confirmed diagnosis may produce a repair prescription (Phase 5C-2 §3)", () => {
  it("K. awaiting confirmation -> buildRepairPlan() refuses, so no RepairPlan and no repair selection can ever happen", async () => {
    const { hypothesis, output } = await freshHypothesis();
    expect(hypothesis.confirmationStatus).toBe("awaiting_confirmation");

    expect(() => buildRepairPlan(hypothesis, output)).toThrow(HypothesisError);
    try {
      buildRepairPlan(hypothesis, output);
    } catch (error) {
      expect((error as HypothesisError).code).toBe("not_confirmed");
    }
  });

  it("L. rejected hypothesis -> buildRepairPlan() refuses, so no repair prescription is produced", async () => {
    const { hypothesis, output } = await freshHypothesis();
    const rejected = rejectHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    expect(rejected.confirmationStatus).toBe("rejected");

    expect(() => buildRepairPlan(rejected, output)).toThrow(HypothesisError);
  });

  it("M. corrected hypothesis -> the student's correction text is preserved exactly, but buildRepairPlan() still refuses (no invented taxonomy classification)", async () => {
    const { hypothesis, output } = await freshHypothesis();
    const correctionText = "It wasn't a base-confusion error — I actually misread which town the question asked about.";
    const corrected = correctHypothesis(hypothesis, correctionText, { now: "2026-09-22T11:00:00.000Z" });

    expect(corrected.confirmationStatus).toBe("corrected");
    // The student's own words are preserved verbatim, not paraphrased or reclassified into an error category.
    expect(corrected.studentCorrectionText).toBe(correctionText);
    // The original AI-proposed category is untouched — the correction adds NEW evidence, it never overwrites it.
    expect(corrected.proposedErrorCategory).toBe(hypothesis.proposedErrorCategory);

    expect(() => buildRepairPlan(corrected, output)).toThrow(HypothesisError);
    try {
      buildRepairPlan(corrected, output);
    } catch (error) {
      expect((error as HypothesisError).code).toBe("not_confirmed");
    }
  });

  it("the selector's own defensive check independently refuses a RepairPlan-shaped object that bypassed buildRepairPlan()'s gate", async () => {
    // Simulates a caller constructing a RepairPlan-shaped value some other way (TypeScript's
    // structural typing cannot prevent this) — the selector must not trust the type alone.
    const tamperedPlan = {
      targetConceptName: "Percentages",
      targetPatternFamilyName: "Reverse Percentage",
      targetTaxonomyCellId: "cell-1",
      targetErrorCategory: "misconception" as const,
      targetErrorTaxonomyCode: "base_confusion",
      recommendedTrainingMode: "standard_practice" as const,
      priority: "medium" as const,
      rationale: [],
      prerequisites: [],
      confirmationSource: { attemptId: "attempt-1", hypothesisConfirmedAt: "" }
    };

    expect(() => selectRepairQuestion({ repairPlan: tamperedPlan, candidateQuestions: [makeCandidate()] })).toThrow(RepairSelectionError);
  });
});
