import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { InMemoryExamIntelligenceSource, type ExamIntelligenceSnapshot } from "@ipmat/exam-intelligence";
import { applyMutation, assemblePaper, planAnswer, planSubmit, startSimulation, type AnswerKey, type SimulationState } from "@ipmat/exam-simulation";
import { describe, expect, it, vi } from "vitest";
import { composeExamPerformanceIntelligence } from "../src/examPerformanceIntelligence.js";
import { TrainingRecommendationService } from "../src/service.js";
import { TrainingRecommendationError } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_EXAM, OTHER_STUDENT, STUDENT, World } from "./fixtures.js";

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const LATER = "2026-10-20T12:00:00.000Z";
const T0 = "2026-10-03T10:00:00.000Z";
const at = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();

async function world(): Promise<World> {
  const w = new World();
  for (const id of ["q-1", "q-2", "q-3", "q-4", "q-5"]) w.addQuestion({ id });
  await w.finalizedAttempt({ id: "a1", questionId: "q-1", correct: false, start: 0, finalize: 30 });
  await w.finalizedAttempt({ id: "a2", questionId: "q-2", correct: false, start: 100, finalize: 130 });
  await w.finalizedAttempt({ id: "a3", questionId: "q-3", start: 200, finalize: 230 });
  return w;
}

/** A REAL finalized simulation from the Unit 4 engine over the World's published questions. */
async function finalizedState(id: string, studentId: string, examCode: string, questionIds: string[], answers: Record<number, string>, startMs = 0, end: "submit" | "deadline" = "submit"): Promise<SimulationState> {
  const config = { examCode, configVersion: "fixture-v1", overallDurationSeconds: 600, sections: [{ sectionName: "Quant", order: 1, questionCount: questionIds.length }], provenance: { kind: "authored" as const, sourceRef: "fixture:composer-test (not an exam rule)", reviewState: "unvalidated" as const, reviewedBy: null, note: "TEST DATA" } };
  const paper = assemblePaper(config, { origin: "assembled", sourceRef: "fixture:paper", sections: { Quant: questionIds } }, questionIds.map((questionId) => ({ questionId, examCode, sectionName: "Quant", validationState: "published", sourceType: "original", contentFingerprint: `fp-${questionId}` })));
  let state = startSimulation({ id, studentId, enrollmentId: "sim-enrollment", config, paper, now: at(startMs) });
  const key: AnswerKey = Object.fromEntries(questionIds.map((q) => [q, { correctAnswer: "right", contentFingerprint: `fp-${q}` }]));
  let t = startMs;
  for (const [position, answer] of Object.entries(answers)) {
    t += 1000;
    state = applyMutation(state, (await planAnswer(state, { position: Number(position), answer }, at(t), { options: null, currentFingerprint: `fp-${questionIds[Number(position) - 1]}` }, async () => key)).mutation);
  }
  return applyMutation(state, (await planSubmit(state, at(end === "deadline" ? startMs + 605_000 : t + 1000), async () => key)).mutation);
}

const readerOf = (states: SimulationState[]) => ({ findFinalizedByStudentAndExam: vi.fn(async (studentId: string, examCode: string) => states.filter((s) => s.studentId === studentId && s.examCode === examCode)) });

