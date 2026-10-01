import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import type { TrainingNextView } from "../src/trainingTypes.js";
import { ANSWER_KEY, CLAIM, COMPLETE_2, CORRECT, OTHER_CLAIM, WRONG, TrainingWorld, t, type WorldQuestion } from "./trainingWorld.js";

/**
 * Phase 5 Unit 3 -- Speed Lab as the second real training system inside the Unit 1/2 session framework. Everything runs the REAL
 * `@ipmat/speed-lab` provider (applicability, stage progression, selection) through the real recommendation composition and the real
 * in-memory repositories; nothing about the provider is faked. TEST DATA pool (concept "Percentages", expected time 90 s for every question):
 *   history   A1-A4   light (conceptualLoad 0.2)             -- answered SLOWLY and correctly => the applicability trigger
 *   stage 1   S1-S5   light, direct        SX  light, TIMED (never a steady/mixed question)
 *   stage 2   X1-X4   conceptually heavier (0.7), direct
 *   stage 3   T1-T3   carry the time_pressured testing mode
 */
type Pool = WorldQuestion[];
function q(id: string, conceptual: number, modes: WorldQuestion["modes"] = ["direct"], extra: Partial<WorldQuestion> = {}): WorldQuestion {
  return { id, noveltyLevel: "standard", conceptual, modes, ...extra };
}
function basePool(): Pool {
  return [
    ...["A1", "A2", "A3", "A4"].map((id) => q(id, 0.2)),
    ...["S1", "S2", "S3", "S4", "S5"].map((id) => q(id, 0.2)),
    q("SX", 0.1, ["time_pressured"]),
    ...["X1", "X2", "X3", "X4"].map((id) => q(id, 0.7)),
    ...["T1", "T2", "T3"].map((id) => q(id, 0.3, ["time_pressured"]))
  ];
}
const STEADY_SET = ["S1", "S2", "S3", "S4", "S5", "A1", "A2", "A3", "A4"]; // light, non-timed (history ones are legitimately re-servable, least-exposed first)
const MIXED_SET = ["X1", "X2", "X3", "X4"];
const TIMED_SET = ["T1", "T2", "T3", "SX"];

// Applicability trigger: 4 eligible attempts, all correct and SLOW (200 s on 90 s expected = ratio 2.2 >= the canonical slow boundary).
const SLOW_HISTORY = ["A1", "A2", "A3", "A4"].map((id) => ({ id, correct: true, seconds: 200 }));
// Three good-pace (<= expected) correct answers on light questions clear the steady gate.
const STEADY_CLEARED = [...SLOW_HISTORY, ...["S1", "S2", "S3"].map((id) => ({ id, correct: true, seconds: 40 }))];
// ... and three good-pace correct answers on conceptually heavier questions clear the mixed gate (heavy attempts are not in the applicability population).
const MIXED_CLEARED = [...STEADY_CLEARED, ...["X1", "X2", "X3"].map((id) => ({ id, correct: true, seconds: 40 }))];

async function boot(pool: Pool = basePool(), plan: Array<{ id: string; correct: boolean; seconds?: number }> = SLOW_HISTORY) {
  const world = new TrainingWorld(0, pool);
  const services = world.boot();
  await world.answer(services.practice, plan);
  return { world, ...services };
}
async function start(training: ReturnType<TrainingWorld["boot"]>["training"], config: unknown = { completion: { kind: "fixed_question_count", questionCount: 10 } }) {
  return (await training.startSession(CLAIM, { systemId: "speed-lab", config, now: t(10_000) })).session;
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
/** Serves the next question and answers it correctly in `seconds` (server-measured from the supplied clock). */
async function serveAndAnswer(env: Awaited<ReturnType<typeof boot>>, sessionId: string, at: number, seconds = 30, answer = CORRECT) {
  const next = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId, now: t(at) }));
  await env.practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: answer, now: t(at + seconds) });
  return next;
}

