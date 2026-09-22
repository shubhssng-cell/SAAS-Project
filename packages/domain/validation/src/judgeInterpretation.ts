import type { ValidationJudgeAiOutput } from "@ipmat/ai";
import { fail, mergeResults, ok, type ValidationResult } from "./types.js";

/**
 * Interprets an already-received validation-judge AI output (docs/AI_
 * ARCHITECTURE.md §3) into the same ValidationResult shape every other
 * check uses. This function is pure — it does not call any AI provider
 * itself; the caller (question-engine's generation pipeline) is
 * responsible for making the "validation-judge" generateStructured() call
 * and handing the parsed, schema-validated result in here. Ambiguity and
 * contradictory-conditions detection genuinely require the judge call —
 * no deterministic check in this package can substitute for reading and
 * understanding natural language.
 */
export function interpretJudgeVerdict(judge: ValidationJudgeAiOutput): ValidationResult {
  const issues: ValidationResult[] = [];
  if (!judge.syllabusRelevant) {
    issues.push(fail("judge_syllabus_irrelevant", "judge.syllabusRelevant", "Judge flagged the question as not syllabus-relevant"));
  }
  if (!judge.hasExactlyOneDefensibleAnswer) {
    issues.push(
      fail("judge_multiple_answers", "judge.hasExactlyOneDefensibleAnswer", "Judge could not confirm exactly one defensible answer")
    );
  }
  if (judge.isAmbiguous) {
    issues.push(fail("judge_ambiguous", "judge.isAmbiguous", `Judge flagged ambiguous wording: ${judge.issues.join("; ") || "no detail given"}`));
  }
  if (judge.hasContradictoryConditions) {
    issues.push(
      fail("judge_contradictory", "judge.hasContradictoryConditions", `Judge flagged contradictory conditions: ${judge.issues.join("; ") || "no detail given"}`)
    );
  }
  if (!judge.difficultyTierIsHonest) {
    issues.push(fail("judge_difficulty_dishonest", "judge.difficultyTierIsHonest", "Judge flagged the claimed difficulty tier as not honest"));
  }
  if (judge.verdict === "fail" && issues.length === 0) {
    // The judge failed the question for a reason not captured by the
    // structured booleans above — still a rejection, never silently passed.
    issues.push(fail("judge_ambiguous", "judge.verdict", `Judge verdict was 'fail': ${judge.issues.join("; ") || "no detail given"}`));
  }
  return issues.length > 0 ? mergeResults(...issues) : ok();
}
