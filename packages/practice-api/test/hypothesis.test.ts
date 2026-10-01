import { InMemoryAutopsyDecisionRepository, InMemoryErrorTaxonomyReader } from "@ipmat/db";
import { describe, expect, it } from "vitest";
import type { ObservationEvidence } from "@ipmat/training-recommendation";
import { HYPOTHESIS_TOKEN_TTL_MS, MAX_CORRECTION_CHARS } from "../src/service.js";
import { PracticeApiError, type HypothesisGenerator, type HypothesisSealer } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World, publishedQuestion, publishedQuestionContent, t } from "./fixtures.js";

/**
 * Phase 4 Units 2-3 -- hypothesis offer, the student's response, and what is PERSISTED, through the REAL attempt lifecycle, the real
 * evidence composition and the real in-memory decision store (the same contract the Prisma store implements). The model is a fake
 * generator (this package never imports an AI SDK); the generator's own safety validation is tested in `@ipmat/autopsy`.
 *
 * Semantics under test: confirmed -> a student-confirmed diagnosis and exactly one RepairPlan; rejected -> recorded, no diagnosis, no plan;
 * corrected -> the exact words recorded, no diagnosis, no plan ("awaiting_diagnosis"); the first response wins and nothing can be applied twice.
 */

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const OTHER = { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT };
const SECOND = { ...publishedQuestion, id: "question-2" };

const dna = (questionId: string, family: string, cell: string, trap: string | null = "base_confusion") => ({
  question: {
    questionId, examCode: "IPMAT_INDORE", sectionName: "Quant", chapterName: "Percentages", conceptName: "Percentages", patternFamilyName: family, patternTaxonomyCellId: cell,
    difficultyTier: "standard" as const,
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard" as const, examRelevance: "core" as const, testingModes: ["reverse" as const], trapErrorTaxonomyCode: trap, combinesWithConcepts: []
  },
  expectedTimeSeconds: 90,
  validationState: "published" as const
});

/** A readable-but-tamper-evident test sealer (the real one is AES-GCM in apps/api). */
function testSealer(secret = "A"): HypothesisSealer {
  return {
    seal: (payload) => `${secret}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`,
    open: (token) => {
      const [s, body] = token.split(".");
      if (s !== secret || !body) return null;
      try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
      } catch {
        return null;
      }
    }
  };
}

const generatorFor: HypothesisGenerator = async (observation, context) => ({
  attemptId: observation.identity.attemptId,
  proposedErrorCategory: context.designedErrorCategory, // the real generator does exactly this: the category is question-design metadata
  proposedExplanation: "The answer you selected may be one of the common wrong options for this pattern.",
  supportingEvidence: [`Your selected answer was ${observation.outcome.selectedAnswer}.`, "Your answer was incorrect."],
  contradictoryEvidence: [],
  missingEvidence: ["The steps used are not recorded."],
  modelConfidence: 0.77,
  confirmationRequired: true,
  confirmationStatus: "awaiting_confirmation",
  studentCorrectionText: null,
  respondedAt: null,
  generationMetadata: { provider: "secret-provider", model: "secret-model", promptVersion: "secret-prompt", task: "autopsy-hypothesis", timestamp: t(0), latencyMs: 5, tokenUsage: null, estimatedCostUsd: null, attempts: 1, success: true, validationOutcome: "valid" }
});

