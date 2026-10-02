import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import type { TrainingNextView } from "../src/trainingTypes.js";
import { ANSWER_KEY, CLAIM, CORRECT, COMPLETE_2, COMPLETE_5, ENROLLMENT, OTHER_CLAIM, WRONG, TrainingWorld, t, type WorldQuestion } from "./trainingWorld.js";

/**
 * Phase 5 Unit 7 -- Revision as the sixth real training system inside the Unit 1-6 session framework. Everything runs the REAL
 * `@ipmat/revision-training` provider through the REAL recommendation composition; nothing about the provider is faked.
 *
 * Revision (D-081) is CONCEPT-level deliberate re-exposure: a concept needs >= 3 graded attempts AND its most recent graded attempt >= 14 days old;
 * the target is the eligible concept dormant the longest (concept name breaks ties); questions are published + well-formed + exact concept, unseen
 * taxonomy cell first, then least exposure, then question id. No stages, no stored state.
 *
 * TEST DATA pool. "Percentages": H1-H3 (answered as history, cells cH1-cH3), R1-R4 fresh (cells cR1-cR4, R4 shares cR3). "Ratio": T1-T3 (history),
 * U1-U2 fresh. Fdraft unpublished.
 */
const DAY = 86_400;
const pool = (): WorldQuestion[] => [
  ...["H1", "H2", "H3"].map((id, i): WorldQuestion => ({ id, noveltyLevel: "standard", cell: `cH${i + 1}` })),
  ...["R1", "R2", "R3", "R4"].map((id, i): WorldQuestion => ({ id, noveltyLevel: "standard", cell: i === 3 ? "cR3" : `cR${i + 1}` })),
  ...["T1", "T2", "T3"].map((id, i): WorldQuestion => ({ id, noveltyLevel: "standard", cell: `cT${i + 1}`, concept: "Ratio" })),
  ...["U1", "U2"].map((id, i): WorldQuestion => ({ id, noveltyLevel: "standard", cell: `cU${i + 1}`, concept: "Ratio" })),
  { id: "Fdraft", noveltyLevel: "standard", cell: "cD", validationState: "ai_validated" }
];

async function boot(options: { percentagesAt?: number; ratioAt?: number | null; correct?: boolean; nowDays?: number } = {}) {
  const world = new TrainingWorld(0, pool());
  const services = world.boot();
  const correct = options.correct ?? true;
  // history: Percentages H1-H3 starting at `percentagesAt` seconds, optionally Ratio T1-T3
  await world.answer(services.practice, ["H1", "H2", "H3"].map((id) => ({ id, correct })), CLAIM, options.percentagesAt ?? 0);
  if (options.ratioAt !== null && options.ratioAt !== undefined) await world.answer(services.practice, ["T1", "T2", "T3"].map((id) => ({ id, correct })), CLAIM, options.ratioAt);
  world.nowSeconds = (options.nowDays ?? 20) * DAY;
  return { world, ...services };
}
const card = async (training: ReturnType<TrainingWorld["boot"]>["training"], atSeconds: number) => (await training.getHub(CLAIM, { now: t(atSeconds) })).systems.find((s) => s.systemId === "revision")!;
const start = async (training: ReturnType<TrainingWorld["boot"]>["training"], atSeconds: number, config: unknown = COMPLETE_5) => (await training.startSession(CLAIM, { systemId: "revision", config, now: t(atSeconds) })).session;
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

