import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import type { TrainingNextView } from "../src/trainingTypes.js";
import { ANSWER_KEY, CLAIM, COMPLETE_2, CORRECT, OTHER_CLAIM, WRONG, TrainingWorld, t, type WorldQuestion } from "./trainingWorld.js";

/**
 * Phase 5 Unit 2 -- Calculation Gym as a real training system inside the Unit 1 session framework. Everything here runs the REAL
 * `@ipmat/calculation-gym` provider (applicability, stage progression, selection) through the real recommendation composition and the real
 * in-memory repositories; nothing about the provider is faked. The pool is shaped (TEST DATA) so each stage is reachable:
 *   history  L1-L3  low load (0.2)           H1-H3 high load (0.8)
 *   fresh    F1-F4  low load, direct         Fm  low load, MULTI-STEP (never a foundational question)
 *            M1-M5  high load, direct        TP1-TP3 high load, TIME-PRESSURED
 */
type Pool = WorldQuestion[];

function q(id: string, load: number, modes: WorldQuestion["modes"] = ["direct"], extra: Partial<WorldQuestion> = {}): WorldQuestion {
  return { id, noveltyLevel: "standard", load, modes, ...extra };
}
const HISTORY = ["L1", "L2", "L3", "H1", "H2", "H3"];
function basePool(): Pool {
  return [
    ...["L1", "L2", "L3"].map((id) => q(id, 0.2)),
    ...["H1", "H2", "H3"].map((id) => q(id, 0.8)),
    ...["F1", "F2", "F3", "F4"].map((id) => q(id, 0.2)),
    q("Fm", 0.1, ["multi_step"]),
    ...["M1", "M2", "M3", "M4", "M5"].map((id) => q(id, 0.8)),
    ...["TP1", "TP2", "TP3"].map((id) => q(id, 0.9, ["time_pressured"]))
  ];
}
const FRESH_LOW = ["F1", "F2", "F3", "F4"];
const MIXED_SET = ["M1", "M2", "M3", "M4", "M5"];
const TP_SET = ["TP1", "TP2", "TP3"];

// Real histories (answered through the ordinary practice flow). Friction needs >= 3 per slice and low - high >= 0.2.
const FOUNDATIONAL_HISTORY = [{ id: "L1", correct: true }, { id: "L2", correct: true }, { id: "L3", correct: false }, { id: "H1", correct: false }, { id: "H2", correct: false }, { id: "H3", correct: false }]; // low 0.67 < 0.75
const MIXED_HISTORY = [{ id: "L1", correct: true }, { id: "L2", correct: true }, { id: "L3", correct: true }, { id: "H1", correct: true }, { id: "H2", correct: true }, { id: "H3", correct: false }]; // low cleared; high 0.67 < 0.75

async function boot(pool: Pool = basePool(), plan = MIXED_HISTORY) {
  const world = new TrainingWorld(0, pool);
  const services = world.boot();
  await world.answer(services.practice, plan);
  return { world, ...services };
}
async function start(training: ReturnType<TrainingWorld["boot"]>["training"], config: unknown = { completion: { kind: "fixed_question_count", questionCount: 5 } }) {
  return (await training.startSession(CLAIM, { systemId: "calculation-gym", config, now: t(10_000) })).session;
}
function asQuestion(next: TrainingNextView): Extract<TrainingNextView, { status: "question" }> {
  if (next.status !== "question") throw new Error(`expected a question, got ${next.status}`);
  return next;
}
async function rejection(promise: Promise<unknown>): Promise<PracticeApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PracticeApiError);
    return error as PracticeApiError;
  }
  throw new Error("expected a rejection");
}