interface Rig {
  world: World;
  store: InMemoryAutopsyDecisionRepository;
  seen: ObservationEvidence[];
  calls: () => number;
}
function rig(o: { generate?: HypothesisGenerator | null; sealer?: HypothesisSealer | null; trap?: string | null; taxonomy?: boolean; store?: boolean } = {}): Rig {
  const world = new World();
  world.questions = [publishedQuestion, SECOND];
  world.questionContent = [publishedQuestionContent, { ...publishedQuestionContent, id: "question-2" }];
  const store = new InMemoryAutopsyDecisionRepository();
  const trap = o.trap === undefined ? "base_confusion" : o.trap;
  world.trainingRecommendationOverrides = {
    trainingQuestionReader: { findPublishedByExamId: async () => [dna("question-1", "Reverse Percentage", "cell-reverse", trap), dna("question-2", "Successive Change", "cell-successive", trap)] },
    conceptReader: { findWithPublishedQuestionsByExamId: async () => [{ id: "concept-percentages", name: "Percentages", chapterId: "chapter-1" }] },
    repairPlanReader: store, // the composition reads the plans the store writes, exactly as the real wiring does
    ...(o.taxonomy === false ? {} : { errorTaxonomyReader: new InMemoryErrorTaxonomyReader() })
  };
  const seen: ObservationEvidence[] = [];
  let n = 0;
  const generate = o.generate === undefined ? generatorFor : o.generate;
  world.hypothesis = {
    hypothesisGenerator: generate === null ? null : async (obs, ctx) => {
      n += 1;
      seen.push(obs);
      return generate(obs, ctx);
    },
    hypothesisSealer: o.sealer === undefined ? testSealer() : o.sealer,
    autopsyStore: o.store === false ? null : store
  };
  return { world, store, seen, calls: () => n };
}

async function attempt(world: World, questionId: string, outcome: "correct" | "wrong" | "skip", start: number, end: number, who = claim): Promise<string> {
  const { attemptId } = await world.service().startAttempt(who, { questionId, now: t(start) });
  if (outcome === "skip") await world.service().skipAttempt(who, { attemptId, questionId, now: t(end) });
  else await world.service().submitAttempt(who, { attemptId, questionId, chosenAnswer: outcome === "correct" ? ANSWER_KEY : "999", now: t(end) });
  return attemptId;
}
const err = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

async function offered(r: Rig, who = claim, questionId = "question-1") {
  const attemptId = await attempt(r.world, questionId, "wrong", 0, 30, who);
  const offer = await r.world.service().generateHypothesis(who, { attemptId, now: t(100) });
  if (offer.status !== "ready") throw new Error(`expected a ready offer, got ${offer.status}`);
  return { attemptId, token: offer.token, summary: offer.hypothesis.summary, offer };
}
const plansFor = (r: Rig, studentId = STUDENT) => r.store.findConfirmedActiveByStudentId(studentId);
type ResponseInput = Parameters<ReturnType<World["service"]>["respondToHypothesis"]>[1]["response"];
const respond = (r: Rig, o: { attemptId: string; token: string }, response: ResponseInput, who = claim, now = t(200)) =>
  r.world.service().respondToHypothesis(who, { attemptId: o.attemptId, token: o.token, response, now });

