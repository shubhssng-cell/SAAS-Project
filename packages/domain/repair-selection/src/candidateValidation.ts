import type { CandidateValidationIssue, CandidateValidationResult, RepairCandidateQuestion } from "./types.js";

/**
 * A structural, deterministic completeness check — NOT the same thing as
 * `@ipmat/question-engine`'s `validateQuestionDna()` (which needs a full
 * `ConceptGraph` + pattern-family list to check REFERENTIAL validity, e.g.
 * "does this concept actually exist"). This checks only what the
 * SELECTOR itself needs to make a safe, explainable decision: a candidate
 * missing an identifier, a taxonomy-cell link, at least one testing mode,
 * or a positive expected time is EXCLUDED from consideration rather than
 * silently treated as a normal, complete candidate (Phase 5C-2 §7 point
 * P — "malformed/incomplete Question DNA rejected rather than silently
 * accepted").
 */
export function validateRepairCandidateQuestion(candidate: RepairCandidateQuestion): CandidateValidationResult {
  const issues: CandidateValidationIssue[] = [];
  const { question } = candidate;

  if (!question.questionId) {
    issues.push({ field: "question.questionId", message: "missing questionId" });
  }
  if (!question.conceptName) {
    issues.push({ field: "question.conceptName", message: "missing conceptName" });
  }
  if (!question.patternFamilyName) {
    issues.push({ field: "question.patternFamilyName", message: "missing patternFamilyName" });
  }
  if (!question.patternTaxonomyCellId) {
    issues.push({ field: "question.patternTaxonomyCellId", message: "missing patternTaxonomyCellId" });
  }
  if (!question.difficultyTier) {
    issues.push({ field: "question.difficultyTier", message: "missing difficultyTier" });
  }
  if (!question.noveltyLevel) {
    issues.push({ field: "question.noveltyLevel", message: "missing noveltyLevel" });
  }
  if (question.testingModes.length === 0) {
    issues.push({ field: "question.testingModes", message: "at least one testing mode is required" });
  }
  if (!Number.isFinite(candidate.expectedTimeSeconds) || candidate.expectedTimeSeconds <= 0) {
    issues.push({ field: "expectedTimeSeconds", message: "expectedTimeSeconds must be a positive finite number" });
  }
  if (!candidate.validationState) {
    issues.push({ field: "validationState", message: "missing validationState" });
  }

  return { valid: issues.length === 0, issues };
}
