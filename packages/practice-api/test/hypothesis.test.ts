import { describe, expect, it } from "vitest";
import type { AutopsyHypothesis, ObservationEvidence } from "@ipmat/training-recommendation";
import { HYPOTHESIS_TOKEN_TTL_MS, MAX_CORRECTION_CHARS } from "../src/service.js";
import { PracticeApiError, type HypothesisSealer } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World, publishedQuestion, publishedQuestionContent, t } from "./fixtures.js";

/**
 * Phase 4 Unit 2 -- hypothesis offer + the student's response, through the REAL attempt lifecycle and the real evidence composition.
 * The model is a fake generator (this package never imports an AI SDK); the generator's own safety validation is tested in
 * `@ipmat/autopsy`. Here: ownership, nothing before submission, fail-safe fallbacks, the stateless confirmation token, and the
 * persistence boundary (nothing stored, no RepairPlan).
 */

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const OTHER = { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT };
const SECOND = { ...publishedQuestion, id: "question-2" };

const dna = (questionId: string, family: string, cell: string) => ({
  question: {
    questionId, examCode: "IPMAT_INDORE", sectionName: "Quant", chapterName: "Percentages", conceptName: "Percentages", patternFamilyName: family, patternTaxonomyCellId: cell,
    difficultyTier: "standard" as const,
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard" as const, examRelevance: "core" as const, testingModes: ["reverse" as const], trapErrorTaxonomyCode: "base_confusion", combinesWithConcepts: []
  },
  expectedTimeSeconds: 90,
  validationState: "published" as const
});

/** A readable-but-tamper-evident test sealer (the real one is AES-GCM in apps/api): a marker plus the JSON, refused if altered. */
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

function hypothesisFor(observation: ObservationEvidence): AutopsyHypothesis {
  return {
    attemptId: observation.identity.attemptId,
    proposedErrorCategory: "trap",
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
  };
}

interface Rig {
  world: World;
  seen: ObservationEvidence[];
  calls: () => number;
}
function rig(generate?: (o: ObservationEvidence) => Promise<AutopsyHypothesis>, sealer: HypothesisSealer | null = testSealer()): Rig {
  const world = new World();
  world.questions = [publishedQuestion, SECOND];
  world.questionContent = [publishedQuestionContent, { ...publishedQuestionContent, id: "question-2" }];
  world.trainingRecommendationOverrides = {
    trainingQuestionReader: { findPublishedByExamId: async () => [dna("question-1", "Reverse Percentage", "cell-reverse"), dna("question-2", "Successive Change", "cell-successive")] },
    conceptReader: { findWithPublishedQuestionsByExamId: async () => [{ id: "concept-percentages", name: "Percentages", chapterId: "chapter-1" }] }
  };
  const seen: ObservationEvidence[] = [];
  let n = 0;
  const generator = generate ?? (async (o: ObservationEvidence) => hypothesisFor(o));
  world.hypothesis = {
    hypothesisGenerator: async (o) => {
      n += 1;
      seen.push(o);
      return generator(o);
    },
    hypothesisSealer: sealer
  };
  return { world, seen, calls: () => n };
}

