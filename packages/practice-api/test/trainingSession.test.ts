import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import type { TrainingNextView } from "../src/trainingTypes.js";
import { ANSWER_KEY, CLAIM, COMPLETE_2, COMPLETE_5, CORRECT, ENROLLMENT, OTHER_CLAIM, TIMED_10_MIN, TrainingWorld, WRONG, t } from "./trainingWorld.js";

async function rejection(promise: Promise<unknown>): Promise<PracticeApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PracticeApiError);
    return error as PracticeApiError;
  }
  throw new Error("expected a rejection");
}

function asQuestion(next: TrainingNextView): Extract<TrainingNextView, { status: "question" }> {
  if (next.status !== "question") throw new Error(`expected a question, got ${next.status}`);
  return next;
}

/** A started session on a world whose history already makes Novelty Training applicable. */
async function startedNovelty(config: unknown = COMPLETE_5, novelCount = 4) {
  const world = new TrainingWorld(novelCount);
  const { practice, training } = world.boot();
  await world.seedHistory(practice);
  const { session } = await training.startSession(CLAIM, { systemId: "novelty-training", config, now: t(10_000) });
  return { world, practice, training, session };
}

describe("training hub -- registration and honest availability", () => {
  it("lists all seven dimensions in a fixed order; with no evidence nothing is startable and Revision/Overtraining say not built", async () => {
    const { training } = new TrainingWorld().boot();
    const hub = await training.getHub(CLAIM, { now: t(0) });
    expect(hub.systems.map((s) => s.label)).toEqual(["Calculation", "Speed", "Traps", "Novelty", "Pressure", "Revision", "Overtraining"]);
    expect(hub.systems.filter((s) => s.availability === "available")).toEqual([]);
    expect(hub.systems.find((s) => s.systemId === "revision")?.availability).toBe("not_built");
    expect(hub.systems.find((s) => s.systemId === "novelty-training")?.availability).toBe("not_applicable");
    expect(hub.activeSession).toBeNull();
  });

  it("with real evidence the system that applies is marked available (and only through its own provider)", async () => {
    const world = new TrainingWorld();
    const { practice, training } = world.boot();
    await world.seedHistory(practice);
    const hub = await training.getHub(CLAIM, { now: t(10_000) });
    expect(hub.systems.find((s) => s.systemId === "novelty-training")).toMatchObject({ availability: "available", note: "Ready to train." });
  });
});

describe("starting a session", () => {
  it("creates a persisted, explicit-objective session on the chosen system", async () => {
    const { session } = await startedNovelty();
    expect(session).toMatchObject({
      systemId: "novelty-training",
      dimension: "novelty",
      status: "active",
      completion: { kind: "fixed_question_count", questionCount: 5 },
      progress: { completedQuestionCount: 0, remainingQuestions: 5, hasOpenQuestion: false }
    });
    expect(session.objective.targetConceptName).toBe("Percentages");
    expect(session.objective.statement).toContain("Percentages");
  });

  it("an unknown system is not_found; a system with no engine is refused; one that does not apply is refused -- nothing is created", async () => {
    const world = new TrainingWorld();
    const { practice, training } = world.boot();
    expect((await rejection(training.startSession(CLAIM, { systemId: "nope", config: COMPLETE_5 }))).code).toBe("not_found");
    expect((await rejection(training.startSession(CLAIM, { systemId: "revision", config: COMPLETE_5 }))).code).toBe("invalid_state"); // no engine
    expect((await rejection(training.startSession(CLAIM, { systemId: "novelty-training", config: COMPLETE_5 }))).code).toBe("invalid_state"); // no evidence yet
    await world.seedHistory(practice);
    expect((await rejection(training.startSession(CLAIM, { systemId: "speed-lab", config: COMPLETE_5 }))).code).toBe("invalid_state"); // different system, not applicable
    expect((await training.getHub(CLAIM)).activeSession).toBeNull();
  });

  it("rejects invalid configuration before touching anything", async () => {
    const world = new TrainingWorld();
    const { practice, training } = world.boot();
    await world.seedHistory(practice);
    for (const config of [undefined, null, {}, { completion: { kind: "fixed_question_count", questionCount: 0 } }, { completion: { kind: "fixed_question_count", questionCount: 21 } }, { completion: { kind: "fixed_duration", durationSeconds: 59 } }, { completion: { kind: "x" } }, "5"]) {
      expect((await rejection(training.startSession(CLAIM, { systemId: "novelty-training", config }))).code).toBe("invalid_request");
    }
    expect((await training.getHub(CLAIM)).activeSession).toBeNull();
  });

  it("only one active session: the same system again resumes it (a double click), a different system is refused", async () => {
    const { training, session } = await startedNovelty();
    const again = await training.startSession(CLAIM, { systemId: "novelty-training", config: COMPLETE_2, now: t(10_005) });
    expect(again).toMatchObject({ resumed: true });
    expect(again.session.sessionId).toBe(session.sessionId);
    expect(again.session.completion).toEqual({ kind: "fixed_question_count", questionCount: 5 }); // the original configuration stands
    expect((await rejection(training.startSession(CLAIM, { systemId: "speed-lab", config: COMPLETE_5 }))).code).toBe("invalid_state");
  });

  it("two concurrent starts create exactly one session", async () => {
    const world = new TrainingWorld();
    const { practice, training } = world.boot();
    await world.seedHistory(practice);
    const results = await Promise.all([1, 2, 3, 4].map(() => training.startSession(CLAIM, { systemId: "novelty-training", config: COMPLETE_5, now: t(10_000) })));
    expect(new Set(results.map((r) => r.session.sessionId)).size).toBe(1);
    expect(results.filter((r) => !r.resumed)).toHaveLength(1);
  });
});

