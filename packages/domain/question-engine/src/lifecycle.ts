import type { DifficultyTier } from "./types.js";

/**
 * The status flow (docs/QUESTION_ENGINE.md §5c / Phase 3 §8). `rejected`
 * is not in the phase brief's linear list but is an unavoidable terminal
 * state — "a question that fails validation must never become published
 * content" has to land somewhere, and pretending failed candidates simply
 * vanish would be worse than naming the state honestly.
 */
export type QuestionLifecycleStatus =
  | "draft"
  | "generated"
  | "validated"
  | "review_required"
  | "approved"
  | "published"
  | "rejected"
  | "deprecated";

/** Hard/Extreme/Novel always require human review before publication (docs/DECISIONS.md D-008, reaffirmed here). */
export function requiresHumanReview(tier: DifficultyTier): boolean {
  return tier === "hard" || tier === "extreme" || tier === "novel";
}

const ALLOWED_TRANSITIONS: Record<QuestionLifecycleStatus, QuestionLifecycleStatus[]> = {
  draft: ["generated"],
  generated: ["validated", "rejected"],
  validated: ["review_required", "published", "rejected"],
  review_required: ["approved", "rejected"],
  approved: ["published"],
  published: ["deprecated"],
  rejected: [],
  deprecated: []
};

export function isValidTransition(from: QuestionLifecycleStatus, to: QuestionLifecycleStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Given the outcome of the full validation pipeline, decides the ONE
 * status a freshly-generated candidate should land in. Never returns
 * "published" directly for a tier that requires review — "generated AI
 * questions should NOT automatically become published" holds regardless
 * of how clean the validation results look (Phase 3 §8).
 */
export function computeLifecycleStatus(input: { allChecksPassed: boolean; difficultyTier: DifficultyTier }): QuestionLifecycleStatus {
  if (!input.allChecksPassed) return "rejected";
  return requiresHumanReview(input.difficultyTier) ? "review_required" : "validated";
}