describe("Calculation Gym -- catalog, availability and the objective", () => {
  it("is the first genuinely usable card: a deliberate-practice description, available only when the provider's own evidence rule is met", async () => {
    const world = new TrainingWorld(0, basePool());
    const { practice, training } = world.boot();
    const before = (await training.getHub(CLAIM, { now: t(0) })).systems.find((s) => s.systemId === "calculation-gym")!;
    expect(before).toMatchObject({ label: "Calculation", dimension: "calculation", availability: "not_applicable" });
    expect(before.trains).toContain("Deliberate calculation practice");
    expect(before.note).toBe("Needs recorded answers on both lighter and heavier-arithmetic questions of the same concept first.");
    await world.answer(practice, MIXED_HISTORY);
    const after = (await training.getHub(CLAIM, { now: t(10_000) })).systems.find((s) => s.systemId === "calculation-gym")!;
    expect(after).toMatchObject({ availability: "available", note: "Ready to train." });
  });

  it("applicability is the provider's, not weakened: too little evidence in EITHER slice, or no gap, is not applicable", async () => {
    const tooFewHigh = [{ id: "L1", correct: true }, { id: "L2", correct: true }, { id: "L3", correct: true }, { id: "H1", correct: false }, { id: "H2", correct: false }];
    const noGap = [{ id: "L1", correct: true }, { id: "L2", correct: true }, { id: "L3", correct: true }, { id: "H1", correct: true }, { id: "H2", correct: true }, { id: "H3", correct: true }];
    for (const plan of [tooFewHigh, noGap]) {
      const { training } = await boot(basePool(), plan);
      expect((await training.getHub(CLAIM, { now: t(10_000) })).systems.find((s) => s.systemId === "calculation-gym")!.availability).toBe("not_applicable");
      expect((await rejection(training.startSession(CLAIM, { systemId: "calculation-gym", config: COMPLETE_2 }))).code).toBe("invalid_state");
    }
  });

  it("the objective is explicit and observational: calculation practice on the concept the provider targeted, with the current stage", async () => {
    const { training } = await boot();
    const session = await start(training);
    expect(session).toMatchObject({ systemId: "calculation-gym", systemLabel: "Calculation", dimension: "calculation" });
    expect(session.objective.targetConceptName).toBe("Percentages");
    expect(session.objective.statement).toBe("Deliberate calculation practice: accuracy on questions that need heavier arithmetic. Focus: Percentages.");
    expect(session.stage).toMatchObject({ key: "mixed", label: "Stage 2 · Heavier arithmetic", position: 2, total: 3 });
  });
});

describe("Calculation Gym -- each stage serves its own kind of question (stage selection)", () => {
  it("stage 1 (foundational): only lighter, single-step questions -- never the heavy, multi-step or time-pressured ones", async () => {
    const { training } = await boot(basePool(), FOUNDATIONAL_HISTORY);
    const session = await start(training);
    expect(session.stage?.key).toBe("foundational");
    const served = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(FRESH_LOW).toContain(served.question.questionId);
    expect(served.session.stage?.key).toBe("foundational");
    expect(served.stageTransition).toBeNull(); // the first question has no previous stage
  });

  it("stage 2 (mixed): only heavier questions that are not time-pressured", async () => {
    const { training } = await boot();
    const session = await start(training);
    const served = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(MIXED_SET).toContain(served.question.questionId);
    expect(served.session.stage?.key).toBe("mixed");
  });

  it("stage 3 (time_pressured): only heavy questions built to be timed", async () => {
    const stage3 = [{ id: "L1", correct: true }, { id: "L2", correct: true }, { id: "L3", correct: true }, { id: "H1", correct: true }, { id: "H2", correct: true }, { id: "H3", correct: true }, { id: "M1", correct: false }];
    // high-load non-time-pressured: H1,H2,H3,M1 -> 3/4 = 0.75 (cleared); low 1.0 -> gap 0.25 (friction still present)
    const { training } = await boot(basePool(), stage3);
    const session = await start(training);
    expect(session.stage?.key).toBe("time_pressured");
    const served = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(TP_SET).toContain(served.question.questionId);
  });

  it("selection never depends on the order candidates are stored in, and is repeatable (no randomness)", async () => {
    const forward = await boot(basePool());
    const reversed = await boot([...basePool()].reverse());
    const a = asQuestion(await forward.training.nextQuestion(CLAIM, { sessionId: (await start(forward.training)).sessionId, now: t(10_010) }));
    const b = asQuestion(await reversed.training.nextQuestion(CLAIM, { sessionId: (await start(reversed.training)).sessionId, now: t(10_010) }));
    expect(a.question.questionId).toBe(b.question.questionId);
  });

  it("a malformed candidate is excluded, never served and never a crash", async () => {
    const pool = [...basePool().filter((p) => !MIXED_SET.includes(p.id)), q("Mbad", 0.8, ["direct"], { malformed: true }), q("M1", 0.8)];
    const { training } = await boot(pool);
    const session = await start(training);
    const served = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(served.question.questionId).toBe("M1");
  });
});