describe("Revision -- the hub card and the provider's applicability, not weakened", () => {
  it("appears as a deliberate-training card; with no history it is honestly unavailable", async () => {
    const { training } = new TrainingWorld(0, pool()).boot();
    expect(await card(training, 0)).toMatchObject({
      systemId: "revision",
      label: "Revision",
      dimension: "revision",
      availability: "not_applicable",
      note: "Needs a concept you have practiced several times before and have not attempted for a while.",
      trains: "Revisit a concept you have practiced before but not attempted for a while.",
      completionKinds: null
    });
  });

  it("recent history (under 14 days) never activates it, however much of it there is", async () => {
    const { training } = await boot({ nowDays: 13 });
    expect((await card(training, 0)).availability).toBe("not_applicable");
  });

  it("fewer than 3 graded attempts never activates it, however old", async () => {
    const world = new TrainingWorld(0, pool());
    const { practice, training } = world.boot();
    await world.answer(practice, [{ id: "H1", correct: true }, { id: "H2", correct: true }]);
    world.nowSeconds = 60 * DAY;
    expect((await card(training, 0)).availability).toBe("not_applicable");
  });

  it("the exact 14-day boundary is measured from the most recent graded attempt's persisted time", async () => {
    // history is answered at t(0), t(120), t(240) with a 60 s answer time: the last finalizes at t(300)
    const world = new TrainingWorld(0, pool());
    const { practice, training } = world.boot();
    await world.answer(practice, ["H1", "H2", "H3"].map((id) => ({ id, correct: true })));
    const lastFinalized = 240 + 60;
    world.nowSeconds = lastFinalized + 14 * DAY - 1;
    expect((await card(training, 0)).availability).toBe("not_applicable");
    world.nowSeconds = lastFinalized + 14 * DAY;
    expect((await card(training, 0)).availability).toBe("available");
  });

  it("three dormant graded attempts make it available, whether the answers were right or wrong (re-exposure, not mistake repair)", async () => {
    for (const correct of [true, false]) {
      const { training } = await boot({ correct });
      expect(await card(training, 0), String(correct)).toMatchObject({ availability: "available", note: "Ready to train." });
    }
  });

  it("is independent of every other system: recent history that activates Novelty does not activate Revision, and vice versa", async () => {
    const world = new TrainingWorld(4); // the default world: 9 history questions make Novelty applicable
    const { practice, training } = world.boot();
    await world.seedHistory(practice);
    world.nowSeconds = 100_000; // history is ~1 day old
    const recent = (await training.getHub(CLAIM, { now: t(0) })).systems;
    expect(recent.find((s) => s.systemId === "novelty-training")!.availability).toBe("available");
    expect(recent.find((s) => s.systemId === "revision")!.availability).toBe("not_applicable");
    world.nowSeconds = 30 * DAY; // the same history, a month on
    const later = (await training.getHub(CLAIM, { now: t(0) })).systems;
    expect(later.find((s) => s.systemId === "revision")!.availability).toBe("available");
    expect(later.find((s) => s.systemId === "novelty-training")!.availability).toBe("available"); // novelty's own rule is unchanged by time
  });
});

