import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import type { TrainingNextView } from "../src/trainingTypes.js";
import { ANSWER_KEY, CLAIM, COMPLETE_2, CORRECT, OTHER_CLAIM, WRONG, TrainingWorld, t, type WorldQuestion } from "./trainingWorld.js";

/**
 * Phase 5 Unit 5 -- Novelty Training as the fifth real training system inside the Unit 1-4 session framework. Everything runs the REAL
 * `@ipmat/novelty-training` provider (exposure evidence, applicability, target pair, selection) through the real recommendation composition and
 * the real in-memory repositories; nothing about the provider is faked. TEST DATA pool (expected time 90 s for every question):
 *   Percentages  S1 S2 S3 standard   nc1-nc4 novel_combination   nx1-nx4 novel_context   nr1 nr2 (SAME taxonomy cell) nr3 nr4 novel_representation
 *   Ratio        RS1 RS2 standard (baseline NOT cleared) + RK1 novel_combination
 * Novelty Training has NO stages and its three styles are PEER categories: the globally least-exposed (concept, style) pair is targeted, so the
 * target legitimately ROTATES; correctness never changes an exposure count.
 */
type Pool = WorldQuestion[];
type Level = "standard" | "novel_representation" | "novel_combination" | "novel_context";
function q(id: string, level: Level, cell: string, concept = "Percentages", extra: Partial<WorldQuestion> = {}): WorldQuestion {
  return { id, noveltyLevel: level, cell, concept, ...extra };
}
function basePool(): Pool {
  return [
    q("S1", "standard", "cS1"),
    q("S2", "standard", "cS2"),
    q("S3", "standard", "cS3"),
    ...["nc1", "nc2", "nc3", "nc4"].map((id, i) => q(id, "novel_combination", `cC${i}`)),
    ...["nx1", "nx2", "nx3", "nx4"].map((id, i) => q(id, "novel_context", `cX${i}`)),
    q("nr1", "novel_representation", "cR"),
    q("nr2", "novel_representation", "cR"), // the SAME surface as nr1
    q("nr3", "novel_representation", "cR2"),
    q("nr4", "novel_representation", "cR3"),
    q("RS1", "standard", "cRS1", "Ratio"),
    q("RS2", "standard", "cRS2", "Ratio"),
    q("RK1", "novel_combination", "cRK1", "Ratio")
  ];
}
const STYLE_OF = (id: string): string => (id.startsWith("nc") || id === "RK1" ? "comb" : id.startsWith("nx") ? "ctx" : id.startsWith("nr") ? "rep" : "std");
const answers = (ids: string[], correct = true) => ids.map((id) => ({ id, correct }));
const BASELINE = answers(["S1", "S2", "S3"]); // three distinct standard questions of ONE concept

