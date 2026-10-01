import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import type { TrainingNextView } from "../src/trainingTypes.js";
import { ANSWER_KEY, CLAIM, CORRECT, ENROLLMENT, OTHER_CLAIM, WRONG, TrainingWorld, t, type WorldQuestion } from "./trainingWorld.js";

/**
 * Phase 5 Unit 6 -- Pressure Training as the fifth real training system inside the Unit 1-5 session framework. Everything runs the REAL
 * `@ipmat/pressure-training` provider (block validation, per-concept evidence, target concept, selection) through the REAL recommendation
 * composition, which assembles `practiceBlocks` from persisted PracticeSession/PracticeBlock rows; nothing about the provider is faked.
 *
 * Pressure (D-061) is SUSTAINED-SEQUENCE evidence over PRACTICE BLOCKS (a training session is one): a block qualifies with >= 3 attempts, a
 * concept needs >= 3 qualifying blocks, and one of three observable block facts must trigger -- within-block degradation (second-half accuracy
 * >= 40 points below the first half), reduced recovery (median gap between attempts < 5 s) or budget consumption (active solving time >= the
 * block's time budget). With no block evidence it is ALWAYS not applicable, however slow the single-question history -- so it can never fire off
 * Speed Lab's evidence.
 *
 * TEST DATA pool (concept "Percentages" unless noted): B1-B4 answered inside the evidence blocks; F1-F5 fresh (distinct taxonomy cells, F5 shares
 * F4's cell); R1 another concept; Fdraft unpublished; Fbad malformed.
 */
type Pool = WorldQuestion[];
function q(id: string, cell: string, concept = "Percentages", extra: Partial<WorldQuestion> = {}): WorldQuestion {
  return { id, noveltyLevel: "standard", cell, concept, ...extra };
}
function basePool(): Pool {
  return [
    q("B1", "cB1"), q("B2", "cB2"), q("B3", "cB3"), q("B4", "cB4"),
    q("F1", "cF1"), q("F2", "cF2"), q("F3", "cF3"), q("F4", "cF4"), q("F5", "cF4"),
    q("R1", "cR1", "Ratio"),
    q("Fdraft", "cD", "Percentages", { validationState: "ai_validated" }),
    q("Fbad", "")
  ];
}
type Step = { id: string; correct: boolean; seconds?: number; gapAfter?: number };
const BLOCK_IDS = ["B1", "B2", "B3", "B4"];
const DEGRADING: Step[] = [{ id: "B1", correct: true }, { id: "B2", correct: true }, { id: "B3", correct: false }, { id: "B4", correct: false }]; // 100% -> 0%
const STEADY: Step[] = BLOCK_IDS.map((id) => ({ id, correct: true, gapAfter: 30 })); // no drop, comfortable gaps
const SHORT_GAPS: Step[] = BLOCK_IDS.map((id) => ({ id, correct: true, gapAfter: 1 })); // median gap 1 s < 5 s

