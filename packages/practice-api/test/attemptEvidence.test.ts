import { describe, expect, it } from "vitest";
import { PracticeApiError } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World, publishedQuestion, publishedQuestionContent, t } from "./fixtures.js";

/**
 * Phase 4 Unit 1 -- observation-only evidence through the REAL attempt lifecycle, real in-memory repositories and the real
 * recommendation composition (no mocked evidence). It answers "what happened", never "why": no diagnosis, no cause, no label, no
 * answer key, no psychological claim, and nothing before submission.
 */

const claim = { studentId: STUDENT, enrollmentId: ENROLLMENT };
const SECOND = { ...publishedQuestion, id: "question-2" };
const dna = (questionId: string, family: string, cell: string) => ({
  question: {
    questionId, examCode: "IPMAT_INDORE", sectionName: "Quant", chapterName: "Percentages", conceptName: "Percentages", patternFamilyName: family, patternTaxonomyCellId: cell,
    difficultyTier: "standard" as const,
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard" as const, examRelevance: "core" as const, testingModes: ["reverse" as const], trapErrorTaxonomyCode: null, combinesWithConcepts: []
  },
  expectedTimeSeconds: 90,
  validationState: "published" as const
});

function worldWithDna(): World {
  const w = new World();
  w.questions = [publishedQuestion, SECOND];
  w.questionContent = [publishedQuestionContent, { ...publishedQuestionContent, id: "question-2" }];
  w.trainingRecommendationOverrides = {
    trainingQuestionReader: { findPublishedByExamId: async () => [dna("question-1", "Reverse Percentage", "cell-reverse"), dna("question-2", "Successive Change", "cell-successive")] },
    conceptReader: { findWithPublishedQuestionsByExamId: async () => [{ id: "concept-percentages", name: "Percentages", chapterId: "chapter-1" }] }
  };
  return w;
}

async function attempt(world: World, questionId: string, outcome: "correct" | "wrong" | "skip", startSec: number, endSec: number): Promise<string> {
  const { attemptId } = await world.service().startAttempt(claim, { questionId, now: t(startSec) });
  if (outcome === "skip") await world.service().skipAttempt(claim, { attemptId, questionId, now: t(endSec) });
  else await world.service().submitAttempt(claim, { attemptId, questionId, chosenAnswer: outcome === "correct" ? ANSWER_KEY : "999", now: t(endSec) });
  return attemptId;
}

const PSYCH = /confiden|motivat|anxi|lazy|careless|struggl|intelligen|ability|emotion|afraid|feel|understand|confus|unsure|guess|weak|hesitat|rushed|panic|nervous/i;