async function boot(pool: Pool = basePool(), plan: Array<{ id: string; correct: boolean }> = BASELINE) {
  const world = new TrainingWorld(0, pool);
  const services = world.boot();
  await world.answer(services.practice, plan);
  return { world, ...services };
}
async function start(training: ReturnType<TrainingWorld["boot"]>["training"], config: unknown = { completion: { kind: "fixed_question_count", questionCount: 10 } }) {
  return (await training.startSession(CLAIM, { systemId: "novelty-training", config, now: t(10_000) })).session;
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
/** Runs the session to its end, answering every served question; returns the served ids and the final (non-question) step. */
async function runSession(env: Awaited<ReturnType<typeof boot>>, sessionId: string, answerFor: (index: number) => string = () => CORRECT) {
  const served: string[] = [];
  let last: TrainingNextView | null = null;
  for (let i = 0; i < 14; i += 1) {
    last = await env.training.nextQuestion(CLAIM, { sessionId, now: t(10_010 + i * 100) });
    if (last.status !== "question") break;
    served.push(last.question.questionId);
    await env.practice.submitAttempt(CLAIM, { attemptId: last.attemptId, questionId: last.question.questionId, chosenAnswer: answerFor(i), now: t(10_040 + i * 100) });
  }
  return { served, last: last! };
}
const card = async (training: ReturnType<TrainingWorld["boot"]>["training"]) => (await training.getHub(CLAIM, { now: t(10_000) })).systems.find((s) => s.systemId === "novelty-training")!;

describe("Novelty Training -- the Training Hub and applicability (the provider's rule, not weakened)", () => {
  it("appears as a deliberate-training card; with no evidence it is honestly unavailable", async () => {
    const { training } = await boot(basePool(), []);
    const systems = (await training.getHub(CLAIM, { now: t(0) })).systems;
    expect(systems.map((s) => s.systemId)).toEqual(["calculation-gym", "speed-lab", "trap-lab", "novelty-training", "pressure-training", "revision", "overtraining"]);
    expect(systems.find((s) => s.systemId === "novelty-training")).toMatchObject({
      label: "Novelty",
      dimension: "novelty",
      availability: "not_applicable",
      note: "Needs several recorded answers on standard questions of one concept first.",
      trains: "Practice unfamiliar question styles: build exposure to different ways the exam can present a concept."
    });
  });

  it("the standard baseline is per concept and counts DISTINCT questions: two standard answers, one question retried, or another concept's baseline never clear it", async () => {
    for (const plan of [answers(["S1", "S2"]), answers(["S1", "S1", "S1", "S1"]), answers(["S1", "S2", "RS1", "RS2"]) /* 2 + 2, not 3 + 0 */]) {
      const { training } = await boot(basePool(), plan);
      expect((await card(training)).availability, JSON.stringify(plan.map((p) => p.id))).toBe("not_applicable");
    }
  });

  it("applicable once ONE concept clears its own baseline -- whether the standard answers were right or wrong (an exposure model, not an accuracy model)", async () => {
    for (const plan of [BASELINE, answers(["S1", "S2", "S3"], false)]) {
      const { training } = await boot(basePool(), plan);
      expect(await card(training)).toMatchObject({ availability: "available", note: "Ready to train." });
    }
  });

  it("applicability never depends on content: applicable with ZERO non-standard candidates is `no_eligible_question`, a different state from `not_applicable`", async () => {
    const pool = basePool().filter((p) => p.noveltyLevel === "standard");
    const { training } = await boot(pool);
    expect(await card(training)).toMatchObject({ availability: "no_eligible_question", note: "No published question in an unfamiliar style is available right now." });
    expect((await rejection(training.startSession(CLAIM, { systemId: "novelty-training", config: COMPLETE_2 }))).code).toBe("invalid_state");
    // the SAME history with a rich pool is available: only the content differs, never the applicability decision
    expect((await card((await boot(basePool())).training)).availability).toBe("available");
  });

  it("skipped attempts are not exposure", async () => {
    const world = new TrainingWorld(0, basePool());
    const { practice, training } = world.boot();
    await world.answer(practice, answers(["S1", "S2"]));
    const started = await practice.startAttempt(CLAIM, { questionId: "S3", now: t(500) });
    await practice.skipAttempt(CLAIM, { attemptId: started.attemptId, questionId: "S3", now: t(510) });
    expect((await card(training)).availability).toBe("not_applicable");
  });
});

describe("Novelty Training -- the objective: exposure-first copy, and NO stages", () => {
  it("states a student-safe focus -- no concept (the target rotates), no style name, no count -- titled 'Novelty Training'", async () => {
    const { training } = await boot();
    const session = await start(training);
    expect(session).toMatchObject({ systemId: "novelty-training", systemLabel: "Novelty", systemTitle: "Novelty Training", dimension: "novelty", status: "active", stage: null });
    expect(session.objective.statement).toBe("Practice unfamiliar question styles: build exposure to different ways the exam can present a concept. This session is expanding the kinds of questions you've encountered.");
    expect(session.objective.targetConceptName).toBeNull();
  });

  it("has no stage anywhere: not on the session, not on any question, no transition, in a full session", async () => {
    const env = await boot();
    const session = await start(env.training);
    for (let i = 0; i < 4; i += 1) {
      const next = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) }));
      expect(next.session.stage).toBeNull();
      expect(next.stageTransition).toBeNull();
      await env.practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: CORRECT, now: t(10_040 + i * 100) });
    }
    expect(JSON.stringify(await env.training.getHub(CLAIM))).not.toMatch(/Stage \d|stageTransition":\{|"stage":\{/);
  });
});

