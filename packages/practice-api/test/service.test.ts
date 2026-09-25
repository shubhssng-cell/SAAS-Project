import { PersistenceError } from "@ipmat/db";
import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import {
  ANSWER_KEY,
  draftQuestion,
  ENROLLMENT,
  makeStoredAutopsy,
  OTHER_ENROLLMENT,
  OTHER_STUDENT,
  publishedQuestion,
  publishedQuestionContent,
  STUDENT,
  t,
  World
} from "./fixtures.js";

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };

async function expectCode(promise: Promise<unknown>, code: PracticeApiError["code"], httpStatus?: number): Promise<PracticeApiError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(PracticeApiError);
  const apiError = error as PracticeApiError;
  expect(apiError.code).toBe(code);
  if (httpStatus !== undefined) expect(apiError.httpStatus).toBe(httpStatus);
  return apiError;
}

describe("PracticeApiService.getNextRecommendation", () => {
  it("returns a student-safe recommendation view for a real orchestration result", async () => {
    const world = new World();
    const view = await world.service().getNextRecommendation(claim);
    expect(view).toHaveProperty("headline");
    expect(view).toHaveProperty("explanation");
    expect(view).toHaveProperty("modeLabel");
    // no_action, since no candidates are supplied in this fixture world.
    expect(view.questionId).toBeNull();
  });

  it("missing enrollment fails closed with not_found", async () => {
    const world = new World();
    await expectCode(world.service().getNextRecommendation({ studentId: STUDENT, enrollmentId: "no-such-enrollment" }), "not_found", 404);
  });

  it("enrollment/student mismatch fails closed with ownership_mismatch", async () => {
    const world = new World();
    await expectCode(world.service().getNextRecommendation({ studentId: STUDENT, enrollmentId: OTHER_ENROLLMENT }), "ownership_mismatch", 403);
  });

  it("rejects a malformed (blank) request before any repository read", async () => {
    const world = new World();
    await expectCode(world.service().getNextRecommendation({ studentId: "", enrollmentId: ENROLLMENT }), "invalid_request", 400);
  });

  it("never leaks internal orchestration/diagnostics structures", async () => {
    const world = new World();
    const view = await world.service().getNextRecommendation(claim);
    const json = JSON.stringify(view);
    for (const forbidden of ["diagnostics", "providerResult", "actionType", "repairPlansSupplied", "trainingSystemProviderOutcomes"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("a repository failure propagates as infrastructure_failure, never swallowed", async () => {
    const world = new World();
    world.trainingRecommendationOverrides = { attemptHistoryReader: { findFinalizedByStudentId: () => Promise.reject(new Error("db down")), findByPracticeBlockId: async () => [] } };
    await expectCode(world.service().getNextRecommendation(claim), "infrastructure_failure", 500);
  });
});

describe("PracticeApiService.startAttempt", () => {
  it("starts an attempt and returns a student-safe question view with no answer-bearing field", async () => {
    const world = new World();
    const result = await world.service().startAttempt(claim, { questionId: publishedQuestion.id });

    expect(result.attemptId).toBeTruthy();
    expect(result.question).toEqual({
      questionId: "question-1",
      chapterName: "Percentages",
      conceptName: "Percentages",
      prompt: publishedQuestionContent.prompt,
      answerFormat: "numeric_entry",
      options: null,
      expectedTimeSeconds: 90
    });
    expect(JSON.stringify(result)).not.toContain(ANSWER_KEY);
    expect(Object.keys(result.question)).not.toContain("correctAnswer");
  });

  it("the started attempt is persisted and resolvable", async () => {
    const world = new World();
    const result = await world.service().startAttempt(claim, { questionId: publishedQuestion.id });
    const persisted = await world.attempts.findById(result.attemptId);
    expect(persisted?.status).toBe("in_progress");
    expect(persisted?.studentId).toBe(STUDENT);
    expect(persisted?.enrollmentId).toBe(ENROLLMENT);
  });

  it("refuses to start against an unpublished question (question_not_published)", async () => {
    const world = new World();
    world.questions = [draftQuestion];
    await expectCode(world.service().startAttempt(claim, { questionId: draftQuestion.id }), "question_not_published", 409);
  });

  it("refuses to start against a nonexistent question (not_found)", async () => {
    const world = new World();
    await expectCode(world.service().startAttempt(claim, { questionId: "no-such-question" }), "not_found", 404);
  });

  it("rejects an enrollment/student ownership mismatch before creating any attempt", async () => {
    const world = new World();
    await expectCode(world.service().startAttempt({ studentId: STUDENT, enrollmentId: OTHER_ENROLLMENT }, { questionId: publishedQuestion.id }), "ownership_mismatch", 403);
    expect((await world.attempts.findFinalizedByStudentId(STUDENT)).length + 0).toBe(0);
  });

  it("never trusts a caller-supplied ownership claim that resolves to another student's data", async () => {
    const world = new World();
    // OTHER_STUDENT genuinely owns OTHER_ENROLLMENT; a caller claiming to be STUDENT against it must fail, not silently substitute OTHER_STUDENT's data.
    await expectCode(world.service().startAttempt({ studentId: OTHER_STUDENT, enrollmentId: ENROLLMENT }, { questionId: publishedQuestion.id }), "ownership_mismatch", 403);
  });

  it("rejects a malformed request (blank questionId)", async () => {
    const world = new World();
    await expectCode(world.service().startAttempt(claim, { questionId: "" }), "invalid_request", 400);
  });
});

describe("PracticeApiService.submitAttempt", () => {
  async function started(world: World): Promise<string> {
    const result = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    return result.attemptId;
  }

  it("submits a correct answer and returns the authoritative correctAnswer only after submission", async () => {
    const world = new World();
    const attemptId = await started(world);

    const view = await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(30) });

    expect(view).toMatchObject({ attemptId, questionId: publishedQuestion.id, status: "submitted", isCorrect: true, chosenAnswer: ANSWER_KEY, correctAnswer: ANSWER_KEY, timeSpentSeconds: 30, expectedTimeSeconds: 90 });
  });

  it("submits an incorrect answer and reports isCorrect: false with the real correctAnswer", async () => {
    const world = new World();
    const attemptId = await started(world);

    const view = await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: "999", now: t(30) });

    expect(view.isCorrect).toBe(false);
    expect(view.chosenAnswer).toBe("999");
    expect(view.correctAnswer).toBe(ANSWER_KEY);
  });

  it("timeSpentSeconds is server-derived from real timestamps, never a client-supplied duration", async () => {
    const world = new World();
    const attemptId = await started(world); // started at t(0)
    // A caller cannot pass a duration directly -- only `now` (a testing seam never exposed over a real HTTP request, see src/service.ts's own doc comment). timeSpentSeconds must equal finalizedAt - startedAt.
    const view = await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(45) });
    expect(view.timeSpentSeconds).toBe(45);
  });

  it("never leaks the answer key for a question the student has not yet submitted (before submission)", async () => {
    const world = new World();
    const result = await world.service().startAttempt(claim, { questionId: publishedQuestion.id });
    expect(JSON.stringify(result)).not.toContain(ANSWER_KEY);
  });

  it("rejects submission against an attempt belonging to another student (ownership_mismatch)", async () => {
    const world = new World();
    const attemptId = await started(world);
    await expectCode(
      world.service().submitAttempt({ studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT }, { attemptId, questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(30) }),
      "ownership_mismatch",
      403
    );
  });

  it("invalid attempt transition: submitting an already-finalized attempt fails with invalid_state", async () => {
    const world = new World();
    const attemptId = await started(world);
    await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(30) });

    await expectCode(world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(60) }), "invalid_state", 409);
  });

  it("rejects submitting a nonexistent attempt (not_found)", async () => {
    const world = new World();
    await expectCode(world.service().submitAttempt(claim, { attemptId: "no-such-attempt", questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(0) }), "not_found", 404);
  });

  it("rejects a malformed request (blank chosenAnswer)", async () => {
    const world = new World();
    const attemptId = await started(world);
    await expectCode(world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: "", now: t(30) }), "invalid_request", 400);
  });
});