describe("offering a hypothesis", () => {
  it("an incorrect attempt gets one possible explanation built from the Unit 1 evidence; the view is student-safe", async () => {
    const r = rig();
    const attemptId = await attempt(r.world, "question-1", "wrong", 0, 40);
    const evidence = await r.world.service().getAttemptEvidence(claim, { attemptId });
    const offer = await r.world.service().generateHypothesis(claim, { attemptId, now: t(100) });

    expect(offer.status).toBe("ready");
    if (offer.status !== "ready") return;
    expect(Object.keys(offer).sort()).toEqual(["attemptId", "hypothesis", "status", "token"]);
    expect(Object.keys(offer.hypothesis).sort()).toEqual(["summary", "supportingEvidence"]);
    expect(r.seen[0]!.outcome).toMatchObject({ verdict: "incorrect", selectedAnswer: "999" });
    expect(evidence.facts.selectedAnswer).toBe(r.seen[0]!.outcome.selectedAnswer);
    const text = JSON.stringify(offer);
    expect(text).not.toMatch(/modelConfidence|0\.77|secret-provider|secret-model|secret-prompt|generationMetadata|promptVersion|proposedErrorCategory|misconception/);
    expect(text).not.toContain(ANSWER_KEY);
  });

  it("nothing to explain: a correct or skipped attempt is not_applicable, the model is never called, and nothing is stored", async () => {
    const r = rig();
    const correct = await attempt(r.world, "question-1", "correct", 0, 30);
    const skipped = await attempt(r.world, "question-2", "skip", 100, 110);
    expect(await r.world.service().generateHypothesis(claim, { attemptId: correct })).toEqual({ status: "not_applicable", attemptId: correct });
    expect(await r.world.service().generateHypothesis(claim, { attemptId: skipped })).toEqual({ status: "not_applicable", attemptId: skipped });
    expect(r.calls()).toBe(0);
    expect(r.store.size).toBe(0);
  });

  it("never before submission: an in-progress attempt is refused (409), the model is not called, nothing is stored", async () => {
    const r = rig();
    const { attemptId } = await r.world.service().startAttempt(claim, { questionId: "question-1", now: t(0) });
    expect(await err(r.world.service().generateHypothesis(claim, { attemptId }))).toMatchObject({ code: "invalid_state", httpStatus: 409 });
    expect(r.calls()).toBe(0);
    expect(r.store.size).toBe(0);
  });

  it("ownership: another student cannot request a hypothesis for this attempt (403), an unknown attempt is 404", async () => {
    const r = rig();
    const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30);
    expect(await err(r.world.service().generateHypothesis(OTHER, { attemptId }))).toMatchObject({ code: "ownership_mismatch", httpStatus: 403 });
    expect(await err(r.world.service().generateHypothesis(claim, { attemptId: "nope" }))).toMatchObject({ code: "not_found" });
    expect(r.calls()).toBe(0);
  });

  it("the OFFER is persisted once: asking again (a refresh, another instance) returns the stored offer with NO new model call, and a fresh token works", async () => {
    const r = rig();
    const first = await offered(r);
    expect(r.store.size).toBe(1);
    const stored = await r.store.findByAttemptId(first.attemptId);
    expect(stored?.autopsy).toMatchObject({ confirmed: null, confirmedAt: null, studentCorrectionText: null, hypothesisText: first.summary, generatedByProvider: "secret-provider" });

    const again = await r.world.service().generateHypothesis(claim, { attemptId: first.attemptId, now: t(150) });
    expect(again.status).toBe("ready");
    if (again.status !== "ready") return;
    expect(again.hypothesis.summary).toBe(first.summary);
    expect(r.calls()).toBe(1);
    expect(r.store.size).toBe(1);
    expect((await respond(r, { attemptId: first.attemptId, token: again.token }, { type: "confirmed" })).status).toBe("confirmed");
  });

  it("provenance: the stored offer links to its attempt and keeps the Unit 1 observation evidence it was generated from (no answer key in it)", async () => {
    const r = rig();
    const o = await offered(r);
    const stored = (await r.store.findByAttemptId(o.attemptId))!.autopsy;
    expect(stored.attemptId).toBe(o.attemptId);
    const observation = stored.evidenceUsed["observationEvidence"] as ObservationEvidence;
    expect(observation.identity).toMatchObject({ attemptId: o.attemptId, studentId: STUDENT });
    expect(observation.outcome).toMatchObject({ verdict: "incorrect", selectedAnswer: "999" });
    expect(JSON.stringify(observation)).not.toMatch(/correctAnswer|expectedAnswer/);
    expect(stored.likelyRootCause).toBe("misconception"); // the designed trap's category, from the existing taxonomy -- not the model's pick
  });

  it("AI failure is neutral: no generator, a provider error, a rejected/unsafe/mismatched proposal all answer 'unavailable' and store nothing", async () => {
    const none = rig({ generate: null });
    const noGen = await attempt(none.world, "question-1", "wrong", 0, 30);
    expect(await none.world.service().generateHypothesis(claim, { attemptId: noGen })).toEqual({ status: "unavailable", attemptId: noGen });
    expect(none.store.size).toBe(0);

    const cases: HypothesisGenerator[] = [
      async () => { throw new Error("provider down: secret-detail-123"); },
      async () => { throw Object.assign(new Error("rejected: stated_as_certain"), { code: "unsafe_hypothesis_output" }); },
      async (o, c) => ({ ...(await generatorFor(o, c)), attemptId: "someone-elses-attempt" }),
      async (o, c) => ({ ...(await generatorFor(o, c)), supportingEvidence: [] }),
      async (o, c) => ({ ...(await generatorFor(o, c)), confirmationStatus: "confirmed" as const })
    ];
    for (const generate of cases) {
      const r = rig({ generate });
      const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30);
      const offer = await r.world.service().generateHypothesis(claim, { attemptId });
      expect(offer).toEqual({ status: "unavailable", attemptId });
      expect(JSON.stringify(offer)).not.toMatch(/secret-detail|down|stated_as_certain/);
      expect(r.store.size).toBe(0);
    }
  });

  it("the result and the evidence are unaffected by an AI failure", async () => {
    const r = rig({ generate: async () => { throw new Error("boom"); } });
    const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30);
    await r.world.service().generateHypothesis(claim, { attemptId });
    expect((await r.world.service().getAttemptResult(claim, { attemptId })).status).toBe("submitted");
    expect((await r.world.service().getAttemptEvidence(claim, { attemptId })).observations).toContain("Your answer was incorrect.");
  });
});

