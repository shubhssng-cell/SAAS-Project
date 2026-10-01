import { InMemoryAutopsyDecisionRepository, InMemoryErrorTaxonomyReader } from "@ipmat/db";
import { describe, expect, it } from "vitest";
import type { HypothesisGenerator, HypothesisSealer } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World, publishedQuestion, publishedQuestionContent, t } from "./fixtures.js";

/**
 * Phase 4 Unit 5 -- the WHOLE chain as one system, deterministically (TEST DATA pool, in-memory store with the Prisma contract; the same
 * scenarios run on real Postgres in the integration suite):
 *
 *   attempt -> observation evidence -> hypothesis -> confirm / reject / correct -> persisted diagnosis -> RepairPlan
 *           -> targeted repair selection -> repair attempt -> lifecycle -> next recommendation
 *
 * Pool (all synthetic): the diagnosed question is Reverse Percentage / cell-rev-1 / trap base_confusion / advanced.
 */

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const OTHER = { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT };

type Tier = "standard" | "advanced" | "hard";
interface Spec { id: string; family: string; cell: string; trap: string | null; tier: Tier; published?: boolean; expected?: number }
const POOL: Record<string, Spec> = {
  "q-diag": { id: "q-diag", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", tier: "advanced" },
  "q-ex-std": { id: "q-ex-std", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", tier: "standard" },
  "q-ex-adv": { id: "q-ex-adv", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", tier: "advanced" },
  "q-ex-hard": { id: "q-ex-hard", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", tier: "hard" },
  "q-fam": { id: "q-fam", family: "Reverse Percentage", cell: "cell-rev-2", trap: "base_confusion", tier: "advanced" },
  "q-trap": { id: "q-trap", family: "Successive Change", cell: "cell-suc-1", trap: "base_confusion", tier: "advanced" },
  "q-broad-1": { id: "q-broad-1", family: "Point Difference", cell: "cell-pt-1", trap: null, tier: "standard" },
  "q-broad-2": { id: "q-broad-2", family: "Point Difference", cell: "cell-pt-2", trap: null, tier: "advanced" },
  "q-draft": { id: "q-draft", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", tier: "advanced", published: false },
  "q-malformed": { id: "q-malformed", family: "Reverse Percentage", cell: "cell-rev-1", trap: "base_confusion", tier: "advanced", expected: 0 }
};
const FULL = Object.keys(POOL);

const dna = (s: Spec) => ({
  question: {
    questionId: s.id, examCode: "IPMAT_INDORE", sectionName: "Quant", chapterName: "Percentages", conceptName: "Percentages", patternFamilyName: s.family, patternTaxonomyCellId: s.cell,
    difficultyTier: s.tier,
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard" as const, examRelevance: "core" as const, testingModes: ["reverse" as const], trapErrorTaxonomyCode: s.trap, combinesWithConcepts: []
  },
  expectedTimeSeconds: s.expected ?? 90,
  validationState: (s.published === false ? "draft" : "published") as "published"
});

function sealer(secret = "T"): HypothesisSealer {
  return {
    seal: (payload) => `${secret}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`,
    open: (token) => {
      const [s, body] = token.split(".");
      if (s !== secret || !body) return null;
      try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown; } catch { return null; }
    }
  };
}
const okGenerator: HypothesisGenerator = async (observation, context) => ({
  attemptId: observation.identity.attemptId,
  proposedErrorCategory: context.designedErrorCategory,
  proposedExplanation: "The answer you selected may be one of the common wrong options for this pattern.",
  supportingEvidence: [`Your selected answer was ${observation.outcome.selectedAnswer}.`, "Your answer was incorrect."],
  contradictoryEvidence: [], missingEvidence: [], modelConfidence: 0.7, confirmationRequired: true, confirmationStatus: "awaiting_confirmation", studentCorrectionText: null, respondedAt: null,
  generationMetadata: { provider: "p", model: "m", promptVersion: "v", task: "autopsy-hypothesis", timestamp: t(0), latencyMs: 1, tokenUsage: null, estimatedCostUsd: null, attempts: 1, success: true, validationOutcome: "valid" }
});

interface Rig { world: World; store: InMemoryAutopsyDecisionRepository; poolIds: string[] }
function rig(o: { ids?: string[]; reverse?: boolean; generator?: HypothesisGenerator | null } = {}): Rig {
  const world = new World();
  const poolIds = o.ids ?? FULL;
  const specs = poolIds.map((id) => POOL[id]!);
  world.questions = specs.map((s) => ({ ...publishedQuestion, id: s.id }));
  world.questionContent = specs.map((s) => ({ ...publishedQuestionContent, id: s.id }));
  const store = new InMemoryAutopsyDecisionRepository();
  const records = specs.map(dna);
  world.trainingRecommendationOverrides = {
    trainingQuestionReader: { findPublishedByExamId: async () => (o.reverse ? [...records].reverse() : records) },
    conceptReader: { findWithPublishedQuestionsByExamId: async () => [{ id: "concept-percentages", name: "Percentages", chapterId: "chapter-1" }] },
    repairPlanReader: store,
    repairPlanStatusWriter: store,
    errorTaxonomyReader: new InMemoryErrorTaxonomyReader()
  };
  world.hypothesis = { hypothesisGenerator: o.generator === undefined ? okGenerator : o.generator, hypothesisSealer: sealer(), autopsyStore: store };
  return { world, store, poolIds };
}

let clock = 0;
const tick = () => (clock += 10);
async function attempt(world: World, questionId: string, outcome: "correct" | "wrong" | "skip", who = claim): Promise<string> {
  const { attemptId } = await world.service().startAttempt(who, { questionId, now: t(tick()) });
  const end = t(tick());
  if (outcome === "skip") await world.service().skipAttempt(who, { attemptId, questionId, now: end });
  else await world.service().submitAttempt(who, { attemptId, questionId, chosenAnswer: outcome === "correct" ? ANSWER_KEY : "999", now: end });
  return attemptId;
}
async function offerFor(r: Rig, attemptId: string, who = claim) {
  const offer = await r.world.service().generateHypothesis(who, { attemptId, now: t(tick()) });
  if (offer.status !== "ready") throw new Error(`no offer: ${offer.status}`);
  return offer;
}
async function decide(r: Rig, decision: "confirmed" | "rejected" | "corrected", questionId = "q-diag", who = claim) {
  const attemptId = await attempt(r.world, questionId, "wrong", who);
  const offer = await offerFor(r, attemptId, who);
  const response = decision === "corrected" ? { type: "corrected" as const, correctedExplanation: "  I used 120% as the base — not the original.\nSecond line ✓ " } : { type: decision };
  const view = await r.world.service().respondToHypothesis(who, { attemptId, token: offer.token, response, now: t(tick()) });
  return { attemptId, offer, view };
}
const next = (r: Rig, who = claim) => r.world.service().getNextRecommendation(who);
const isRepair = (v: { modeLabel: string }) => v.modeLabel === "Confirmed pattern";
const planOf = async (r: Rig, attemptId: string) => (await r.store.findByAttemptId(attemptId))!.repairPlan;

// every student-facing string the chain can produce, for one scenario
const FORBIDDEN_PSYCH = /confiden|motivat|intelligen|abilit|emotion|personalit|careless|confus|unsure|you (felt|knew|thought)|anxi|lazy|weak|struggl|fixed|mastered|solved/i;
const FORBIDDEN_INTERNAL = /base_confusion|taxonomy|autopsy|misconception|modelConfidence|generationMetadata|promptVersion|direct_cell|concept_fallback|pattern_family|trap_only|cell-rev|priority|recommendedTrainingMode|followUp/i;
/** Identifier fields (the student own attempt/question ids and the opaque token) are legitimate; everything else is scanned. */
const withoutIds = (value: unknown) => JSON.stringify(value, (key, v) => (key === "questionId" || key === "attemptId" || key === "token" ? undefined : v));
function assertStudentSafe(label: string, value: unknown) {
  const text = withoutIds(value);
  expect(text, `${label}: internal metadata`).not.toMatch(FORBIDDEN_INTERNAL);
  expect(text, `${label}: psychological wording`).not.toMatch(FORBIDDEN_PSYCH);
}

describe("SCENARIO A -- confirmed repair, the whole chain", () => {
  it("incorrect attempt -> evidence -> hypothesis -> confirm -> persisted diagnosis + plan -> exact repair -> repair attempt -> lifecycle -> next recommendation", async () => {
    const r = rig();
    const wrong = await attempt(r.world, "q-diag", "wrong");
    const evidence = await r.world.service().getAttemptEvidence(claim, { attemptId: wrong });
    expect(evidence.observations).toContain("Your answer was incorrect.");

    const offer = await offerFor(r, wrong);
    expect(offer.hypothesis.supportingEvidence.every((line) => evidence.observations.includes(line))).toBe(true); // grounded in what the student was shown
    expect((await r.store.findByAttemptId(wrong))!.autopsy.confirmed).toBeNull(); // offered, not diagnosed

    const view = await r.world.service().respondToHypothesis(claim, { attemptId: wrong, token: offer.token, response: { type: "confirmed" }, now: t(tick()) });
    expect(view).toMatchObject({ status: "confirmed", persisted: true, diagnosis: { state: "confirmed" }, repairPlan: { conceptName: "Percentages", patternFamilyName: "Reverse Percentage", status: "pending" } });
    const stored = (await r.store.findByAttemptId(wrong))!;
    expect(stored.autopsy.confirmed).toBe(true);
    expect(stored.repairPlan).toMatchObject({ attemptId: wrong, autopsyId: stored.autopsy.id, status: "pending" });

    const repair = await next(r);
    expect(isRepair(repair)).toBe(true);
    expect(repair.questionId).toBe("q-ex-adv"); // exact cell + trap, at the diagnosed tier; never the question just answered, a draft, or the malformed one
    expect(repair.explanation).toMatch(/same pattern/);

    await attempt(r.world, repair.questionId!, "correct");
    const after = await next(r);
    expect((await planOf(r, wrong))!.status).toBe("in_progress");
    expect(isRepair(after)).toBe(true); // one correct answer is not "fixed"
    expect(after.questionId).not.toBe(repair.questionId);

    await attempt(r.world, after.questionId!, "correct");
    const resumed = await next(r);
    expect((await planOf(r, wrong))!.status).toBe("completed"); // two consecutive correct direct-match answers
    expect(isRepair(resumed)).toBe(false); // ordinary practice resumes
    assertStudentSafe("scenario A", [offer.hypothesis, view, repair, after, resumed]);
  });
});

describe("SCENARIO B -- rejected", () => {
  it("no diagnosis, no plan; ordinary adaptive practice stays in charge", async () => {
    const r = rig();
    const { attemptId, view } = await decide(r, "rejected");
    expect(view).toMatchObject({ status: "rejected", diagnosis: { state: "not_confirmed" }, repairPlan: null, studentCorrectionText: null });
    expect((await r.store.findByAttemptId(attemptId))!.autopsy.confirmed).toBe(false);
    expect(await planOf(r, attemptId)).toBeNull();
    expect(await r.store.findConfirmedActiveByStudentId(STUDENT)).toEqual([]);
    const rec = await next(r);
    expect(isRepair(rec)).toBe(false);
    assertStudentSafe("scenario B", [view, rec]);
  });
});

describe("SCENARIO C -- corrected: the boundary is explicit and safe", () => {
  it("the exact correction is preserved, nothing is diagnosed, no plan exists, and the state stays awaiting a diagnosis pass", async () => {
    const r = rig();
    const words = "  I used 120% as the base — not the original.\nSecond line ✓ ";
    const { attemptId, view, offer } = await decide(r, "corrected");
    expect(view).toMatchObject({ status: "corrected", studentCorrectionText: words, diagnosis: { state: "awaiting_diagnosis" }, repairPlan: null });
    const stored = (await r.store.findByAttemptId(attemptId))!;
    expect(stored.autopsy).toMatchObject({ confirmed: false, studentCorrectionText: words, hypothesisText: offer.hypothesis.summary }); // the original proposal is never overwritten
    expect(stored.repairPlan).toBeNull();
    expect(isRepair(await next(r))).toBe(false);

    // nothing the student (or a replay) can send turns it into a diagnosis or a plan
    for (const response of [{ type: "confirmed" as const }, { type: "rejected" as const }, { type: "corrected" as const, correctedExplanation: "something else" }]) {
      const again = await r.world.service().respondToHypothesis(claim, { attemptId, token: offer.token, response, now: t(tick()) });
      expect(again).toMatchObject({ status: "corrected", studentCorrectionText: words, alreadyRecorded: true, diagnosis: { state: "awaiting_diagnosis" }, repairPlan: null });
    }
    expect(await r.store.findConfirmedActiveByStudentId(STUDENT)).toEqual([]);
    expect(r.store.size).toBe(1); // one autopsy row for the attempt: the correction did not spawn a second diagnosis
  });
});

describe("SCENARIO D -- AI unavailable", () => {
  it("the result stays usable, no hypothesis is fabricated, Continue works, and ordinary practice goes on", async () => {
    for (const generator of [null, (async () => { throw new Error("provider down: secret-detail"); }) as HypothesisGenerator]) {
      const r = rig({ generator });
      const wrong = await attempt(r.world, "q-diag", "wrong");
      expect(await r.world.service().generateHypothesis(claim, { attemptId: wrong })).toEqual({ status: "unavailable", attemptId: wrong });
      expect(r.store.size).toBe(0);
      expect((await r.world.service().getAttemptResult(claim, { attemptId: wrong })).status).toBe("submitted");
      expect((await r.world.service().getAttemptEvidence(claim, { attemptId: wrong })).status).toBe("submitted");
      const rec = await next(r);
      expect(isRepair(rec)).toBe(false);
      expect(rec.questionId).not.toBeNull();
      await expect(r.world.service().startAttempt(claim, { questionId: rec.questionId!, now: t(tick()) })).resolves.toBeDefined(); // Continue -> a normal attempt
      assertStudentSafe("scenario D", rec);
    }
  });
});

describe("SCENARIOS E / F / G -- exact, broader, none", () => {
  it("E: an exact candidate exists -> it (and only it) is selected, even though broader and other-tier candidates exist", async () => {
    const r = rig();
    await decide(r, "confirmed");
    const rec = await next(r);
    expect(["q-ex-std", "q-ex-adv", "q-ex-hard"]).toContain(rec.questionId);
    expect(rec.explanation).toMatch(/same pattern/);
    expect(rec.explanation).not.toMatch(/broader/);
  });

  it("E: exact beats broader at every level, and an unpublished or malformed exact candidate is never chosen", async () => {
    const r = rig({ ids: ["q-diag", "q-draft", "q-malformed", "q-fam", "q-trap", "q-broad-1", "q-broad-2"] });
    await decide(r, "confirmed");
    const rec = await next(r);
    expect(rec.questionId).toBe("q-fam"); // best VALID match; the draft and malformed exact candidates are out
    expect(rec.questionId).not.toBe("q-draft");
    expect(rec.questionId).not.toBe("q-malformed");
  });

  it("F: only a broader candidate -> it is served, and the explanation says so (no false exact-match claim)", async () => {
    const trapOnly = rig({ ids: ["q-diag", "q-trap", "q-broad-1"] });
    await decide(trapOnly, "confirmed");
    const a = await next(trapOnly);
    expect(a.questionId).toBe("q-trap");
    expect(a.explanation).toMatch(/same kind of wrong-answer trap in a different pattern/);
    expect(a.explanation).not.toMatch(/same pattern, so/);

    const broad = rig({ ids: ["q-diag", "q-broad-1", "q-broad-2"] });
    await decide(broad, "confirmed");
    const b = await next(broad);
    expect(["q-broad-1", "q-broad-2"]).toContain(b.questionId);
    expect(b.explanation).toMatch(/No question for that exact pattern is available right now, so this is a broader Percentages question/);
    expect(b.explanation).not.toMatch(/practises the same pattern/);
  });

  it("G: no valid repair candidate -> deterministic fallback to ordinary practice, and the plan is NOT destroyed (repair resumes when content returns)", async () => {
    const r = rig();
    const { attemptId } = await decide(r, "confirmed");
    const full = r.world.trainingRecommendationOverrides.trainingQuestionReader!;
    r.world.trainingRecommendationOverrides = {
      ...r.world.trainingRecommendationOverrides,
      trainingQuestionReader: { findPublishedByExamId: async () => [{ ...dna(POOL["q-ex-std"]!), question: { ...dna(POOL["q-ex-std"]!).question, conceptName: "Ratio" } }] }
    };
    const fallback = await next(r);
    expect(isRepair(fallback)).toBe(false);
    expect(await next(r)).toEqual(fallback); // deterministic
    expect((await planOf(r, attemptId))!.status).toBe("pending"); // not completed, not deleted
    r.world.trainingRecommendationOverrides = { ...r.world.trainingRecommendationOverrides, trainingQuestionReader: full };
    expect(isRepair(await next(r))).toBe(true);
  });
});

describe("repair completion semantics and lifecycle hardening", () => {
  it("wrong answers and skips reset the run; the round limit ends repair deterministically without claiming success", async () => {
    // correct, wrong, correct -> 3 rounds: ends by the round limit, NOT by demonstration
    const a = rig();
    const diagA = (await decide(a, "confirmed")).attemptId;
    for (const outcome of ["correct", "wrong", "correct"] as const) {
      const rec = await next(a);
      expect(isRepair(rec)).toBe(true);
      await attempt(a.world, rec.questionId!, outcome);
    }
    expect(isRepair(await next(a))).toBe(false);
    expect((await planOf(a, diagA))!.status).toBe("completed");

    // correct, skip -> still repairing (a skip is not a correct answer)
    const b = rig();
    const diagB = (await decide(b, "confirmed")).attemptId;
    await attempt(b.world, (await next(b)).questionId!, "correct");
    await attempt(b.world, (await next(b)).questionId!, "skip");
    expect(isRepair(await next(b))).toBe(true);
    expect((await planOf(b, diagB))!.status).toBe("in_progress");
  });

  it("the stored status only moves forward, repeated syncs change nothing, and a completed plan is never reopened", async () => {
    const r = rig();
    const diag = (await decide(r, "confirmed")).attemptId;
    for (let i = 0; i < 2; i++) await attempt(r.world, (await next(r)).questionId!, "correct");
    await next(r);
    const planId = (await planOf(r, diag))!.id;
    for (let i = 0; i < 5; i++) await next(r); // repeated reads
    expect((await planOf(r, diag))!.status).toBe("completed");
    expect(await r.store.advanceStatus({ planId, studentId: STUDENT, to: "in_progress" })).toBe(false);
    expect(await r.store.advanceStatus({ planId, studentId: STUDENT, to: "completed" })).toBe(false); // idempotent
    expect(r.store.size).toBe(1);
  });

  it("a completed plan never blocks ordinary practice, and a NEW confirmed diagnosis starts a new, valid repair state", async () => {
    const r = rig();
    const first = (await decide(r, "confirmed")).attemptId;
    for (let i = 0; i < 2; i++) await attempt(r.world, (await next(r)).questionId!, "correct");
    expect(isRepair(await next(r))).toBe(false);
    const second = (await decide(r, "confirmed", "q-trap")).attemptId;
    expect((await planOf(r, first))!.status).toBe("completed");
    expect((await planOf(r, second))!.status).toBe("pending");
    expect(isRepair(await next(r))).toBe(true);
  });
});

describe("determinism of the whole chain", () => {
  async function trace(r: Rig): Promise<unknown[]> {
    const out: unknown[] = [];
    const diag = await decide(r, "confirmed");
    out.push({ ...diag.view, attemptId: undefined }, (await offerFor(r, diag.attemptId).catch(() => "answered")) === "answered");
    for (const outcome of ["correct", "wrong", "correct", "correct"] as const) {
      const rec = await next(r);
      out.push(rec);
      await attempt(r.world, rec.questionId!, outcome);
      out.push((await planOf(r, diag.attemptId))!.status);
    }
    out.push(await next(r));
    return out;
  }

  it("same persisted state + same pool = the same complete chain, regardless of candidate input order", async () => {
    clock = 0;
    const forward = await trace(rig());
    clock = 0;
    const reversed = await trace(rig({ reverse: true }));
    expect(reversed).toEqual(forward);
    clock = 0;
    expect(await trace(rig())).toEqual(forward); // and on a fresh instance of everything
  });

  it("concurrent recommendation calls during the loop agree with each other and with a later sequential call", async () => {
    const r = rig();
    await decide(r, "confirmed");
    await attempt(r.world, (await next(r)).questionId!, "correct");
    const burst = await Promise.all(Array.from({ length: 16 }, () => next(r)));
    for (const v of burst) expect(v).toEqual(burst[0]);
    expect(await next(r)).toEqual(burst[0]);
    expect((await r.store.findConfirmedActiveByStudentId(STUDENT)).length).toBe(1);
  });
});

describe("pre-submission gating, ownership and leakage across the whole chain", () => {
  it("before submission nothing exists: no evidence, hypothesis, response, diagnosis or plan -- and the answer key is never in any response", async () => {
    const r = rig();
    const { attemptId } = await r.world.service().startAttempt(claim, { questionId: "q-diag", now: t(tick()) });
    for (const call of [
      () => r.world.service().getAttemptEvidence(claim, { attemptId }),
      () => r.world.service().generateHypothesis(claim, { attemptId }),
      () => r.world.service().respondToHypothesis(claim, { attemptId, token: "x", response: { type: "confirmed" } }),
      () => r.world.service().getAttemptResult(claim, { attemptId })
    ]) {
      await expect(call()).rejects.toMatchObject({ httpStatus: 409 });
    }
    expect(r.store.size).toBe(0);
    expect(JSON.stringify(await r.world.service().getNextRecommendation(claim))).not.toContain(ANSWER_KEY);
  });

  it("another student can reach nothing of this chain: offer, response, evidence, result are all 403, and their recommendation is unaffected", async () => {
    const r = rig();
    const { attemptId, offer } = await decide(r, "confirmed");
    const svc = r.world.service();
    for (const call of [
      () => svc.generateHypothesis(OTHER, { attemptId }),
      () => svc.respondToHypothesis(OTHER, { attemptId, token: offer.token, response: { type: "confirmed" } }),
      () => svc.getAttemptEvidence(OTHER, { attemptId }),
      () => svc.getAttemptResult(OTHER, { attemptId })
    ]) {
      await expect(call()).rejects.toMatchObject({ httpStatus: 403 });
    }
    expect(isRepair(await next(r, OTHER))).toBe(false);
  });

  it("the student-facing output of the full confirmed loop (evidence, offer, response, every recommendation, results) carries no internal metadata, psychology or answer key", async () => {
    const r = rig();
    const wrong = await attempt(r.world, "q-diag", "wrong");
    const surfaces: unknown[] = [await r.world.service().getAttemptEvidence(claim, { attemptId: wrong }), await r.world.service().getAttemptResult(claim, { attemptId: wrong })];
    const offer = await offerFor(r, wrong);
    surfaces.push({ hypothesis: offer.hypothesis });
    surfaces.push(await r.world.service().respondToHypothesis(claim, { attemptId: wrong, token: offer.token, response: { type: "confirmed" }, now: t(tick()) }));
    for (let i = 0; i < 4; i++) {
      const rec = await next(r);
      surfaces.push(rec);
      await attempt(r.world, rec.questionId!, i % 2 === 0 ? "correct" : "wrong");
    }
    for (const [i, surface] of surfaces.entries()) {
      const text = withoutIds(surface);
      expect(text, `surface ${i}`).not.toMatch(FORBIDDEN_INTERNAL);
      expect(text, `surface ${i}`).not.toMatch(FORBIDDEN_PSYCH);
    }
  });
});
