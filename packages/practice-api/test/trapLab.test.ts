import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import type { TrainingNextView } from "../src/trainingTypes.js";
import { ANSWER_KEY, CLAIM, COMPLETE_2, CORRECT, OTHER_CLAIM, WRONG, TrainingWorld, t, type WorldQuestion } from "./trainingWorld.js";

/**
 * Phase 5 Unit 4 -- Trap Lab as the fourth real training system inside the Unit 1-3 session framework. Everything runs the REAL `@ipmat/trap-lab`
 * provider (applicability, target code, selection) through the real recommendation composition and the real in-memory repositories; nothing about
 * the provider is faked. TEST DATA pool (expected time 90 s for every question):
 *   history   P1 P2 (Percentages, trap base_confusion, cells cP1 cP2)   R1 (Ratio, base_confusion, cell cR1)   O1 O2 (other_code)
 *   fresh     B1 (base_confusion, cell cP1 = ALREADY-SEEN surface)   B2 B3 (unseen cells)   BR (Ratio, unseen cell)   OB1 (other_code)   N1 (no trap)
 * Trap Lab has NO stages (D-056): every view must report `stage: null` and no stage transition.
 */
type Pool = WorldQuestion[];
const BASE = "base_confusion";
function q(id: string, trap: string | null, cell: string, concept = "Percentages", extra: Partial<WorldQuestion> = {}): WorldQuestion {
  return { id, noveltyLevel: "standard", trap, cell, concept, ...extra };
}
function basePool(): Pool {
  return [
    q("P1", BASE, "cP1"),
    q("P2", BASE, "cP2"),
    q("R1", BASE, "cR1", "Ratio"),
    q("O1", "other_code", "cO1"),
    q("O2", "other_code", "cO2"),
    q("B1", BASE, "cP1"),
    q("B2", BASE, "cB2"),
    q("B3", BASE, "cB3"),
    q("BR", BASE, "cBR", "Ratio"),
    q("OB1", "other_code", "cOB1"),
    q("N1", null, "cN1")
  ];
}
const wrong = (...ids: string[]) => ids.map((id) => ({ id, correct: false }));
const right = (...ids: string[]) => ids.map((id) => ({ id, correct: true }));
const RECURRING = wrong("P1", "P2"); // two DISTINCT failing questions, same code

async function boot(pool: Pool = basePool(), plan: Array<{ id: string; correct: boolean }> = RECURRING) {
  const world = new TrainingWorld(0, pool);
  const services = world.boot();
  await world.answer(services.practice, plan);
  return { world, ...services };
}
async function start(training: ReturnType<TrainingWorld["boot"]>["training"], config: unknown = { completion: { kind: "fixed_question_count", questionCount: 10 } }) {
  return (await training.startSession(CLAIM, { systemId: "trap-lab", config, now: t(10_000) })).session;
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
async function serveAndAnswer(env: Awaited<ReturnType<typeof boot>>, sessionId: string, at: number, answer = CORRECT) {
  const next = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId, now: t(at) }));
  await env.practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: answer, now: t(at + 30) });
  return next;
}
const card = async (training: ReturnType<TrainingWorld["boot"]>["training"]) => (await training.getHub(CLAIM, { now: t(10_000) })).systems.find((s) => s.systemId === "trap-lab")!;

