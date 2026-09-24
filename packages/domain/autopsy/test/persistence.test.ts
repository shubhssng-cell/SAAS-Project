import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import { buildAutopsyOutput } from "../src/autopsyOutput.js";
import { confirmHypothesis, correctHypothesis, generateHypothesis, rejectHypothesis } from "../src/hypothesis.js";
import { fromRepairPlanPersistenceRecord, toAutopsyPersistenceRecord, toRepairPlanPersistenceRecord } from "../src/persistence.js";
import { buildRepairPlan } from "../src/repairPlan.js";
import type { RepairPlan } from "../src/types.js";
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

describe("toRepairPlanPersistenceRecord — maps onto the repair_plans schema", () => {
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

  // docs/DECISIONS.md D-039 addendum -- persistence-fidelity fix regression coverage.
  async function buildFullyPopulatedConfirmedPlan(respondedAt: string): Promise<{ plan: RepairPlan; respondedAt: string }> {
    const hypothesis = await freshHypothesis();
    const confirmed = confirmHypothesis(hypothesis, { now: respondedAt });
    const plan = buildRepairPlan(confirmed, output);
    return { plan, respondedAt };
  }

  const RESOLVED_IDS = { studentId: "student-1", autopsyId: "autopsy-1", targetConceptId: "concept-percentages", targetErrorTaxonomyId: "taxonomy-id-1" };

  it("[A] forward mapping: every new RepairPlan field survives into toRepairPlanPersistenceRecord()", async () => {
    const { plan } = await buildFullyPopulatedConfirmedPlan("2026-09-22T11:00:00.000Z");
    const record = toRepairPlanPersistenceRecord(plan, RESOLVED_IDS);

    expect(record.targetConceptName).toBe(plan.targetConceptName);
    expect(record.targetPatternFamilyName).toBe(plan.targetPatternFamilyName);
    expect(record.targetTaxonomyCellId).toBe(plan.targetTaxonomyCellId);
    expect(record.targetErrorCategory).toBe(plan.targetErrorCategory);
    expect(record.recommendedTrainingMode).toBe(plan.recommendedTrainingMode);
    expect(record.priority).toBe(plan.priority);
  });

  it("[B] exact key-set regression: toRepairPlanPersistenceRecord() output has exactly the expected keys, no more, no fewer — the original bug was a field silently dropped here without any test noticing", async () => {
    const { plan } = await buildFullyPopulatedConfirmedPlan("2026-09-22T11:00:00.000Z");
    const record = toRepairPlanPersistenceRecord(plan, RESOLVED_IDS);

    expect(Object.keys(record).sort()).toEqual(
      [
        "studentId",
        "autopsyId",
        "targetConceptId",
        "targetErrorTaxonomyId",
        "followUpQuestionIds",
        "status",
        "targetConceptName",
        "targetPatternFamilyName",
        "targetTaxonomyCellId",
        "targetErrorCategory",
        "recommendedTrainingMode",
        "priority"
      ].sort()
    );
  });

  it("[D] reverse round-trip: a fully populated stored record reconstructs the expected domain RepairPlan (rationale/prerequisites reconstruct as the accepted [] default, since neither is read downstream)", async () => {
    const { plan } = await buildFullyPopulatedConfirmedPlan("2026-09-22T11:05:00.000Z");
    const record = toRepairPlanPersistenceRecord(plan, RESOLVED_IDS);

    const reconstructed = fromRepairPlanPersistenceRecord({
      targetConceptName: record.targetConceptName,
      targetPatternFamilyName: record.targetPatternFamilyName,
      targetTaxonomyCellId: record.targetTaxonomyCellId,
      targetErrorCategory: record.targetErrorCategory,
      recommendedTrainingMode: record.recommendedTrainingMode,
      priority: record.priority,
      targetErrorTaxonomyCode: plan.targetErrorTaxonomyCode,
      attemptId: plan.confirmationSource.attemptId,
      confirmedAt: plan.confirmationSource.hypothesisConfirmedAt
    });

    expect(reconstructed).toEqual({
      targetConceptName: plan.targetConceptName,
      targetPatternFamilyName: plan.targetPatternFamilyName,
      targetTaxonomyCellId: plan.targetTaxonomyCellId,
      targetErrorCategory: plan.targetErrorCategory,
      targetErrorTaxonomyCode: plan.targetErrorTaxonomyCode,
      recommendedTrainingMode: plan.recommendedTrainingMode,
      priority: plan.priority,
      rationale: [],
      prerequisites: [],
      confirmationSource: plan.confirmationSource
    });
  });

  it("[E] incomplete historical record: returns null when any required snapshot field is missing", async () => {
    const { plan } = await buildFullyPopulatedConfirmedPlan("2026-09-22T11:10:00.000Z");
    const record = toRepairPlanPersistenceRecord(plan, RESOLVED_IDS);
    const complete = {
      targetConceptName: record.targetConceptName,
      targetPatternFamilyName: record.targetPatternFamilyName,
      targetTaxonomyCellId: record.targetTaxonomyCellId,
      targetErrorCategory: record.targetErrorCategory,
      recommendedTrainingMode: record.recommendedTrainingMode,
      priority: record.priority,
      targetErrorTaxonomyCode: plan.targetErrorTaxonomyCode,
      attemptId: plan.confirmationSource.attemptId,
      confirmedAt: plan.confirmationSource.hypothesisConfirmedAt
    };

    for (const missingKey of ["targetConceptName", "targetPatternFamilyName", "targetTaxonomyCellId", "targetErrorCategory", "recommendedTrainingMode", "priority", "confirmedAt"] as const) {
      expect(fromRepairPlanPersistenceRecord({ ...complete, [missingKey]: null })).toBeNull();
    }
    // Sanity check: the fully-populated shape it was derived from DOES reconstruct.
    expect(fromRepairPlanPersistenceRecord(complete)).not.toBeNull();
  });

  it("[E, continued] a pre-migration-shaped record (every new field null) reconstructs as null, never a fabricated RepairPlan", () => {
    const preMigrationShaped = {
      targetConceptName: null,
      targetPatternFamilyName: null,
      targetTaxonomyCellId: null,
      targetErrorCategory: null,
      recommendedTrainingMode: null,
      priority: null,
      targetErrorTaxonomyCode: null,
      attemptId: "attempt-old-row",
      confirmedAt: null
    };
    expect(fromRepairPlanPersistenceRecord(preMigrationShaped)).toBeNull();
  });

  it("[F] priority: all three values survive the forward mapping", async () => {
    for (const priority of ["low", "medium", "high"] as const) {
      const { plan } = await buildFullyPopulatedConfirmedPlan("2026-09-22T11:15:00.000Z");
      const overridden = { ...plan, priority };
      const record = toRepairPlanPersistenceRecord(overridden, RESOLVED_IDS);
      expect(record.priority).toBe(priority);
    }
  });

  it("[G] recommendedTrainingMode: all four values survive the forward mapping", async () => {
    for (const mode of ["standard_practice", "guided_hint_first", "timed_pressure_drill", "novelty_exposure"] as const) {
      const { plan } = await buildFullyPopulatedConfirmedPlan("2026-09-22T11:20:00.000Z");
      const overridden = { ...plan, recommendedTrainingMode: mode };
      const record = toRepairPlanPersistenceRecord(overridden, RESOLVED_IDS);
      expect(record.recommendedTrainingMode).toBe(mode);
    }
  });

  it("[H] historical snapshots are used directly, never re-derived — a 'current' Concept/PatternFamily name that differs from what was stored must not change the reconstructed value", () => {
    // fromRepairPlanPersistenceRecord() takes no Concept/PatternFamily lookup at all --
    // this test proves the stored snapshot strings pass through completely unchanged,
    // even when they look "stale" relative to some hypothetical current name.
    const reconstructed = fromRepairPlanPersistenceRecord({
      targetConceptName: "Percentages (as diagnosed)",
      targetPatternFamilyName: "Reverse Percentage (as diagnosed)",
      targetTaxonomyCellId: "cell-repair-1",
      targetErrorCategory: "misconception",
      recommendedTrainingMode: "guided_hint_first",
      priority: "high",
      targetErrorTaxonomyCode: "base_confusion",
      attemptId: "attempt-historical-1",
      confirmedAt: "2026-09-22T11:25:00.000Z"
    });

    expect(reconstructed?.targetConceptName).toBe("Percentages (as diagnosed)");
    expect(reconstructed?.targetPatternFamilyName).toBe("Reverse Percentage (as diagnosed)");
    expect(reconstructed?.targetTaxonomyCellId).toBe("cell-repair-1");
  });
});