describe("the evidence for a finalized attempt", () => {
  it("incorrect answer: neutral, numeric observations taken from the real lifecycle", async () => {
    const world = worldWithDna();
    const attemptId = await attempt(world, "question-1", "wrong", 0, 86);
    const view = await world.service().getAttemptEvidence(claim, { attemptId });

    expect(view.observations).toEqual([
      "Your selected answer was 999.",
      "Your answer was incorrect.",
      "You took 86 seconds.",
      "The expected time was 90 seconds.",
      "That is about 1.0 times the expected time.",
      'This question was in Percentages, pattern "Reverse Percentage", at the standard level.'
    ]);
    expect(view.facts).toMatchObject({ verdict: "incorrect", selectedAnswer: "999", elapsedSeconds: 86, expectedSeconds: 90, answerChangeCount: null });
    expect(view.history).toBeNull(); // nothing before it
    // the one selection the flow records cannot show "no change": this is reported as not recorded, never as zero
    expect(view.notRecorded).toEqual(["Changes to your answer before submitting are not recorded in this practice flow."]);
    expect(view.observations.join(" ")).not.toMatch(/changed your answer/);
  });

  it("correct answer and a slower-than-expected attempt state the ratio as a number, not a judgment", async () => {
    const world = worldWithDna();
    const attemptId = await attempt(world, "question-1", "correct", 0, 135);
    const view = await world.service().getAttemptEvidence(claim, { attemptId });
    expect(view.facts).toMatchObject({ verdict: "correct", elapsedSeconds: 135, timeRatio: 1.5 });
    expect(view.observations).toContain("Your answer was correct.");
    expect(view.observations).toContain("That is about 1.5 times the expected time.");
  });

  it("skipped attempt: a skip is stated as a skip, with no selected answer and no grading", async () => {
    const world = worldWithDna();
    const attemptId = await attempt(world, "question-1", "skip", 0, 12);
    const view = await world.service().getAttemptEvidence(claim, { attemptId });
    expect(view.status).toBe("skipped");
    expect(view.facts).toMatchObject({ verdict: "not_graded", selectedAnswer: null });
    expect(view.observations[0]).toBe("You skipped this question.");
    expect(view.observations.join(" ")).not.toMatch(/correct|incorrect|selected answer/);
  });

  it("history: previous attempts on the concept are counted; an earlier result never changes when later attempts are made", async () => {
    const world = worldWithDna();
    const first = await attempt(world, "question-1", "wrong", 0, 40);
    await attempt(world, "question-2", "correct", 100, 130);
    await attempt(world, "question-1", "wrong", 200, 250);
    const third = await attempt(world, "question-2", "skip", 300, 310);

    const v3 = await world.service().getAttemptEvidence(claim, { attemptId: third });
    expect(v3.history).toEqual({ priorAttempts: 3, onConcept: { attempts: 3, correct: 1, incorrect: 2, skipped: 0 } });
    expect(v3.observations).toContain("Before this attempt you had 3 earlier attempts on Percentages: 1 correct, 2 incorrect.");

    const v1Before = await world.service().getAttemptEvidence(claim, { attemptId: first });
    expect(v1Before.history).toBeNull(); // the first attempt had nothing before it, even now that three more exist
    await attempt(world, "question-1", "correct", 400, 440);
    expect(await world.service().getAttemptEvidence(claim, { attemptId: first })).toEqual(v1Before);
  });

  it("reproducible after a 'restart': a brand-new service over the same persisted state returns the identical view", async () => {
    const world = worldWithDna();
    const a1 = await attempt(world, "question-1", "wrong", 0, 50);
    const a2 = await attempt(world, "question-2", "correct", 100, 160);
    const before = [await world.service().getAttemptEvidence(claim, { attemptId: a1 }), await world.service().getAttemptEvidence(claim, { attemptId: a2 })];
    const after = [await world.service().getAttemptEvidence(claim, { attemptId: a1 }), await world.service().getAttemptEvidence(claim, { attemptId: a2 })];
    expect(after).toEqual(before);
  });

  it("missing question metadata is UNKNOWN, not guessed: outcome and timing are still reported, context and history are null", async () => {
    const world = new World(); // default world: no DNA pool
    const attemptId = await attempt(world, "question-1", "wrong", 0, 30);
    const view = await world.service().getAttemptEvidence(claim, { attemptId });
    expect(view.context).toBeNull();
    expect(view.history).toBeNull();
    expect(view.observations).toEqual(["Your selected answer was 999.", "Your answer was incorrect.", "You took 30 seconds.", "The expected time was 90 seconds.", "That is about 0.3 times the expected time."]);
  });

  it("is read-only: asking for evidence writes nothing to the attempt record", async () => {
    const world = worldWithDna();
    const attemptId = await attempt(world, "question-1", "wrong", 0, 30);
    const snapshot = JSON.stringify(await world.attempts.findFinalizedByStudentId(STUDENT));
    await world.service().getAttemptEvidence(claim, { attemptId });
    await world.service().getAttemptEvidence(claim, { attemptId });
    expect(JSON.stringify(await world.attempts.findFinalizedByStudentId(STUDENT))).toBe(snapshot);
  });
});

