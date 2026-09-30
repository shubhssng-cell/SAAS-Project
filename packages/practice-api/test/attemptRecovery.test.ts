import { describe, expect, it } from "vitest";
import { ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World, publishedQuestion, t } from "./fixtures.js";

/**
 * Product Phase 2 Unit 5 -- a reload must resume the student's open attempt, never
 * start another. Runs against the real PracticeApiService + in-memory repositories.
 */

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const QID = publishedQuestion.id;
const scope = { studentId: STUDENT, questionId: QID, enrollmentId: ENROLLMENT };

const hasOpen = async (world: World) => (await world.attempts.findInProgressByStudentQuestion(scope)) !== null;

describe("startAttempt -- recovery of an open attempt", () => {
  it("first visit starts one attempt with elapsedSeconds 0", async () => {
    const world = new World();
    const started = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    expect(started.elapsedSeconds).toBe(0);
    expect(await hasOpen(world)).toBe(true);
  });

  it("a reload resumes the SAME attempt id, and elapsedSeconds comes from the server's clock", async () => {
    const world = new World();
    const first = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    const reloaded = await world.service().startAttempt(claim, { questionId: QID, now: t(42) });
    expect(reloaded.attemptId).toBe(first.attemptId);
    expect(reloaded.elapsedSeconds).toBe(42);
    expect(reloaded.question.questionId).toBe(QID);
    const again = await world.service().startAttempt(claim, { questionId: QID, now: t(100) });
    expect(again.attemptId).toBe(first.attemptId);
    expect(again.elapsedSeconds).toBe(100);
  });

  it("concurrent starts (double request / two tabs) create exactly ONE attempt", async () => {
    const world = new World();
    const service = world.service();
    const results = await Promise.all([1, 2, 3, 4].map(() => service.startAttempt(claim, { questionId: QID, now: t(0) })));
    expect(new Set(results.map((r) => r.attemptId)).size).toBe(1);
    const open = await world.attempts.findInProgressByStudentQuestion(scope);
    expect(open?.id).toBe(results[0]!.attemptId);
  });

  it("the resumed attempt is the one that gets submitted; submitting twice is refused", async () => {
    const world = new World();
    const first = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    const resumed = await world.service().startAttempt(claim, { questionId: QID, now: t(20) });
    const result = await world.service().submitAttempt(claim, { attemptId: resumed.attemptId, questionId: QID, chosenAnswer: "1", now: t(30) });
    expect(result.attemptId).toBe(first.attemptId);
    expect(result.timeSpentSeconds).toBe(30); // server clock from the ORIGINAL start, not from the reload
    await expect(world.service().submitAttempt(claim, { attemptId: resumed.attemptId, questionId: QID, chosenAnswer: "1", now: t(31) })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("a SUBMITTED attempt never resumes as in-progress: the next start is a brand-new attempt", async () => {
    const world = new World();
    const first = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    await world.service().submitAttempt(claim, { attemptId: first.attemptId, questionId: QID, chosenAnswer: "1", now: t(5) });
    expect(await hasOpen(world)).toBe(false);
    const next = await world.service().startAttempt(claim, { questionId: QID, now: t(60) });
    expect(next.attemptId).not.toBe(first.attemptId);
    expect(next.elapsedSeconds).toBe(0);
  });

  it("a SKIPPED attempt never resumes either", async () => {
    const world = new World();
    const first = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    await world.service().skipAttempt(claim, { attemptId: first.attemptId, questionId: QID, now: t(5) });
    const next = await world.service().startAttempt(claim, { questionId: QID, now: t(9) });
    expect(next.attemptId).not.toBe(first.attemptId);
  });

  it("ownership: another student starting the same question gets their OWN attempt, never the first student's", async () => {
    const world = new World();
    const mine = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    const theirs = await world.service().startAttempt({ studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT }, { questionId: QID, now: t(1) });
    expect(theirs.attemptId).not.toBe(mine.attemptId);
    expect(theirs.elapsedSeconds).toBe(0);
    expect((await world.service().startAttempt(claim, { questionId: QID, now: t(10) })).attemptId).toBe(mine.attemptId);
  });

  it("ownership: a claim pairing this student with someone else's enrollment is refused, and resumes nothing", async () => {
    const world = new World();
    await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    await expect(world.service().startAttempt({ studentId: STUDENT, enrollmentId: OTHER_ENROLLMENT }, { questionId: QID, now: t(1) })).rejects.toMatchObject({ code: "ownership_mismatch" });
  });

  it("an attempt under a DIFFERENT enrollment of the same student is not resumed", async () => {
    const world = new World();
    world.enrollments.push({ id: "enrollment-1b", studentId: STUDENT, examId: "exam-other" });
    const a = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    const b = await world.service().startAttempt({ studentId: STUDENT, enrollmentId: "enrollment-1b" }, { questionId: QID, now: t(1) });
    expect(b.attemptId).not.toBe(a.attemptId);
  });

  it("several open attempts (orphans): the most recently started one wins -- a fixed server rule", async () => {
    const world = new World();
    const seed = async (id: string, s: number) => world.attempts.save((await import("@ipmat/attempt")).startAttempt({ id, studentId: STUDENT, questionId: QID, enrollmentId: ENROLLMENT, now: t(s) }));
    await seed("orphan-a", 0);
    await seed("orphan-b", 50);
    const resumed = await world.service().startAttempt(claim, { questionId: QID, now: t(70) });
    expect(resumed.attemptId).toBe("orphan-b");
    expect(resumed.elapsedSeconds).toBe(20);
  });

  it("a question that is no longer published is refused, never resumed", async () => {
    const world = new World();
    await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    world.questions = [{ ...publishedQuestion, validationState: "draft" }];
    await expect(world.service().startAttempt(claim, { questionId: QID, now: t(5) })).rejects.toMatchObject({ code: "question_not_published" });
  });

  it("a nonexistent question is still refused (not_found)", async () => {
    await expect(new World().service().startAttempt(claim, { questionId: "nope", now: t(0) })).rejects.toMatchObject({ code: "not_found" });
  });

  it("elapsedSeconds is never negative, and the response carries no internal attempt diagnostics", async () => {
    const world = new World();
    await world.service().startAttempt(claim, { questionId: QID, now: t(100) });
    const early = await world.service().startAttempt(claim, { questionId: QID, now: t(50) });
    expect(early.elapsedSeconds).toBe(0);
    expect(Object.keys(early).sort()).toEqual(["attemptId", "elapsedSeconds", "question"]);
    expect(JSON.stringify(early)).not.toMatch(/startedAt|studentId|enrollmentId|events|status/);
  });
});

describe("startAttempt -- losing a race to another API instance (Unit 7)", () => {
  it("when the database's one-open-attempt guarantee rejects our create, the WINNER's attempt is resumed, not an error", async () => {
    // Two services with independent in-process locks over ONE shared store that mirrors the DB index.
    const world = new World({ enforceSingleOpenAttempt: true });
    const instanceA = world.service();
    const instanceB = world.service();
    const results = await Promise.all([instanceA, instanceB, instanceA, instanceB, instanceA, instanceB].map((svc) => svc.startAttempt(claim, { questionId: QID, now: t(0) })));
    expect(new Set(results.map((r) => r.attemptId)).size).toBe(1);
    expect(await hasOpen(world)).toBe(true);
  });

  it("a conflict with NO resumable winner is not swallowed: it surfaces as a safe 409", async () => {
    const world = new World({ enforceSingleOpenAttempt: true });
    await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    // Simulate the reader never finding the winner (e.g. it was finalized in between).
    world.attempts.findInProgressByStudentQuestion = async () => null;
    await expect(world.service().startAttempt(claim, { questionId: QID, now: t(1) })).rejects.toMatchObject({ code: "invalid_state", httpStatus: 409 });
  });
});