describe("Calculation Gym -- progression through a session, derived and reconstructible", () => {
  async function toStageThree() {
    const env = await boot(); // mixed; high-load non-TP history: H1 H2 correct, H3 wrong (2/3)
    const session = await start(env.training);
    const q1 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(q1.stageTransition).toBeNull();
    // one more correct heavy answer -> 3/4 = 0.75: the mixed -> time_pressured gate is met by the recorded evidence
    await env.practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(10_040) });
    return { ...env, session, q1 };
  }

  it("a stage change mid-session is announced on the next question, with authored, threshold-free copy", async () => {
    const { training, session, q1 } = await toStageThree();
    const q2 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_050) }));
    expect(TP_SET).toContain(q2.question.questionId);
    expect(q2.question.questionId).not.toBe(q1.question.questionId);
    expect(q2.stageTransition).toMatchObject({
      direction: "forward",
      from: { key: "mixed", position: 2 },
      to: { key: "time_pressured", label: "Stage 3 · Under time pressure", position: 3 },
      note: "Your recorded answers at the previous stage met this training's requirement for moving on."
    });
    expect(q2.session.stage?.key).toBe("time_pressured");
    expect(JSON.stringify(q2.stageTransition)).not.toMatch(/0\.75|75|threshold|accuracy|score|improv/i);
  });

  it("stage and the transition are reconstructed identically after a restart (derived from persisted rows, nothing stored)", async () => {
    const { world, training, session } = await toStageThree();
    const q2 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_050) }));
    const restarted = world.boot().training;
    const again = asQuestion(await restarted.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_060) })); // resumes the SAME open question
    expect(again.attemptId).toBe(q2.attemptId);
    expect(again.stageTransition).toEqual(q2.stageTransition);
    expect(again.session.stage).toEqual(q2.session.stage);
    expect((await restarted.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_070) })).stage).toEqual(q2.session.stage);
  });

  it("no stage is stored anywhere: the session record holds only the system, objective and configuration", async () => {
    const { world, session } = await toStageThree();
    const stored = (await world.trainingSessions.findById(session.sessionId))!;
    expect(Object.keys(stored).sort()).toEqual(["block", "config", "createdAt", "enrollmentId", "id", "objective", "studentId", "systemId"]);
    expect(JSON.stringify(stored)).not.toMatch(/stage|time_pressured|foundational/);
  });
});