let blockCounter = 0;
/** Records ONE real PracticeBlock (a finished training session on another system) with the given attempts, through the real repositories and the one attempt lifecycle. */
async function recordBlock(env: Awaited<ReturnType<typeof boot>>, steps: Step[], atSecond: number, systemId = "calculation-gym") {
  blockCounter += 1;
  const stored = await env.world.trainingSessions.create({
    id: `ts-${blockCounter}`, practiceSessionId: `ps-${blockCounter}`, practiceBlockId: `pb-${blockCounter}`, enrollmentId: ENROLLMENT, systemId,
    objective: { systemId, dimension: "calculation", statement: "x", targetConceptName: null }, config: { completion: { kind: "fixed_question_count", questionCount: steps.length } },
    blockSettings: { targetQuestionCount: steps.length, blockTimeBudgetSeconds: null }, now: t(atSecond)
  });
  let second = atSecond;
  for (const step of steps) {
    const started = await env.practice.startAttempt(CLAIM, { questionId: step.id, practiceBlockId: stored.block.id, now: t(second) });
    second += step.seconds ?? 40;
    await env.practice.submitAttempt(CLAIM, { attemptId: started.attemptId, questionId: step.id, chosenAnswer: step.correct ? CORRECT : WRONG, now: t(second) });
    second += step.gapAfter ?? 20;
  }
  await env.world.trainingSessions.complete(stored.id, { now: t(second) });
  return second;
}
async function boot(pool: Pool = basePool()) {
  const world = new TrainingWorld(0, pool);
  return { world, ...world.boot() };
}
/** Three qualifying blocks of the same concept, each shaped as `shape`. */
async function withBlocks(shape: Step[], count = 3, pool: Pool = basePool()) {
  const env = await boot(pool);
  let at = 0;
  for (let i = 0; i < count; i += 1) at = (await recordBlock(env, shape, at)) + 600;
  return env;
}
const TIMED_300 = { completion: { kind: "fixed_duration", durationSeconds: 300 } };
async function start(training: ReturnType<TrainingWorld["boot"]>["training"], config: unknown = TIMED_300) {
  return (await training.startSession(CLAIM, { systemId: "pressure-training", config, now: t(20_000) })).session;
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
const card = async (training: ReturnType<TrainingWorld["boot"]>["training"]) => (await training.getHub(CLAIM, { now: t(20_000) })).systems.find((s) => s.systemId === "pressure-training")!;
async function runTimed(env: Awaited<ReturnType<typeof boot>>, sessionId: string, maxSteps = 12, answer = CORRECT) {
  const served: string[] = [];
  let last: TrainingNextView | null = null;
  for (let i = 0; i < maxSteps; i += 1) {
    last = await env.training.nextQuestion(CLAIM, { sessionId, now: t(20_010 + i * 20) });
    if (last.status !== "question") break;
    served.push(last.question.questionId);
    await env.practice.submitAttempt(CLAIM, { attemptId: last.attemptId, questionId: last.question.questionId, chosenAnswer: answer, now: t(20_020 + i * 20) });
  }
  return { served, last: last! };
}

describe("Pressure Training -- applicability is the provider's block-evidence rule, not weakened", () => {
  it("appears as a deliberate-training card; with no block evidence it is honestly unavailable", async () => {
    const { training } = await boot();
    const c = await card(training);
    expect(c).toMatchObject({ label: "Pressure", dimension: "pressure", availability: "not_applicable", note: "Needs several earlier training sessions of at least three questions each on the same concept first." });
    expect(c.trains).toBe("Practice a sustained, timed run of questions: keep working steadily across a whole sequence, not just one question.");
    expect(c.completionKinds).toEqual(["fixed_duration"]);
  });

  it("insufficient evidence: fewer than 3 qualifying blocks of one concept, or blocks shorter than 3 attempts, never activate it", async () => {
    expect((await card((await withBlocks(DEGRADING, 2)).training)).availability).toBe("not_applicable");
    expect((await card((await withBlocks(DEGRADING.slice(0, 2), 3)).training)).availability).toBe("not_applicable"); // 3 blocks of 2 attempts
  });

  it("three qualifying blocks WITHOUT any observed pressure fact: not applicable, with its own explanation", async () => {
    const { training } = await withBlocks(STEADY);
    expect(await card(training)).toMatchObject({ availability: "not_applicable", note: "Your recorded training sessions don't call for this right now." });
  });

  it("each observable block fact activates it: degradation across the sequence, or short gaps between attempts", async () => {
    for (const shape of [DEGRADING, SHORT_GAPS]) {
      expect(await card((await withBlocks(shape)).training)).toMatchObject({ availability: "available", note: "Ready to train." });
    }
  });

  it("budget consumption activates it: active solving time at or beyond a block's time budget", async () => {
    const env = await boot();
    let at = 0;
    for (let i = 0; i < 3; i += 1) {
      const stored = await env.world.trainingSessions.create({
        id: `bud-${i}`, practiceSessionId: `bps-${i}`, practiceBlockId: `bpb-${i}`, enrollmentId: ENROLLMENT, systemId: "calculation-gym", objective: { systemId: "calculation-gym", dimension: "calculation", statement: "x", targetConceptName: null },
        config: { completion: { kind: "fixed_duration", durationSeconds: 100 } }, blockSettings: { targetQuestionCount: null, blockTimeBudgetSeconds: 100 }, now: t(at)
      });
      let second = at;
      for (const id of ["B1", "B2", "B3"]) {
        const started = await env.practice.startAttempt(CLAIM, { questionId: id, practiceBlockId: stored.block.id, now: t(second) });
        second += 50; // 150 s of active solving against a 100 s budget
        await env.practice.submitAttempt(CLAIM, { attemptId: started.attemptId, questionId: id, chosenAnswer: CORRECT, now: t(second) });
        second += 30;
      }
      await env.world.trainingSessions.complete(stored.id, { now: t(second) });
      at = second + 600;
    }
    expect((await card(env.training)).availability).toBe("available");
  });

  it("structurally distinct from Speed Lab: plenty of slow single-question history with NO blocks never activates Pressure (and vice versa)", async () => {
    const slow = await boot();
    await slow.world.answer(slow.practice, ["B1", "B2", "B3", "B4"].map((id) => ({ id, correct: true, seconds: 200 })));
    const systems = (await slow.training.getHub(CLAIM, { now: t(20_000) })).systems;
    expect(systems.find((s) => s.systemId === "speed-lab")!.availability).toBe("available"); // Speed Lab fires on this
    expect(systems.find((s) => s.systemId === "pressure-training")!.availability).toBe("not_applicable"); // Pressure cannot
    const blocks = (await withBlocks(DEGRADING)).training;
    const hub = (await blocks.getHub(CLAIM, { now: t(20_000) })).systems;
    expect(hub.find((s) => s.systemId === "pressure-training")!.availability).toBe("available");
    expect(hub.find((s) => s.systemId === "speed-lab")!.availability).toBe("not_applicable"); // fast, accurate attempts: nothing slow
  });
});

describe("Pressure Training -- the session: a timed run, no stages", () => {
  it("only a timed session is allowed: a question-count session is refused by the server (and the hub offers only the timed kind)", async () => {
    const { training } = await withBlocks(DEGRADING);
    expect((await rejection(training.startSession(CLAIM, { systemId: "pressure-training", config: { completion: { kind: "fixed_question_count", questionCount: 5 } } }))).code).toBe("invalid_request");
    expect((await training.getHub(CLAIM)).activeSession).toBeNull();
    const session = await start(training);
    expect(session).toMatchObject({ systemId: "pressure-training", systemLabel: "Pressure", systemTitle: "Pressure Training", dimension: "pressure", status: "active", stage: null, completion: { kind: "fixed_duration", durationSeconds: 300 } });
    expect(session.progress.remainingSeconds).toBe(300);
  });

  it("states a student-safe objective (no concept, no evidence fact) and has no stage anywhere", async () => {
    const env = await withBlocks(DEGRADING);
    const session = await start(env.training);
    expect(session.objective).toEqual({ statement: "Practice a sustained, timed run of questions: keep working steadily across a whole sequence, not just one question. This session is a sustained, timed run of questions.", targetConceptName: null });
    const next = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_010) }));
    expect(next.session.stage).toBeNull();
    expect(next.stageTransition).toBeNull();
  });

  it("the time budget is the SERVER's: the session completes only when its clock passes the budget, an open question is never dropped, and nothing new starts afterwards", async () => {
    const env = await withBlocks(DEGRADING);
    const session = await start(env.training);
    const q1 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_010) }));
    expect((await env.training.getSession(CLAIM, { sessionId: session.sessionId, now: t(20_299) })).progress).toMatchObject({ completionReached: false, remainingSeconds: 1 });
    const late = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_400) })); // time is up while the question is open
    expect(late.attemptId).toBe(q1.attemptId);
    expect(late.session.progress).toMatchObject({ completionReached: true, remainingSeconds: 0, hasOpenQuestion: true });
    await env.practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(20_410) });
    expect(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_420) })).toMatchObject({ status: "completed", session: { status: "completed", stage: null } });
  });
});

