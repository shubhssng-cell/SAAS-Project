import type { ValidationJudgeAiOutput } from "@ipmat/ai";

export const passingJudgeVerdict: ValidationJudgeAiOutput = {
  syllabusRelevant: true,
  hasExactlyOneDefensibleAnswer: true,
  isAmbiguous: false,
  hasContradictoryConditions: false,
  difficultyTierIsHonest: true,
  issues: [],
  verdict: "pass"
};

/** Ambiguity/contradiction detection needs natural-language understanding — this is what only the AI-judge call can catch, not a deterministic check. */
export const ambiguousJudgeVerdict: ValidationJudgeAiOutput = {
  syllabusRelevant: true,
  hasExactlyOneDefensibleAnswer: true,
  isAmbiguous: true,
  hasContradictoryConditions: false,
  difficultyTierIsHonest: true,
  issues: ["\"before the increase, before this increase\" is redundant and could be read as describing two separate events"],
  verdict: "fail"
};

export const contradictoryJudgeVerdict: ValidationJudgeAiOutput = {
  syllabusRelevant: true,
  hasExactlyOneDefensibleAnswer: false,
  isAmbiguous: false,
  hasContradictoryConditions: true,
  difficultyTierIsHonest: true,
  issues: ["States the population both increased and simultaneously halved in the same period, which cannot both be true"],
  verdict: "fail"
};