describe("the question loop -- the existing attempt lifecycle", () => {
  it("serves a published question from the session's own system, in the session's block, and answers it through the normal practice API", async () => {
    const { world, practice, training, session } = await startedNovelty();
    const next = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(world.novelIds).toContain(next.question.questionId);
    expect(next.session.progress.hasOpenQuestion).toBe(true);

    const submitted = await practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: CORRECT, now: t(10_040) });
    expect(submitted).toMatchObject({ status: "submitted", isCorrect: true, timeSpentSeconds: 30 });

    const stored = await world.attempts.findById(next.attemptId);
    expect(stored?.blockMembership?.practiceBlockId).toBeTruthy();
    expect(stored?.status).toBe("submitted");
    expect(stored?.isCorrect).toBe(true); // derived server-side from the canonical answer, never client-supplied
    expect(stored?.timeSpentSeconds).toBe(30);
  });

  it("never repeats a question within a session; once the qualifying pool is used up it says so honestly (no invented question)", async () => {
    const { practice, training, session } = await startedNovelty(COMPLETE_5, 2);
    const seen: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) }));
      seen.push(q.question.questionId);
      await practice.submitAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, chosenAnswer: WRONG, now: t(10_050 + i * 100) });
    }
    expect(new Set(seen).size).toBe(2);
    const exhausted = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(11_000) });
    expect(exhausted.status).toBe("no_question");
    expect(exhausted.session.status).toBe("active");
  });

  it("a skipped question counts as completed and is never graded", async () => {
    const { practice, training, session } = await startedNovelty(COMPLETE_2);
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(await practice.skipAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, now: t(10_020) })).toMatchObject({ status: "skipped", isCorrect: null });
    const view = await training.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_030) });
    expect(view.progress).toMatchObject({ completedQuestionCount: 1, skippedCount: 1, submittedCount: 0 });
  });

  it("training attempts are ordinary finalized attempts: they feed evidence, history and the next recommendation", async () => {
    const { world, practice, training, session } = await startedNovelty(COMPLETE_2);
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    await practice.submitAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, chosenAnswer: WRONG, now: t(10_050) });

    const evidence = await practice.getAttemptEvidence(CLAIM, { attemptId: q.attemptId });
    expect(evidence.facts).toMatchObject({ verdict: "incorrect", selectedAnswer: WRONG });
    expect(evidence.history?.priorAttempts).toBe(9); // the 9 earlier attempts, not this one

    const history = await world.attempts.findFinalizedByStudentId("student-1");
    expect(history.map((a) => a.id)).toContain(q.attemptId);
    expect((await practice.getNextRecommendation(CLAIM)).questionId).not.toBeUndefined();
  });
});