describe("Revision -- the session: no stages, concept-scoped, one concept at a time", () => {
  it("states a student-safe objective that names no concept and carries no stage", async () => {
    const { training } = await boot();
    const session = await start(training, 20 * DAY);
    expect(session).toMatchObject({ systemId: "revision", systemLabel: "Revision", systemTitle: "Revision", dimension: "revision", status: "active", stage: null });
    expect(session.objective).toEqual({
      statement: "Revisit a concept you have practiced before but not attempted for a while. This session is revisiting a concept you have not practiced for a while.",
      targetConceptName: null
    });
  });

  it("serves a published question of the dormant concept, preferring an unseen taxonomy cell; the first is R1 (cell cR1)", async () => {
    const { training } = await boot();
    const session = await start(training, 20 * DAY);
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 10) }));
    expect(q.question.questionId).toBe("R1");
    expect(q.stageTransition).toBeNull();
    expect(q.session.stage).toBeNull();
  });

  it("history: the revision attempt is an ordinary attempt, and the revised concept stops qualifying -- the session then says so and offers to end", async () => {
    const { world, practice, training } = await boot();
    const session = await start(training, 20 * DAY);
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 10) }));
    expect(await practice.submitAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, chosenAnswer: CORRECT, now: t(20 * DAY + 40) })).toMatchObject({ status: "submitted", isCorrect: true });
    world.nowSeconds = 20 * DAY + 60;
    const next = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 60) });
    expect(next).toMatchObject({
      status: "no_question",
      message: "That concept has now been revisited, and no other concept is waiting for a revisit right now. You can end the session.",
      session: { status: "active", stage: null }
    });
    expect(await training.finishSession(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 70) })).toMatchObject({ status: "completed", stage: null, summary: { submittedCount: 1, correctCount: 1 } });
    expect((await card(training, 20 * DAY + 80)).availability).toBe("not_applicable"); // the latest graded attempt is now recent
  });

  it("with two dormant concepts the longest-dormant goes first, then the next concept becomes the target (rotation, never a repeat of the revised one)", async () => {
    const { world, practice, training } = await boot({ percentagesAt: 0, ratioAt: 3 * DAY, nowDays: 30 });
    const session = await start(training, 30 * DAY, COMPLETE_5);
    const served: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const next = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(30 * DAY + i * 100) });
      if (next.status !== "question") {
        served.push(next.status);
        break;
      }
      served.push(next.question.questionId);
      await practice.submitAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, chosenAnswer: i === 0 ? CORRECT : WRONG, now: t(30 * DAY + i * 100 + 30) });
      world.nowSeconds = 30 * DAY + i * 100 + 60;
    }
    expect(served).toEqual(["R1", "U1", "no_question"]); // Percentages (older) first, then Ratio, then nothing is dormant any more
  });

  it("never switches concept to fill a pool: a started session serves only the target concept's questions", async () => {
    const { world, practice, training } = await boot({ ratioAt: 5 * DAY, nowDays: 40 });
    const session = await start(training, 40 * DAY);
    const q = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(40 * DAY + 10) }));
    expect(["R1", "R2", "R3", "R4", "H1", "H2", "H3"]).toContain(q.question.questionId);
    expect(["T1", "T2", "T3", "U1", "U2", "Fdraft"]).not.toContain(q.question.questionId);
    expect(world.pool.length).toBeGreaterThan(0);
    await practice.skipAttempt(CLAIM, { attemptId: q.attemptId, questionId: q.question.questionId, now: t(40 * DAY + 30) });
  });

  it("a skipped revision question is not a graded attempt: the concept stays dormant and the session keeps serving it", async () => {
    const { world, practice, training } = await boot();
    const session = await start(training, 20 * DAY);
    const q1 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 10) }));
    await practice.skipAttempt(CLAIM, { attemptId: q1.attemptId, questionId: q1.question.questionId, now: t(20 * DAY + 20) });
    world.nowSeconds = 20 * DAY + 30;
    const q2 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 40) }));
    expect(q2.question.questionId).toBe("R2"); // not R1 again (no repeat within a session), same concept
  });

  it("repeat the concept's surface last: an unseen cell is served before an already-seen one (R4 shares R3's cell)", async () => {
    const { world, practice, training } = await boot({ nowDays: 20 });
    const session = await start(training, 20 * DAY, { completion: { kind: "fixed_question_count", questionCount: 10 } });
    const served: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      world.nowSeconds = 20 * DAY + i * 100;
      const next = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + i * 100 + 5) });
      if (next.status !== "question") break;
      served.push(next.question.questionId);
      await practice.skipAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, now: t(20 * DAY + i * 100 + 20) }); // skips keep the concept dormant
    }
    expect(served.slice(0, 3)).toEqual(["R1", "R2", "R3"]);
    expect(served.indexOf("R4")).toBeGreaterThan(served.indexOf("R3"));
    expect(new Set(served).size).toBe(served.length);
  });
});

