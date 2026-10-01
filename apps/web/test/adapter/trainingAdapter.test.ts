import { describe, expect, it } from "vitest";
import type { FetchLike } from "../../src/http.js";
import { createApiTrainingAdapter } from "../../src/adapter/apiTrainingAdapter.js";

interface Call {
  url: string;
  init?: RequestInit;
}

function routedFetch(routes: Record<string, { ok: boolean; status: number; body: unknown }>): { calls: Call[]; fetchImpl: FetchLike } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const response = key ? routes[key]! : { ok: false, status: 500, body: { error: { code: "infrastructure_failure", message: "boom" } } };
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  return { calls, fetchImpl };
}

const SESSION = {
  sessionId: "s-1",
  systemId: "novelty-training",
  systemLabel: "Novelty",
  systemTitle: "Novelty training",
  dimension: "novelty",
  objective: { statement: "Unfamiliar twists. Focus: Percentages.", targetConceptName: "Percentages" },
  status: "active",
  completion: { kind: "fixed_question_count", questionCount: 5 },
  progress: { completedQuestionCount: 0, submittedCount: 0, skippedCount: 0, elapsedSeconds: 0, remainingQuestions: 5, remainingSeconds: null, completionReached: false, hasOpenQuestion: true },
  stage: null,
  summary: { submittedCount: 0, skippedCount: 0, correctCount: 0, incorrectCount: 0, totalTimeSeconds: 0, expectedTimeSeconds: 0 },
  startedAt: "2026-10-01T10:00:00.000Z",
  endedAt: null
};
const STAGE_2 = { key: "mixed", label: "Stage 2 · Heavier arithmetic", summary: "Questions with more demanding calculation.", position: 2, total: 3 };
const STAGE_3 = { key: "time_pressured", label: "Stage 3 · Under time pressure", summary: "Demanding calculation on questions built to be timed.", position: 3, total: 3 };
const QUESTION = { questionId: "q-1", chapterName: "Percentages", conceptName: "Percentages", prompt: "Find the base.", answerFormat: "multiple_choice", options: ["A", "B"], expectedTimeSeconds: 60 };
const HUB = {
  systems: [
    { systemId: "novelty-training", dimension: "novelty", label: "Novelty", trains: "Unfamiliar twists.", availability: "available", note: "Ready to train." },
    { systemId: "revision", dimension: "revision", label: "Revision", trains: "Revisiting.", availability: "not_built", note: "Not built yet." }
  ],
  activeSession: null
};