describe("Speed Lab -- the Training Hub and the objective", () => {
  it("appears as a deliberate-training card beside Calculation; startable only when the provider's own evidence rule is met", async () => {
    const world = new TrainingWorld(0, basePool());
    const { practice, training } = world.boot();
    const before = (await training.getHub(CLAIM, { now: t(0) })).systems;
    expect(before.map((s) => s.systemId).slice(0, 2)).toEqual(["calculation-gym", "speed-lab"]);
    const card = before.find((s) => s.systemId === "speed-lab")!;
    expect(card).toMatchObject({ label: "Speed", dimension: "speed", availability: "not_applicable", note: "Needs several recorded answers on straightforward questions of the same concept first." });
    expect(card.trains).toBe("Improve solving speed: working within the expected time on concepts you already answer correctly.");
    await world.answer(practice, SLOW_HISTORY);
    const hub = (await training.getHub(CLAIM, { now: t(10_000) })).systems;
    expect(hub.find((s) => s.systemId === "speed-lab")).toMatchObject({ availability: "available", note: "Ready to train." });
    expect(hub.find((s) => s.systemId === "calculation-gym")!.availability).toBe("not_applicable"); // a separate system with its own evidence
  });

  it("applicability is the provider's, not weakened: wrong-and-slow, fast, or too few attempts never activate it; a single slow attempt never does", async () => {
    const wrongSlow = ["A1", "A2", "A3", "A4"].map((id) => ({ id, correct: false, seconds: 200 }));
    const fast = ["A1", "A2", "A3", "A4"].map((id) => ({ id, correct: true, seconds: 40 }));
    const tooFew = SLOW_HISTORY.slice(0, 2);
    for (const plan of [wrongSlow, fast, tooFew]) {
      const { training } = await boot(basePool(), plan);
      expect((await training.getHub(CLAIM, { now: t(10_000) })).systems.find((s) => s.systemId === "speed-lab")!.availability).toBe("not_applicable");
      expect((await rejection(training.startSession(CLAIM, { systemId: "speed-lab", config: COMPLETE_2 }))).code).toBe("invalid_state");
    }
  });

  it("the objective is explicit and observational, titled 'Speed Lab', with the current stage", async () => {
    const { training } = await boot();
    const session = await start(training);
    expect(session).toMatchObject({ systemId: "speed-lab", systemLabel: "Speed", systemTitle: "Speed Lab", dimension: "speed" });
    expect(session.objective.targetConceptName).toBe("Percentages");
    expect(session.objective.statement).toBe("Improve solving speed: working within the expected time on concepts you already answer correctly. Focus: Percentages.");
    expect(session.stage).toMatchObject({ key: "steady_pace", label: "Stage 1 · Steady pace", position: 1, total: 3 });
  });
});

describe("Speed Lab -- each stage serves its own kind of question", () => {
  it("stage 1 (steady_pace): only light, non-timed questions", async () => {
    const { training } = await boot();
    const session = await start(training);
    const served = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(STEADY_SET).toContain(served.question.questionId);
    expect(served.stageTransition).toBeNull();
  });

  it("stage 2 (mixed_pace): only conceptually heavier, non-timed questions", async () => {
    const { training } = await boot(basePool(), STEADY_CLEARED);
    const session = await start(training);
    expect(session.stage?.key).toBe("mixed_pace");
    expect(MIXED_SET).toContain(asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })).question.questionId);
  });

  it("stage 3 (time_constrained): only questions that carry the time-pressured testing mode", async () => {
    const { training } = await boot(basePool(), MIXED_CLEARED);
    const session = await start(training);
    expect(session.stage?.key).toBe("time_constrained");
    expect(TIMED_SET).toContain(asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })).question.questionId);
  });

  it("selection never depends on the order candidates are stored in, and is repeatable (no randomness)", async () => {
    const a = await boot(basePool());
    const b = await boot([...basePool()].reverse());
    const qa = asQuestion(await a.training.nextQuestion(CLAIM, { sessionId: (await start(a.training)).sessionId, now: t(10_010) }));
    const qb = asQuestion(await b.training.nextQuestion(CLAIM, { sessionId: (await start(b.training)).sessionId, now: t(10_010) }));
    expect(qa.question.questionId).toBe(qb.question.questionId);
  });

  it("a malformed candidate is excluded, never served and never a crash", async () => {
    const pool = [...basePool().filter((p) => !p.id.startsWith("S")), q("Sbad", 0.2, ["direct"], { malformed: true })];
    const { training } = await boot(pool);
    const session = await start(training);
    const served = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(served.question.questionId).not.toBe("Sbad");
    expect(STEADY_SET).toContain(served.question.questionId);
  });
});

