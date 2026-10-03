import { describe, expect, it } from "vitest";
import {
  applyMutation,
  assemblePaper,
  buildResult,
  buildSimulationView,
  deriveCurrentAnswers,
  isPastDeadline,
  parseServerTime,
  planAnswer,
  planSettle,
  planSubmit,
  SimulationError,
  startSimulation,
  toFinalizedSimulationEvidence,
  type AnswerContext,
  type AnswerKey,
  type SimulationState
} from "../src/index.js";
import { candidates, DURATION, EXAM, fixtureConfig, fixtureSelection, T0 } from "./fixtures.js";

const ms = (offset: number): string => new Date(Date.parse(T0) + offset).toISOString();
const KEY: AnswerKey = { qa1: { correctAnswer: "11", contentFingerprint: "fp-qa1" }, qa2: { correctAnswer: "22", contentFingerprint: "fp-qa2" }, qb1: { correctAnswer: "33", contentFingerprint: "fp-qb1" } };
const loadKey = async (): Promise<AnswerKey> => KEY;
const ctx = (over: Partial<AnswerContext> = {}): AnswerContext => ({ options: null, currentFingerprint: "fp-qa1", ...over });

function fresh(): SimulationState {
  return startSimulation({ id: "s1", studentId: "stu", enrollmentId: "enr", config: fixtureConfig(), paper: assemblePaper(fixtureConfig(), fixtureSelection(), candidates()), now: T0 });
}
async function answered(state: SimulationState, position: number, answer: string, at: number, fingerprint = `fp-${["qa1", "qa2", "qb1"][position - 1]}`): Promise<SimulationState> {
  const r = await planAnswer(state, { position, answer }, ms(at), ctx({ currentFingerprint: fingerprint }), loadKey);
  expect(r.outcome).toBe("recorded");
  return applyMutation(state, r.mutation);
}

describe("start: the deadline is server time plus the configured duration, exactly", () => {
  it("computes the deadline and starts in progress with no events and no result", () => {
    const s = fresh();
    expect(s).toMatchObject({ status: "in_progress", startedAt: T0, deadlineAt: ms(DURATION * 1000), finalizedAt: null, finalizedBy: null, events: [], result: null, examCode: EXAM });
  });
  it("snapshots the configuration and paper as deep copies: mutating what the caller supplied cannot alter the simulation", () => {
    const config = fixtureConfig();
    const paper = assemblePaper(config, fixtureSelection(), candidates());
    const s = startSimulation({ id: "s", studentId: "a", enrollmentId: "b", config, paper, now: T0 });
    (config as { overallDurationSeconds: number }).overallDurationSeconds = 1;
    (config.sections[0] as { questionCount: number }).questionCount = 99;
    (paper.questions[0] as { questionId: string }).questionId = "tampered";
    expect(s.config.overallDurationSeconds).toBe(DURATION);
    expect(s.config.sections.find((x) => x.sectionName === "Section B")!.questionCount).toBe(1);
    expect(s.paper.questions[0]!.questionId).toBe("qa1");
    expect(s.deadlineAt).toBe(ms(DURATION * 1000));
  });
  it("fails closed on an invalid configuration or an unparseable time", () => {
    const paper = assemblePaper(fixtureConfig(), fixtureSelection(), candidates());
    expect(() => startSimulation({ id: "s", studentId: "a", enrollmentId: "b", config: fixtureConfig({ overallDurationSeconds: 0 }), paper, now: T0 })).toThrow(SimulationError);
    expect(() => startSimulation({ id: "s", studentId: "a", enrollmentId: "b", config: fixtureConfig(), paper, now: "not-a-time" })).toThrow(/not a valid time/);
    expect(() => parseServerTime("", "x")).toThrow(SimulationError);
  });
});

