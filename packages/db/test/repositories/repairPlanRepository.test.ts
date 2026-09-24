import { FixtureProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { recordAttemptEvent, startAttempt, submitAttempt, toAutopsyEvidence, type AttemptQuestionContext } from "@ipmat/attempt";
import { buildAutopsyOutput, buildRepairPlan, confirmHypothesis, generateHypothesis, rejectHypothesis, type AutopsyQuestionContext } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { InMemoryAutopsyRepository, InMemoryRepairPlanRepository } from "../fixtures/inMemoryRepositories.js";

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

async function buildHypothesisAndOutput(attemptId: string, studentId: string) {
  let attempt = startAttempt({ id: attemptId, studentId, questionId: attemptQuestionContext.questionId, enrollmentId: "enrollment-1", now: t(0) });
  attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, { studentId, questionId: attemptQuestionContext.questionId });
  attempt = submitAttempt(attempt, { studentId, questionId: attemptQuestionContext.questionId }, attemptQuestionContext, { now: t(30) });
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
  return { hypothesis, output };
}

async function buildConfirmedPlan(attemptId: string, studentId = "student-1") {
  const { hypothesis, output } = await buildHypothesisAndOutput(attemptId, studentId);
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

// docs/DECISIONS.md D-039 addendum -- findConfirmedActiveByStudentId() regression coverage.
// InMemoryRepairPlanRepository is wired to a real InMemoryAutopsyRepository here so the
// confirmation join genuinely happens (a RepairPlan's own confirmationSource proves the
// domain object was built from a confirmed hypothesis AT CONSTRUCTION TIME — it does NOT
// prove the linked Autopsy row still says so, which is exactly what these tests isolate).
describe("RepairPlanRepository.findConfirmedActiveByStudentId (docs/DECISIONS.md D-039 addendum)", () => {
  /**
   * `autopsyId` here is DELIBERATELY the real `id` `InMemoryAutopsyRepository.save()`
   * itself assigned — never a caller-invented string — the same way
   * `PrismaRepairPlanRepository.save()`'s real caller would only ever have
   * a genuine `Autopsy.id` to pass as `RepairPlan.autopsyId` (an actual
   * foreign key must reference a row that exists). Passing a mismatched,
   * made-up id here would silently break `findConfirmedActiveByStudentId()`'s
   * join and make every test below pass vacuously against an empty
   * result, rather than actually exercising the confirmed/active logic.
   */
  async function saveConfirmedPlan(params: { attemptId: string; studentId: string; autopsyRepo: InMemoryAutopsyRepository; repairRepo: InMemoryRepairPlanRepository }) {
    const { hypothesis, output } = await buildHypothesisAndOutput(params.attemptId, params.studentId);
    const confirmed = confirmHypothesis(hypothesis, { now: t(60) });
    const storedAutopsy = await params.autopsyRepo.save({ hypothesis: confirmed, output });
    const plan = buildRepairPlan(confirmed, output);
    return params.repairRepo.save({ plan, autopsyId: storedAutopsy.id, studentId: params.studentId });
  }

  it("[I] confirmed=false is excluded even though the RepairPlan's own confirmationSource looks valid", async () => {
    const autopsyRepo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" }, autopsyRepo);

    const { hypothesis, output } = await buildHypothesisAndOutput("attempt-i-1", "student-1");
    const confirmed = confirmHypothesis(hypothesis, { now: t(60) });
    const plan = buildRepairPlan(confirmed, output);
    // Save the LINKED Autopsy as rejected (confirmed: false) -- independent of the RepairPlan
    // domain object's own (separately valid) confirmationSource, exactly the scenario the join
    // exists to catch: two independent stores that could, in principle, disagree.
    const rejected = rejectHypothesis(hypothesis, { now: t(60) });
    const storedAutopsy = await autopsyRepo.save({ hypothesis: rejected, output });
    await repairRepo.save({ plan, autopsyId: storedAutopsy.id, studentId: "student-1" });

    expect(await repairRepo.findConfirmedActiveByStudentId("student-1")).toEqual([]);
  });

  it("[J] confirmed=true + status=completed is excluded", async () => {
    const autopsyRepo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" }, autopsyRepo);
    const stored = await saveConfirmedPlan({ attemptId: "attempt-j-1", studentId: "student-1", autopsyRepo, repairRepo });
    expect(stored.status).toBe("pending");
    // Sanity check that the join genuinely resolved before mutating away from it below.
    expect(await repairRepo.findConfirmedActiveByStudentId("student-1")).toEqual([stored]);

    // Directly mutate the stored row's status to simulate a later workflow transition --
    // RepairPlanRepository has no update() method (out of this fix's scope), so the test
    // reaches into the fixture's own map, the same way a real "status" column would be
    // updated by future, unbuilt workflow code.
    stored.status = "completed";

    expect(await repairRepo.findConfirmedActiveByStudentId("student-1")).toEqual([]);
  });

  it("[K] confirmed=true + status=pending/in_progress is eligible", async () => {
    const autopsyRepo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" }, autopsyRepo);

    const pending = await saveConfirmedPlan({ attemptId: "attempt-k-1", studentId: "student-1", autopsyRepo, repairRepo });
    expect(pending.status).toBe("pending");
    expect(await repairRepo.findConfirmedActiveByStudentId("student-1")).toEqual([pending]);

    const inProgress = await saveConfirmedPlan({ attemptId: "attempt-k-2", studentId: "student-1", autopsyRepo, repairRepo });
    inProgress.status = "in_progress";
    const results = await repairRepo.findConfirmedActiveByStudentId("student-1");
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.id === inProgress.id)).toBe(true);
  });

  it("[E] confirmedAt presence alone never makes a plan eligible without confirmed also being true", async () => {
    const autopsyRepo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" }, autopsyRepo);

    const { hypothesis, output } = await buildHypothesisAndOutput("attempt-e-1", "student-1");
    const confirmed = confirmHypothesis(hypothesis, { now: t(60) });
    const plan = buildRepairPlan(confirmed, output);
    // A rejected response still sets `respondedAt` (docs/DECISIONS.md D-039 addendum §2 --
    // confirmedAt is set for rejected/corrected too, not exclusively confirmed) -- proving
    // that a non-null confirmedAt on its own is not sufficient for eligibility.
    const rejectedButTimestamped = rejectHypothesis(hypothesis, { now: t(60) });
    expect(rejectedButTimestamped.respondedAt).not.toBeNull();
    const storedAutopsy = await autopsyRepo.save({ hypothesis: rejectedButTimestamped, output });
    expect(storedAutopsy.confirmedAt).not.toBeNull();
    expect(storedAutopsy.confirmed).toBe(false);
    await repairRepo.save({ plan, autopsyId: storedAutopsy.id, studentId: "student-1" });

    expect(await repairRepo.findConfirmedActiveByStudentId("student-1")).toEqual([]);
  });

  it("[L] ownership: student A cannot retrieve student B's RepairPlans", async () => {
    const autopsyRepo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" }, autopsyRepo);

    await saveConfirmedPlan({ attemptId: "attempt-l-1", studentId: "student-a", autopsyRepo, repairRepo });
    await saveConfirmedPlan({ attemptId: "attempt-l-2", studentId: "student-b", autopsyRepo, repairRepo });

    const resultsA = await repairRepo.findConfirmedActiveByStudentId("student-a");
    expect(resultsA).toHaveLength(1);
    expect(resultsA[0]?.studentId).toBe("student-a");

    const resultsB = await repairRepo.findConfirmedActiveByStudentId("student-b");
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0]?.studentId).toBe("student-b");
  });

  it("[M] attemptId is correctly resolved from autopsyId -> Autopsy.attemptId", async () => {
    const autopsyRepo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" }, autopsyRepo);

    const stored = await saveConfirmedPlan({ attemptId: "attempt-m-1", studentId: "student-1", autopsyRepo, repairRepo });
    expect(stored.attemptId).toBe("attempt-m-1");

    const [found] = await repairRepo.findConfirmedActiveByStudentId("student-1");
    expect(found?.attemptId).toBe("attempt-m-1");
  });

  it("[N] confirmedAt is correctly resolved from Autopsy.confirmedAt", async () => {
    const autopsyRepo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" }, autopsyRepo);

    const stored = await saveConfirmedPlan({ attemptId: "attempt-n-1", studentId: "student-1", autopsyRepo, repairRepo });
    expect(stored.confirmedAt).toBe(t(60));

    const [found] = await repairRepo.findConfirmedActiveByStudentId("student-1");
    expect(found?.confirmedAt).toBe(t(60));
  });

  it("[F] targetErrorTaxonomyCode is resolved from the existing targetErrorTaxonomyId relation", async () => {
    const autopsyRepo = new InMemoryAutopsyRepository({ base_confusion: "taxonomy-row-id-1" });
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" }, autopsyRepo);

    const stored = await saveConfirmedPlan({ attemptId: "attempt-f-1", studentId: "student-1", autopsyRepo, repairRepo });
    expect(stored.targetErrorTaxonomyId).toBe("taxonomy-row-id-1");
    expect(stored.targetErrorTaxonomyCode).toBe("base_confusion");
  });

  it("returns [] (fails closed) when the linked Autopsy is not wired at all, rather than assuming confirmed", async () => {
    // No autopsyRepository passed to the constructor -- mirrors a caller that never wires
    // the join; findConfirmedActiveByStudentId() must never default to "confirmed."
    const repairRepo = new InMemoryRepairPlanRepository({ Percentages: "concept-row-id-1" }, { base_confusion: "taxonomy-row-id-1" });
    const plan = await buildConfirmedPlan("attempt-unwired-1", "student-1");
    await repairRepo.save({ plan, autopsyId: "autopsy-unwired-1", studentId: "student-1" });

    expect(await repairRepo.findConfirmedActiveByStudentId("student-1")).toEqual([]);
  });
});