describe("Speed Lab -- progression through a session is derived from evidence", () => {
  it("good-pace answers inside the session move the stage; the change is announced with authored copy and rebuilt after a restart", async () => {
    const env = await boot();
    const session = await start(env.training);
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const served = await serveAndAnswer(env, session.sessionId, 10_010 + i * 100);
      expect(STEADY_SET).toContain(served.question.questionId);
      expect(served.stageTransition).toBeNull();
      seen.push(served.question.questionId);
    }
    const q4 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_400) }));
    expect(MIXED_SET).toContain(q4.question.questionId);
    expect(q4.stageTransition).toMatchObject({
      direction: "forward",
      from: { key: "steady_pace", label: "Stage 1 · Steady pace" },
      to: { key: "mixed_pace", label: "Stage 2 · Mixed pace" },
      note: "Your recorded answers at the previous stage met this training's requirement for moving on."
    });
    expect(q4.session.stage?.key).toBe("mixed_pace");
    expect(JSON.stringify(q4.stageTransition)).not.toMatch(/ratio|1\.3|0\.5|threshold|score|slow|improv/i);

    // a restart (fresh services over the same rows) resumes the same open question and rebuilds the same transition
    const restarted = env.world.boot().training;
    const again = asQuestion(await restarted.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_410) }));
    expect(again.attemptId).toBe(q4.attemptId);
    expect(again.stageTransition).toEqual(q4.stageTransition);
    expect(again.session.stage).toEqual(q4.session.stage);
  });

  it("three good-pace answers on the stage-2 shape then reach stage 3, announced the same way", async () => {
    const env = await boot(basePool(), STEADY_CLEARED);
    const session = await start(env.training);
    for (let i = 0; i < 3; i += 1) expect(MIXED_SET).toContain((await serveAndAnswer(env, session.sessionId, 10_010 + i * 100)).question.questionId);
    const next = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_400) }));
    expect(TIMED_SET).toContain(next.question.questionId);
    expect(next.stageTransition).toMatchObject({ direction: "forward", from: { key: "mixed_pace" }, to: { key: "time_constrained", label: "Stage 3 · Time-constrained" } });
  });

  it("slow answers inside the session never advance the stage", async () => {
    const env = await boot();
    const session = await start(env.training);
    for (let i = 0; i < 3; i += 1) await serveAndAnswer(env, session.sessionId, 10_010 + i * 300, 200);
    expect((await env.training.getSession(CLAIM, { sessionId: session.sessionId, now: t(11_000) })).stage?.key).toBe("steady_pace");
  });

  it("no stage is stored anywhere: the session record holds only the system, objective and configuration", async () => {
    const env = await boot();
    const session = await start(env.training);
    const stored = (await env.world.trainingSessions.findById(session.sessionId))!;
    expect(Object.keys(stored).sort()).toEqual(["block", "config", "createdAt", "enrollmentId", "id", "objective", "studentId", "systemId"]);
    expect(JSON.stringify(stored)).not.toMatch(/stage|steady_pace|mixed_pace|time_constrained/);
  });
});

