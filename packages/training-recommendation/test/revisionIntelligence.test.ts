import { describe, expect, it, vi } from "vitest";
import { composeRevisionIntelligence } from "../src/revisionIntelligence.js";
import { TrainingRecommendationService } from "../src/service.js";
import { TrainingRecommendationError } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_EXAM, OTHER_STUDENT, STUDENT, World } from "./fixtures.js";

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };
/** ~28 days after the fixture attempts (which start 2026-09-22), so a concept with 3 graded attempts is dormant. */
const LATER = "2026-10-20T12:00:00.000Z";

async function world(): Promise<World> {
  const w = new World();
  for (const id of ["q-1", "q-2", "q-3", "q-4"]) w.addQuestion({ id });
  await w.finalizedAttempt({ id: "a1", questionId: "q-1", correct: false, start: 0, finalize: 30 });
  await w.finalizedAttempt({ id: "a2", questionId: "q-2", correct: false, start: 100, finalize: 130 });
  await w.finalizedAttempt({ id: "a3", questionId: "q-3", start: 200, finalize: 230 });
  return w;
}

describe("revision intelligence derived from persisted attempts", () => {
  it("composes evidence, the existing providers' own outcomes and a traced recommendation", async () => {
    const w = await world();
    const r = await composeRevisionIntelligence(w.deps({ now: () => LATER }), request);
    expect(r).not.toBeNull();
    expect(r!.status).toBe("evidence_based_no_verdict");
    expect(r!.priority.defined).toBe(false);
    expect(r!.examCode).toBe("IPMAT_INDORE");
    expect(r!.evaluatedAt).toBe(LATER);
    expect(r!.signals.find((s) => s.id === "dormant_concept|Percentages|*")!.contributingAttemptIds).toEqual(["a1", "a2", "a3"]);
    const rev = r!.recommendations.find((x) => x.systemId === "revision")!;
    expect(rev.targetConceptName).toBe("Percentages");
    expect(rev.supportingSignalIds).toEqual(["dormant_concept|Percentages|*"]);
    expect(rev.contributingAttemptIds).toEqual(["a1", "a2", "a3"]);
    expect(rev.question.questionId).toBe("q-4"); // the provider's own tie-break: least prior exposure
    expect(r!.providerOutcomes.map((p) => p.systemId)).toEqual(["calculation-gym", "novelty-training", "pressure-training", "revision", "speed-lab", "trap-lab"]);
  });

  it("not yet dormant: no dormancy signal and Revision is not applicable (its own rule decides)", async () => {
    const w = await world();
    const r = await composeRevisionIntelligence(w.deps({ now: () => "2026-09-24T12:00:00.000Z" }), request);
    expect(r!.signals.some((s) => s.kind === "dormant_concept")).toBe(false);
    expect(r!.providerOutcomes.find((p) => p.systemId === "revision")!.status).toBe("not_applicable");
  });

  it("skips are kept out of graded evidence: a skip neither makes a concept dormant nor counts toward its minimum", async () => {
    const w = new World();
    for (const id of ["q-1", "q-2", "q-3"]) w.addQuestion({ id });
    await w.finalizedAttempt({ id: "a1", questionId: "q-1", start: 0, finalize: 30 });
    await w.finalizedAttempt({ id: "a2", questionId: "q-2", start: 100, finalize: 130 });
    await w.finalizedAttempt({ id: "a3", questionId: "q-3", skip: true, start: 200, finalize: 210 });
    const r = await composeRevisionIntelligence(w.deps({ now: () => LATER }), request);
    expect(r!.signals.some((s) => s.kind === "dormant_concept")).toBe(false);
  });

  it("student isolation: another student's attempts never contribute", async () => {
    const w = await world();
    for (const [i, id] of ["t1", "t2", "t3"].entries()) await w.finalizedAttempt({ id, questionId: `q-${i + 1}`, start: 300 + i * 100, finalize: 330 + i * 100, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    const mine = await composeRevisionIntelligence(w.deps({ now: () => LATER }), request);
    expect(JSON.stringify(mine)).not.toMatch(/"t[123]"|student-2/);
    const theirs = await composeRevisionIntelligence(w.deps({ now: () => LATER }), { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    expect(theirs!.signals.find((s) => s.id === "dormant_concept|Percentages|*")!.contributingAttemptIds).toEqual(["t1", "t2", "t3"]);
  });

  it("enrollment ownership is verified first and nothing is read for a claimant who does not own it", async () => {
    const w = await world();
    const deps = w.deps();
    const finalized = vi.spyOn(deps.attemptHistoryReader, "findFinalizedByStudentId");
    const error = await composeRevisionIntelligence(deps, { studentId: OTHER_STUDENT, enrollmentId: ENROLLMENT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrainingRecommendationError);
    expect((error as TrainingRecommendationError).code).toBe("enrollment_ownership_mismatch");
    expect(finalized).not.toHaveBeenCalled();
  });

  it("exam isolation: another exam's pool and attempts never reach this exam's providers", async () => {
    const w = await world();
    w.addQuestion({ id: "q-other", exam: OTHER_EXAM, dna: { examCode: "OTHER_EXAM" } });
    const r = await composeRevisionIntelligence(w.deps({ now: () => LATER }), request);
    expect(r!.examCode).toBe("IPMAT_INDORE");
    expect(JSON.stringify(r)).not.toContain("q-other");
  });

  it("an exam with no published pool yields null", async () => {
    const w = new World();
    expect(await composeRevisionIntelligence(w.deps(), request)).toBeNull();
  });

  it("is read-only: the RepairPlan status writer and the attempt repository are never written to", async () => {
    const w = await world();
    const advanceStatus = vi.fn(async () => true);
    const save = vi.spyOn(w.attempts, "save");
    await composeRevisionIntelligence(w.deps({ now: () => LATER, repairPlanStatusWriter: { advanceStatus } }), request);
    expect(advanceStatus).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("is deterministic, never carries the answer key or another student's data, and is exposed by the service", async () => {
    const w = await world();
    const deps = w.deps({ now: () => LATER });
    const first = await composeRevisionIntelligence(deps, request);
    expect(await composeRevisionIntelligence(deps, request)).toEqual(first);
    expect(await new TrainingRecommendationService(deps).readRevisionIntelligence(request)).toEqual(first);
    const text = JSON.stringify(first);
    for (const secret of [ANSWER_KEY, "correctAnswer", "student-2", "enrollment-2"]) expect(text, secret).not.toContain(secret);
  });

  it("Unit 1's evidence read is unchanged by Unit 2", async () => {
    const w = await world();
    const view = await new TrainingRecommendationService(w.deps({ now: () => LATER })).readMasteryEvidence(request);
    expect(view!.status).toBe("evidence_only");
    expect(view!.concepts.find((c) => c.conceptName === "Percentages")!.overall).toMatchObject({ attempts: 3, gradedAttempts: 3, distinctQuestions: 3 });
  });
});