describe("PracticeApiService.skipAttempt", () => {
  it("skips an in-progress attempt where the domain contract allows it", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });

    const view = await world.service().skipAttempt(claim, { attemptId, questionId: publishedQuestion.id, now: t(20) });

    expect(view).toMatchObject({ attemptId, status: "skipped", isCorrect: null, chosenAnswer: null, correctAnswer: null });
  });

  it("rejects skipping an already-finalized attempt (invalid_state)", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    await world.service().skipAttempt(claim, { attemptId, questionId: publishedQuestion.id, now: t(20) });

    await expectCode(world.service().skipAttempt(claim, { attemptId, questionId: publishedQuestion.id, now: t(40) }), "invalid_state", 409);
  });

  it("rejects skipping another student's attempt", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    await expectCode(
      world.service().skipAttempt({ studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT }, { attemptId, questionId: publishedQuestion.id, now: t(20) }),
      "ownership_mismatch",
      403
    );
  });
});

describe("PracticeApiService.getAttemptResult", () => {
  it("returns the submitted result after finalization, including correctAnswer", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(30) });

    const result = await world.service().getAttemptResult(claim, { attemptId });
    expect(result).toMatchObject({ attemptId, status: "submitted", isCorrect: true, correctAnswer: ANSWER_KEY });
  });

  it("returns the skipped result with no correctAnswer", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    await world.service().skipAttempt(claim, { attemptId, questionId: publishedQuestion.id, now: t(20) });

    const result = await world.service().getAttemptResult(claim, { attemptId });
    expect(result).toMatchObject({ status: "skipped", correctAnswer: null });
  });

  it("refuses an attempt still in_progress (invalid_state)", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    await expectCode(world.service().getAttemptResult(claim, { attemptId }), "invalid_state", 409);
  });

  it("rejects a cross-student read (ownership_mismatch), never substituting another student's result", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    await world.service().submitAttempt(claim, { attemptId, questionId: publishedQuestion.id, chosenAnswer: ANSWER_KEY, now: t(30) });

    await expectCode(world.service().getAttemptResult({ studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT }, { attemptId }), "ownership_mismatch", 403);
  });

  it("rejects a nonexistent attempt (not_found)", async () => {
    const world = new World();
    await expectCode(world.service().getAttemptResult(claim, { attemptId: "no-such-attempt" }), "not_found", 404);
  });
});