describe("toAutopsyPersistenceRecord — confirmedAt (docs/DECISIONS.md D-039 addendum)", () => {
  it("[C] hypothesis.respondedAt survives exactly into confirmedAt", async () => {
    const hypothesis = await freshHypothesis();
    const confirmed = confirmHypothesis(hypothesis, { now: "2026-09-22T11:30:00.000Z" });
    const record = toAutopsyPersistenceRecord(confirmed, output, "taxonomy-id-1");
    expect(record.confirmedAt).toBe("2026-09-22T11:30:00.000Z");
    expect(record.confirmedAt).toBe(confirmed.respondedAt);
  });

  it("confirmedAt is null while still awaiting_confirmation", async () => {
    const hypothesis = await freshHypothesis();
    const record = toAutopsyPersistenceRecord(hypothesis, output, "taxonomy-id-1");
    expect(record.confirmedAt).toBeNull();
  });

  it("confirmedAt is never inferred from createdAt or the current time — rejected/corrected responses also get their own real respondedAt, not a fabricated value", async () => {
    const hypothesis = await freshHypothesis();
    const rejected = rejectHypothesis(hypothesis, { now: "2026-09-22T11:35:00.000Z" });
    const record = toAutopsyPersistenceRecord(rejected, output, "taxonomy-id-1");
    expect(record.confirmedAt).toBe("2026-09-22T11:35:00.000Z");
  });
});