describe("Pressure Training -- selection is the provider's (concept-scoped, surface-varying, deterministic)", () => {
  it("serves only published, well-formed questions of the evidenced concept -- never another concept, an unpublished or a malformed one", async () => {
    const env = await withBlocks(DEGRADING);
    const session = await start(env.training);
    const { served } = await runTimed(env, session.sessionId, 12);
    expect(served.length).toBeGreaterThan(5);
    for (const id of served) expect(["R1", "Fdraft", "Fbad"]).not.toContain(id);
    expect(new Set(served).size).toBe(served.length); // no repeat within a session
  });

  it("repeat the concept, vary the surface: unseen taxonomy cells first, the already-seen surfaces after (F5 shares F4's surface and waits)", async () => {
    const env = await withBlocks(DEGRADING);
    const session = await start(env.training);
    const { served } = await runTimed(env, session.sessionId, 12);
    expect(served.slice(0, 4)).toEqual(["F1", "F2", "F3", "F4"]); // all unseen cells, then ties by exposure and id
    expect(served.indexOf("F5")).toBeGreaterThan(served.indexOf("F4"));
    expect(served.indexOf("F5")).toBeLessThan(served.indexOf("B1")); // F5's cell was only "seen" through F4 inside THIS session; B1-B4 cells were seen earlier
  });

  it("selection never depends on the order candidates are stored in, and is repeatable (no randomness)", async () => {
    const a = await withBlocks(DEGRADING);
    const b = await withBlocks(DEGRADING, 3, [...basePool()].reverse());
    const run = async (env: Awaited<ReturnType<typeof boot>>) => (await runTimed(env, (await start(env.training)).sessionId, 12)).served;
    expect(await run(a)).toEqual(await run(b));
  });

  it("when the concept's pool runs out the session ends honestly (no_question); nothing from another concept is substituted", async () => {
    const pool = [q("B1", "cB1"), q("B2", "cB2"), q("B3", "cB3"), q("B4", "cB4"), q("F1", "cF1"), q("R1", "cR1", "Ratio")];
    const env = await withBlocks(DEGRADING, 3, pool);
    const session = await start(env.training);
    const { served, last } = await runTimed(env, session.sessionId, 12);
    expect([...served].sort()).toEqual(["B1", "B2", "B3", "B4", "F1"]);
    expect(last.status).toBe("no_question");
    expect(last.session.status).toBe("active");
  });
});