describe("Novelty Training -- target pair and question selection (provider-local, deterministic)", () => {
  it("the target ROTATES through the three peer styles as exposure is recorded (lowest count, then style name), correct or wrong, until each has enough", async () => {
    const env = await boot();
    const session = await start(env.training);
    const { served, last } = await runSession(env, session.sessionId, (i) => (i % 2 === 0 ? CORRECT : WRONG)); // correctness never changes the rotation
    expect(served.map(STYLE_OF)).toEqual(["comb", "ctx", "rep", "comb", "ctx", "rep", "comb", "ctx", "rep"]);
    expect(served.every((id) => !["S1", "S2", "S3", "RS1", "RS2", "RK1"].includes(id))).toBe(true); // never a standard question; never the concept whose baseline is not cleared
    expect(new Set(served).size).toBe(9);
    // every style now has 3 distinct questions: the provider's own evidence says there is nothing more to add -- said in authored words, session still active
    expect(last).toMatchObject({ status: "no_question", message: "Your recorded practice now includes several questions in each unfamiliar style, so there is nothing more to add right now. You can end the session." });
    expect(last.session.status).toBe("active");
  });

  it("repeat the style, vary the surface: an unseen taxonomy cell is preferred at the target style; once every surface is seen the matching pool is used (not 'no question')", async () => {
    const env = await boot();
    const session = await start(env.training);
    const { served } = await runSession(env, session.sessionId);
    expect(served.filter((id) => id.startsWith("nr"))).toEqual(["nr1", "nr3", "nr4"]); // nr2 shares nr1's surface, so it waits behind the unseen ones

    // all-seen fallback: comb/ctx are already sufficiently exposed in history; rep has only two questions on the SAME surface
    const pool = [q("S1", "standard", "cS1"), q("S2", "standard", "cS2"), q("S3", "standard", "cS3"), ...["nc1", "nc2", "nc3"].map((id, i) => q(id, "novel_combination", `cC${i}`)), ...["nx1", "nx2", "nx3"].map((id, i) => q(id, "novel_context", `cX${i}`)), q("nr1", "novel_representation", "cR"), q("nr2", "novel_representation", "cR")];
    const env2 = await boot(pool, answers(["S1", "S2", "S3", "nc1", "nc2", "nc3", "nx1", "nx2", "nx3"]));
    const s2 = await start(env2.training);
    const run2 = await runSession(env2, s2.sessionId);
    expect(run2.served).toEqual(["nr1", "nr2"]); // nr2's surface was already seen, yet it is served from the fallback pool
  });

  it("a concept that has not cleared its own baseline is never targeted, even with candidates (cross-concept baseline isolation)", async () => {
    const env = await boot();
    const session = await start(env.training);
    const { served } = await runSession(env, session.sessionId);
    expect(served).not.toContain("RK1");
  });

  it("with two concepts cleared, the globally lowest count wins, then the concept name", async () => {
    const pool = [...basePool(), q("RS3", "standard", "cRS3", "Ratio"), q("RK2", "novel_combination", "cRK2", "Ratio")];
    const env = await boot(pool, [...BASELINE, ...answers(["RS1", "RS2", "RS3"])]);
    const session = await start(env.training);
    const first = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    // every (concept, style) pair has 0 exposures: ties break by concept name ("Percentages" < "Ratio") then style name (novel_combination first)
    expect(first.question.questionId.startsWith("nc")).toBe(true);
    await env.practice.submitAttempt(CLAIM, { attemptId: first.attemptId, questionId: first.question.questionId, chosenAnswer: CORRECT, now: t(10_040) });
    const second = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_100) }));
    expect(second.question.questionId.startsWith("nx")).toBe(true); // Percentages' next-lowest pair (context), not Ratio
  });

  it("an unpublished or structurally malformed candidate is never served", async () => {
    const pool = [...basePool(), q("ndraft", "novel_combination", "cD", "Percentages", { validationState: "ai_validated" }), q("nbad", "novel_combination", "")];
    const env = await boot(pool);
    const session = await start(env.training);
    const { served } = await runSession(env, session.sessionId);
    expect(served.length).toBe(9);
    expect(served).not.toContain("ndraft");
    expect(served).not.toContain("nbad");
  });

  it("selection never depends on the order candidates are stored in, and is repeatable (no randomness)", async () => {
    const a = await boot(basePool());
    const b = await boot([...basePool()].reverse());
    const run = async (env: Awaited<ReturnType<typeof boot>>) => (await runSession(env, (await start(env.training)).sessionId)).served;
    expect(await run(a)).toEqual(await run(b));
  });

  it("when the target style has no published question the session says so honestly; nothing from another style is substituted", async () => {
    const pool = basePool().filter((p) => !p.id.startsWith("nc")); // the first target (novel_combination) has no content
    const env = await boot(pool);
    expect((await card(env.training)).availability).toBe("no_eligible_question");
    expect((await rejection(env.training.startSession(CLAIM, { systemId: "novelty-training", config: COMPLETE_2 }))).code).toBe("invalid_state");
  });
});