describe("Trap Lab -- the Training Hub and applicability (the provider's rule, not weakened)", () => {
  it("appears as a deliberate-training card beside Calculation and Speed, with an honest 'nothing recorded yet' state", async () => {
    const world = new TrainingWorld(0, basePool());
    const { training } = world.boot();
    const systems = (await training.getHub(CLAIM, { now: t(0) })).systems;
    expect(systems.map((s) => s.systemId).slice(0, 3)).toEqual(["calculation-gym", "speed-lab", "trap-lab"]);
    expect(systems.find((s) => s.systemId === "trap-lab")).toMatchObject({
      label: "Traps",
      dimension: "trap",
      availability: "not_applicable",
      note: "Needs recorded incorrect answers on questions that share a trap pattern first.",
      trains: "Practice a recurring trap pattern: the same kind of trap, in different question formats."
    });
    expect(systems.find((s) => s.systemId === "overtraining")!.availability).toBe("not_built");
  });

  it("insufficient evidence: no incorrect answer on a trap-tagged question (correct ones, or wrong ones on untagged questions, never count)", async () => {
    for (const plan of [right("P1", "P2"), wrong("N1"), []]) {
      const { training } = await boot(basePool(), plan);
      expect(await card(training)).toMatchObject({ availability: "not_applicable", note: "Needs recorded incorrect answers on questions that share a trap pattern first." });
    }
  });

  it("no recurring trap: ONE incorrect answer, or the SAME question failed many times, never activates it -- and the card says so differently", async () => {
    for (const plan of [wrong("P1"), wrong("P1", "P1", "P1", "P1", "P1")]) {
      const { training } = await boot(basePool(), plan);
      expect(await card(training)).toMatchObject({ availability: "not_applicable", note: "Your recorded practice doesn't show the same trap pattern across several different questions yet." });
      expect((await rejection(training.startSession(CLAIM, { systemId: "trap-lab", config: COMPLETE_2 }))).code).toBe("invalid_state");
    }
  });

  it("different codes never combine: one failure on each of two codes is not a recurrence", async () => {
    const { training } = await boot(basePool(), wrong("P1", "O1"));
    expect((await card(training)).availability).toBe("not_applicable");
  });

  it("recurring trap: two DISTINCT failing questions of one code, including across two different concepts", async () => {
    for (const plan of [RECURRING, wrong("P1", "R1")]) {
      const { training } = await boot(basePool(), plan);
      expect(await card(training)).toMatchObject({ availability: "available", note: "Ready to train." });
    }
  });

  it("correct answers never cancel a recurrence (cumulative, no decay)", async () => {
    const { training } = await boot(basePool(), [...RECURRING, ...right("B1", "B2", "B3", "BR")]);
    expect((await card(training)).availability).toBe("available");
  });

  it("skipped attempts are not evidence", async () => {
    const world = new TrainingWorld(0, basePool());
    const { practice, training } = world.boot();
    await world.answer(practice, wrong("P1"));
    const started = await practice.startAttempt(CLAIM, { questionId: "P2", now: t(500) });
    await practice.skipAttempt(CLAIM, { attemptId: started.attemptId, questionId: "P2", now: t(510) });
    expect((await card(training)).availability).toBe("not_applicable");
  });
});

