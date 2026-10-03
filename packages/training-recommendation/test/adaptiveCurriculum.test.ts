import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { InMemoryExamIntelligenceSource, type ExamIntelligenceSnapshot } from "@ipmat/exam-intelligence";
import { describe, expect, it, vi } from "vitest";
import { composeAdaptiveCurriculum } from "../src/adaptiveCurriculum.js";
import { TrainingRecommendationService } from "../src/service.js";
import { TrainingRecommendationError } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_EXAM, OTHER_STUDENT, STUDENT, storedRepairPlan, World } from "./fixtures.js";

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const LATER = "2026-10-20T12:00:00.000Z";

async function world(): Promise<World> {
  const w = new World();
  for (const id of ["q-1", "q-2", "q-3", "q-4", "q-5"]) w.addQuestion({ id });
  await w.finalizedAttempt({ id: "a1", questionId: "q-1", correct: false, start: 0, finalize: 30 });
  await w.finalizedAttempt({ id: "a2", questionId: "q-2", correct: false, start: 100, finalize: 130 });
  await w.finalizedAttempt({ id: "a3", questionId: "q-3", start: 200, finalize: 230 });
  return w;
}

describe("the adaptive curriculum derived from persisted attempts", () => {
  it("its next action is EXACTLY what recommendNextTrainingAction returns, and the rest is composition", async () => {
    const w = await world();
    const deps = w.deps({ now: () => LATER });
    const service = new TrainingRecommendationService(deps);
    const direct = await service.recommendNextTrainingAction(request);
    const curriculum = await service.readAdaptiveCurriculum(request);
    expect(curriculum).not.toBeNull();
    expect(curriculum!.status).toBe("evidence_based_no_verdict");
    expect(curriculum!.examCode).toBe("IPMAT_INDORE");
    if (direct.status !== "selected" || curriculum!.nextAction.status !== "selected") throw new Error("expected a selected action");
    expect(curriculum!.nextAction.question.questionId).toBe(direct.question.questionId);
    expect(curriculum!.nextAction.actionType).toBe(direct.actionType);
    expect(curriculum!.nextAction.explanation).toBe(direct.explanation);
    expect(curriculum!.chain.map((c) => c.id)).toEqual(["targeted_repair", "trap-lab", "calculation-gym", "speed-lab", "pressure-training", "novelty-training", "adaptive_practice"]);
    expect(curriculum!.sequencing.definedBeyondExistingChain).toBe(false);
    expect(curriculum!.steps.filter((s) => s.isOrchestratorNextAction)).toHaveLength(1);
  });

  it("carries Unit 1 evidence and Unit 2 revision intelligence for the same persisted attempts", async () => {
    const w = await world();
    const c = (await composeAdaptiveCurriculum(w.deps({ now: () => LATER }), request))!;
    const concept = c.concepts.find((x) => x.conceptName === "Percentages")!;
    expect(concept.evidence.overall).toMatchObject({ attempts: 3, gradedAttempts: 3, distinctQuestions: 3, contributingAttemptIds: ["a1", "a2", "a3"] });
    expect(c.revision.signals.find((s) => s.id === "dormant_concept|Percentages|*")!.contributingAttemptIds).toEqual(["a1", "a2", "a3"]);
    expect(concept.revisionSignalIds).toContain("dormant_concept|Percentages|*");
    expect(c.steps.find((s) => s.systemId === "revision")).toMatchObject({ chainOrder: null, outsideAdaptiveChain: true });
  });

  it("an active confirmed repair plan is the next action and a repair/revision conflict is preserved as unresolved", async () => {
    const w = await world();
    w.repairPlans = [storedRepairPlan()];
    const c = (await composeAdaptiveCurriculum(w.deps({ now: () => LATER }), request))!;
    expect(c.nextAction).toMatchObject({ status: "selected", actionType: "targeted_repair", chainOrder: 0 });
    const conflict = c.conflicts.find((x) => x.kind === "repair_plan_with_revision_signal")!;
    expect(conflict.resolution).toBe("unresolved_product_decision");
    expect(c.concepts.find((x) => x.conceptName === "Percentages")!.activeRepairPlans).toEqual([{ targetPatternFamilyName: "Reverse Percentage", priority: "high" }]);
    expect(JSON.stringify(c)).not.toMatch(/rationale|targetErrorCategory|recommendedTrainingMode/); // target facts only, no diagnosis detail
  });

  it("not dormant: no revision step and no revision conflict (Revision's own rule decides)", async () => {
    const w = await world();
    const c = (await composeAdaptiveCurriculum(w.deps({ now: () => "2026-09-24T12:00:00.000Z" }), request))!;
    expect(c.revision.signals.some((s) => s.kind === "dormant_concept")).toBe(false);
    expect(c.steps.some((s) => s.systemId === "revision")).toBe(false); // Revision's own rule is not met, so it offers no step
    expect(c.conflicts.some((x) => x.kind === "revision_available_outside_adaptive_chain")).toBe(false);
  });

  it("student isolation: another student's attempts never contribute, and the claimant must own the enrollment", async () => {
    const w = await world();
    for (const [i, id] of ["t1", "t2", "t3"].entries()) await w.finalizedAttempt({ id, questionId: `q-${i + 1}`, start: 300 + i * 100, finalize: 330 + i * 100, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    const mine = await composeAdaptiveCurriculum(w.deps({ now: () => LATER }), request);
    expect(JSON.stringify(mine)).not.toMatch(/"t[123]"|student-2/);
    const deps = w.deps();
    const finalized = vi.spyOn(deps.attemptHistoryReader, "findFinalizedByStudentId");
    const error = await composeAdaptiveCurriculum(deps, { studentId: OTHER_STUDENT, enrollmentId: ENROLLMENT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrainingRecommendationError);
    expect((error as TrainingRecommendationError).code).toBe("enrollment_ownership_mismatch");
    expect(finalized).not.toHaveBeenCalled();
  });

  it("exam isolation, empty pool and read-only", async () => {
    const w = await world();
    w.addQuestion({ id: "q-other", exam: OTHER_EXAM, dna: { examCode: "OTHER_EXAM" } });
    const c = await composeAdaptiveCurriculum(w.deps({ now: () => LATER }), request);
    expect(JSON.stringify(c)).not.toContain("q-other");
    expect(await composeAdaptiveCurriculum(new World().deps(), request)).toBeNull();
    const advanceStatus = vi.fn(async () => true);
    const save = vi.spyOn(w.attempts, "save");
    w.repairPlans = [storedRepairPlan()];
    await composeAdaptiveCurriculum(w.deps({ now: () => LATER, repairPlanStatusWriter: { advanceStatus } }), request);
    expect(advanceStatus).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("is deterministic and never carries the answer key or another student's data", async () => {
    const w = await world();
    const deps = w.deps({ now: () => LATER });
    const first = await composeAdaptiveCurriculum(deps, request);
    expect(await composeAdaptiveCurriculum(deps, request)).toEqual(first);
    const text = JSON.stringify(first);
    for (const secret of [ANSWER_KEY, "correctAnswer", "student-2", "enrollment-2"]) expect(text, secret).not.toContain(secret);
  });

  it("Phase 6 content availability is attached only when a source is supplied, and unknown concepts get none", async () => {
    const w = await world();
    const snapshot = { examCode: "IPMAT_INDORE", examVersion: ipmatIndoreExamPack.packVersion, pack: ipmatIndoreExamPack, patternFamilies: [], errorTaxonomyCodes: [], questions: [], historicalRecords: [] } as unknown as ExamIntelligenceSnapshot;
    const without = (await composeAdaptiveCurriculum(w.deps({ now: () => LATER }), request))!;
    expect(without.concepts.every((c) => c.contentAvailability === null)).toBe(true);
    const withSource = (await composeAdaptiveCurriculum(w.deps({ now: () => LATER, examIntelligenceSource: new InMemoryExamIntelligenceSource([snapshot]) }), request))!;
    expect(withSource.concepts.find((c) => c.conceptName === "Percentages")!.contentAvailability).toEqual({ available: 0, validated: 0, published: 0 });
    expect(withSource.nextAction).toEqual(without.nextAction); // Phase 6 never changes what is selected
  });

  it("Units 1 and 2 reads are unchanged by Unit 3", async () => {
    const w = await world();
    const service = new TrainingRecommendationService(w.deps({ now: () => LATER }));
    const rev = await service.readRevisionIntelligence(request);
    const curriculum = await service.readAdaptiveCurriculum(request);
    expect(curriculum!.revision).toEqual(rev);
    expect((await service.readMasteryEvidence(request))!.status).toBe("evidence_only");
  });
});
