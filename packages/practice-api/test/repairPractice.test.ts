import { InMemoryAutopsyDecisionRepository, InMemoryErrorTaxonomyReader } from "@ipmat/db";
import { describe, expect, it } from "vitest";
import type { HypothesisGenerator, HypothesisSealer } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World, publishedQuestion, publishedQuestionContent, t } from "./fixtures.js";

/**
 * Phase 4 Unit 4 -- TARGETED REPAIR PRACTICE end to end at the service level: the real attempt lifecycle, the real persisted-state
 * composition, the real orchestrator (repair tier -> training systems -> adaptive) and the real in-memory decision store (the Prisma
 * store implements the same contract; real Postgres is exercised in the integration suite).
 *
 * The diagnosed question is q-diag (Reverse Percentage, cell-rev-1, trap base_confusion). The pool:
 *   q-cell     same cell + trap           -> tier direct_cell_and_trap
 *   q-family   same family, other cell    -> tier pattern_family_and_trap
 *   q-trap     other family, same trap    -> tier trap_only
 *   q-broad    other family, no trap      -> tier concept_fallback
 */

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const OTHER = { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT };

interface Spec { id: string; family: string; cell: string; trap: string | null; tier?: "standard" | "advanced"; state?: "published" | "draft"; expected?: number }
const SPECS: Record<string, Spec> = {
  "q-diag": { id: "q-diag", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion" },
  "q-cell": { id: "q-cell", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion" },
  "q-family": { id: "q-family", family: "Reverse Percentage", cell: "cell-rev-2", trap: "base_confusion" },
  "q-trap": { id: "q-trap", family: "Successive Change", cell: "cell-suc-1", trap: "base_confusion" },
  "q-broad": { id: "q-broad", family: "Point Difference", cell: "cell-pt-1", trap: null }
};

const dna = (s: Spec) => ({
  question: {
    questionId: s.id, examCode: "IPMAT_INDORE", sectionName: "Quant", chapterName: "Percentages", conceptName: "Percentages", patternFamilyName: s.family, patternTaxonomyCellId: s.cell,
    difficultyTier: s.tier ?? ("standard" as const),
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard" as const, examRelevance: "core" as const, testingModes: ["reverse" as const], trapErrorTaxonomyCode: s.trap, combinesWithConcepts: []
  },
  expectedTimeSeconds: s.expected ?? 90,
  validationState: (s.state ?? "published") as "published"
});

function testSealer(): HypothesisSealer {
  return {
    seal: (payload) => `T.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`,
    open: (token) => {
      const [s, body] = token.split(".");
      if (s !== "T" || !body) return null;
      try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown; } catch { return null; }
    }
  };
}
const generator: HypothesisGenerator = async (observation, context) => ({
  attemptId: observation.identity.attemptId,
  proposedErrorCategory: context.designedErrorCategory,
  proposedExplanation: "The answer you selected may be one of the common wrong options for this pattern.",
  supportingEvidence: [`Your selected answer was ${observation.outcome.selectedAnswer}.`, "Your answer was incorrect."],
  contradictoryEvidence: [], missingEvidence: [], modelConfidence: 0.7, confirmationRequired: true, confirmationStatus: "awaiting_confirmation", studentCorrectionText: null, respondedAt: null,
  generationMetadata: { provider: "p", model: "m", promptVersion: "v", task: "autopsy-hypothesis", timestamp: t(0), latencyMs: 1, tokenUsage: null, estimatedCostUsd: null, attempts: 1, success: true, validationOutcome: "valid" }
});

interface Rig { world: World; store: InMemoryAutopsyDecisionRepository }
function rig(ids: string[] = ["q-diag", "q-cell", "q-family", "q-trap", "q-broad"], specs: Record<string, Spec> = SPECS, reverse = false): Rig {
  const world = new World();
  const pool = ids.map((id) => specs[id]!);
  world.questions = pool.map((s) => ({ ...publishedQuestion, id: s.id }));
  world.questionContent = pool.map((s) => ({ ...publishedQuestionContent, id: s.id }));
  const store = new InMemoryAutopsyDecisionRepository();
  const records = pool.map(dna);
  world.trainingRecommendationOverrides = {
    trainingQuestionReader: { findPublishedByExamId: async () => (reverse ? [...records].reverse() : records) },
    conceptReader: { findWithPublishedQuestionsByExamId: async () => [{ id: "concept-percentages", name: "Percentages", chapterId: "chapter-1" }] },
    repairPlanReader: store,
    repairPlanStatusWriter: store,
    errorTaxonomyReader: new InMemoryErrorTaxonomyReader()
  };
  world.hypothesis = { hypothesisGenerator: generator, hypothesisSealer: testSealer(), autopsyStore: store };
  return { world, store };
}

let clock = 0;
const tick = () => (clock += 10);
async function attempt(world: World, questionId: string, outcome: "correct" | "wrong" | "skip", who = claim): Promise<string> {
  const start = tick();
  const { attemptId } = await world.service().startAttempt(who, { questionId, now: t(start) });
  const end = tick();
  if (outcome === "skip") await world.service().skipAttempt(who, { attemptId, questionId, now: t(end) });
  else await world.service().submitAttempt(who, { attemptId, questionId, chosenAnswer: outcome === "correct" ? ANSWER_KEY : "999", now: t(end) });
  return attemptId;
}
async function wrongThenDecide(r: Rig, decision: "confirmed" | "rejected" | "corrected", questionId = "q-diag", who = claim) {
  const attemptId = await attempt(r.world, questionId, "wrong", who);
  const offer = await r.world.service().generateHypothesis(who, { attemptId, now: t(tick()) });
  if (offer.status !== "ready") throw new Error(`no offer: ${offer.status}`);
  const response = decision === "corrected" ? { type: "corrected" as const, correctedExplanation: "my own words" } : { type: decision };
  await r.world.service().respondToHypothesis(who, { attemptId, token: offer.token, response, now: t(tick()) });
  return attemptId;
}
const next = (r: Rig, who = claim) => r.world.service().getNextRecommendation(who);
const isRepair = (v: { modeLabel: string }) => v.modeLabel === "Confirmed pattern";
const planOf = async (r: Rig, attemptId: string) => (await r.store.findByAttemptId(attemptId))!.repairPlan;

describe("targeted repair selection (existing deterministic selector, now fed real stored plans)", () => {
  it("a confirmed plan makes the next question a repair question about the confirmed concept and pattern -- and never the one just answered", async () => {
    const r = rig();
    const before = await next(r);
    await wrongThenDecide(r, "confirmed");
    const view = await next(r);
    expect(isRepair(view)).toBe(true);
    expect(view.questionId).not.toBe("q-diag"); // no immediate repeat when another candidate exists
    expect(view.questionId).toBe("q-cell"); // the exact diagnosed cell+trap beats family-only, trap-only and broad
    expect(view.explanation).toContain("Reverse Percentage");
    expect(view.explanation).toContain("Percentages");
    expect(before.questionId === view.questionId && isRepair(before)).toBe(false);
  });

  it("matching preference order: cell > family(+trap) > trap-only > concept fallback, as each better candidate is removed", async () => {
    const order: Array<[string[], string, RegExp]> = [
      [["q-diag", "q-cell", "q-family", "q-trap", "q-broad"], "q-cell", /same pattern/],
      [["q-diag", "q-family", "q-trap", "q-broad"], "q-family", /same pattern/],
      [["q-diag", "q-trap", "q-broad"], "q-trap", /same kind of wrong-answer trap in a different pattern/],
      [["q-diag", "q-broad"], "q-broad", /No question for that exact pattern is available right now, so this is a broader Percentages question/]
    ];
    for (const [ids, expected, copy] of order) {
      const r = rig(ids);
      await wrongThenDecide(r, "confirmed");
      const view = await next(r);
      expect(isRepair(view)).toBe(true);
      expect(view.questionId).toBe(expected);
      expect(view.explanation).toMatch(copy);
    }
  });

  it("candidate input order cannot change the result, and repeated/concurrent calls agree", async () => {
    const a = rig(undefined, SPECS, false);
    const b = rig(undefined, SPECS, true);
    await wrongThenDecide(a, "confirmed");
    await wrongThenDecide(b, "confirmed");
    const va = await next(a);
    expect(await next(b)).toEqual(va);
    const burst = await Promise.all(Array.from({ length: 12 }, () => next(a)));
    for (const v of burst) expect(v).toEqual(va);
  });

  it("an unpublished candidate is never selected, even when it is the best match", async () => {
    const specs = { ...SPECS, "q-draft": { id: "q-draft", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", state: "draft" as const } };
    const r = rig(["q-diag", "q-draft", "q-family", "q-trap"], specs);
    await wrongThenDecide(r, "confirmed");
    const view = await next(r);
    expect(view.questionId).toBe("q-family");
    expect(view.questionId).not.toBe("q-draft");
  });

  it("difficulty: the tie-break starts at the DIAGNOSED question's own tier -- there is no escalation", async () => {
    const specs: Record<string, Spec> = {
      "q-diag": { ...SPECS["q-diag"]!, tier: "advanced" },
      "q-cell-a": { id: "q-cell-a", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", tier: "standard" },
      "q-cell-b": { id: "q-cell-b", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", tier: "advanced" }
    };
    const r = rig(["q-diag", "q-cell-a", "q-cell-b"], specs);
    await wrongThenDecide(r, "confirmed");
    // both are the same match tier; the advanced one is at the diagnosed tier (a-before-b by id alone would have chosen q-cell-a)
    expect((await next(r)).questionId).toBe("q-cell-b");
  });

  it("when the only candidate is the question just answered, the documented sole-candidate behaviour applies (it is served, with honest copy) -- never an invented target", async () => {
    const r = rig(["q-diag"]);
    await wrongThenDecide(r, "confirmed");
    const view = await next(r);
    expect(view.questionId).toBe("q-diag");
    expect(view.explanation).toContain("Reverse Percentage");
  });

  it("no candidate on the target concept at all -> deterministic fallback to ordinary adaptive practice (practice is never blocked)", async () => {
    const r = rig(["q-diag", "q-cell"]);
    await wrongThenDecide(r, "confirmed");
    // remove the target concept from the pool after confirming: a broken or unservable plan must not block practice
    r.world.trainingRecommendationOverrides = {
      ...r.world.trainingRecommendationOverrides,
      trainingQuestionReader: { findPublishedByExamId: async () => [{ ...dna(SPECS["q-cell"]!), question: { ...dna(SPECS["q-cell"]!).question, conceptName: "Ratio" } }] }
    };
    const view = await next(r);
    expect(isRepair(view)).toBe(false);
    expect(view.questionId).toBe("q-cell");
    expect(await next(r)).toEqual(view); // deterministic
  });
});

describe("repair priority", () => {
  it("a valid confirmed plan outranks every ordinary adaptive reason; without one the same student gets ordinary practice", async () => {
    const withPlan = rig();
    const without = rig();
    await wrongThenDecide(withPlan, "confirmed");
    await wrongThenDecide(without, "rejected");
    expect(isRepair(await next(withPlan))).toBe(true);
    expect(isRepair(await next(without))).toBe(false);
  });

  it("a rejected explanation creates no repair; a corrected one creates none either and does not bypass diagnosis", async () => {
    for (const decision of ["rejected", "corrected"] as const) {
      const r = rig();
      const attemptId = await wrongThenDecide(r, decision);
      expect(await planOf(r, attemptId)).toBeNull();
      expect(await r.store.findConfirmedActiveByStudentId(STUDENT)).toEqual([]);
      expect(isRepair(await next(r))).toBe(false);
    }
  });

  it("two confirmed plans never create two repair flows: exactly one question is offered, deterministically", async () => {
    const r = rig();
    await wrongThenDecide(r, "confirmed", "q-diag");
    await wrongThenDecide(r, "confirmed", "q-trap");
    const views = await Promise.all(Array.from({ length: 6 }, () => next(r)));
    for (const v of views) expect(v).toEqual(views[0]);
    expect(isRepair(views[0]!)).toBe(true);
    expect(typeof views[0]!.questionId).toBe("string");
  });
});

describe("RepairPlan lifecycle (pending -> in_progress -> completed), derived from persisted attempts", () => {
  it("answering the repair question is an ordinary persisted attempt; the plan moves to in_progress; ONE correct answer does not complete it", async () => {
    const r = rig();
    const diagnosed = await wrongThenDecide(r, "confirmed");
    expect((await planOf(r, diagnosed))!.status).toBe("pending");
    const first = await next(r);
    const repairAttempt = await attempt(r.world, first.questionId!, "correct");

    // a normal result and normal evidence exist for it
    expect((await r.world.service().getAttemptResult(claim, { attemptId: repairAttempt })).status).toBe("submitted");
    const evidence = await r.world.service().getAttemptEvidence(claim, { attemptId: repairAttempt });
    expect(evidence.status).toBe("submitted");

    const again = await next(r); // recomputes the lifecycle and syncs the stored status
    expect((await planOf(r, diagnosed))!.status).toBe("in_progress");
    expect(isRepair(again)).toBe(true); // still repairing: one correct answer is not proof
    expect(again.questionId).not.toBe(first.questionId); // and not the question just answered
  });

  it("two consecutive correct direct-match answers complete the plan: the stored status follows, repair stops, ordinary practice resumes", async () => {
    const r = rig();
    const diagnosed = await wrongThenDecide(r, "confirmed");
    const q1 = (await next(r)).questionId!;
    await attempt(r.world, q1, "correct");
    const q2 = (await next(r)).questionId!;
    await attempt(r.world, q2, "correct");
    const view = await next(r);
    expect((await planOf(r, diagnosed))!.status).toBe("completed");
    expect(isRepair(view)).toBe(false);
    expect(await r.store.findConfirmedActiveByStudentId(STUDENT)).toEqual([]);
  });

  it("an incorrect repair answer keeps repairing until the round limit, then releases the student -- a failing plan cannot block practice forever", async () => {
    const r = rig();
    const diagnosed = await wrongThenDecide(r, "confirmed");
    for (let round = 0; round < 3; round++) {
      const v = await next(r);
      expect(isRepair(v)).toBe(true);
      await attempt(r.world, v.questionId!, "wrong");
    }
    const view = await next(r);
    expect(isRepair(view)).toBe(false);
    expect((await planOf(r, diagnosed))!.status).toBe("completed");
  });

  it("status is reconstructed from persisted attempts after a 'restart' (a fresh service on the same store) and the decision is unchanged", async () => {
    const r = rig();
    const diagnosed = await wrongThenDecide(r, "confirmed");
    await attempt(r.world, (await next(r)).questionId!, "wrong");
    const before = await next(r);
    r.world.hypothesis = { ...r.world.hypothesis }; // a fresh service() is built on every call: nothing is cached between them
    expect(await next(r)).toEqual(before);
    expect((await planOf(r, diagnosed))!.status).toBe("in_progress");
  });

  it("a NEW confirmed diagnosis after completion starts a new plan (the mistake can become eligible again)", async () => {
    const r = rig();
    const first = await wrongThenDecide(r, "confirmed");
    await attempt(r.world, (await next(r)).questionId!, "correct");
    await attempt(r.world, (await next(r)).questionId!, "correct");
    await next(r);
    expect((await planOf(r, first))!.status).toBe("completed");
    const second = await wrongThenDecide(r, "confirmed", "q-trap");
    expect((await planOf(r, second))!.status).toBe("pending");
    expect(isRepair(await next(r))).toBe(true);
  });

  it("the stored status never moves backwards and never skips an unrelated plan or student", async () => {
    const r = rig();
    const mine = await wrongThenDecide(r, "confirmed");
    const planId = (await planOf(r, mine))!.id;
    expect(await r.store.advanceStatus({ planId, studentId: STUDENT, to: "completed" })).toBe(true);
    expect(await r.store.advanceStatus({ planId, studentId: STUDENT, to: "in_progress" })).toBe(false); // backwards: refused
    expect(await r.store.advanceStatus({ planId, studentId: OTHER_STUDENT, to: "completed" })).toBe(false); // another student's plan
    expect((await planOf(r, mine))!.status).toBe("completed");
  });
});

describe("isolation, provenance, and what the student sees", () => {
  it("another student's plan never influences this student's recommendation", async () => {
    const r = rig();
    await wrongThenDecide(r, "confirmed");
    const stranger = await next(r, OTHER);
    expect(isRepair(stranger)).toBe(false);
  });

  it("the plan stays traceable: plan -> autopsy -> attempt, with the student's confirmation time", async () => {
    const r = rig();
    const diagnosed = await wrongThenDecide(r, "confirmed");
    const stored = (await r.store.findByAttemptId(diagnosed))!;
    expect(stored.repairPlan).toMatchObject({ attemptId: diagnosed, autopsyId: stored.autopsy.id, studentId: STUDENT });
    expect(stored.repairPlan!.confirmedAt).toBe(stored.autopsy.confirmedAt);
  });

  it("the student-facing recommendation carries only the four display fields: no ids, taxonomy codes, tiers, confidence, provider or prompt, and no psychological claims", async () => {
    for (const ids of [["q-diag", "q-cell", "q-family", "q-trap", "q-broad"], ["q-diag", "q-broad"]]) {
      const r = rig(ids);
      await wrongThenDecide(r, "confirmed");
      const view = await next(r);
      expect(Object.keys(view).sort()).toEqual(["explanation", "headline", "modeLabel", "questionId"]);
      const text = `${view.modeLabel} ${view.headline} ${view.explanation}`;
      expect(text).not.toMatch(/base_confusion|taxonomy|cell-|q-diag|q-cell|direct_cell|concept_fallback|pattern_family|modelConfidence|provider|prompt|priority|misconception|autopsy/i);
      expect(text).not.toMatch(/confiden|motivat|careless|anxi|lazy|intelligen|emotion|you (felt|knew|thought)|weak|struggl|fixed|mastered|solved/i);
      expect(text).not.toContain(ANSWER_KEY);
    }
  });

  it("no answer key is available before the repair question is answered (the recommendation view has none)", async () => {
    const r = rig();
    await wrongThenDecide(r, "confirmed");
    expect(JSON.stringify(await next(r))).not.toContain(ANSWER_KEY);
  });
});