describe("Trap Lab -- the objective: a student-safe target, and NO stages", () => {
  it("states a trap-pattern focus in observational language -- no code, no count, no concept claim -- titled 'Trap Lab'", async () => {
    const { training } = await boot();
    const session = await start(training);
    expect(session).toMatchObject({ systemId: "trap-lab", systemLabel: "Traps", systemTitle: "Trap Lab", dimension: "trap", status: "active" });
    expect(session.objective.statement).toBe("Practice a recurring trap pattern: the same kind of trap, in different question formats. This session focuses on a trap pattern that has appeared across your practice.");
    expect(session.objective.targetConceptName).toBeNull(); // recurrence is cross-concept; concept is never part of the trap's identity
  });

  it("has no stage anywhere: not on the session, not on the question, no transition -- ever", async () => {
    const env = await boot();
    const session = await start(env.training);
    expect(session.stage).toBeNull();
    for (let i = 0; i < 4; i += 1) {
      const served = await serveAndAnswer(env, session.sessionId, 10_010 + i * 100);
      expect(served.session.stage).toBeNull();
      expect(served.stageTransition).toBeNull();
    }
    expect((await env.training.getSession(CLAIM, { sessionId: session.sessionId, now: t(11_000) })).stage).toBeNull();
    expect(JSON.stringify(await env.training.getHub(CLAIM))).not.toMatch(/Stage \d|stageTransition":\{|"stage":\{/);
  });
});

describe("Trap Lab -- target code and question selection (provider-local, deterministic)", () => {
  it("serves only questions that carry the target trap code: never another code, an untagged question, or an unpublished/malformed one", async () => {
    const pool = [...basePool(), q("Bdraft", BASE, "cD", "Percentages", { validationState: "ai_validated" }), q("Bbad", BASE, "") /* structurally malformed for Trap Lab: no taxonomy cell */];
    const env = await boot(pool);
    const session = await start(env.training);
    const served: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const next = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) });
      if (next.status !== "question") break;
      served.push(next.question.questionId);
      await env.practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: CORRECT, now: t(10_040 + i * 100) });
    }
    expect(served.length).toBeGreaterThan(4);
    for (const id of served) expect(["O1", "O2", "OB1", "N1", "Bdraft"]).not.toContain(id);
    expect(served).not.toContain("Bbad");
  });

  it("repeat the trap, vary the surface: unseen taxonomy cells come first, the already-seen surface last, then least exposure, then question id", async () => {
    const env = await boot();
    const session = await start(env.training);
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) order.push((await serveAndAnswer(env, session.sessionId, 10_010 + i * 100)).question.questionId);
    // seen cells after the history: cP1, cP2 (and cR1 not, it is a different... R1 is not in history). Unseen: B2 (cB2), B3 (cB3), BR (cBR), R1? (R1 cell cR1 unseen -- R1 is a legitimate cross-concept candidate).
    expect(order.slice(0, 3).every((id) => ["B2", "B3", "BR", "R1"].includes(id))).toBe(true);
    expect(order[0]).toBe("B2"); // lexicographic among the equally-unseen, equally-exposed
    expect(new Set(order).size).toBe(order.length);
  });

  it("the largest distinct-failure count picks the target code; an exact tie breaks lexicographically by code", async () => {
    const pool = [
      ...basePool(),
      q("AF1", "aaa_code", "cAF1"),
      q("AF2", "aaa_code", "cAF2"),
      q("AB1", "aaa_code", "cAB1")
    ];
    // base_confusion fails on 3 distinct questions, aaa_code on 2 -> base_confusion wins on count
    const bigger = await boot(pool, [...wrong("P1", "P2", "R1"), ...wrong("AF1", "AF2")]);
    const s1 = await start(bigger.training);
    const n1 = asQuestion(await bigger.training.nextQuestion(CLAIM, { sessionId: s1.sessionId, now: t(10_010) }));
    expect(["B2", "B3", "BR", "B1", "P1", "P2", "R1"]).toContain(n1.question.questionId);
    // 2 vs 2 -> "aaa_code" < "base_confusion"
    const tied = await boot(pool, [...wrong("P1", "P2"), ...wrong("AF1", "AF2")]);
    const s2 = await start(tied.training);
    const n2 = asQuestion(await tied.training.nextQuestion(CLAIM, { sessionId: s2.sessionId, now: t(10_010) }));
    expect(["AB1", "AF1", "AF2"]).toContain(n2.question.questionId);
  });

  it("selection never depends on the order candidates are stored in, and is repeatable (no randomness)", async () => {
    const a = await boot(basePool());
    const b = await boot([...basePool()].reverse());
    const qa = asQuestion(await a.training.nextQuestion(CLAIM, { sessionId: (await start(a.training)).sessionId, now: t(10_010) }));
    const qb = asQuestion(await b.training.nextQuestion(CLAIM, { sessionId: (await start(b.training)).sessionId, now: t(10_010) }));
    expect(qa.question.questionId).toBe(qb.question.questionId);
  });

  it("when the trap's pool runs out the session ends honestly (no_question) -- nothing from another code or an adaptive fallback is served", async () => {
    const pool = [q("P1", BASE, "cP1"), q("P2", BASE, "cP2"), q("B2", BASE, "cB2"), q("O1", "other_code", "cO1"), q("N1", null, "cN1")];
    const env = await boot(pool);
    const session = await start(env.training);
    const served: string[] = [];
    let last: TrainingNextView = { status: "completed", session } as TrainingNextView;
    for (let i = 0; i < 8; i += 1) {
      last = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010 + i * 100) });
      if (last.status !== "question") break;
      served.push(last.question.questionId);
      await env.practice.submitAttempt(CLAIM, { attemptId: last.attemptId, questionId: last.question.questionId, chosenAnswer: CORRECT, now: t(10_040 + i * 100) });
    }
    expect(served.sort()).toEqual(["B2", "P1", "P2"]);
    expect(last.status).toBe("no_question");
    expect(last.session.status).toBe("active");
  });
});

describe("Trap Lab -- the one attempt lifecycle, evidence, completion", () => {
  it("correct, incorrect and skipped answers are ordinary attempts with server-derived verdicts and timing in the session's block", async () => {
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
    expect(inBlock.map((a) => [a.status, a.isCorrect, a.blockMembership?.blockSequenceNumber])).toEqual([["submitted", true, 1], ["submitted", false, 2], ["skipped", null, 3]]);
    expect((await env.practice.getAttemptEvidence(CLAIM, { attemptId: q2.attemptId })).facts).toMatchObject({ verdict: "incorrect", elapsedSeconds: 50 });
    expect(await env.world.attempts.findFinalizedByStudentId("student-1")).toHaveLength(RECURRING.length + 3);
  });

  it("completes with observable counts only -- and claims nothing about the student", async () => {
    const env = await boot();
    const session = await start(env.training, COMPLETE_2);
    await serveAndAnswer(env, session.sessionId, 10_010);
    await serveAndAnswer(env, session.sessionId, 10_100, WRONG);
    const done = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_200) });
    expect(done.status).toBe("completed");
    expect(done.session).toMatchObject({ status: "completed", stage: null, summary: { submittedCount: 2, correctCount: 1, incorrectCount: 1 } });
    const text = JSON.stringify(done).toLowerCase();
    for (const banned of ["mastery", "improved", "weakness", "confidence", "guarantee", "permanent", "score", "prone", "always fall", "diagnos"]) expect(text, banned).not.toContain(banned);
    expect(text).not.toMatch(/\bability\b/);
  });
});