describe("Speed Lab -- the one attempt lifecycle, server-authoritative timing, evidence", () => {
  it("correct, incorrect and skipped answers are ordinary attempts; time spent is measured by the server, never sent by the client", async () => {
    const env = await boot();
    const session = await start(env.training, { completion: { kind: "fixed_question_count", questionCount: 3 } });
    const q1 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(await env.practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(10_041) })).toMatchObject({ status: "submitted", isCorrect: true, timeSpentSeconds: 31 });
    const q2 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_050) }));
    expect(await env.practice.submitAttempt(CLAIM, { attemptId: q2.attemptId, questionId: q2.question.questionId, chosenAnswer: WRONG, now: t(10_100) })).toMatchObject({ isCorrect: false, timeSpentSeconds: 50 });
    const q3 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_110) }));
    expect(await env.practice.skipAttempt(CLAIM, { attemptId: q3.attemptId, questionId: q3.question.questionId, now: t(10_120) })).toMatchObject({ status: "skipped", isCorrect: null });
    const block = (await env.world.trainingSessions.findById(session.sessionId))!.block;
    const inBlock = await env.world.attempts.findByPracticeBlockId(block.id);
    expect(inBlock.map((a) => [a.status, a.isCorrect, a.timeSpentSeconds, a.blockMembership?.blockSequenceNumber])).toEqual([["submitted", true, 31, 1], ["submitted", false, 50, 2], ["skipped", null, 10, 3]]);
    expect((await env.practice.getAttemptEvidence(CLAIM, { attemptId: q2.attemptId })).facts).toMatchObject({ verdict: "incorrect", elapsedSeconds: 50, expectedSeconds: 90 });
    expect(await env.world.attempts.findFinalizedByStudentId("student-1")).toHaveLength(SLOW_HISTORY.length + 3);
  });
});

describe("Speed Lab -- completion and the observable summary", () => {
  it("completes with observable counts, time against expected, and the current stage -- claiming nothing else", async () => {
    const env = await boot();
    const session = await start(env.training, COMPLETE_2);
    await serveAndAnswer(env, session.sessionId, 10_010, 30);
    await serveAndAnswer(env, session.sessionId, 10_100, 60, WRONG);
    const done = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_200) });
    expect(done.status).toBe("completed");
    expect(done.session).toMatchObject({ status: "completed", summary: { submittedCount: 2, correctCount: 1, incorrectCount: 1, totalTimeSeconds: 90, expectedTimeSeconds: 180 }, stage: { key: "steady_pace" } });
    const text = JSON.stringify(done).toLowerCase();
    for (const banned of ["mastery", "improved", "weakness", "confidence", "guarantee", "permanent", "ability", "score", "slow solver", "ratio"]) expect(text, banned).not.toContain(banned);
  });
});

describe("Speed Lab -- honest behavior when content is short", () => {
  it("no qualifying published question for the current stage: the start is refused and the hub says so -- nothing else is substituted", async () => {
    // evidence is real and the student is at stage 2; the catalogue has no non-timed heavier question, and the light/timed ones are NOT stage-2 questions
    const pool = basePool().filter((p) => !MIXED_SET.includes(p.id));
    const { training } = await boot(pool, STEADY_CLEARED);
    const hub = await training.getHub(CLAIM, { now: t(10_000) });
    expect(hub.systems.find((s) => s.systemId === "speed-lab")!.availability).toBe("no_eligible_question");
    expect((await rejection(training.startSession(CLAIM, { systemId: "speed-lab", config: COMPLETE_2 }))).code).toBe("invalid_state");
    expect((await training.getHub(CLAIM)).activeSession).toBeNull();
  });

  it("the stage's pool running out mid-session ends it honestly (no_question), serving nothing from another stage", async () => {
    const pool = basePool().filter((p) => !["S3", "S4", "S5", "A3", "A4"].includes(p.id) || SLOW_HISTORY.some((h) => h.id === p.id));
    const { training, practice } = await boot(pool);
    const session = await start(training);
    const served: string[] = [];
    let last: TrainingNextView = { status: "completed", session } as TrainingNextView;
    for (let i = 0; i < 12; i += 1) {
      last = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 300) });
      if (last.status !== "question") break;
      served.push(last.question.questionId);
      await practice.submitAttempt(CLAIM, { attemptId: last.attemptId, questionId: last.question.questionId, chosenAnswer: CORRECT, now: t(10_010 + i * 300 + 200) }); // slow answers keep the stage at 1
    }
    expect(last.status).toBe("no_question");
    expect(last.session.status).toBe("active");
    for (const id of served) expect([...MIXED_SET, ...TIMED_SET]).not.toContain(id);
  });

  it("an unpublished question is never served as Speed Lab", async () => {
    const pool = [...basePool(), q("Sdraft", 0.2, ["direct"], { validationState: "ai_validated" })];
    const { practice, training } = await boot(pool);
    const session = await start(training);
    const served: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 300) });
      if (next.status !== "question") break;
      served.push(next.question.questionId);
      await practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: CORRECT, now: t(10_010 + i * 300 + 200) });
    }
    expect(served.length).toBeGreaterThan(2);
    expect(served).not.toContain("Sdraft");
  });
});

