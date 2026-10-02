import { describe, expect, it, vi } from "vitest";
import { composeMasteryEvidenceView } from "../src/masteryEvidence.js";
import { TrainingRecommendationService } from "../src/service.js";
import { TrainingRecommendationError } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, EXAM, OTHER_ENROLLMENT, OTHER_EXAM, OTHER_STUDENT, RATIO, STUDENT, World } from "./fixtures.js";

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const concept = (view: Awaited<ReturnType<typeof composeMasteryEvidenceView>>, name = "Percentages") => view!.concepts.find((c) => c.conceptName === name)!;

async function world(): Promise<World> {
  const w = new World();
  w.addQuestion({ id: "q-1" });
  w.addQuestion({ id: "q-2", dna: { patternFamilyName: "Successive Percentage Change", noveltyLevel: "novel_representation", testingModes: ["combined"] } });
  w.addQuestion({ id: "q-ratio", concept: RATIO, dna: { chapterName: "Ratio" } });
  return w;
}

describe("the evidence view is derived from persisted attempts, scoped to the verified student and enrollment", () => {
  it("separates attempts from distinct questions, keeps skips apart, and audits contributing attempts", async () => {
    const w = await world();
    await w.finalizedAttempt({ id: "a1", questionId: "q-1", start: 0, finalize: 30 });
    await w.finalizedAttempt({ id: "a2", questionId: "q-1", correct: false, start: 100, finalize: 140 });
    await w.finalizedAttempt({ id: "a3", questionId: "q-1", start: 200, finalize: 220 });
    await w.finalizedAttempt({ id: "a4", questionId: "q-2", skip: true, start: 300, finalize: 310 });
    await w.finalizedAttempt({ id: "a5", questionId: "q-2", start: 400, finalize: 450 });
    const view = await composeMasteryEvidenceView(w.deps(), request);
    expect(view).not.toBeNull();
    expect(view!.status).toBe("evidence_only");
    expect(view!.examCode).toBe("IPMAT_INDORE");
    const c = concept(view);
    expect(c.overall).toMatchObject({ attempts: 5, gradedAttempts: 4, correctGradedAttempts: 3, incorrectGradedAttempts: 1, skippedAttempts: 1, distinctQuestions: 2, distinctGradedQuestions: 2, distinctSkippedQuestions: 1 });
    expect(c.overall.contributingAttemptIds).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(c.questions.find((q) => q.questionId === "q-1")).toMatchObject({ attempts: 3, gradedAttempts: 3 });
    expect(Object.keys(c.byPatternFamily)).toEqual(["Reverse Percentage", "Successive Percentage Change"]);
    expect(c.byNoveltyLevel.novel_representation!.contributingAttemptIds).toEqual(["a4", "a5"]);
    expect(c.byTestingMode.combined!.attempts).toBe(2);
  });

  it("includes the exam's concepts with no attempts as empty evidence (absence, not a verdict)", async () => {
    const w = await world();
    await w.finalizedAttempt({ id: "a1", questionId: "q-1", start: 0, finalize: 30 });
    const view = await composeMasteryEvidenceView(w.deps(), request);
    expect(concept(view, "Ratio").overall).toMatchObject({ attempts: 0, distinctQuestions: 0, contributingAttemptIds: [] });
  });

  it("an unfinished attempt contributes nothing", async () => {
    const w = await world();
    await w.finalizedAttempt({ id: "a1", questionId: "q-1", start: 0, finalize: 30 });
    await w.openAttempt({ id: "open", questionId: "q-1", start: 500 });
    expect(concept(await composeMasteryEvidenceView(w.deps(), request)).overall.attempts).toBe(1);
  });

  it("student isolation: another student's attempts, even in the same exam, never appear", async () => {
    const w = await world();
    await w.finalizedAttempt({ id: "mine", questionId: "q-1", start: 0, finalize: 30 });
    await w.finalizedAttempt({ id: "theirs", questionId: "q-1", start: 100, finalize: 130, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    const mine = await composeMasteryEvidenceView(w.deps(), request);
    expect(concept(mine).overall.contributingAttemptIds).toEqual(["mine"]);
    expect(JSON.stringify(mine)).not.toContain("theirs");
    const theirs = await composeMasteryEvidenceView(w.deps(), { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    expect(concept(theirs).overall.contributingAttemptIds).toEqual(["theirs"]);
    expect(JSON.stringify(theirs)).not.toContain("mine");
  });

  it("enrollment ownership is verified first: a claimed student who does not own the enrollment is refused and nothing is read", async () => {
    const w = await world();
    const deps = w.deps();
    const finalized = vi.spyOn(deps.attemptHistoryReader, "findFinalizedByStudentId");
    const error = await composeMasteryEvidenceView(deps, { studentId: OTHER_STUDENT, enrollmentId: ENROLLMENT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrainingRecommendationError);
    expect((error as TrainingRecommendationError).code).toBe("enrollment_ownership_mismatch");
    expect(finalized).not.toHaveBeenCalled();
  });

  it("exam isolation: another exam's questions never contribute, and the other exam has its own separate view", async () => {
    const w = await world();
    w.addQuestion({ id: "q-other-exam", exam: OTHER_EXAM, dna: { examCode: "OTHER_EXAM" } });
    w.conceptsByExam.set(OTHER_EXAM, [{ id: "concept-percentages", name: "Percentages", chapterId: "x" }]);
    w.enrollments.push({ id: "enrollment-x", studentId: STUDENT, examId: OTHER_EXAM });
    await w.finalizedAttempt({ id: "ipmat-attempt", questionId: "q-1", start: 0, finalize: 30 });
    await w.finalizedAttempt({ id: "other-exam-attempt", questionId: "q-other-exam", start: 100, finalize: 130, enrollmentId: "enrollment-x" });
    const ipmat = await composeMasteryEvidenceView(w.deps(), request);
    expect(ipmat!.examCode).toBe("IPMAT_INDORE");
    expect(ipmat!.concepts.flatMap((c) => c.overall.contributingAttemptIds)).toEqual(["ipmat-attempt"]);
    const other = await composeMasteryEvidenceView(w.deps(), { studentId: STUDENT, enrollmentId: "enrollment-x" });
    expect(other!.examCode).toBe("OTHER_EXAM");
    expect(other!.concepts.flatMap((c) => c.overall.contributingAttemptIds)).toEqual(["other-exam-attempt"]);
  });

  it("an attempt on a question that is no longer in the published pool is excluded, not invented (documented limitation)", async () => {
    const w = await world();
    await w.finalizedAttempt({ id: "a1", questionId: "q-1", start: 0, finalize: 30 });
    w.questionRecordsByExam.set(EXAM, w.questionRecordsByExam.get(EXAM)!.filter((r) => r.question.questionId !== "q-1"));
    expect(concept(await composeMasteryEvidenceView(w.deps(), request)).overall.attempts).toBe(0);
  });

  it("an exam with no published pool yields null rather than an unattributable view", async () => {
    const w = new World();
    await w.finalizedAttempt({ id: "a1", questionId: "ghost", start: 0, finalize: 30 });
    expect(await composeMasteryEvidenceView(w.deps(), request)).toBeNull();
  });

  it("is read-only: the repair-plan status writer is never invoked, and nothing is written", async () => {
    const w = await world();
    await w.finalizedAttempt({ id: "a1", questionId: "q-1", start: 0, finalize: 30 });
    const advanceStatus = vi.fn(async () => true);
    const save = vi.spyOn(w.attempts, "save");
    await composeMasteryEvidenceView(w.deps({ repairPlanStatusWriter: { advanceStatus } }), request);
    expect(advanceStatus).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("is deterministic across repeated calls and never carries the answer key, a question text, or another student's id", async () => {
    const w = await world();
    await w.finalizedAttempt({ id: "a1", questionId: "q-1", start: 0, finalize: 30 });
    await w.finalizedAttempt({ id: "x1", questionId: "q-1", start: 50, finalize: 80, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    const first = await composeMasteryEvidenceView(w.deps(), request);
    expect(await composeMasteryEvidenceView(w.deps(), request)).toEqual(first);
    const text = JSON.stringify(first);
    for (const secret of [ANSWER_KEY, "correctAnswer", "student-2", "enrollment-2", "x1"]) expect(text, secret).not.toContain(secret);
  });

  it("the service exposes it as a read-only method", async () => {
    const w = await world();
    await w.finalizedAttempt({ id: "a1", questionId: "q-1", start: 0, finalize: 30 });
    const view = await new TrainingRecommendationService(w.deps()).readMasteryEvidence(request);
    expect(concept(view).overall.attempts).toBe(1);
  });
});