describe("Pressure Training -- the one attempt lifecycle, restart, ownership, concurrency, leakage, scope", () => {
  it("answers are ordinary attempts in the session's block with server-derived timing; they add to the same evidence the provider reads", async () => {
    const env = await withBlocks(DEGRADING);
    const session = await start(env.training);
    const q1 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_010) }));
    expect(await env.practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(20_041) })).toMatchObject({ status: "submitted", isCorrect: true, timeSpentSeconds: 31 });
    const q2 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_050) }));
    await env.practice.skipAttempt(CLAIM, { attemptId: q2.attemptId, questionId: q2.question.questionId, now: t(20_060) });
    const block = (await env.world.trainingSessions.findById(session.sessionId))!.block;
    expect((await env.world.attempts.findByPracticeBlockId(block.id)).map((a) => [a.status, a.blockMembership?.blockSequenceNumber])).toEqual([["submitted", 1], ["skipped", 2]]);
    expect((await env.practice.getAttemptEvidence(CLAIM, { attemptId: q1.attemptId })).facts).toMatchObject({ verdict: "correct", elapsedSeconds: 31 });
  });

  it("a restarted (or second) instance resumes the same session and the same open question", async () => {
    const env = await withBlocks(DEGRADING);
    const session = await start(env.training);
    const q1 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_010) }));
    const again = asQuestion(await env.world.boot().training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_020) }));
    expect(again.attemptId).toBe(q1.attemptId);
  });

  it("another student can neither read nor advance a Pressure Training session", async () => {
    const { training } = await withBlocks(DEGRADING);
    const session = await start(training);
    for (const call of [() => training.getSession(OTHER_CLAIM, { sessionId: session.sessionId }), () => training.nextQuestion(OTHER_CLAIM, { sessionId: session.sessionId })]) {
      expect((await rejection(call())).code).toBe("ownership_mismatch");
    }
  });

  it("concurrent starts make one session; concurrent next calls (one instance and two) make one open attempt", async () => {
    const env = await withBlocks(DEGRADING);
    const starts = await Promise.all([1, 2, 3, 4].map(() => env.training.startSession(CLAIM, { systemId: "pressure-training", config: TIMED_300, now: t(20_000) })));
    expect(new Set(starts.map((r) => r.session.sessionId)).size).toBe(1);
    const sessionId = starts[0]!.session.sessionId;
    const results = await Promise.all([1, 2, 3].map(() => env.training.nextQuestion(CLAIM, { sessionId, now: t(20_010) })).concat([env.world.boot().training.nextQuestion(CLAIM, { sessionId, now: t(20_010) })]));
    expect(new Set(results.map((r) => asQuestion(r).attemptId)).size).toBe(1);
  });

  it("no view leaks an answer key, the evidenced dimension, block internals, cell ids, thresholds or numbers about the student; no stress/fatigue/confidence wording", async () => {
    const env = await withBlocks(DEGRADING);
    const session = await start(env.training);
    const q1 = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_010) });
    const text = JSON.stringify([await env.training.getHub(CLAIM), session, q1, await env.training.getSession(CLAIM, { sessionId: session.sessionId })]);
    expect(text).not.toContain(ANSWER_KEY);
    for (const banned of ["within_block_degradation", "reduced_recovery", "budget_consumption", "evidencedDimension", "targetConceptName\":\"", "practiceBlock", "interAttempt", "medianGap", "firstHalf", "secondHalf", "SHORT_RECOVERY", "DEGRADATION", "cB1", "cF1", "cell-", "providerId", "providerResult", "\"requirement\"", "diagnostics", "correctAnswer", "threshold"]) {
      expect(text, banned).not.toContain(banned);
    }
    for (const banned of ["stress", "anxiety", "anxious", "fatigue", "panic", "nervous", "choke", "crack", "you fade", "your accuracy", "confidence", "emotion", "motivation", "lack", "weak", "poor", "degrad", "recovery"]) {
      expect(text.toLowerCase(), banned).not.toContain(banned);
    }
  });

  it("adds no new score: no view anywhere has a score/rank/rating/index/percent/count-of-evidence field", async () => {
    const env = await withBlocks(DEGRADING);
    const session = await start(env.training);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k.toLowerCase()); walk(v); }
    };
    walk([await env.training.getHub(CLAIM), session, await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20_010) })]);
    for (const key of keys) expect(key, key).not.toMatch(/(^|_)(score|rank|rating|index|percent|ratio|fraction|evidence|evidenced|median|block)/);
  });
});

