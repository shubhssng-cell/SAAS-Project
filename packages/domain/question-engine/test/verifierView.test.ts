import { describe, expect, it } from "vitest";
import { buildJudgeUserPrompt, buildReverificationUserPrompt } from "../src/prompts.js";
import { toJudgeView, toPresentedQuestionView } from "../src/verifierView.js";
import { validGeneratedCandidate } from "../fixtures/pipelineFixtures.js";
import type { QuestionCandidateAiOutput } from "@ipmat/ai";

const SECRET_ANSWER = "SECRET_ANSWER_MARKER_9f3a1c";
const SECRET_EXPLANATION = "SECRET_EXPLANATION_MARKER_7b2e0d";
const SECRET_COMPUTATION = "SECRET_COMPUTATION_MARKER_1a4f6b";
const SECRET_REASONING = "SECRET_REASONING_MARKER_5c8d2e";
const SECRET_SOLUTION_STEP = "SECRET_SOLUTION_STEP_MARKER_3e9f1a";

/**
 * Proves answer leakage is impossible through the verifier input
 * structure (Phase 3.1 §1 / docs/DECISIONS.md D-020) — not just that the
 * current prompt text happens not to mention the answer, but that the
 * TYPE these functions accept has no field the answer could travel
 * through, and that a marker planted in every field the verifier must
 * NOT see never appears in what actually gets sent.
 */
const candidateWithMarkers: QuestionCandidateAiOutput = {
  ...validGeneratedCandidate,
  correctAnswer: SECRET_ANSWER,
  explanation: SECRET_EXPLANATION,
  reasoning: SECRET_REASONING,
  solutionSteps: [SECRET_SOLUTION_STEP],
  groundTruthDerivation: { computation: SECRET_COMPUTATION, expectedAnswer: 999999 }
};

describe("independent verifier input structure — answer leakage is impossible", () => {
  it("toPresentedQuestionView returns ONLY stem/options/answerFormat — nothing else, by key", () => {
    const view = toPresentedQuestionView(candidateWithMarkers);
    expect(new Set(Object.keys(view))).toEqual(new Set(["stem", "options", "answerFormat"]));
  });

  it("toJudgeView adds ONLY claimedDifficultyTier on top of the presented view", () => {
    const view = toJudgeView(candidateWithMarkers);
    expect(new Set(Object.keys(view))).toEqual(new Set(["stem", "options", "answerFormat", "claimedDifficultyTier"]));
  });

  it("the reverification prompt built from the view never contains the answer, explanation, computation, reasoning, or solution steps", () => {
    const prompt = buildReverificationUserPrompt(toPresentedQuestionView(candidateWithMarkers));
    for (const secret of [SECRET_ANSWER, SECRET_EXPLANATION, SECRET_COMPUTATION, SECRET_REASONING, SECRET_SOLUTION_STEP]) {
      expect(prompt).not.toContain(secret);
    }
  });

  it("the judge prompt built from the view never contains the answer, explanation, computation, reasoning, or solution steps", () => {
    const prompt = buildJudgeUserPrompt(toJudgeView(candidateWithMarkers));
    for (const secret of [SECRET_ANSWER, SECRET_EXPLANATION, SECRET_COMPUTATION, SECRET_REASONING, SECRET_SOLUTION_STEP]) {
      expect(prompt).not.toContain(secret);
    }
  });

  it("the reverification prompt DOES contain the stem and options — the verifier must be able to see the actual question", () => {
    const prompt = buildReverificationUserPrompt(toPresentedQuestionView(candidateWithMarkers));
    expect(prompt).toContain(candidateWithMarkers.stem);
    for (const option of candidateWithMarkers.options ?? []) {
      expect(prompt).toContain(option);
    }
  });

  it("the judge prompt DOES contain the stem, options, and claimed difficulty tier", () => {
    const prompt = buildJudgeUserPrompt(toJudgeView(candidateWithMarkers));
    expect(prompt).toContain(candidateWithMarkers.stem);
    expect(prompt).toContain(candidateWithMarkers.questionDna.difficultyTier);
  });
});