describe("CASE A -- confirmed: a student-confirmed diagnosis and exactly one RepairPlan", () => {
  it("is persisted: the autopsy is confirmed with its response time, and one RepairPlan exists with its provenance", async () => {
    const r = rig();
    const o = await offered(r);
    const view = await respond(r, o, { type: "confirmed" });
    expect(view).toEqual({
      attemptId: o.attemptId,
      status: "confirmed",
      studentCorrectionText: null,
      hypothesisSummary: o.summary,
      persisted: true,
      alreadyRecorded: false,
      diagnosis: { state: "confirmed" },
      repairPlan: { conceptName: "Percentages", patternFamilyName: "Reverse Percentage", status: "pending" }
    });

    const stored = (await r.store.findByAttemptId(o.attemptId))!;
    expect(stored.autopsy).toMatchObject({ confirmed: true, confirmedAt: t(200), studentCorrectionText: null });
    expect(stored.repairPlan).toMatchObject({
      attemptId: o.attemptId, // provenance: the attempt
      autopsyId: stored.autopsy.id, // provenance: the diagnosis (autopsy row)
      studentId: STUDENT,
      confirmedAt: t(200), // provenance: the student's confirmation
      targetConceptName: "Percentages",
      targetPatternFamilyName: "Reverse Percentage",
      targetErrorCategory: "misconception",
      targetErrorTaxonomyCode: "base_confusion",
      status: "pending",
      followUpQuestionIds: [] // no question is selected in this unit
    });
    expect((await plansFor(r)).map((p) => p.id)).toEqual([stored.repairPlan!.id]);
  });

  it("the student view exposes only the practice focus: no ids, no internal fields, no model data", async () => {
    const r = rig();
    const o = await offered(r);
    const view = await respond(r, o, { type: "confirmed" });
    expect(Object.keys(view.repairPlan!).sort()).toEqual(["conceptName", "patternFamilyName", "status"]);
    expect(JSON.stringify(view)).not.toMatch(/autopsyId|studentId|targetConceptId|taxonomy|misconception|modelConfidence|secret-|followUp|priority|recommendedTrainingMode|correctAnswer/i);
    expect(JSON.stringify(view)).not.toContain(ANSWER_KEY);
  });

  it("confirmed but no structured target (the question has no resolvable designed trap): the confirmation is recorded, no plan is invented", async () => {
    for (const r of [rig({ trap: null }), rig({ taxonomy: false })]) {
      const o = await offered(r);
      const view = await respond(r, o, { type: "confirmed" });
      expect(view).toMatchObject({ status: "confirmed", diagnosis: { state: "confirmed" }, repairPlan: null });
      expect((await r.store.findByAttemptId(o.attemptId))!.repairPlan).toBeNull();
      expect(await plansFor(r)).toEqual([]);
    }
  });
});