describe("Pressure Training -- property tests (seeded, no Math.random)", () => {
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }
  const shuffled = <T,>(items: T[], next: () => number): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };

  it("for 25 seeded candidate orders and random pool trimming: the served sequence is order-independent, repeat-free, on the evidenced concept and published only", async () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const next = lcg(seed);
      const extras = ["F1", "F2", "F3", "F4", "F5"].filter(() => next() > 0.3);
      const pool = basePool().filter((p) => !p.id.startsWith("F") || p.id === "Fdraft" || p.id === "Fbad" || extras.includes(p.id));
      const reference = await withBlocks(DEGRADING, 3, pool);
      const permuted = await withBlocks(DEGRADING, 3, shuffled(pool, next));
      const run = async (env: Awaited<ReturnType<typeof boot>>) => (await runTimed(env, (await start(env.training)).sessionId, 12)).served;
      const a = await run(reference);
      const b = await run(permuted);
      expect(b, `seed ${seed}`).toEqual(a);
      expect(new Set(a).size).toBe(a.length);
      const allowed = new Set(pool.filter((p) => p.concept === "Percentages" && p.id !== "Fdraft" && p.id !== "Fbad").map((p) => p.id));
      for (const id of a) expect(allowed.has(id), `${id} (seed ${seed})`).toBe(true);
    }
  });

  it("applicability is monotone in evidence: adding a qualifying degrading block never removes availability, and the same blocks always give the same card", async () => {
    for (const count of [3, 4, 5]) {
      const env = await withBlocks(DEGRADING, count);
      const first = await card(env.training);
      const second = await card(env.training);
      expect(first.availability).toBe("available");
      expect(second).toEqual(first);
    }
  });
});