describe("Calculation Gym -- the one attempt lifecycle, evidence and history", () => {
  it("correct, incorrect and skipped answers are ordinary attempts with server-derived verdicts and timing, inside the session's block", async () => {
    const { world, practice, training } = await boot();
    const session = await start(training, { completion: { kind: "fixed_question_count", questionCount: 3 } });
    const q1 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    const r1 = await practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(10_041) });
    expect(r1).toMatchObject({ status: "submitted", isCorrect: true, timeSpentSeconds: 31 });
    const q2 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_050) }));
    const r2 = await practice.submitAttempt(CLAIM, { attemptId: q2.attemptId, questionId: q2.question.questionId, chosenAnswer: WRONG, now: t(10_100) });
    expect(r2).toMatchObject({ status: "submitted", isCorrect: false, timeSpentSeconds: 50 });
    const q3 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_110) }));
    expect(await practice.skipAttempt(CLAIM, { attemptId: q3.attemptId, questionId: q3.question.questionId, now: t(10_120) })).toMatchObject({ status: "skipped", isCorrect: null });

    const block = (await world.trainingSessions.findById(session.sessionId))!.block;
    const inBlock = await world.attempts.findByPracticeBlockId(block.id);
    expect(inBlock.map((a) => [a.status, a.isCorrect, a.blockMembership?.blockSequenceNumber])).toEqual([["submitted", true, 1], ["submitted", false, 2], ["skipped", null, 3]]);

    // evidence for a training attempt is the ordinary evidence; history counts it like any other attempt
    expect((await practice.getAttemptEvidence(CLAIM, { attemptId: q2.attemptId })).facts).toMatchObject({ verdict: "incorrect", elapsedSeconds: 50, expectedSeconds: 90 });
    const finalized = await world.attempts.findFinalizedByStudentId("student-1");
    expect(finalized).toHaveLength(HISTORY.length + 3);
    expect(finalized.map((a) => a.id)).toEqual(expect.arrayContaining([q1.attemptId, q2.attemptId, q3.attemptId]));
  });

  it("training attempts change what the provider sees next -- through the ordinary evidence, with no calculation-specific record anywhere", async () => {
    const { world, training, practice } = await boot();
    const session = await start(training);
    const q1 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    await practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(10_040) });
    expect((await training.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_050) })).stage?.key).toBe("time_pressured"); // evidence moved the stage
    const all = await world.attempts.findFinalizedByStudentId("student-1");
    expect(all.every((a) => Object.keys(a).every((k) => !/calc|gym|stage/i.test(k)))).toBe(true);
  });
});

describe("Calculation Gym -- completion and the observable summary", () => {
  it("a fixed-length session completes with observable counts, timing and the current stage -- and claims nothing else", async () => {
    const { practice, training } = await boot();
    const session = await start(training, COMPLETE_2);
    const q1 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    await practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(10_040) }); // 30 s
    const q2 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_050) }));
    await practice.submitAttempt(CLAIM, { attemptId: q2.attemptId, questionId: q2.question.questionId, chosenAnswer: WRONG, now: t(10_110) }); // 60 s
    const done = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_120) });
    expect(done.status).toBe("completed");
    expect(done.session).toMatchObject({
      status: "completed",
      summary: { submittedCount: 2, skippedCount: 0, correctCount: 1, incorrectCount: 1, totalTimeSeconds: 90, expectedTimeSeconds: 180 },
      stage: { key: "time_pressured" }
    });
    const text = JSON.stringify(done).toLowerCase();
    for (const banned of ["mastery", "improv", "weakness", "confidence", "guarantee", "permanent", "ability", "score"]) expect(text, banned).not.toContain(banned);
  });
});

describe("Calculation Gym -- honest behavior when content is short", () => {
  it("no qualifying published question for the current stage: the start is refused and the hub says so -- never a different kind of question dressed as Calculation", async () => {
    // Evidence is real (answered while the heavy questions were ordinary ones); the catalogue then changes so that every heavy question
    // is a timed one. The student is still at stage 2, which serves no timed question -- and the lighter/timed ones must NOT be substituted.
    const world = new TrainingWorld(0, basePool().filter((p) => !MIXED_SET.includes(p.id)));
    const { practice } = world.boot();
    await world.answer(practice, MIXED_HISTORY);
    for (const p of world.pool) if (p.id.startsWith("H")) p.modes = ["time_pressured"];
    const { training } = world.boot();
    const hub = await training.getHub(CLAIM, { now: t(10_000) });
    expect(hub.systems.find((s) => s.systemId === "calculation-gym")!.availability).toBe("no_eligible_question");
    expect((await rejection(training.startSession(CLAIM, { systemId: "calculation-gym", config: COMPLETE_2 }))).code).toBe("invalid_state");
    expect((await training.getHub(CLAIM)).activeSession).toBeNull();
  });

  it("the stage's pool running out mid-session ends it honestly (no_question), serving nothing from another stage", async () => {
    const pool = basePool().filter((p) => !["M2", "M3", "M4", "M5"].includes(p.id)); // stage-2 questions left: M1, H1, H2, H3
    const { practice, training } = await boot(pool);
    const session = await start(training, { completion: { kind: "fixed_question_count", questionCount: 10 } });
    const served: string[] = [];
    let last: TrainingNextView = { status: "completed", session } as TrainingNextView;
    for (let i = 0; i < 8; i += 1) {
      last = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) });
      if (last.status !== "question") break;
      served.push(last.question.questionId);
      await practice.submitAttempt(CLAIM, { attemptId: last.attemptId, questionId: last.question.questionId, chosenAnswer: WRONG, now: t(10_050 + i * 100) }); // wrong answers keep the stage at 2
    }
    expect([...served].sort()).toEqual(["H1", "H2", "H3", "M1"]);
    expect(last.status).toBe("no_question");
    expect(last.session.status).toBe("active");
    for (const id of served) expect([...FRESH_LOW, ...TP_SET, "Fm"]).not.toContain(id);
  });

  it("an unpublished question is never served as Calculation", async () => {
    const pool = [...basePool(), q("Mdraft", 0.8, ["direct"], { validationState: "ai_validated" })];
    const { practice, training } = await boot(pool);
    const session = await start(training, { completion: { kind: "fixed_question_count", questionCount: 10 } });
    const served: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) });
      if (next.status !== "question") break;
      served.push(next.question.questionId);
      await practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: WRONG, now: t(10_050 + i * 100) });
    }
    expect(served.length).toBeGreaterThan(2);
    expect(served).not.toContain("Mdraft");
  });
});