describe("CASE B -- rejected: recorded as not confirmed; no diagnosis, no RepairPlan", () => {
  it("persists the rejection and creates neither", async () => {
    const r = rig();
    const o = await offered(r);
    const view = await respond(r, o, { type: "rejected" });
    expect(view).toMatchObject({ status: "rejected", studentCorrectionText: null, diagnosis: { state: "not_confirmed" }, repairPlan: null, persisted: true, alreadyRecorded: false });
    const stored = (await r.store.findByAttemptId(o.attemptId))!;
    expect(stored.autopsy).toMatchObject({ confirmed: false, confirmedAt: t(200), studentCorrectionText: null });
    expect(stored.repairPlan).toBeNull();
    expect(await plansFor(r)).toEqual([]);
  });
});

describe("CASE C -- corrected: the student's words are recorded exactly; NOT a diagnosis, no RepairPlan", () => {
  it("persists the exact correction (spacing, line breaks, unicode) and reports awaiting_diagnosis", async () => {
    const r = rig();
    const o = await offered(r);
    const words = "  I used 120% as the base — not the original.\n(second line) ✓  ";
    const view = await respond(r, o, { type: "corrected", correctedExplanation: words });
    expect(view).toMatchObject({ status: "corrected", studentCorrectionText: words, diagnosis: { state: "awaiting_diagnosis" }, repairPlan: null });
    const stored = (await r.store.findByAttemptId(o.attemptId))!;
    expect(stored.autopsy).toMatchObject({ confirmed: false, studentCorrectionText: words, hypothesisText: o.summary }); // the original proposal is kept alongside, never overwritten
    expect(stored.repairPlan).toBeNull();
    expect(await plansFor(r)).toEqual([]);
  });
});

describe("once-only: the first response wins and nothing can be applied twice", () => {
  it("the same confirmation twice: the second changes nothing, returns the persisted result, and there is still exactly one plan", async () => {
    const r = rig();
    const o = await offered(r);
    const first = await respond(r, o, { type: "confirmed" });
    const second = await respond(r, o, { type: "confirmed" }, claim, t(999));
    expect(second).toEqual({ ...first, alreadyRecorded: true });
    expect((await plansFor(r)).length).toBe(1);
    expect((await r.store.findByAttemptId(o.attemptId))!.autopsy.confirmedAt).toBe(t(200)); // the first response time, untouched
  });

  it("a DIFFERENT second response cannot override the first (confirm then reject stays confirmed; reject then confirm stays rejected and never gains a plan)", async () => {
    const a = rig();
    const oa = await offered(a);
    await respond(a, oa, { type: "confirmed" });
    expect(await respond(a, oa, { type: "rejected" })).toMatchObject({ status: "confirmed", alreadyRecorded: true });
    expect((await plansFor(a)).length).toBe(1);

    const b = rig();
    const ob = await offered(b);
    await respond(b, ob, { type: "rejected" });
    expect(await respond(b, ob, { type: "confirmed" })).toMatchObject({ status: "rejected", alreadyRecorded: true, repairPlan: null });
    expect(await respond(b, ob, { type: "corrected", correctedExplanation: "something else" })).toMatchObject({ status: "rejected", studentCorrectionText: null });
    expect(await plansFor(b)).toEqual([]);
  });

  it("ten concurrent confirmations create exactly one plan and agree on the outcome", async () => {
    const r = rig();
    const o = await offered(r);
    const views = await Promise.all(Array.from({ length: 10 }, () => respond(r, o, { type: "confirmed" })));
    expect(views.every((v) => v.status === "confirmed")).toBe(true);
    expect(views.filter((v) => !v.alreadyRecorded)).toHaveLength(1);
    expect((await plansFor(r)).length).toBe(1);
  });

  it("after it is answered, asking again shows the persisted outcome (not a new offer) -- the state survives a refresh", async () => {
    const r = rig();
    const o = await offered(r);
    const done = await respond(r, o, { type: "confirmed" });
    const again = await r.world.service().generateHypothesis(claim, { attemptId: o.attemptId, now: t(300) });
    expect(again).toEqual({ status: "answered", attemptId: o.attemptId, result: { ...done, alreadyRecorded: true } });
    expect(r.calls()).toBe(1); // never regenerated
  });

  it("a stored answer is returned even when no model is configured any more", async () => {
    const r = rig();
    const o = await offered(r);
    await respond(r, o, { type: "rejected" });
    r.world.hypothesis = { ...r.world.hypothesis, hypothesisGenerator: null };
    expect(await r.world.service().generateHypothesis(claim, { attemptId: o.attemptId })).toMatchObject({ status: "answered", result: { status: "rejected" } });
  });
});