async function attempt(world: World, questionId: string, outcome: "correct" | "wrong" | "skip", start: number, end: number, who = claim): Promise<string> {
  const { attemptId } = await world.service().startAttempt(who, { questionId, now: t(start) });
  if (outcome === "skip") await world.service().skipAttempt(who, { attemptId, questionId, now: t(end) });
  else await world.service().submitAttempt(who, { attemptId, questionId, chosenAnswer: outcome === "correct" ? ANSWER_KEY : "999", now: t(end) });
  return attemptId;
}
const err = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

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
    expect(offer.hypothesis.summary).toMatch(/\bmay\b/);
    // the generator was handed exactly the observation evidence the student's evidence card is built from
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]!.outcome).toMatchObject({ verdict: "incorrect", selectedAnswer: "999" });
    expect(evidence.facts.selectedAnswer).toBe(r.seen[0]!.outcome.selectedAnswer);
    const text = JSON.stringify(offer);
    expect(text).not.toMatch(/modelConfidence|0\.77|secret-provider|secret-model|secret-prompt|generationMetadata|promptVersion|proposedErrorCategory/);
    expect(text).not.toContain(ANSWER_KEY);
  });

  it("nothing to explain: a correct or skipped attempt is not_applicable and the model is never called", async () => {
    const r = rig();
    const correct = await attempt(r.world, "question-1", "correct", 0, 30);
    const skipped = await attempt(r.world, "question-2", "skip", 100, 110);
    expect(await r.world.service().generateHypothesis(claim, { attemptId: correct })).toEqual({ status: "not_applicable", attemptId: correct });
    expect(await r.world.service().generateHypothesis(claim, { attemptId: skipped })).toEqual({ status: "not_applicable", attemptId: skipped });
    expect(r.calls()).toBe(0);
  });

  it("never before submission: an in-progress attempt is refused (409) and the model is not called", async () => {
    const r = rig();
    const { attemptId } = await r.world.service().startAttempt(claim, { questionId: "question-1", now: t(0) });
    expect(await err(r.world.service().generateHypothesis(claim, { attemptId }))).toMatchObject({ code: "invalid_state", httpStatus: 409 });
    expect(r.calls()).toBe(0);
  });

  it("ownership: another student cannot request a hypothesis for this attempt (403), an unknown attempt is 404", async () => {
    const r = rig();
    const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30);
    expect(await err(r.world.service().generateHypothesis(OTHER, { attemptId }))).toMatchObject({ code: "ownership_mismatch", httpStatus: 403 });
    expect(await err(r.world.service().generateHypothesis(claim, { attemptId: "nope" }))).toMatchObject({ code: "not_found" });
    expect(r.calls()).toBe(0);
  });

  it("AI failure is neutral: no generator, a provider error, a rejected/unsafe proposal, or a malformed one all answer 'unavailable' with nothing else", async () => {
    const attemptOf = async (r: Rig) => attempt(r.world, "question-1", "wrong", 0, 30);
    const none = rig(undefined, testSealer());
    none.world.hypothesis = {}; // no generator at all
    const noGen = await attemptOf(none);
    expect(await none.world.service().generateHypothesis(claim, { attemptId: noGen })).toEqual({ status: "unavailable", attemptId: noGen });

    const cases: Array<(o: ObservationEvidence) => Promise<AutopsyHypothesis>> = [
      async () => { throw new Error("provider down: secret-detail-123"); },
      async () => { throw Object.assign(new Error("The proposed hypothesis was rejected: stated_as_certain."), { code: "unsafe_hypothesis_output" }); },
      async (o) => ({ ...hypothesisFor(o), attemptId: "someone-elses-attempt" }),
      async (o) => ({ ...hypothesisFor(o), supportingEvidence: [] }),
      async (o) => ({ ...hypothesisFor(o), confirmationStatus: "confirmed" as const })
    ];
    for (const generate of cases) {
      const r = rig(generate);
      const attemptId = await attemptOf(r);
      const offer = await r.world.service().generateHypothesis(claim, { attemptId });
      expect(offer).toEqual({ status: "unavailable", attemptId });
      expect(JSON.stringify(offer)).not.toMatch(/secret-detail|down|stated_as_certain/);
    }
  });

  it("the result and the evidence are unaffected by an AI failure", async () => {
    const r = rig(async () => { throw new Error("boom"); });
    const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30);
    await r.world.service().generateHypothesis(claim, { attemptId });
    expect((await r.world.service().getAttemptResult(claim, { attemptId })).status).toBe("submitted");
    expect((await r.world.service().getAttemptEvidence(claim, { attemptId })).observations).toContain("Your answer was incorrect.");
  });
});

