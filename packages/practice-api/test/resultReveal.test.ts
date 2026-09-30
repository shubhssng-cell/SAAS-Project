import { describe, expect, it } from "vitest";
import { ANSWER_KEY, ENROLLMENT, STUDENT, World, publishedQuestion, publishedQuestionContent, t } from "./fixtures.js";

/**
 * Product Phase 2 Unit 3 -- the authored solution and question context are
 * revealed ONLY in the result of a SUBMITTED attempt, never before submission
 * and never for a skip.
 */

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const STEPS = ["Step one: identify the base.", "Step two: divide by 1.20."];

function worldWithSolution(): World {
  const world = new World();
  world.questions = [{ ...publishedQuestion, solutionSteps: STEPS }];
  return world;
}

describe("result reveals the authored solution only after submission", () => {
  it("submitAttempt returns the stored solution steps and the question context", async () => {
    const world = worldWithSolution();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    const view = await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: "999", now: t(30) });

    expect(view.isCorrect).toBe(false);
    expect(view.solutionSteps).toEqual(STEPS);
    expect(view.question).toEqual({ prompt: publishedQuestionContent.prompt, chapterName: "Percentages", conceptName: "Percentages" });
  });

  it("getAttemptResult (the refresh path) returns the same solution and question context", async () => {
    const world = worldWithSolution();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(30) });

    const view = await world.service().getAttemptResult(claim, { attemptId });
    expect(view.solutionSteps).toEqual(STEPS);
    expect(view.question?.prompt).toBe(publishedQuestionContent.prompt);
  });

  it("startAttempt (before submission) exposes neither the solution nor the answer key", async () => {
    const world = worldWithSolution();
    const started = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    const json = JSON.stringify(started);
    expect(json).not.toContain(STEPS[0]!);
    expect(json).not.toContain(ANSWER_KEY);
    expect(json).not.toContain("solutionSteps");
  });

  it("a skipped attempt reveals no solution, no answer, and no question context", async () => {
    const world = worldWithSolution();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    const skipped = await world.service().skipAttempt(claim, { attemptId, questionId: publishedQuestion.id, now: t(10) });
    expect(skipped).toMatchObject({ solutionSteps: [], question: null, correctAnswer: null });
    const reread = await world.service().getAttemptResult(claim, { attemptId });
    expect(reread).toMatchObject({ solutionSteps: [], question: null, correctAnswer: null });
  });

  it("a question with no stored solution yields an empty list -- nothing is invented", async () => {
    const world = new World(); // publishedQuestion has no solutionSteps
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    const view = await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: "1", now: t(5) });
    expect(view.solutionSteps).toEqual([]);
  });

  it("the solution shown is the ATTEMPT's question, not whatever questionId the request body claims", async () => {
    const world = worldWithSolution();
    world.questions.push({ ...publishedQuestion, id: "question-other", solutionSteps: ["someone else's solution"] });
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    const view = await world.service().submitAttempt(claim, { attemptId, questionId: "question-other", chosenAnswer: "1", now: t(5) }).catch((e: unknown) => e);
    // Either refused outright (ownership on the claimed question) or, if accepted, still the attempt's own solution.
    if (view instanceof Error) return;
    expect((view as { solutionSteps: string[] }).solutionSteps).not.toContain("someone else's solution");
  });
});