describe("exam performance intelligence derived on read from persisted attempts and finalized simulations", () => {
  it("composes finalized simulations with Units 1-3 into the five readiness distinctions, with no score", async () => {
    const w = await world();
    const s1 = await finalizedState("sim-1", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right", 2: "wrong" }, 0);
    const s2 = await finalizedState("sim-2", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right", 2: "right", 3: "right" }, 3_600_000);
    const reader = readerOf([s1, s2]);
    const r = (await composeExamPerformanceIntelligence(w.deps({ now: () => LATER, finalizedSimulationReader: reader }), request))!;
    expect(reader.findFinalizedByStudentAndExam).toHaveBeenCalledWith(STUDENT, "IPMAT_INDORE");
    expect(r).toMatchObject({ status: "evidence_only_readiness_unspecified", examCode: "IPMAT_INDORE", simulationCount: 2, readiness: { defined: false } });
    expect(r.simulations.map((s) => [s.simulationId, s.status])).toEqual([["sim-1", "submitted"], ["sim-2", "submitted"]]);
    const c = r.concepts.find((x) => x.conceptName === "Percentages")!;
    expect(c.conceptMastery.practice).toMatchObject({ gradedAttempts: 3, correctGradedAttempts: 1 });
    expect(c.conceptMastery.simulation).toMatchObject({ appearances: 6, correct: 4, incorrect: 1, unanswered: 1 });
    expect(r.comparisons.groups).toHaveLength(1);
    expect(r.comparisons.groups[0]!.series.find((s) => s.measure === "correct")!.values.map((v) => v.value)).toEqual([1, 3]);
    expect(r.bridges.unit3).toMatchObject({ curriculumUnchanged: true, reorderingApplied: false, priorityDefined: false });
  });

  it("works with no simulation reader and with no simulations: an empty report, never an error or a zero score", async () => {
    const w = await world();
    const none = (await composeExamPerformanceIntelligence(w.deps({ now: () => LATER }), request))!;
    expect(none.simulationCount).toBe(0);
    expect((await composeExamPerformanceIntelligence(w.deps({ now: () => LATER, finalizedSimulationReader: readerOf([]) }), request))!.simulations).toEqual([]);
  });

  it("fails closed if a reader ever returns an in-progress simulation", async () => {
    const w = await world();
    const done = await finalizedState("sim-1", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right" });
    const active: SimulationState = { ...done, status: "in_progress", finalizedAt: null, finalizedBy: null, result: null };
    await expect(composeExamPerformanceIntelligence(w.deps({ now: () => LATER, finalizedSimulationReader: readerOf([active]) }), request)).rejects.toMatchObject({ code: "not_finalized" });
  });

  it("student and exam isolation: a hostile reader returning another student's or another exam's simulation is refused, never merged", async () => {
    const w = await world();
    const mine = await finalizedState("mine", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right" });
    const theirs = await finalizedState("theirs", OTHER_STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right" });
    const foreign = await finalizedState("foreign", STUDENT, "OTHER_EXAM_CODE", ["q-1", "q-2", "q-3"], { 1: "right" });
    for (const bad of [theirs, foreign]) {
      const hostile = { findFinalizedByStudentAndExam: async () => [mine, bad] };
      await expect(composeExamPerformanceIntelligence(w.deps({ now: () => LATER, finalizedSimulationReader: hostile }), request)).rejects.toMatchObject({ code: "scope_mismatch" });
    }
    // the honest reader scopes by the VERIFIED student and exam
    const reader = readerOf([mine, theirs, foreign]);
    const r = (await composeExamPerformanceIntelligence(w.deps({ now: () => LATER, finalizedSimulationReader: reader }), request))!;
    expect(r.simulations.map((s) => s.simulationId)).toEqual(["mine"]);
  });

  it("enrollment ownership is verified first and nothing is read for a claimant who does not own it", async () => {
    const w = await world();
    const reader = readerOf([]);
    const error = await composeExamPerformanceIntelligence(w.deps({ finalizedSimulationReader: reader }), { studentId: OTHER_STUDENT, enrollmentId: ENROLLMENT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrainingRecommendationError);
    expect((error as TrainingRecommendationError).code).toBe("enrollment_ownership_mismatch");
    expect(reader.findFinalizedByStudentAndExam).not.toHaveBeenCalled();
  });

  it("student isolation across students of the same exam: each gets only their own simulations", async () => {
    const w = await world();
    for (const [i, id] of ["t1", "t2", "t3"].entries()) await w.finalizedAttempt({ id, questionId: `q-${i + 1}`, start: 300 + i * 100, finalize: 330 + i * 100, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    const mine = await finalizedState("mine", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right" });
    const theirs = await finalizedState("theirs", OTHER_STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "wrong" });
    const deps = w.deps({ now: () => LATER, finalizedSimulationReader: readerOf([mine, theirs]) });
    const a = (await composeExamPerformanceIntelligence(deps, request))!;
    const b = (await composeExamPerformanceIntelligence(deps, { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT }))!;
    expect(a.simulations.map((s) => s.simulationId)).toEqual(["mine"]);
    expect(b.simulations.map((s) => s.simulationId)).toEqual(["theirs"]);
    expect(JSON.stringify(a)).not.toMatch(/theirs|student-2|"t[123]"/);
  });

  it("an exam with no published pool yields null", async () => {
    expect(await composeExamPerformanceIntelligence(new World().deps(), request)).toBeNull();
    void OTHER_EXAM;
  });

  it("is read-only: no attempt is written from simulation data, and the RepairPlan status writer is never invoked", async () => {
    const w = await world();
    w.repairPlans = [];
    const advanceStatus = vi.fn(async () => true);
    const save = vi.spyOn(w.attempts, "save");
    const s1 = await finalizedState("sim-1", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right" });
    await composeExamPerformanceIntelligence(w.deps({ now: () => LATER, repairPlanStatusWriter: { advanceStatus }, finalizedSimulationReader: readerOf([s1]) }), request);
    expect(advanceStatus).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("Units 1, 2 and 3 are unchanged by the presence of simulations, and the report embeds nothing it could alter", async () => {
    const w = await world();
    const s1 = await finalizedState("sim-1", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "wrong", 2: "wrong" });
    const without = new TrainingRecommendationService(w.deps({ now: () => LATER }));
    const withSims = new TrainingRecommendationService(w.deps({ now: () => LATER, finalizedSimulationReader: readerOf([s1]) }));
    expect(await withSims.readMasteryEvidence(request)).toEqual(await without.readMasteryEvidence(request));
    expect(await withSims.readRevisionIntelligence(request)).toEqual(await without.readRevisionIntelligence(request));
    expect(await withSims.readAdaptiveCurriculum(request)).toEqual(await without.readAdaptiveCurriculum(request));
    expect(await withSims.recommendNextTrainingAction(request)).toEqual(await without.recommendNextTrainingAction(request));
  });

  it("Phase 6 content availability and historical-record counts are attached only when a source is supplied, and never change the simulation facts", async () => {
    const w = await world();
    const s1 = await finalizedState("sim-1", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right" });
    const snapshot = { examCode: "IPMAT_INDORE", examVersion: ipmatIndoreExamPack.packVersion, pack: ipmatIndoreExamPack, patternFamilies: [], errorTaxonomyCodes: [], questions: [], historicalRecords: [] } as unknown as ExamIntelligenceSnapshot;
    const base = (await composeExamPerformanceIntelligence(w.deps({ now: () => LATER, finalizedSimulationReader: readerOf([s1]) }), request))!;
    const withP6 = (await composeExamPerformanceIntelligence(w.deps({ now: () => LATER, finalizedSimulationReader: readerOf([s1]), examIntelligenceSource: new InMemoryExamIntelligenceSource([snapshot]) }), request))!;
    expect(base.concepts.every((c) => c.examContent.contentAvailability === null)).toBe(true);
    expect(withP6.concepts.find((c) => c.conceptName === "Percentages")!.examContent).toEqual({ contentAvailability: { available: 0, validated: 0, published: 0 }, historicalRecordsObserved: 0 });
    expect(withP6.simulations).toEqual(base.simulations);
    expect(withP6.dimensions).toEqual(base.dimensions);
  });

  it("is deterministic and never carries an answer key, a chosen answer or another student's data", async () => {
    const w = await world();
    const s1 = await finalizedState("sim-1", STUDENT, "IPMAT_INDORE", ["q-1", "q-2", "q-3"], { 1: "right", 2: "wrong" });
    const deps = w.deps({ now: () => LATER, finalizedSimulationReader: readerOf([s1]) });
    const first = await composeExamPerformanceIntelligence(deps, request);
    expect(await composeExamPerformanceIntelligence(deps, request)).toEqual(first);
    const text = JSON.stringify(first);
    for (const secret of [ANSWER_KEY, "correctAnswer", "chosenAnswer", "\"right\"", "\"wrong\"", "student-2", "enrollment-2", "sim-enrollment"]) expect(text, secret).not.toContain(secret);
  });

  it("the service exposes it as a read-only method", async () => {
    const w = await world();
    const r = await new TrainingRecommendationService(w.deps({ now: () => LATER })).readExamPerformanceIntelligence(request);
    expect(r!.readiness.defined).toBe(false);
  });
});
