import type { DifficultyTier } from "./types.js";
import type { QuestionCandidateAiOutput } from "@ipmat/ai";

/**
 * The ONLY view of a candidate ever shown to an independent verifier
 * (Phase 3.1 §1 / docs/DECISIONS.md D-020). Built via explicit field-by-
 * field destructuring, never object spread of the full candidate — so it
 * is structurally impossible for `correctAnswer`, `expectedAnswer`,
 * `groundTruthDerivation`, `explanation`, `solutionSteps`, or `reasoning`
 * to leak through, even if `QuestionCandidateAiOutput` gains new fields
 * later. This is the trust boundary the independent re-derivation call
 * and the AI-judge call are both built on top of.
 */
export interface PresentedQuestionView {
  stem: string;
  options: string[] | null;
  answerFormat: "multiple_choice" | "numeric_entry";
}

export function toPresentedQuestionView(candidate: QuestionCandidateAiOutput): PresentedQuestionView {
  return {
    stem: candidate.stem,
    options: candidate.options,
    answerFormat: candidate.answerFormat
  };
}

/**
 * Adds ONLY the claimed difficulty tier, for the judge's difficulty-
 * honesty check specifically ("is the claimed tier honest given the
 * actual reasoning required" legitimately needs to know what was
 * claimed). This is the one piece of generator metadata the judge is
 * allowed to see — never the claimed answer, explanation, or reasoning.
 */
export interface JudgeView extends PresentedQuestionView {
  claimedDifficultyTier: DifficultyTier;
}

export function toJudgeView(candidate: QuestionCandidateAiOutput): JudgeView {
  return {
    ...toPresentedQuestionView(candidate),
    claimedDifficultyTier: candidate.questionDna.difficultyTier
  };
}
