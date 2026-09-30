import { describe, expect, it } from "vitest";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World, publishedQuestion, t } from "./fixtures.js";

/**
 * Product Phase 2 Unit 6 -- skip is a terminal, server-owned attempt state, distinct from
 * a submitted answer, that never resumes and can never be submitted afterwards.
 */

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const QID = publishedQuestion.id;
const scope = { studentId: STUDENT, questionId: QID, enrollmentId: ENROLLMENT };

describe("skip lifecycle", () => {
  it("skipping finalizes the attempt as 'skipped' -- not graded: no verdict, no answers, no solution, no question", async () => {
    const world = new World();
    world.questions = [{ ...publishedQuestion, solutionSteps: ["secret step"] }];
    const { attemptId } = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    const view = await world.service().skipAttempt(claim, { attemptId, questionId: QID, now: t(12) });
    expect(view).toMatchObject({ attemptId, questionId: QID, status: "skipped", isCorrect: null, chosenAnswer: null, correctAnswer: null, timeSpentSeconds: 12, solutionSteps: [], question: null });
    expect(JSON.stringify(view)).not.toContain(ANSWER_KEY);
    expect(JSON.stringify(view)).not.toContain("secret step");
  });

  it("a skip is distinguishable from an incorrect submitted answer", async () => {
    const world = new World();
    const a = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    const skipped = await world.service().skipAttempt(claim, { attemptId: a.attemptId, questionId: QID, now: t(5) });
    const b = await world.service().startAttempt(claim, { questionId: QID, now: t(10) });
    const wrong = await world.service().submitAttempt(claim, { attemptId: b.attemptId, questionId: QID, chosenAnswer: "999", now: t(15) });
    expect(skipped.status).toBe("skipped");
    expect(skipped.isCorrect).toBeNull();
    expect(wrong.status).toBe("submitted");
    expect(wrong.isCorrect).toBe(false);
  });

  it("a skipped attempt can NEVER be submitted afterwards (invalid_state), and stays skipped", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    await world.service().skipAttempt(claim, { attemptId, questionId: QID, now: t(5) });
    await expect(world.service().submitAttempt(claim, { attemptId, questionId: QID, chosenAnswer: ANSWER_KEY, now: t(6) })).rejects.toMatchObject({ code: "invalid_state" });
    expect((await world.service().getAttemptResult(claim, { attemptId })).status).toBe("skipped");
  });

  it("skipping twice is refused (invalid_state) -- no duplicate skip", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    await world.service().skipAttempt(claim, { attemptId, questionId: QID, now: t(5) });
    await expect(world.service().skipAttempt(claim, { attemptId, questionId: QID, now: t(6) })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("a submitted attempt cannot be skipped afterwards", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    await world.service().submitAttempt(claim, { attemptId, questionId: QID, chosenAnswer: "1", now: t(5) });
    await expect(world.service().skipAttempt(claim, { attemptId, questionId: QID, now: t(6) })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("recovery: a skipped attempt is not resumed; the next start is a NEW attempt and its later submit leaves the skipped one untouched", async () => {
    const world = new World();
    const first = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    await world.service().skipAttempt(claim, { attemptId: first.attemptId, questionId: QID, now: t(5) });
    expect(await world.attempts.findInProgressByStudentQuestion(scope)).toBeNull();

    const second = await world.service().startAttempt(claim, { questionId: QID, now: t(30) });
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(second.elapsedSeconds).toBe(0);
    const submitted = await world.service().submitAttempt(claim, { attemptId: second.attemptId, questionId: QID, chosenAnswer: ANSWER_KEY, now: t(40) });
    expect(submitted).toMatchObject({ status: "submitted", isCorrect: true });

    const reread = await world.service().getAttemptResult(claim, { attemptId: first.attemptId });
    expect(reread).toMatchObject({ status: "skipped", isCorrect: null, chosenAnswer: null, timeSpentSeconds: 5 });
  });

  it("time on a skip is the server's clock (finalized - started); no caller duration exists", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    const view = await world.service().skipAttempt(claim, { attemptId, questionId: QID, now: t(47) });
    expect(view.timeSpentSeconds).toBe(47);
  });

  it("ownership: another student cannot skip this attempt, and it stays open and resumable for its owner", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    await expect(world.service().skipAttempt({ studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT }, { attemptId, questionId: QID, now: t(1) })).rejects.toMatchObject({ code: "ownership_mismatch" });
    expect((await world.service().startAttempt(claim, { questionId: QID, now: t(9) })).attemptId).toBe(attemptId);
  });

  it("a nonexistent attempt is refused (not_found)", async () => {
    await expect(new World().service().skipAttempt(claim, { attemptId: "nope", questionId: QID, now: t(0) })).rejects.toMatchObject({ code: "not_found" });
  });

  it("malformed skip requests are rejected before any lookup", async () => {
    const world = new World();
    await expect(world.service().skipAttempt(claim, { attemptId: "", questionId: QID })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(world.service().skipAttempt(claim, { attemptId: "a", questionId: "" })).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("skip response consistency", () => {
  it("the skip response and a later re-read of the same attempt are identical (including expectedTimeSeconds)", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: QID, now: t(0) });
    const skipped = await world.service().skipAttempt(claim, { attemptId, questionId: QID, now: t(8) });
    expect(skipped.expectedTimeSeconds).toBe(90);
    expect(await world.service().getAttemptResult(claim, { attemptId })).toEqual(skipped);
  });
});