describe("Revision -- refusal, restart, ownership, concurrency, leakage, scope", () => {
  it("a session cannot start when nothing is dormant (409-class refusal), and nothing is created", async () => {
    const { training } = await boot({ nowDays: 2 });
    expect((await rejection(training.startSession(CLAIM, { systemId: "revision", config: COMPLETE_2, now: t(0) }))).code).toBe("invalid_state");
    expect((await training.getHub(CLAIM)).activeSession).toBeNull();
  });

  it("either completion rule is allowed (Revision restricts nothing)", async () => {
    for (const config of [COMPLETE_2, { completion: { kind: "fixed_duration", durationSeconds: 300 } }]) {
      const { training } = await boot();
      expect((await start(training, 20 * DAY, config)).status).toBe("active");
    }
  });

  it("a restarted (or second) instance resumes the same session and the same open question", async () => {
    const { world, training } = await boot();
    const session = await start(training, 20 * DAY);
    const q1 = asQuestion(await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 10) }));
    const again = asQuestion(await world.boot().training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 20) }));
    expect(again.attemptId).toBe(q1.attemptId);
  });

  it("another student can neither read nor advance a Revision session", async () => {
    const { training } = await boot();
    const session = await start(training, 20 * DAY);
    for (const call of [() => training.getSession(OTHER_CLAIM, { sessionId: session.sessionId }), () => training.nextQuestion(OTHER_CLAIM, { sessionId: session.sessionId })]) {
      expect((await rejection(call())).code).toBe("ownership_mismatch");
    }
  });

  it("concurrent starts make one session; concurrent next calls (one instance and two) make one open attempt", async () => {
    const { world, training } = await boot();
    const starts = await Promise.all([1, 2, 3, 4].map(() => training.startSession(CLAIM, { systemId: "revision", config: COMPLETE_5, now: t(20 * DAY) })));
    expect(new Set(starts.map((r) => r.session.sessionId)).size).toBe(1);
    const sessionId = starts[0]!.session.sessionId;
    const results = await Promise.all([1, 2, 3].map(() => training.nextQuestion(CLAIM, { sessionId, now: t(20 * DAY + 10) })).concat([world.boot().training.nextQuestion(CLAIM, { sessionId, now: t(20 * DAY + 10) })]));
    expect(new Set(results.map((r) => asQuestion(r).attemptId)).size).toBe(1);
  });

  it("no view leaks an answer key, the dormancy rule, a threshold, a count, a timestamp, a provider id, diagnostics or a taxonomy cell; no trait or forgetting wording", async () => {
    const { training } = await boot();
    const session = await start(training, 20 * DAY);
    const q1 = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 10) });
    const hub = await training.getHub(CLAIM);
    // Revision's own surfaces only (other systems' authored cards are covered by their own units).
    const text = JSON.stringify([hub.systems.find((s) => s.systemId === "revision"), hub.activeSession, session, q1, await training.getSession(CLAIM, { sessionId: session.sessionId })]);
    expect(text).not.toContain(ANSWER_KEY);
    for (const banned of ["revision-training", "providerId", "providerResult", "diagnostics", "\"requirement\"", "targetConceptName\":\"", "dormant", "dormancy", "14 day", "14-day", "fourteen", "finalizedAt", "lastGraded", "gradedAttempt", "cH1", "cR1", "cT1", "correctAnswer", "threshold"]) {
      expect(text, banned).not.toContain(banned);
    }
    const hit = text.toLowerCase().match(/forgot|forget|memory|decay|confiden|motivat|emotion|babilityb|weak|lazy|careless|struggle|you lack|stress|anxi/);
    expect(hit).toBeNull();
  });

  it("adds no score, rank, priority, due date, interval or state anywhere in any view", async () => {
    const { training } = await boot();
    const session = await start(training, 20 * DAY);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k.toLowerCase()); walk(v); }
    };
    walk([await training.getHub(CLAIM), session, await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + 10) })]);
    for (const key of keys) expect(key, key).not.toMatch(/(^|_)(score|rank|rating|priority|due|interval|nextrevision|revisionstate|decay|probability)/);
  });
});

describe("Revision -- property test (seeded, no Math.random)", () => {
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

  it("for 20 seeded candidate orders the served sequence is identical, repeat-free and of the target concept only", async () => {
    const run = async (items: WorldQuestion[]): Promise<string[]> => {
      const world = new TrainingWorld(0, items);
      const { practice, training } = world.boot();
      await world.answer(practice, ["H1", "H2", "H3"].map((id) => ({ id, correct: true })));
      world.nowSeconds = 20 * DAY;
      const session = (await training.startSession(CLAIM, { systemId: "revision", config: { completion: { kind: "fixed_question_count", questionCount: 10 } }, now: t(20 * DAY) })).session;
      const served: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        world.nowSeconds = 20 * DAY + i * 100;
        const next = await training.nextQuestion(CLAIM, { sessionId: session.sessionId, now: t(20 * DAY + i * 100 + 5) });
        if (next.status !== "question") break;
        served.push(next.question.questionId);
        await practice.skipAttempt(CLAIM, { attemptId: next.attemptId, questionId: next.question.questionId, now: t(20 * DAY + i * 100 + 20) });
      }
      return served;
    };
    const reference = await run(pool());
    expect(reference.length).toBeGreaterThan(4);
    for (let seed = 1; seed <= 20; seed += 1) {
      expect(await run(shuffled(pool(), lcg(seed))), `seed ${seed}`).toEqual(reference);
    }
    expect(new Set(reference).size).toBe(reference.length);
    for (const id of reference) expect(["T1", "T2", "T3", "U1", "U2", "Fdraft"]).not.toContain(id);
  });
});

describe("Revision -- scope of the session framework", () => {
  it("the other systems' hub states are unchanged by Revision's presence", async () => {
    const { training } = new TrainingWorld(0, pool()).boot();
    const systems = (await training.getHub(CLAIM, { now: t(0) })).systems;
    expect(systems.map((s) => s.label)).toEqual(["Calculation", "Speed", "Traps", "Novelty", "Pressure", "Revision", "Overtraining"]);
    expect(systems.find((s) => s.systemId === "overtraining")!.availability).toBe("not_built");
    expect(ENROLLMENT).toBe("enrollment-1");
  });
});
