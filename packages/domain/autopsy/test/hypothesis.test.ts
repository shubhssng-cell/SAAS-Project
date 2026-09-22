import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import { buildAutopsyOutput } from "../src/autopsyOutput.js";
import { applyConfirmationResponse, confirmHypothesis, correctHypothesis, generateHypothesis, rejectHypothesis } from "../src/hypothesis.js";
import { HypothesisError, type AutopsyHypothesis } from "../src/types.js";
import { buildEvidence } from "../fixtures/evidence.js";
import { errorTaxonomyFixture } from "../fixtures/errorTaxonomy.js";
import { percentagesQuestionContext } from "../fixtures/questionContext.js";

const validAiHypothesis: AutopsyHypothesisAiOutput = {
  proposedErrorCategory: "misconception",
  proposedExplanation: "This pattern is consistent with applying the percentage change to the wrong base quantity.",
  supportingEvidence: ["The candidate error evidence matched the question's designated trap (base_confusion)."],
  contradictoryEvidence: [],
  missingEvidence: ["No reasoning_text was available for this attempt."],
  modelConfidence: 0.6
};

const incorrectOutput = buildAutopsyOutput({
  evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
  question: percentagesQuestionContext,
  errorTaxonomy: errorTaxonomyFixture
});

const correctOutput = buildAutopsyOutput({
  evidence: buildEvidence({ isCorrect: true }),
  question: percentagesQuestionContext,
  errorTaxonomy: errorTaxonomyFixture
});

describe("generateHypothesis — goes through @ipmat/ai's generateStructured, FixtureProvider only (Phase 5B §1/§3/§19)", () => {
  it("a valid hypothesis is wrapped into an AutopsyHypothesis, always starting awaiting_confirmation", async () => {
    const provider = new FixtureProvider([JSON.stringify(validAiHypothesis)]);
    const hypothesis = await generateHypothesis(provider, { autopsyOutput: incorrectOutput });

    expect(hypothesis.attemptId).toBe(incorrectOutput.attemptFacts.attemptId);
    expect(hypothesis.proposedErrorCategory).toBe("misconception");
    expect(hypothesis.confirmationRequired).toBe(true);
    expect(hypothesis.confirmationStatus).toBe("awaiting_confirmation");
    expect(hypothesis.respondedAt).toBeNull();
    expect(hypothesis.studentCorrectionText).toBeNull();
    expect(hypothesis.generationMetadata.task).toBe("autopsy-hypothesis");
    expect(hypothesis.generationMetadata.success).toBe(true);
  });

  it("a malformed (non-JSON) AI response throws after retries — never silently accepted", async () => {
    const provider = new FixtureProvider(["not json", "still not json", "still not json"]);
    await expect(generateHypothesis(provider, { autopsyOutput: incorrectOutput })).rejects.toThrow();
  });

  it("a hypothesis missing required evidence fields fails schema validation and retries, eventually throwing if never fixed", async () => {
    const missingSupportingEvidence = { ...validAiHypothesis, supportingEvidence: [] }; // schema requires .min(1)
    const provider = new FixtureProvider([
      JSON.stringify(missingSupportingEvidence),
      JSON.stringify(missingSupportingEvidence),
      JSON.stringify(missingSupportingEvidence)
    ]);
    await expect(generateHypothesis(provider, { autopsyOutput: incorrectOutput })).rejects.toThrow(/schema validation/);
  });

  it("refuses to call the provider at all when there is no candidate error evidence to diagnose (correct attempt)", async () => {
    // an EMPTY FixtureProvider queue proves no call happened: if the guard failed to fire and
    // generateStructured were reached, complete() would throw "no canned response left" instead —
    // a plain Error with no .code, which would fail the assertion below.
    const provider = new FixtureProvider([]);
    try {
      await generateHypothesis(provider, { autopsyOutput: correctOutput });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as HypothesisError).code).toBe("no_evidence_to_diagnose");
    }
  });

  it("an AI-supplied hypothesis that invents an unsupported fact is still schema-valid (schemas validate shape, not truth) — the model's output remains untrusted, which is exactly why supportingEvidence/contradictoryEvidence/missingEvidence are preserved verbatim for a human/student to judge, not silently accepted as fact", async () => {
    const inventedFactHypothesis: AutopsyHypothesisAiOutput = {
      ...validAiHypothesis,
      proposedExplanation: "The student was clearly anxious about the time pressure and rushed the calculation." // an unsupported psychological claim the MODEL might wrongly produce
    };
    const provider = new FixtureProvider([JSON.stringify(inventedFactHypothesis)]);
    const hypothesis = await generateHypothesis(provider, { autopsyOutput: incorrectOutput });
    // this package cannot stop the MODEL from writing something it was told not to — that's exactly
    // why confirmation is mandatory: nothing downstream trusts proposedExplanation until a human confirms it.
    expect(hypothesis.confirmationStatus).toBe("awaiting_confirmation");
    expect(hypothesis.confirmationRequired).toBe(true);
  });
});

