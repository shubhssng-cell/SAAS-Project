import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { recordAttemptEvent, startAttempt, submitAttempt, toAutopsyEvidence, type AttemptQuestionContext } from "@ipmat/attempt";
import { buildAutopsyOutput, buildRepairPlan, confirmHypothesis, generateHypothesis, type AutopsyQuestionContext } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { InMemoryRepairPlanRepository } from "../fixtures/inMemoryRepositories.js";

const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

const attemptQuestionContext: AttemptQuestionContext = {
  questionId: "question-repair-1",
  conceptId: "concept-percentages",
  answerFormat: "multiple_choice",
  options: ["420", "450", "480", "500"],
  correctAnswer: "480",
  expectedTimeSeconds: 90
};

const autopsyQuestionContext: AutopsyQuestionContext = {
  questionId: attemptQuestionContext.questionId,
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  conceptName: "Percentages",
  patternFamilyName: "Reverse Percentage",
  patternTaxonomyCellId: "cell-repair-1",
  difficultyTier: "advanced",
  difficultyDimensions: { conceptualLoad: 0.4, computationalLoad: 0.3, trapDensity: 0.5, representationNovelty: 0.2, timePressure: 0.3, multiStepDepth: 0.4 },
  noveltyLevel: "standard",
  examRelevance: "core",
  testingModes: ["reverse"],
  trapErrorTaxonomyCode: "base_confusion",
  combinesWithConcepts: ["Ratio"]
};

const errorTaxonomy = [{ code: "base_confusion", label: "Base confusion", description: "Wrong base.", category: "misconception" as const }];

async function buildConfirmedPlan(attemptId: string) {
  let attempt = startAttempt({ id: attemptId, studentId: "student-1", questionId: attemptQuestionContext.questionId, enrollmentId: "enrollment-1", now: t(0) });
  attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, { studentId: "student-1", questionId: attemptQuestionContext.questionId });
  attempt = submitAttempt(attempt, { studentId: "student-1", questionId: attemptQuestionContext.questionId }, attemptQuestionContext, { now: t(30) });
  const evidence = toAutopsyEvidence(attempt, attemptQuestionContext);
  const output = buildAutopsyOutput({ evidence, question: autopsyQuestionContext, errorTaxonomy });

  const aiHypothesis: AutopsyHypothesisAiOutput = {
    proposedErrorCategory: "misconception",
    proposedExplanation: "Applied the percentage change to the wrong base quantity.",
    supportingEvidence: ["Matched the designated trap (base_confusion)."],
    contradictoryEvidence: [],
    missingEvidence: [],
    modelConfidence: 0.7
  };
  const provider = new FixtureProvider([JSON.stringify(aiHypothesis)]);
  const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
  const confirmed = confirmHypothesis(hypothesis, { now: t(60) });
  return buildRepairPlan(confirmed, output);
}

describe("PrismaRepairPlanRepository semantics (verified against InMemoryRepairPlanRepository — same interface, no live DB)", () => {
  it("round-trips a save then find, resolving targetConceptId/targetErrorTaxonomyId by name/code", async () => {
    const plan = await buildConfirmedPlan("attempt-repair-1");
    const repo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" });

    const stored = await repo.save({ plan, autopsyId: "autopsy-row-1", studentId: "student-1" });
    expect(stored.targetConceptId).toBe("concept-row-id-1");
    expect(stored.targetErrorTaxonomyId).toBe("taxonomy-row-id-1");
    expect(stored.followUpQuestionIds).toEqual([]);
    expect(stored.status).toBe("pending");

    const found = await repo.findByAutopsyId("autopsy-row-1");
    expect(found).toEqual(stored);
  });

  it("rejects a plan whose target concept cannot be resolved (invalid state combination — dangling FK)", async () => {
    const plan = await buildConfirmedPlan("attempt-repair-2");
    const repo = new InMemoryRepairPlanRepository({}, { base_confusion: "taxonomy-row-id-1" });

    await expect(repo.save({ plan, autopsyId: "autopsy-row-2", studentId: "student-1" })).rejects.toThrow(/No Concept found/);
  });

  it("rejects a plan with no autopsyId or studentId", async () => {
    const plan = await buildConfirmedPlan("attempt-repair-3");
    const repo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" });

    await expect(repo.save({ plan, autopsyId: "", studentId: "student-1" })).rejects.toThrow(/autopsyId/);
    await expect(repo.save({ plan, autopsyId: "autopsy-row-3", studentId: "" })).rejects.toThrow(/studentId/);
  });

  it("findByAutopsyId returns null when nothing has been saved for that autopsy", async () => {
    const repo = new InMemoryRepairPlanRepository();
    expect(await repo.findByAutopsyId("nonexistent")).toBeNull();
  });

  it("refuses to persist a RepairPlan-shaped object that bypassed buildRepairPlan()'s confirmation gate (RepairPlan cannot be persisted from an unconfirmed hypothesis)", async () => {
    const plan = await buildConfirmedPlan("attempt-repair-tampered");
    // buildRepairPlan() always sets a real confirmationSource.hypothesisConfirmedAt from the
    // confirmed hypothesis's respondedAt — TypeScript's structural typing cannot stop a caller
    // from constructing a same-shaped object some other way, e.g. by stripping this field.
    // The repository must catch that independently of the domain layer's own gate.
    const tampered = { ...plan, confirmationSource: { ...plan.confirmationSource, hypothesisConfirmedAt: "" } };
    const repo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" });

    await expect(repo.save({ plan: tampered, autopsyId: "autopsy-row-tampered", studentId: "student-1" })).rejects.toThrow(
      /confirmationSource.hypothesisConfirmedAt/
    );
  });

  it("fails closed when a proposed target error-taxonomy code cannot be resolved, instead of silently writing null (foreign-key resolution cannot silently produce an invalid relation)", async () => {
    const plan = await buildConfirmedPlan("attempt-repair-unresolved-taxonomy");
    expect(plan.targetErrorTaxonomyCode).toBe("base_confusion");
    // Concept resolves; error-taxonomy code does not — isolates the errorTaxonomy fail-closed path
    // from the already-covered concept fail-closed path above.
    const repo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, {});

    await expect(repo.save({ plan, autopsyId: "autopsy-row-unresolved", studentId: "student-1" })).rejects.toThrow(
      /No ErrorTaxonomy found with code "base_confusion"/
    );
  });
});