describe("Novelty Training -- the one attempt lifecycle, restart, ownership, concurrency, leakage, scope", () => {
  it("correct, incorrect and skipped answers are ordinary attempts with server-derived timing in the session's block, and they ARE the exposure the next decision reads", async () => {
    const env = await boot();
    const session = await start(env.training, { completion: { kind: "fixed_question_count", questionCount: 3 } });
    const q1 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    expect(await env.practice.submitAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, chosenAnswer: CORRECT, now: t(10_041) })).toMatchObject({ status: "submitted", isCorrect: true, timeSpentSeconds: 31 });
    const q2 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_050) }));
    expect(STYLE_OF(q2.question.questionId)).not.toBe(STYLE_OF(q1.question.questionId)); // the recorded exposure moved the target
    expect(await env.practice.submitAttempt(CLAIM, { attemptId: q2.attemptId, questionId: q2.question.questionId, chosenAnswer: WRONG, now: t(10_100) })).toMatchObject({ isCorrect: false, timeSpentSeconds: 50 });
    const q3 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_110) }));
    expect(await env.practice.skipAttempt(CLAIM, { attemptId: q3.attemptId, questionId: q3.question.questionId, now: t(10_120) })).toMatchObject({ status: "skipped", isCorrect: null });
    const block = (await env.world.trainingSessions.findById(session.sessionId))!.block;
    expect((await env.world.attempts.findByPracticeBlockId(block.id)).map((a) => [a.status, a.isCorrect, a.blockMembership?.blockSequenceNumber])).toEqual([["submitted", true, 1], ["submitted", false, 2], ["skipped", null, 3]]);
    const done = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_200) });
    expect(done).toMatchObject({ status: "completed", session: { stage: null, summary: { submittedCount: 2, correctCount: 1, incorrectCount: 1, skippedCount: 1 } } });
    expect(JSON.stringify(done).toLowerCase()).not.toMatch(/mastery|improved|weakness|confidence|guarantee|permanent|\bability\b|score/);
  });

  it("a restarted (or second) instance resumes the same session and the same open question", async () => {
    const env = await boot();
    const session = await start(env.training);
    const q1 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    const again = asQuestion(await env.world.boot().training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_020) }));
    expect(again.attemptId).toBe(q1.attemptId);
  });

  it("another student can neither read nor advance a Novelty Training session", async () => {
    const { training } = await boot();
    const session = await start(training);
    for (const call of [() => training.getSession(OTHER_CLAIM, { sessionId: session.sessionId }), () => training.nextQuestion(OTHER_CLAIM, { sessionId: session.sessionId })]) {
      expect((await rejection(call())).code).toBe("ownership_mismatch");
    }
  });

  it("concurrent starts make one session; concurrent next calls (one instance and two) make one open attempt", async () => {
    const { world, training } = await boot();
    const starts = await Promise.all([1, 2, 3, 4].map(() => training.startSession(CLAIM, { systemId: "novelty-training", config: COMPLETE_2, now: t(10_000) })));
    expect(new Set(starts.map((r) => r.session.sessionId)).size).toBe(1);
    const sessionId = starts[0]!.session.sessionId;
    const results = await Promise.all([1, 2, 3].map(() => training.nextQuestion(CLAIM, { sessionId, now: t(10_010) })).concat([world.boot().training.nextQuestion(CLAIM, { sessionId, now: t(10_010) })]));
    expect(new Set(results.map((r) => asQuestion(r).attemptId)).size).toBe(1);
    expect(await world.attempts.findByPracticeBlockId((await world.trainingSessions.findById(sessionId))!.block.id)).toHaveLength(1);
  });

  it("no view leaks an answer key, a novelty-level name, taxonomy-cell ids, exposure counts, thresholds or provider internals; no deficiency or psychological wording", async () => {
    const env = await boot();
    const session = await start(env.training);
    const next = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    await env.practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: CORRECT, now: t(10_040) });
    const next2 = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_100) });
    const text = JSON.stringify([await env.training.getHub(CLAIM), session, next, next2, await env.training.getSession(CLAIM, { sessionId: session.sessionId })]);
    expect(text).not.toContain(ANSWER_KEY);
    for (const banned of ["novel_representation", "novel_combination", "novel_context", "noveltyLevel", "standardExposureCount", "distinctQuestionIds", "targetNoveltyLevel", "targetConceptName\":\"", "cC0", "cX0", "cell-", "providerId", "providerResult", "\"requirement\"", "diagnostics", "representationNovelty", "MIN_OBSERVATIONS", "threshold", "correctAnswer"]) {
      expect(text, banned).not.toContain(banned);
    }
    for (const banned of ["confidence", "emotion", "motivation", "anxiety", "mood", "careless", "lazy", "intelligen", "struggle", "weak at", "lack", "poor", "not good at", "adaptab", "you are bad"]) {
      expect(text.toLowerCase(), banned).not.toContain(banned);
    }
    expect(text.toLowerCase()).not.toMatch(/\bability\b/);
  });

  it("adds no new score: no view anywhere has a score/rank/rating/index/percent/count-of-exposure field", async () => {
    const env = await boot();
    const session = await start(env.training);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k.toLowerCase()); walk(v); }
    };
    walk([await env.training.getHub(CLAIM), session, await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })]);
    for (const key of keys) expect(key, key).not.toMatch(/score|rank|rating|index|percent|ratio|fraction|exposure|distinct|novelty/);
  });
});