describe("Calculation Gym -- no repeats, ownership, concurrency, leakage", () => {
  it("never repeats a question within a session", async () => {
    const { practice, training } = await boot();
    const session = await start(training, { completion: { kind: "fixed_question_count", questionCount: 5 } });
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const next = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) });
      if (next.status !== "question") break;
      seen.push(next.question.questionId);
      await practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: WRONG, now: t(10_050 + i * 100) });
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("another student can neither read nor advance a Calculation session", async () => {
    const { training } = await boot();
    const session = await start(training);
    for (const call of [() => training.getSession(OTHER_CLAIM, { sessionId: session.sessionId }), () => training.nextQuestion(OTHER_CLAIM, { sessionId: session.sessionId })]) {
      expect((await rejection(call())).code).toBe("ownership_mismatch");
    }
  });

  it("concurrent next calls (one instance and two) hand out one open question and create one attempt", async () => {
    const { world, training } = await boot();
    const session = await start(training);
    const other = world.boot().training;
    const results = await Promise.all([1, 2, 3].map(() => training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })).concat([other.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })]));
    expect(new Set(results.map((r) => asQuestion(r).attemptId)).size).toBe(1);
    expect(await world.attempts.findByPracticeBlockId((await world.trainingSessions.findById(session.sessionId))!.block.id)).toHaveLength(1);
  });

  it("no view leaks an answer key, provider internals, thresholds or a score; no psychological wording", async () => {
    const { practice, training } = await boot();
    const session = await start(training);
    const q1 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    await practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(10_040) });
    const q2 = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_050) });
    const text = JSON.stringify([await training.getHub(CLAIM), session, q1, q2, await training.getSession(CLAIM, { sessionId: session.sessionId })]);
    expect(text).not.toContain(ANSWER_KEY);
    for (const banned of ["correctAnswer", "providerId", "providerResult", "\"requirement\"", "diagnostics", "computationalLoad", "frictionDetected", "minComputationalLoad", "excludeTimePressured", "STAGE_MASTERY", "threshold", "reason"]) {
      expect(text, banned).not.toContain(banned);
    }
    for (const banned of ["confidence", "emotion", "motivation", "anxiety", "mood", "careless", "lazy", "intelligen", "struggle", "bad at"]) {
      expect(text.toLowerCase(), banned).not.toContain(banned);
    }
  });

  it("adds no new score: no view anywhere has a score/rank/rating/index field", async () => {
    const { training } = await boot();
    const session = await start(training);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k.toLowerCase()); walk(v); }
    };
    walk([await training.getHub(CLAIM), session, await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })]);
    for (const key of keys) expect(key, key).not.toMatch(/score|rank|rating|index|percent/);
  });
});