describe("boundaries: nothing before submission, nothing for someone else, nothing diagnostic", () => {
  it("an attempt that is still in progress is refused (no evidence before submission)", async () => {
    const world = worldWithDna();
    const { attemptId } = await world.service().startAttempt(claim, { questionId: "question-1", now: t(0) });
    const error = await world.service().getAttemptEvidence(claim, { attemptId }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PracticeApiError);
    expect(error).toMatchObject({ code: "invalid_state", httpStatus: 409 });
    expect(JSON.stringify(error)).not.toContain(ANSWER_KEY);
  });

  it("another student cannot read this attempt's evidence, and an unknown attempt is not found", async () => {
    const world = worldWithDna();
    const attemptId = await attempt(world, "question-1", "wrong", 0, 30);
    const foreign = { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT };
    expect(await world.service().getAttemptEvidence(foreign, { attemptId }).catch((e: unknown) => e)).toMatchObject({ code: "ownership_mismatch", httpStatus: 403 });
    expect(await world.service().getAttemptEvidence(claim, { attemptId: "no-such-attempt" }).catch((e: unknown) => e)).toMatchObject({ code: "not_found" });
    // a claim whose enrollment belongs to someone else is refused as well
    expect(await world.service().getAttemptEvidence({ studentId: STUDENT, enrollmentId: OTHER_ENROLLMENT }, { attemptId }).catch((e: unknown) => e)).toBeInstanceOf(PracticeApiError);
  });

  it("the view never contains the answer key, a diagnosis, a repair, or a psychological claim -- for any outcome", async () => {
    const world = worldWithDna();
    const ids = [await attempt(world, "question-1", "wrong", 0, 30), await attempt(world, "question-2", "correct", 100, 400), await attempt(world, "question-1", "skip", 500, 505)];
    for (const attemptId of ids) {
      const view = await world.service().getAttemptEvidence(claim, { attemptId });
      const text = JSON.stringify(view);
      // the key can appear ONLY as the student's own selected answer on a correct attempt -- never for an incorrect or skipped one
      if (view.facts.verdict === "correct") expect(text.split(ANSWER_KEY).length - 1).toBe(view.observations.filter((o) => o.includes(ANSWER_KEY)).length + (view.facts.selectedAnswer === ANSWER_KEY ? 1 : 0));
      else expect(text).not.toContain(ANSWER_KEY);
      expect(text).not.toMatch(/correctAnswer|solutionSteps|groundTruth|hypothesis|diagnos|repair|candidateError|errorCategory|trap|modelConfidence/i);
      expect(text).not.toMatch(PSYCH);
      expect(Object.keys(view).sort()).toEqual(["attemptId", "context", "facts", "history", "notRecorded", "observations", "questionId", "status"]);
    }
  });

  it("every sentence is a recorded or derived fact: fixed templates only, no cause and no label", async () => {
    const world = worldWithDna();
    const ids = [await attempt(world, "question-1", "wrong", 0, 10), await attempt(world, "question-2", "correct", 100, 500), await attempt(world, "question-1", "wrong", 600, 640)];
    for (const attemptId of ids) {
      for (const line of (await world.service().getAttemptEvidence(claim, { attemptId })).observations) {
        expect(line).toMatch(/^(Your selected answer was .+\.|Your answer was (correct|incorrect)\.|You skipped this question\.|You took \d+ seconds?\.|The expected time was \d+ seconds?\.|That is about \d+\.\d times the expected time\.|You changed your answer .+ before submitting\.|You opened .+\.|This question was in .+, pattern ".+", at the .+ level\.|Before this attempt you had \d+ earlier attempts? on .+: .+\.)$/);
        expect(line).not.toMatch(/because|due to|probably|seems|maybe|likely|should have|too (fast|slow)|rushed|careless/i);
      }
    }
  });
});