describe("the token and who may use it", () => {
  it("a forged, altered, foreign-secret, expired, mismatched-offer, replayed or moved token is refused -- and nothing is written", async () => {
    const r = rig();
    const o = await offered(r);
    const stale = { code: "invalid_state", httpStatus: 409 };
    const go = (who: typeof claim, attemptId: string, token: string, now = t(200)) => err(r.world.service().respondToHypothesis(who, { attemptId, token, response: { type: "confirmed" }, now }));
    const stored = (await r.store.findByAttemptId(o.attemptId))!.autopsy;

    expect(await go(claim, o.attemptId, "garbage")).toMatchObject(stale);
    expect(await go(claim, o.attemptId, testSealer("B").seal({ v: 2 }))).toMatchObject(stale);
    // sealed with the right secret but for a different offer text / offer id: the stored offer must still match what the token binds
    const sealer = testSealer();
    const payload = { v: 2, studentId: STUDENT, attemptId: o.attemptId, autopsyId: stored.id, hypothesisText: stored.hypothesisText, expiresAtMs: Date.parse(t(100)) + HYPOTHESIS_TOKEN_TTL_MS };
    expect(await go(claim, o.attemptId, sealer.seal({ ...payload, hypothesisText: "A different proposal that was never offered." }))).toMatchObject(stale);
    expect(await go(claim, o.attemptId, sealer.seal({ ...payload, autopsyId: "another-autopsy" }))).toMatchObject(stale);
    expect(await go(claim, o.attemptId, o.token, t(HYPOTHESIS_TOKEN_TTL_MS / 1000 + 1000))).toMatchObject(stale); // expired (the offer itself does not expire)
    // an old-format (Unit 2) token is not accepted
    expect(await go(claim, o.attemptId, sealer.seal({ v: 1, studentId: STUDENT, attemptId: o.attemptId, expiresAtMs: Date.now() + 1e9, hypothesis: { proposedExplanation: "x", confirmationStatus: "awaiting_confirmation" } }))).toMatchObject(stale);

    const theirs = await attempt(r.world, "question-2", "wrong", 0, 20, OTHER);
    expect(await go(OTHER, theirs, o.token)).toMatchObject({ code: "ownership_mismatch", httpStatus: 403 }); // this student's token, their own attempt
    const second = await attempt(r.world, "question-2", "wrong", 500, 520);
    expect(await go(claim, second, o.token)).toMatchObject({ code: "ownership_mismatch" }); // moved to another attempt of the same student
    expect(await go(OTHER, o.attemptId, o.token)).toMatchObject({ code: "ownership_mismatch" }); // another student against this attempt

    const after = (await r.store.findByAttemptId(o.attemptId))!;
    expect(after.autopsy.confirmed).toBeNull(); // every refusal left the offer awaiting
    expect(after.repairPlan).toBeNull();
  });

  it("an unfinished attempt cannot be answered even with a token (409)", async () => {
    const r = rig();
    const o = await offered(r);
    const { attemptId } = await r.world.service().startAttempt(claim, { questionId: "question-2", now: t(900) });
    expect(await err(respond(r, { attemptId, token: o.token }, { type: "confirmed" }))).toMatchObject({ code: "invalid_state" });
  });

  it("malformed responses are refused (400): unknown type, empty/whitespace/oversize correction, empty or oversize token", async () => {
    const r = rig();
    const o = await offered(r);
    const bad = (response: unknown, token = o.token) => err(r.world.service().respondToHypothesis(claim, { attemptId: o.attemptId, token, response: response as never, now: t(200) }));
    for (const response of [{ type: "maybe" }, { type: "corrected", correctedExplanation: "" }, { type: "corrected", correctedExplanation: "   " }, { type: "corrected", correctedExplanation: "x".repeat(MAX_CORRECTION_CHARS + 1) }, { type: "corrected" }, null]) {
      expect(await bad(response)).toMatchObject({ code: "invalid_request", httpStatus: 400 });
    }
    expect(await bad({ type: "confirmed" }, "")).toMatchObject({ code: "invalid_request" });
    expect(await bad({ type: "confirmed" }, "x".repeat(20_001))).toMatchObject({ code: "invalid_request" });
    expect((await r.store.findByAttemptId(o.attemptId))!.autopsy.confirmed).toBeNull(); // none of them recorded anything
    expect(await err(respond(r, o, { type: "corrected", correctedExplanation: "x".repeat(MAX_CORRECTION_CHARS) }))).toBeNull(); // the limit itself is allowed
  });

  it("without a sealer or a store no offer is made, and no response can be applied", async () => {
    for (const r of [rig({ sealer: null }), rig({ store: false })]) {
      const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30);
      expect(await r.world.service().generateHypothesis(claim, { attemptId })).toEqual({ status: "unavailable", attemptId });
      expect(await err(r.world.service().respondToHypothesis(claim, { attemptId, token: "x", response: { type: "confirmed" } }))).toBeInstanceOf(PracticeApiError);
    }
  });
});