describe("createApiTrainingAdapter -- training sessions (Phase 5 Unit 1)", () => {
  it("getTrainingHub GETs /v1/training/systems and maps systems and the active session", async () => {
    const { calls, fetchImpl } = routedFetch({ "/v1/training/systems": { ok: true, status: 200, body: { ...HUB, activeSession: SESSION } } });
    const hub = await createApiTrainingAdapter(fetchImpl).getTrainingHub();
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(hub.systems.map((s) => s.availability)).toEqual(["available", "not_built"]);
    expect(hub.activeSession?.sessionId).toBe("s-1");
  });

  it("rejects a malformed hub (unknown availability) instead of guessing", async () => {
    const bad = { systems: [{ ...HUB.systems[0], availability: "maybe" }], activeSession: null };
    const { fetchImpl } = routedFetch({ "/v1/training/systems": { ok: true, status: 200, body: bad } });
    await expect(createApiTrainingAdapter(fetchImpl).getTrainingHub()).rejects.toBeTruthy();
  });

  it("startTrainingSession sends ONLY the system and the completion rule -- no identity, no clock, no block", async () => {
    const { calls, fetchImpl } = routedFetch({ "/v1/training/sessions": { ok: true, status: 200, body: { session: SESSION, resumed: false } } });
    const result = await createApiTrainingAdapter(fetchImpl).startTrainingSession({ systemId: "novelty-training", completion: { kind: "fixed_question_count", questionCount: 5 } });
    expect(result).toMatchObject({ resumed: false, session: { sessionId: "s-1" } });
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ systemId: "novelty-training", config: { completion: { kind: "fixed_question_count", questionCount: 5 } } });
    expect(calls[0]!.init!.body as string).not.toMatch(/studentId|enrollmentId|now|practiceBlockId/);
  });

  it("nextTrainingQuestion registers the server-started attempt so the normal submit acts on it", async () => {
    const { calls, fetchImpl } = routedFetch({
      "/v1/training/sessions/s-1/next": { ok: true, status: 200, body: { status: "question", session: SESSION, attemptId: "att-7", question: QUESTION, elapsedSeconds: 12 } },
      "/v1/attempts/att-7/submit": { ok: true, status: 200, body: { status: "submitted", attemptId: "att-7", questionId: "q-1", isCorrect: true, chosenAnswer: "A", correctAnswer: "A", timeSpentSeconds: 20 } }
    });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const next = await adapter.nextTrainingQuestion("s-1");
    expect(next).toMatchObject({ status: "question", question: { questionId: "q-1", elapsedSeconds: 12 } });
    const result = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 999 });
    expect(result.attemptId).toBe("att-7");
    const submitCall = calls.find((c) => c.url.includes("/v1/attempts/att-7/submit"))!;
    expect(JSON.parse(submitCall.init!.body as string)).toEqual({ questionId: "q-1", chosenAnswer: "A" }); // the client duration is never sent
  });

  it("maps a stage, a stage transition and the observable summary; a missing stage is null", async () => {
    const calc = { ...SESSION, systemId: "calculation-gym", systemLabel: "Calculation", systemTitle: "Calculation Gym", stage: STAGE_3, summary: { submittedCount: 2, skippedCount: 1, correctCount: 1, incorrectCount: 1, totalTimeSeconds: 90, expectedTimeSeconds: 180 } };
    const transition = { from: STAGE_2, to: STAGE_3, direction: "forward", note: "Your recorded answers at the previous stage met this training's requirement for moving on." };
    const { fetchImpl } = routedFetch({ "/next": { ok: true, status: 200, body: { status: "question", session: calc, attemptId: "att-1", question: QUESTION, elapsedSeconds: 0, stageTransition: transition } } });
    const next = await createApiTrainingAdapter(fetchImpl).nextTrainingQuestion("s-1");
    if (next.status !== "question") throw new Error("expected question");
    expect(next.session).toMatchObject({ systemTitle: "Calculation Gym", stage: { position: 3, label: "Stage 3 · Under time pressure" }, summary: { correctCount: 1, totalTimeSeconds: 90 } });
    expect(next.stageTransition).toMatchObject({ direction: "forward", from: { key: "mixed" }, to: { key: "time_pressured" } });
    const none = routedFetch({ "/next": { ok: true, status: 200, body: { status: "question", session: SESSION, attemptId: "att-2", question: QUESTION, elapsedSeconds: 0, stageTransition: null } } });
    const plain = await createApiTrainingAdapter(none.fetchImpl).nextTrainingQuestion("s-9");
    expect(plain.status === "question" && plain.stageTransition === null && plain.session.stage === null).toBe(true);
  });

  it("a session without its observable summary, or a malformed stage / transition, is rejected rather than guessed", async () => {
    const noSummary = { ...SESSION } as Record<string, unknown>;
    delete noSummary.summary;
    for (const body of [noSummary, { ...SESSION, stage: { key: "mixed" } }]) {
      const { fetchImpl } = routedFetch({ "/v1/training/sessions/s-1": { ok: true, status: 200, body } });
      await expect(createApiTrainingAdapter(fetchImpl).getTrainingSession("s-1")).rejects.toBeTruthy();
    }
    const badTransition = routedFetch({ "/next": { ok: true, status: 200, body: { status: "question", session: SESSION, attemptId: "a", question: QUESTION, elapsedSeconds: 0, stageTransition: { from: STAGE_2, to: STAGE_3, direction: "sideways", note: "x" } } } });
    await expect(createApiTrainingAdapter(badTransition.fetchImpl).nextTrainingQuestion("s-3")).rejects.toBeTruthy();
  });

  it("maps completed and no_question steps", async () => {
    const done = routedFetch({ "/next": { ok: true, status: 200, body: { status: "completed", session: { ...SESSION, status: "completed" } } } });
    expect((await createApiTrainingAdapter(done.fetchImpl).nextTrainingQuestion("s-1")).status).toBe("completed");
    const none = routedFetch({ "/next": { ok: true, status: 200, body: { status: "no_question", session: SESSION, message: "No further question." } } });
    expect(await createApiTrainingAdapter(none.fetchImpl).nextTrainingQuestion("s-1")).toMatchObject({ status: "no_question", message: "No further question." });
  });

  it("a question step without an attempt id is malformed -- an error, never an unanswerable screen", async () => {
    const { fetchImpl } = routedFetch({ "/next": { ok: true, status: 200, body: { status: "question", session: SESSION, question: QUESTION } } });
    await expect(createApiTrainingAdapter(fetchImpl).nextTrainingQuestion("s-1")).rejects.toBeTruthy();
  });

  it("concurrent nextTrainingQuestion calls for one session share a single request", async () => {
    const { calls, fetchImpl } = routedFetch({ "/next": { ok: true, status: 200, body: { status: "question", session: SESSION, attemptId: "att-1", question: QUESTION, elapsedSeconds: 0 } } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await Promise.all([adapter.nextTrainingQuestion("s-1"), adapter.nextTrainingQuestion("s-1")]);
    expect(calls.filter((c) => c.url.includes("/next"))).toHaveLength(1);
  });

  it("finish and get map a session; a server error surfaces as a rejection", async () => {
    const ok = routedFetch({ "/finish": { ok: true, status: 200, body: { ...SESSION, status: "completed" } }, "/v1/training/sessions/s-1": { ok: true, status: 200, body: SESSION } });
    const adapter = createApiTrainingAdapter(ok.fetchImpl);
    expect((await adapter.finishTrainingSession("s-1")).status).toBe("completed");
    expect((await adapter.getTrainingSession("s-1")).sessionId).toBe("s-1");
    const bad = routedFetch({ "/finish": { ok: false, status: 409, body: { error: { code: "invalid_state", message: "open question" } } } });
    await expect(createApiTrainingAdapter(bad.fetchImpl).finishTrainingSession("s-1")).rejects.toBeTruthy();
  });
});
