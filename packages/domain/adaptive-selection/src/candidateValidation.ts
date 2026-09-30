import type { AdaptiveCandidateQuestion, CandidateValidationIssue, CandidateValidationResult } from "./types.js";

/**
 * A structural, deterministic completeness check — the SAME shape and
 * purpose as `@ipmat/repair-selection`'s `validateRepairCandidateQuestion()`,
 * independently declared (see `types.ts`'s doc comment on why siblings
 * restate rather than import from each other). Checks only what THIS
 * selector needs to make a safe, explainable decision; a candidate
 * missing an identifier, a taxonomy-cell link, at least one testing mode,
 * or a positive expected time is EXCLUDED rather than silently repaired.
 */
export function validateAdaptiveCandidateQuestion(candidate: AdaptiveCandidateQuestion): CandidateValidationResult {
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Phase 3 Unit 5 -- one questionId must mean one question. Every later stage keys on `questionId`, so two DIFFERENT candidates sharing an id
 * would silently collapse into one (and which one survived would depend on input order). Rule, independent of input order:
 *   - exact duplicates (identical content) collapse to one candidate -- harmless, the copies are interchangeable;
 *   - candidates that share an id but DIFFER are contradictory: ALL copies are excluded (counted as malformed), never guessed between.
 * Candidates with an empty id are left for `validateAdaptiveCandidateQuestion()` to reject.
 */
export function dedupeCandidatesById(candidates: AdaptiveCandidateQuestion[]): { unique: AdaptiveCandidateQuestion[]; conflictingCount: number } {
  const groups = new Map<string, { signatures: Set<string>; count: number }>();
  for (const candidate of candidates) {
    const id = candidate.question?.questionId;
    if (!id) continue;
    const group = groups.get(id) ?? { signatures: new Set<string>(), count: 0 };
    group.signatures.add(canonicalJson(candidate));
    group.count += 1;
    groups.set(id, group);
  }
  const unique: AdaptiveCandidateQuestion[] = [];
  const emitted = new Set<string>();
  let conflictingCount = 0;
  for (const candidate of candidates) {
    const id = candidate.question?.questionId;
    const group = id ? groups.get(id) : undefined;
    if (!id || !group) {
      unique.push(candidate);
    } else if (group.signatures.size > 1) {
      conflictingCount += 1; // every copy of a contradictory id is excluded
    } else if (!emitted.has(id)) {
      emitted.add(id);
      unique.push(candidate);
    }
  }
  return { unique, conflictingCount };
}