describe("isolation and the boundary of this unit", () => {
  it("another student's diagnosis and plan are never visible to this student", async () => {
    const r = rig();
    const mine = await offered(r);
    await respond(r, mine, { type: "confirmed" });
    expect(await plansFor(r, OTHER_STUDENT)).toEqual([]);
    const theirsAttempt = await attempt(r.world, "question-2", "wrong", 0, 20, OTHER);
    const theirOffer = await r.world.service().generateHypothesis(OTHER, { attemptId: theirsAttempt, now: t(100) });
    expect(theirOffer.status).toBe("ready"); // their own, independent offer
    expect(await err(r.world.service().generateHypothesis(OTHER, { attemptId: mine.attemptId }))).toMatchObject({ code: "ownership_mismatch" });
    expect((await plansFor(r)).map((p) => p.studentId)).toEqual([STUDENT]);
  });

  it("the existing recommendation path READS the stored plan through its unchanged repair tier -- no selection code was added or changed", async () => {
    const r = rig();
    const o = await offered(r);
    const before = await r.world.service().getNextRecommendation(claim);
    await respond(r, o, { type: "confirmed" });
    const after = await r.world.service().getNextRecommendation(claim);
    // before a confirmation there is no plan; after it, the composition hands the stored plan to the existing orchestration
    expect(before.modeLabel).not.toBe("Confirmed pattern");
    expect(after.modeLabel).toBe("Confirmed pattern");
    expect(after.headline).toBe("Fix a confirmed mistake pattern");
  });

  it("rejected and corrected answers leave the recommendation path exactly as it was (no plan reaches it)", async () => {
    for (const response of [{ type: "rejected" } as const, { type: "corrected", correctedExplanation: "my own words" } as const]) {
      const r = rig();
      const o = await offered(r);
      const before = await r.world.service().getNextRecommendation(claim);
      await respond(r, o, response);
      expect(await r.world.service().getNextRecommendation(claim)).toEqual(before);
    }
  });

  it("the service has no mastery, selection or planner dependency of its own (structural)", () => {
    const deps = Object.keys((new World().service() as unknown as { deps: object }).deps).join(" ");
    expect(deps).not.toMatch(/mastery|selection|planner|adaptive|repairSelection/i);
  });
});