describe("Trap Lab -- restart, ownership, concurrency, leakage, scope", () => {
  it("a restarted (or second) instance resumes the same session and the same open question", async () => {
    const env = await boot();
    const session = await start(env.training);
    const q1 = asQuestion(await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) }));
    const restarted = env.world.boot().training;
    const again = asQuestion(await restarted.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_020) }));
    expect(again.attemptId).toBe(q1.attemptId);
    expect(await restarted.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_030) })).toEqual(await env.training.getSession(CLAIM, { sessionId: session.sessionId, now: t(10_030) }));
  });

  it("another student can neither read nor advance a Trap Lab session", async () => {
    const { training } = await boot();
    const session = await start(training);
    for (const call of [() => training.getSession(OTHER_CLAIM, { sessionId: session.sessionId }), () => training.nextQuestion(OTHER_CLAIM, { sessionId: session.sessionId })]) {
      expect((await rejection(call())).code).toBe("ownership_mismatch");
    }
  });

  it("concurrent starts make one session; concurrent next calls (one instance and two) make one open attempt", async () => {
    const { world, training } = await boot();
    const starts = await Promise.all([1, 2, 3, 4].map(() => training.startSession(CLAIM, { systemId: "trap-lab", config: COMPLETE_2, now: t(10_000) })));
    expect(new Set(starts.map((r) => r.session.sessionId)).size).toBe(1);
    const sessionId = starts[0]!.session.sessionId;
    const other = world.boot().training;
    const results = await Promise.all([1, 2, 3].map(() => training.nextQuestion(CLAIM, { sessionId, now: t(10_010) })).concat([other.nextQuestion(CLAIM, { sessionId, now: t(10_010) })]));
    expect(new Set(results.map((r) => asQuestion(r).attemptId)).size).toBe(1);
    expect(await world.attempts.findByPracticeBlockId((await world.trainingSessions.findById(sessionId))!.block.id)).toHaveLength(1);
  });

  it("no view leaks an answer key, the trap code, taxonomy/cell ids, counts, provider internals or a score; no diagnostic or psychological wording", async () => {
    const env = await boot();
    const session = await start(env.training);
    const q1 = await serveAndAnswer(env, session.sessionId, 10_010);
    const q2 = await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_100) });
    const text = JSON.stringify([await env.training.getHub(CLAIM), session, q1, q2, await env.training.getSession(CLAIM, { sessionId: session.sessionId })]);
    expect(text).not.toContain(ANSWER_KEY);
    for (const banned of [BASE, "other_code", "cP1", "cB2", "cell-", "targetErrorTaxonomyCode", "errorTaxonomy", "distinctFailing", "recurrence", "providerId", "providerResult", "\"requirement\"", "diagnostics", "resistance", "REPEATED_EVIDENCE", "threshold", "correctAnswer"]) {
      expect(text, banned).not.toContain(banned);
    }
    for (const banned of ["confidence", "emotion", "motivation", "anxiety", "mood", "careless", "lazy", "intelligen", "prone", "you always", "diagnos", "bad at", "lack", "trap score"]) {
      expect(text.toLowerCase(), banned).not.toContain(banned);
    }
    expect(text.toLowerCase()).not.toMatch(/\bability\b/); // (the word inside "availability" is not a claim about the student)
  });

  it("adds no new score: no view anywhere has a score/rank/rating/index/percent/count-of-recurrence field", async () => {
    const env = await boot();
    const session = await start(env.training);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k.toLowerCase()); walk(v); }
    };
    walk([await env.training.getHub(CLAIM), session, await env.training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(10_010) })]);
    for (const key of keys) expect(key, key).not.toMatch(/score|rank|rating|index|percent|ratio|fraction|recurr|distinct/);
  });
});