describe("the exclusive deadline: exact boundary behaviour", () => {
  const deadline = DURATION * 1000;
  it("one millisecond before the deadline is not past; at the deadline it is", () => {
    const s = fresh();
    expect(isPastDeadline(s, ms(deadline - 1))).toBe(false);
    expect(isPastDeadline(s, ms(deadline))).toBe(true);
    expect(isPastDeadline(s, ms(deadline + 1))).toBe(true);
  });
  it("an answer 1 ms before the deadline is recorded; at the deadline it is rejected and the simulation expires AT the deadline", async () => {
    const s = fresh();
    expect((await planAnswer(s, { position: 1, answer: "11" }, ms(deadline - 1), ctx(), loadKey)).outcome).toBe("recorded");
    const late = await planAnswer(s, { position: 1, answer: "11" }, ms(deadline), ctx(), loadKey);
    expect(late.outcome).toBe("rejected_expired");
    expect(late.mutation).toMatchObject({ kind: "finalize", status: "expired", finalizedAt: ms(deadline), finalizedBy: "deadline" });
  });
  it("a submit 1 ms before the deadline is `submitted` at that time; at the deadline it is too late and the simulation is `expired` at the deadline", async () => {
    const s = fresh();
    const early = await planSubmit(s, ms(deadline - 1), loadKey);
    expect(early.outcome).toBe("submitted");
    expect(early.mutation).toMatchObject({ kind: "finalize", status: "submitted", finalizedAt: ms(deadline - 1), finalizedBy: "student_submit" });
    const late = await planSubmit(s, ms(deadline), loadKey);
    expect(late.outcome).toBe("expired_before_submit");
    expect(late.mutation).toMatchObject({ kind: "finalize", status: "expired", finalizedAt: ms(deadline), finalizedBy: "deadline" });
  });
  it("expiry finalizes at the deadline however late it is noticed", async () => {
    const s = fresh();
    const { mutation, expired } = await planSettle(s, ms(deadline * 50), loadKey);
    expect(expired).toBe(true);
    expect(mutation).toMatchObject({ kind: "finalize", finalizedAt: ms(deadline) });
    if (mutation.kind === "finalize") expect(mutation.result.timing.elapsedSeconds).toBe(DURATION);
  });
  it("before the deadline settling does nothing", async () => {
    expect((await planSettle(fresh(), ms(5), loadKey)).mutation).toEqual({ kind: "none" });
  });
});

