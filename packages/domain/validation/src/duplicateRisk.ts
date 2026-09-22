import { fail, ok, type ValidationResult } from "./types.js";

const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * A deliberately lightweight, deterministic stand-in for the embedding-
 * similarity dedup check described in docs/QUESTION_ENGINE.md §4/§5
 * (real semantic dedup needs an embedding model — out of scope for Phase
 * 3's proof-of-concept). Token-overlap similarity catches near-verbatim
 * reuse; it will NOT catch a semantically identical question phrased in
 * entirely different words — that gap is real and documented, not hidden.
 */
export function checkDuplicateRisk(candidateStem: string, existingStems: string[]): ValidationResult {
  const candidateTokens = tokenize(candidateStem);
  for (const existing of existingStems) {
    const similarity = jaccardSimilarity(candidateTokens, tokenize(existing));
    if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return fail(
        "duplicate_risk",
        "stem",
        `Token-overlap similarity to an existing question is ${(similarity * 100).toFixed(0)}% (threshold ${DUPLICATE_SIMILARITY_THRESHOLD * 100}%)`
      );
    }
  }
  return ok();
}