describe("completion rules", () => {
  it("fixed question count: the session completes after exactly N questions and then serves nothing more", async () => {
    const { practice, training, session } = await startedNovelty(COMPLETE_2);
    for (let i = 0; i < 2; i += 1) {
      const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) }));
      await practice.submitAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, chosenAnswer: CORRECT, now: t(10_050 + i * 100) });
    }
    const done = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_300) });
    expect(done).toMatchObject({ status: "completed", session: { status: "completed", progress: { completedQuestionCount: 2, completionReached: true } } });
    expect((await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_400) })).status).toBe("completed"); // stays final
    expect((await training.getHub(CLAIM)).activeSession).toBeNull();
  });

  it("fixed duration: completes when the SERVER clock passes the budget, regardless of how many questions were answered", async () => {
    const { practice, training, session } = await startedNovelty(TIMED_10_MIN);
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_100) }));
    await practice.submitAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, chosenAnswer: CORRECT, now: t(10_130) });
    expect((await training.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_599) })).progress.completionReached).toBe(false);
    expect((await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_599) })).status).toBe("question");
  });

  it("fixed duration: an expired session completes on the next step; an open question is still answerable first", async () => {
    const { practice, training, session } = await startedNovelty(TIMED_10_MIN);
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_100) }));
    // Time is up while a question is open: that question resumes (it is never silently dropped) ...
    const resumed = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_700) }));
    expect(resumed.attemptId).toBe(q.attemptId);
    await practice.submitAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, chosenAnswer: CORRECT, now: t(10_710) });
    // ... and only then does the session complete.
    expect((await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_720) })).status).toBe("completed");
  });

  it("the student can end a session early, but not while a question is open; ending is idempotent and final", async () => {
    const { practice, training, session } = await startedNovelty();
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect((await rejection(training.finishSession(CLAIM, { sessionId: session.sessionId, now: t(10_020) }))).code).toBe("invalid_state");
    await practice.submitAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, chosenAnswer: CORRECT, now: t(10_030) });
    const ended = await training.finishSession(CLAIM, { sessionId: session.sessionId, now: t(10_040) });
    expect(ended).toMatchObject({ status: "completed", progress: { completedQuestionCount: 1 } });
    expect((await training.finishSession(CLAIM, { sessionId: session.sessionId, now: t(10_050) })).endedAt).toBe(ended.endedAt);
    expect((await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_060) })).status).toBe("completed");
  });

  it("after a session ends, a new one can be started", async () => {
    const { training, session } = await startedNovelty();
    await training.finishSession(CLAIM, { sessionId: session.sessionId, now: t(10_040) });
    const second = await training.startSession(CLAIM, { systemId: "novelty-training", config: COMPLETE_2, now: t(10_100) });
    expect(second.resumed).toBe(false);
    expect(second.session.sessionId).not.toBe(session.sessionId);
  });
});

describe("persistence, restart and concurrency", () => {
  it("a restarted (or second) instance reconstructs the identical session and resumes the same open question", async () => {
    const { world, training, session } = await startedNovelty();
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));

    const restarted = world.boot().training; // fresh services over the same persisted state; no process-local state survives
    const view = await restarted.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_020) });
    expect(view).toEqual(await training.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_020) }));
    expect(view.progress.hasOpenQuestion).toBe(true);
    const resumed = asQuestion(await restarted.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_030) }));
    expect(resumed.attemptId).toBe(q.attemptId);
    expect(resumed.question.questionId).toBe(q.question.questionId);
    expect((await restarted.getHub(CLAIM, { now: t(10_040) })).activeSession?.sessionId).toBe(session.sessionId);
  });

  it("concurrent next calls hand out the same open question, never two", async () => {
    const { world, training, session } = await startedNovelty();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })));
    expect(new Set(results.map((r) => asQuestion(r).attemptId)).size).toBe(1);
    const inBlock = await world.attempts.findByPracticeBlockId((await world.trainingSessions.findById(session.sessionId))!.block.id);
    expect(inBlock).toHaveLength(1);
  });

  it("two instances racing on the same session also converge on one open question", async () => {
    const { world, session } = await startedNovelty();
    const a = world.boot().training;
    const b = world.boot().training;
    const [ra, rb] = await Promise.all([a.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }), b.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })]);
    expect(asQuestion(ra).attemptId).toBe(asQuestion(rb).attemptId);
  });
});