describe("the answer log: explicit, append-only transitions", () => {
  it("records an answer with the server time; the current answer is the last event", async () => {
    let s = fresh();
    s = await answered(s, 1, "10", 1000);
    s = await answered(s, 1, "11", 2000);
    expect(s.events).toEqual([{ position: 1, answer: "10", occurredAt: ms(1000) }, { position: 1, answer: "11", occurredAt: ms(2000) }]);
    expect(deriveCurrentAnswers(s.events).get(1)).toEqual({ answer: "11", firstAnsweredAt: ms(1000), lastAnsweredAt: ms(2000), changes: 1 });
  });
  it("counts only events that CHANGE the answer", async () => {
    let s = fresh();
    for (const [a, t] of [["10", 1], ["10", 2], ["11", 3], ["11", 4], ["10", 5]] as const) s = await answered(s, 1, a, t * 1000);
    expect(deriveCurrentAnswers(s.events).get(1)!.changes).toBe(2);
  });
  it("trims the stored answer and validates text, position and (for multiple choice) the option", async () => {
    const s = fresh();
    const rec = await planAnswer(s, { position: 1, answer: "  11  " }, ms(1), ctx({ options: ["10", "11"] }), loadKey);
    expect(rec.mutation).toMatchObject({ kind: "append_event", event: { answer: "11" } });
    await expect(planAnswer(s, { position: 9, answer: "11" }, ms(1), ctx(), loadKey)).rejects.toMatchObject({ code: "invalid_position" });
    await expect(planAnswer(s, { position: 1, answer: "   " }, ms(1), ctx(), loadKey)).rejects.toMatchObject({ code: "invalid_answer" });
    await expect(planAnswer(s, { position: 1, answer: "x".repeat(501) }, ms(1), ctx(), loadKey)).rejects.toMatchObject({ code: "invalid_answer" });
    await expect(planAnswer(s, { position: 1, answer: "99" }, ms(1), ctx({ options: ["10", "11"] }), loadKey)).rejects.toMatchObject({ code: "invalid_answer" });
  });
  it("refuses an answer to a question whose content changed after the paper was fixed", async () => {
    await expect(planAnswer(fresh(), { position: 1, answer: "11" }, ms(1), ctx({ currentFingerprint: "fp-EDITED" }), loadKey)).rejects.toMatchObject({ code: "question_content_changed" });
    await expect(planAnswer(fresh(), { position: 1, answer: "11" }, ms(1), ctx({ currentFingerprint: null }), loadKey)).rejects.toMatchObject({ code: "question_content_changed" });
  });
  it("a finalized simulation rejects every answer without any change", async () => {
    const s = fresh();
    const done = applyMutation(s, (await planSubmit(s, ms(10), loadKey)).mutation);
    const r = await planAnswer(done, { position: 1, answer: "11" }, ms(20), ctx(), loadKey);
    expect(r).toEqual({ mutation: { kind: "none" }, outcome: "rejected_finalized" });
  });
  it("applyMutation never mutates its input", async () => {
    const s = fresh();
    const frozen = JSON.stringify(s);
    await answered(s, 1, "11", 5);
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe("submission: idempotent and final", () => {
  it("finalizes as submitted, builds the result once, and a repeat is a no-op reporting how it ended", async () => {
    let s = fresh();
    s = await answered(s, 1, "11", 1000);
    const first = await planSubmit(s, ms(5000), loadKey);
    expect(first.outcome).toBe("submitted");
    const done = applyMutation(s, first.mutation);
    expect(done).toMatchObject({ status: "submitted", finalizedAt: ms(5000), finalizedBy: "student_submit" });
    expect(await planSubmit(done, ms(6000), loadKey)).toEqual({ mutation: { kind: "none" }, outcome: "already_submitted" });
    const expired = applyMutation(fresh(), (await planSettle(fresh(), ms(DURATION * 1000), loadKey)).mutation);
    expect(await planSubmit(expired, ms(DURATION * 1000 + 5), loadKey)).toEqual({ mutation: { kind: "none" }, outcome: "already_expired" });
  });
});

describe("the result: raw outcomes only, traceable, no score", () => {
  it("reports per-question and per-section outcomes, timing and totals", async () => {
    let s = fresh();
    s = await answered(s, 1, "10", 1000); // wrong
    s = await answered(s, 1, "11", 2000); // changed to correct
    s = await answered(s, 3, "99", 3000); // wrong
    const r = applyMutation(s, (await planSubmit(s, ms(9000), loadKey)).mutation).result!;
    expect(r.questions.map((q) => [q.position, q.answered, q.isCorrect, q.gradingStatus, q.answerChangeCount])).toEqual([[1, true, true, "graded", 1], [2, false, null, "unanswered", 0], [3, true, false, "graded", 0]]);
    expect(r.sections.map((x) => [x.sectionName, x.answered, x.unanswered, x.correct, x.incorrect])).toEqual([["Section A", 1, 1, 1, 0], ["Section B", 1, 0, 0, 1]]);
    expect(r.totals).toEqual({ questionCount: 3, answered: 2, unanswered: 1, correct: 1, incorrect: 1, notGraded: 0 });
    expect(r.timing).toEqual({ startedAt: T0, deadlineAt: ms(DURATION * 1000), finalizedAt: ms(9000), allowedSeconds: DURATION, elapsedSeconds: 9, finalizedBy: "student_submit" });
    expect(r).toMatchObject({ status: "submitted", isHistoricalPaper: false, interpretation: "none", scoring: { defined: false } });
  });
  it("computes NO score and carries no readiness, mastery, confidence or prediction field", async () => {
    const s = fresh();
    const r = applyMutation(s, (await planSubmit(s, ms(10), loadKey)).mutation).result!;
    const keys: string[] = [];
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); }
    };
    walk(r);
    for (const k of keys) expect(k, k).not.toMatch(/^score$|marks|points|percent|rank|mastery|readiness|confidence|ability|probab|predict/i);
  });
  it("an answer to a question whose content changed is reported not graded - never graded against a different version", () => {
    let s = fresh();
    s = { ...s, events: [{ position: 1, answer: "11", occurredAt: ms(1) }, { position: 2, answer: "22", occurredAt: ms(2) }] };
    const key: AnswerKey = { ...KEY, qa1: { correctAnswer: "11", contentFingerprint: "fp-EDITED" } };
    const r = buildResult(s, { status: "submitted", finalizedAt: ms(10), finalizedBy: "student_submit" }, key);
    expect(r.questions[0]).toMatchObject({ isCorrect: null, gradingStatus: "question_content_changed" });
    expect(r.questions[1]).toMatchObject({ isCorrect: true, gradingStatus: "graded" });
    expect(r.totals).toMatchObject({ answered: 2, correct: 1, notGraded: 1 });
    const missing = buildResult(s, { status: "submitted", finalizedAt: ms(10), finalizedBy: "student_submit" }, {});
    expect(missing.questions[0]!.gradingStatus).toBe("question_content_changed");
  });
  it("is reproducible: the same state, finalization and key give an identical result", () => {
    const s = { ...fresh(), events: [{ position: 2, answer: "22", occurredAt: ms(1) }] };
    const f = { status: "submitted", finalizedAt: ms(10), finalizedBy: "student_submit" } as const;
    expect(buildResult(s, f, KEY)).toEqual(buildResult(s, f, KEY));
  });
});

describe("the student view: never an answer key, never result detail", () => {
  it("shows status and the student's own answers, with remaining seconds from the server clock", async () => {
    let s = fresh();
    s = await answered(s, 2, "22", 1000);
    const v = buildSimulationView(s, ms(30_000));
    expect(v).toMatchObject({ status: "in_progress", remainingSeconds: DURATION - 30, resultAvailable: false });
    expect(v.questions.map((q) => [q.position, q.status, q.chosenAnswer])).toEqual([[1, "unanswered", null], [2, "answered", "22"], [3, "unanswered", null]]);
    expect(v.sections.map((x) => [x.sectionName, x.positions])).toEqual([["Section A", [1, 2]], ["Section B", [3]]]);
    expect(JSON.stringify(v)).not.toMatch(/correct|fingerprint|isCorrect|"11"|provenance/i);
  });
  it("remaining time never goes negative and is 0 once finalized", async () => {
    const s = fresh();
    expect(buildSimulationView(s, ms(DURATION * 1000 * 3)).remainingSeconds).toBe(0);
    const done = applyMutation(s, (await planSubmit(s, ms(10), loadKey)).mutation);
    expect(buildSimulationView(done, ms(11)).remainingSeconds).toBe(0);
    expect(buildSimulationView(done, ms(11)).resultAvailable).toBe(true);
  });
});

describe("the downstream integration contract", () => {
  it("exists only for a FINALIZED simulation, with no score, no chosen answer and no interpretation", async () => {
    const s = fresh();
    expect(() => toFinalizedSimulationEvidence(s)).toThrowError(/Only a finalized simulation/);
    const done = applyMutation(await answered(s, 1, "11", 100), (await planSubmit(await answered(s, 1, "11", 100), ms(900), loadKey)).mutation);
    const e = toFinalizedSimulationEvidence(done);
    expect(e).toMatchObject({ contract: "finalized_simulation_evidence_v1", status: "submitted", isHistoricalPaper: false, interpretation: "none", scoring: { defined: false } });
    expect(JSON.stringify(e)).not.toContain("chosenAnswer");
    expect(e.questions[0]).toMatchObject({ position: 1, isCorrect: expect.any(Boolean) });
  });
});