describe("the student's response", () => {
  async function offered(r: Rig, who = claim) {
    const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30, who);
    const offer = await r.world.service().generateHypothesis(who, { attemptId, now: t(100) });
    if (offer.status !== "ready") throw new Error("expected a ready offer");
    return { attemptId, token: offer.token, summary: offer.hypothesis.summary };
  }

  it("confirm: 'the student said it matches' -- and nothing is stored", async () => {
    const r = rig();
    const o = await offered(r);
    const before = JSON.stringify(await r.world.attempts.findFinalizedByStudentId(STUDENT));
    const view = await r.world.service().respondToHypothesis(claim, { attemptId: o.attemptId, token: o.token, response: { type: "confirmed" }, now: t(200) });
    expect(view).toEqual({ attemptId: o.attemptId, status: "confirmed", studentCorrectionText: null, hypothesisSummary: o.summary, persisted: false });
    expect(JSON.stringify(await r.world.attempts.findFinalizedByStudentId(STUDENT))).toBe(before); // no write
  });

  it("reject: stays rejected -- never confirmed -- and carries no correction", async () => {
    const r = rig();
    const o = await offered(r);
    const view = await r.world.service().respondToHypothesis(claim, { attemptId: o.attemptId, token: o.token, response: { type: "rejected" }, now: t(200) });
    expect(view).toMatchObject({ status: "rejected", studentCorrectionText: null, persisted: false });
  });

  it("correct: the student's own words come back EXACTLY as sent", async () => {
    const r = rig();
    const o = await offered(r);
    const words = "  I used 120% as the base — not the original.\n(second line) ✓  ";
    const view = await r.world.service().respondToHypothesis(claim, { attemptId: o.attemptId, token: o.token, response: { type: "corrected", correctedExplanation: words }, now: t(200) });
    expect(view).toMatchObject({ status: "corrected", studentCorrectionText: words, hypothesisSummary: o.summary });
  });

  it("the same token and response twice give the same result (the token is stateless, so nothing is consumed)", async () => {
    const r = rig();
    const o = await offered(r);
    const send = () => r.world.service().respondToHypothesis(claim, { attemptId: o.attemptId, token: o.token, response: { type: "confirmed" }, now: t(200) });
    expect(await send()).toEqual(await send());
  });

  it("a response is applied to the hypothesis that was OFFERED: a token cannot be forged, altered, replayed by another student, moved to another attempt, or used after it expires", async () => {
    const r = rig();
    const o = await offered(r);
    const stale = { code: "invalid_state", httpStatus: 409 };
    const respond = (who: typeof claim, attemptId: string, token: string, now = t(200)) => err(r.world.service().respondToHypothesis(who, { attemptId, token, response: { type: "confirmed" }, now }));

    expect(await respond(claim, o.attemptId, "garbage")).toMatchObject(stale);
    expect(await respond(claim, o.attemptId, testSealer("B").seal({ v: 1 }))).toMatchObject(stale); // sealed with another secret
    const forged = testSealer().seal({ v: 1, studentId: STUDENT, attemptId: o.attemptId, expiresAtMs: Date.now() + 1e9, hypothesis: { ...hypothesisFor(r.seen[0]!), confirmationStatus: "confirmed" } });
    expect(await respond(claim, o.attemptId, forged)).toMatchObject(stale); // a pre-confirmed hypothesis is never accepted
    expect(await respond(claim, o.attemptId, o.token, t(HYPOTHESIS_TOKEN_TTL_MS / 1000 + 1000))).toMatchObject(stale); // expired

    // another student's own attempt, with this student's token
    const theirs = await attempt(r.world, "question-2", "wrong", 0, 20, OTHER);
    expect(await respond(OTHER, theirs, o.token)).toMatchObject({ code: "ownership_mismatch", httpStatus: 403 });
    // this student, but another attempt of theirs
    const second = await attempt(r.world, "question-2", "wrong", 500, 520);
    expect(await respond(claim, second, o.token)).toMatchObject({ code: "ownership_mismatch" });
    // another student against this attempt
    expect(await respond(OTHER, o.attemptId, o.token)).toMatchObject({ code: "ownership_mismatch" });
  });

  it("no response before submission: an open attempt cannot be answered (409) even with a token", async () => {
    const r = rig();
    const o = await offered(r);
    const { attemptId } = await r.world.service().startAttempt(claim, { questionId: "question-2", now: t(900) });
    expect(await err(r.world.service().respondToHypothesis(claim, { attemptId, token: o.token, response: { type: "confirmed" } }))).toMatchObject({ code: "invalid_state" });
  });

  it("malformed responses are refused (400): unknown type, empty/whitespace/oversize correction, empty or oversize token", async () => {
    const r = rig();
    const o = await offered(r);
    const bad = (response: unknown, token = o.token) => err(r.world.service().respondToHypothesis(claim, { attemptId: o.attemptId, token, response: response as never }));
    for (const response of [{ type: "maybe" }, { type: "corrected", correctedExplanation: "" }, { type: "corrected", correctedExplanation: "   " }, { type: "corrected", correctedExplanation: "x".repeat(MAX_CORRECTION_CHARS + 1) }, { type: "corrected" }, null]) {
      expect(await bad(response)).toMatchObject({ code: "invalid_request", httpStatus: 400 });
    }
    expect(await bad({ type: "confirmed" }, "")).toMatchObject({ code: "invalid_request" });
    expect(await bad({ type: "confirmed" }, "x".repeat(20_001))).toMatchObject({ code: "invalid_request" });
    expect(await err(r.world.service().respondToHypothesis(claim, { attemptId: o.attemptId, token: o.token, response: { type: "corrected", correctedExplanation: "x".repeat(MAX_CORRECTION_CHARS) }, now: t(200) }))).toBeNull(); // the limit itself is allowed
  });

  it("without a sealer a response cannot be applied (the offer could not have been made either)", async () => {
    const r = rig(undefined, null);
    const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30);
    expect(await r.world.service().generateHypothesis(claim, { attemptId })).toEqual({ status: "unavailable", attemptId });
    expect(await err(r.world.service().respondToHypothesis(claim, { attemptId, token: "x", response: { type: "confirmed" } }))).toBeInstanceOf(PracticeApiError);
  });
});

describe("the Unit 2 persistence boundary", () => {
  it("offering and answering write nothing: no autopsy row, no attempt change, and the pending-autopsy read still reports nothing", async () => {
    const r = rig();
    const attemptId = await attempt(r.world, "question-1", "wrong", 0, 30);
    const snapshot = JSON.stringify(await r.world.attempts.findFinalizedByStudentId(STUDENT));
    const offer = await r.world.service().generateHypothesis(claim, { attemptId, now: t(100) });
    if (offer.status !== "ready") throw new Error("ready expected");
    await r.world.service().respondToHypothesis(claim, { attemptId, token: offer.token, response: { type: "confirmed" }, now: t(200) });
    expect(JSON.stringify(await r.world.attempts.findFinalizedByStudentId(STUDENT))).toBe(snapshot);
    expect(await r.world.service().getAutopsyForConfirmation(claim, { attemptId })).toMatchObject({ pending: false, hypothesis: null });
  });

  it("the service has no RepairPlan or diagnosis dependency to write to (structural)", () => {
    const keys = Object.keys(new World().service()).concat(Object.keys((new World().service() as unknown as { deps: object }).deps));
    expect(keys.join(" ")).not.toMatch(/repairPlan|diagnosis|autopsyWriter|autopsyRepository/i);
  });
});