describe("applyConfirmationResponse — HYPOTHESIS -> CONFIRMED or REJECTED/CORRECTED, explicit student action only (Phase 5B §4)", () => {
  async function freshHypothesis(): Promise<AutopsyHypothesis> {
    const provider = new FixtureProvider([JSON.stringify(validAiHypothesis)]);
    return generateHypothesis(provider, { autopsyOutput: incorrectOutput });
  }

  it("student confirms", async () => {
    const hypothesis = await freshHypothesis();
    const confirmed = confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    expect(confirmed.confirmationStatus).toBe("confirmed");
    expect(confirmed.respondedAt).toBe("2026-09-22T11:00:00.000Z");
    expect(confirmed.studentCorrectionText).toBeNull();
  });

  it("student rejects", async () => {
    const hypothesis = await freshHypothesis();
    const rejected = rejectHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    expect(rejected.confirmationStatus).toBe("rejected");
    expect(rejected.studentCorrectionText).toBeNull();
  });

  it("student provides a correction: preserved as NEW evidence, proposedExplanation untouched", async () => {
    const hypothesis = await freshHypothesis();
    const corrected = correctHypothesis(hypothesis, "I actually misread which quantity was 150.", { now: "2026-09-22T11:00:00.000Z" });
    expect(corrected.confirmationStatus).toBe("corrected");
    expect(corrected.studentCorrectionText).toBe("I actually misread which quantity was 150.");
    expect(corrected.proposedExplanation).toBe(hypothesis.proposedExplanation); // original never overwritten
  });

  it("hypothesis requiring confirmation: confirmationRequired is always true and never settable to false", async () => {
    const hypothesis = await freshHypothesis();
    expect(hypothesis.confirmationRequired).toBe(true);
    const confirmed = confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    expect(confirmed.confirmationRequired).toBe(true); // still true — this field is never toggled off
  });

  it("invalid confirmation transition: applying a second response throws already_decided", async () => {
    const hypothesis = await freshHypothesis();
    const confirmed = confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    try {
      rejectHypothesis(confirmed, { now: "2026-09-22T11:05:00.000Z" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as HypothesisError).code).toBe("already_decided");
    }
  });

  it("rejects a correction with an empty correctedExplanation", async () => {
    const hypothesis = await freshHypothesis();
    expect(() => correctHypothesis(hypothesis, "   ", { now: "2026-09-22T11:00:00.000Z" })).toThrow(HypothesisError);
  });

  it("cannot apply a response to a nonexistent hypothesis", () => {
    expect(() => applyConfirmationResponse(null, { type: "confirmed" }, { now: "2026-09-22T11:00:00.000Z" })).toThrow(HypothesisError);
  });

  it("original AutopsyOutput/AttemptAutopsyEvidence remains unchanged after confirmation (immutability)", async () => {
    const hypothesis = await freshHypothesis();
    const snapshotBefore = JSON.stringify(incorrectOutput);
    confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    expect(JSON.stringify(incorrectOutput)).toBe(snapshotBefore);
  });

  it("a hypothesis cannot become confirmed without an explicit call — generateHypothesis alone never produces confirmationStatus other than awaiting_confirmation", async () => {
    const hypothesis = await freshHypothesis();
    expect(hypothesis.confirmationStatus).toBe("awaiting_confirmation");
  });
});