describe("Speed Lab -- no repeats, ownership, concurrency, leakage, scope", () => {
  it("never repeats a question within a session", async () => {
    const env = await boot();
    const session = await start(env.training);
    const seen: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const next = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 300) });
      if (next.status !== "question") break;
      seen.push(next.question.questionId);
      await env.practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: WRONG, now: t(10_010 + i * 300 + 20) });
    }
    expect(seen.length).toBeGreaterThan(3);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("another student can neither read nor advance a Speed Lab session", async () => {
    const { training } = await boot();
    const session = await start(training);
    for (const call of [() => training.getSession(OTHER_CLAIM, { sessionId: session.sessionId }), () => training.nextQuestion(OTHER_CLAIM, { sessionId: session.sessionId })]) {
      expect((await rejection(call())).code).toBe("ownership_mismatch");
    }
  });

  it("concurrent starts make one session; concurrent next calls (one instance and two) make one open attempt", async () => {
    const { world, training } = await boot();
    const starts = await Promise.all([1, 2, 3, 4].map(() => training.startSession(CLAIM, { systemId: "speed-lab", config: COMPLETE_2, now: t(10_000) })));
    expect(new Set(starts.map((r) => r.session.sessionId)).size).toBe(1);
    const sessionId = starts[0]!.session.sessionId;
    const other = world.boot().training;
    const results = await Promise.all([1, 2, 3].map(() => training.nextQuestion(CLAIM, { sessionId, now: t(10_010) })).concat([other.nextQuestion(CLAIM, { sessionId, now: t(10_010) })]));
    expect(new Set(results.map((r) => asQuestion(r).attemptId)).size).toBe(1);
    expect(await world.attempts.findByPracticeBlockId((await world.trainingSessions.findById(sessionId))!.block.id)).toHaveLength(1);
  });

  it("no view leaks an answer key, provider internals, thresholds or a score; no psychological wording", async () => {
    const env = await boot();
    const session = await start(env.training);
    const q1 = await serveAndAnswer(env, session.sessionId, 10_010, 30);
    const q2 = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_100) });
    const text = JSON.stringify([await env.training.getHub(CLAIM), session, q1, q2, await env.training.getSession(CLAIM, { sessionId: session.sessionId })]);
    expect(text).not.toContain(ANSWER_KEY);
    for (const banned of ["correctAnswer", "providerId", "providerResult", "\"requirement\"", "diagnostics", "slowFraction", "correctSlowCount", "incorrectSlowCount", "eligibleGradedCount", "maxConceptualLoad", "minConceptualLoad", "excludeTimePressured", "SLOW_SPEED_RATIO", "GOOD_PACE", "threshold", "speedRatio", "conceptualLoad", "computationalLoad"]) {
      expect(text, banned).not.toContain(banned);
    }
    for (const banned of ["confidence", "emotion", "motivation", "anxiety", "mood", "careless", "lazy", "intelligen", "slow solver", "poor", "lack", "you are slow"]) {
      expect(text.toLowerCase(), banned).not.toContain(banned);
    }
  });

  it("adds no new score: no view anywhere has a score/rank/rating/index/percent field", async () => {
    const env = await boot();
    const session = await start(env.training);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k.toLowerCase()); walk(v); }
    };
    walk([await env.training.getHub(CLAIM), session, await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })]);
    for (const key of keys) expect(key, key).not.toMatch(/score|rank|rating|index|percent|ratio|fraction/);
  });
});