describe("ownership", () => {
  it("another student can neither read, advance nor end a session", async () => {
    const { training, session } = await startedNovelty();
    for (const call of [
      () => training.getSession(OTHER_CLAIM, { sessionId: session.sessionId }),
      () => training.nextQuestion(OTHER_CLAIM, { sessionId: session.sessionId }),
      () => training.finishSession(OTHER_CLAIM, { sessionId: session.sessionId })
    ]) {
      expect((await rejection(call())).code).toBe("ownership_mismatch");
    }
    // ... and a claim that pairs the right student with someone else's enrollment fails the enrollment check.
    expect((await rejection(training.getSession({ studentId: "student-1", enrollmentId: "enrollment-2" }, { sessionId: session.sessionId }))).code).toBe("ownership_mismatch");
  });

  it("an unknown session id is not_found; a blank one is invalid", async () => {
    const { training } = await startedNovelty();
    expect((await rejection(training.getSession(CLAIM, { sessionId: "nope" }))).code).toBe("not_found");
    expect((await rejection(training.getSession(CLAIM, { sessionId: " " }))).code).toBe("invalid_request");
  });

  it("another student's hub never shows this student's session", async () => {
    const { training } = await startedNovelty();
    expect((await training.getHub(OTHER_CLAIM)).activeSession).toBeNull();
  });

  it("a training attempt cannot be placed in someone else's block", async () => {
    const { world, practice, session } = await startedNovelty();
    const block = (await world.trainingSessions.findById(session.sessionId))!.block;
    // Student 2 tries to open an attempt directly in student 1's block: refused by ownership, never silently allowed.
    await expect(practice.startAttempt(OTHER_CLAIM, { questionId: "novel-1", practiceBlockId: block.id, now: t(10_010) })).rejects.toBeInstanceOf(PracticeApiError);
  });
});

describe("published-only, no leakage, no inference", () => {
  it("an unpublished question is never served, even though it matches the target", async () => {
    const world = new TrainingWorld(2);
    world.addDraft("novel-draft");
    const { practice, training } = world.boot();
    await world.seedHistory(practice);
    const { session } = await training.startSession(CLAIM, { systemId: "novelty-training", config: COMPLETE_5, now: t(10_000) });
    const served: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const next = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) });
      if (next.status !== "question") break;
      served.push(next.question.questionId);
      await practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: CORRECT, now: t(10_050 + i * 100) });
    }
    expect(served.sort()).toEqual(["novel-1", "novel-2"]);
  });

  it("no view anywhere carries an answer key, a provider outcome, a requirement, diagnostics, or a score", async () => {
    const { practice, training, session } = await startedNovelty();
    const hub = await training.getHub(CLAIM, { now: t(10_001) });
    const next = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    const everything = JSON.stringify([hub, session, next, await training.getSession(CLAIM, { sessionId: session.sessionId })]);
    expect(everything).not.toContain(ANSWER_KEY);
    for (const banned of ["correctAnswer", "providerId", "providerResult", "requirement", "diagnostics", "groundTruth", "solutionSteps", "score", "rank"]) {
      expect(everything, banned).not.toContain(banned);
    }
    // the answer key only appears AFTER submission, through the existing result view
    const result = await practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: WRONG, now: t(10_050) });
    expect(result.correctAnswer).toBe(ANSWER_KEY);
  });

  it("views describe observable training only: no confidence, emotion, motivation or inferred state", async () => {
    const { training, session } = await startedNovelty();
    const text = JSON.stringify([await training.getHub(CLAIM), session]).toLowerCase();
    for (const banned of ["confidence", "emotion", "motivation", "anxiety", "mood", "careless", "lazy", "intelligen"]) expect(text, banned).not.toContain(banned);
  });

  it("the same persisted state always gives the same hub and the same session (deterministic)", async () => {
    const { world, session } = await startedNovelty();
    const a = world.boot().training;
    const b = world.boot().training;
    expect(await a.getHub(CLAIM, { now: t(10_100) })).toEqual(await b.getHub(CLAIM, { now: t(10_100) }));
    expect(await a.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_100) })).toEqual(await b.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_100) }));
  });

  it("an enrollment that does not belong to the claiming student is refused at the hub", async () => {
    const { training } = await startedNovelty();
    expect((await rejection(training.getHub({ studentId: "student-1", enrollmentId: "enrollment-2" }))).code).toBe("ownership_mismatch");
    expect(ENROLLMENT).toBe("enrollment-1");
  });
});