describe("PracticeApiService.getAutopsyForConfirmation", () => {
  it("returns pending: false when no autopsy has been recorded for this attempt (a valid, ordinary state)", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });

    const view = await world.service().getAutopsyForConfirmation(claim, { attemptId });
    expect(view).toEqual({ attemptId, pending: false, hypothesis: null });
  });

  it("returns the pending hypothesis, safely, without modelConfidence or raw internal signal shapes", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    const stored = makeStoredAutopsy({ attemptId });
    world.autopsy.seed(stored);

    const view = await world.service().getAutopsyForConfirmation(claim, { attemptId });
    expect(view.pending).toBe(true);
    expect(view.hypothesis?.summary).toBe(stored.hypothesisText);
    expect(view.hypothesis?.supportingEvidence).toEqual(["You changed your answer once before submitting."]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("modelConfidence");
    expect(json).not.toContain("high");
    expect(json).not.toContain("behaviorSignals");
    expect(json).not.toContain("errorTaxonomyId");
  });

  it("returns pending: false once the hypothesis has already been confirmed/rejected", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    world.autopsy.seed(makeStoredAutopsy({ attemptId, confirmed: true, confirmedAt: t(50) }));

    const view = await world.service().getAutopsyForConfirmation(claim, { attemptId });
    expect(view).toEqual({ attemptId, pending: false, hypothesis: null });
  });

  it("rejects a cross-student read", async () => {
    const world = new World();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: publishedQuestion.id, now: t(0) });
    await expectCode(world.service().getAutopsyForConfirmation({ studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT }, { attemptId }), "ownership_mismatch", 403);
  });

  it("rejects a nonexistent attempt", async () => {
    const world = new World();
    await expectCode(world.service().getAutopsyForConfirmation(claim, { attemptId: "no-such-attempt" }), "not_found", 404);
  });
});

describe("PracticeApiService — safe error mapping never exposes internal detail", () => {
  it("a PersistenceError's original message is never echoed into the response", async () => {
    const world = new World();
    world.trainingRecommendationOverrides = {
      enrollmentReader: {
        findById: () => Promise.reject(new PersistenceError("invalid_record", "Enrollment \"enrollment-1\" has more than one active PracticeSession -- internal detail"))
      }
    };
    const error = await expectCode(world.service().getNextRecommendation(claim), "infrastructure_failure", 500);
    expect(error.message).not.toContain("PracticeSession");
    expect(error.message).not.toContain("internal detail");
  });

  it("an unrecognized thrown value maps to a generic infrastructure_failure, never a raw error", async () => {
    const world = new World();
    world.trainingRecommendationOverrides = { attemptHistoryReader: { findFinalizedByStudentId: () => Promise.reject("a raw string throw"), findByPracticeBlockId: async () => [] } };
    const error = await expectCode(world.service().getNextRecommendation(claim), "infrastructure_failure", 500);
    expect(error.message).not.toContain("raw string throw");
  });
});
