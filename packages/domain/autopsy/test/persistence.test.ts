import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import { buildAutopsyOutput } from "../src/autopsyOutput.js";
import { confirmHypothesis, correctHypothesis, generateHypothesis, rejectHypothesis } from "../src/hypothesis.js";
import { toAutopsyPersistenceRecord, toRepairPlanPersistenceRecord } from "../src/persistence.js";
import { buildRepairPlan } from "../src/repairPlan.js";
import { buildEvidence } from "../fixtures/evidence.js";
import { errorTaxonomyFixture } from "../fixtures/errorTaxonomy.js";
import { percentagesQuestionContext } from "../fixtures/questionContext.js";

const validAiHypothesis: AutopsyHypothesisAiOutput = {
  proposedErrorCategory: "misconception",
  proposedExplanation: "This pattern is consistent with applying the percentage change to the wrong base quantity.",
  supportingEvidence: ["matched the designated trap"],
  contradictoryEvidence: [],
  missingEvidence: [],
  modelConfidence: 0.6
};

const output = buildAutopsyOutput({
  evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
  question: percentagesQuestionContext,
  errorTaxonomy: errorTaxonomyFixture
});

async function freshHypothesis() {
  const provider = new FixtureProvider([JSON.stringify(validAiHypothesis)]);
  return generateHypothesis(provider, { autopsyOutput: output });
}

describe("toAutopsyPersistenceRecord — maps onto the EXISTING autopsies schema, no migration needed (Phase 5B §5)", () => {
  it("awaiting_confirmation maps to confirmed: null, studentCorrectionText: null", async () => {
    const hypothesis = await freshHypothesis();
    const record = toAutopsyPersistenceRecord(hypothesis, output, "taxonomy-id-1");
    expect(record.confirmed).toBeNull();
    expect(record.studentCorrectionText).toBeNull();
  });

  it("confirmed maps to confirmed: true, studentCorrectionText: null", async () => {
    const hypothesis = await freshHypothesis();
    const confirmed = confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    const record = toAutopsyPersistenceRecord(confirmed, output, "taxonomy-id-1");
    expect(record.confirmed).toBe(true);
    expect(record.studentCorrectionText).toBeNull();
  });

  it("rejected maps to confirmed: false, studentCorrectionText: null", async () => {
    const hypothesis = await freshHypothesis();
    const rejected = rejectHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    const record = toAutopsyPersistenceRecord(rejected, output, "taxonomy-id-1");
    expect(record.confirmed).toBe(false);
    expect(record.studentCorrectionText).toBeNull();
  });

  it("corrected maps to confirmed: false, studentCorrectionText: <the correction>", async () => {
    const hypothesis = await freshHypothesis();
    const corrected = correctHypothesis(hypothesis, "It was a sign error.", { now: "2026-09-22T11:00:00.000Z" });
    const record = toAutopsyPersistenceRecord(corrected, output, "taxonomy-id-1");
    expect(record.confirmed).toBe(false);
    expect(record.studentCorrectionText).toBe("It was a sign error.");
  });

  it("errorTaxonomyId is exactly whatever the caller resolved and supplied — this package never resolves it itself", async () => {
    const hypothesis = await freshHypothesis();
    const record = toAutopsyPersistenceRecord(hypothesis, output, null);
    expect(record.errorTaxonomyId).toBeNull();
  });

  it("generatedByProvider/promptVersion come from the real generation metadata", async () => {
    const hypothesis = await freshHypothesis();
    const record = toAutopsyPersistenceRecord(hypothesis, output, null);
    expect(record.generatedByProvider).toBe("fixture");
    expect(record.promptVersion).toBe("autopsy-hypothesis-v1");
  });
});

describe("toRepairPlanPersistenceRecord — maps onto the EXISTING repair_plans schema, no migration needed", () => {
  it("always writes followUpQuestionIds: [] and status: 'pending'", async () => {
    const hypothesis = await freshHypothesis();
    const confirmed = confirmHypothesis(hypothesis, { now: "2026-09-22T11:00:00.000Z" });
    const plan = buildRepairPlan(confirmed, output);
    const record = toRepairPlanPersistenceRecord(plan, {
      studentId: "student-1",
      autopsyId: "autopsy-1",
      targetConceptId: "concept-percentages",
      targetErrorTaxonomyId: "taxonomy-id-1"
    });
    expect(record.followUpQuestionIds).toEqual([]);
    expect(record.status).toBe("pending");
    expect(record.studentId).toBe("student-1");
  });
});
