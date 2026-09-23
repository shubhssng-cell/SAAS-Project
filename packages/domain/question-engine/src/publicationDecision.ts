import { requiresHumanReview } from "./lifecycle.js";
import type { DifficultyTier, ValidationState } from "./types.js";

/**
 * Phase 3.5 (Content Curation / Publication Workflow) — the ONE place
 * that decides whether an explicit human "publish" or "reject" decision
 * on a Question is currently allowed. Operates on the REAL, persisted
 * `ValidationState` enum (the actual `Question.validationState` column,
 * docs/DATABASE.md), never `QuestionLifecycleStatus` (lifecycle.ts) —
 * that vocabulary is the generation PIPELINE's own in-memory candidate
 * status, produced before anything is ever persisted, and is intentionally
 * left untouched here (no rewrite of the existing pipeline).
 *
 * This function is PURE and NEVER called by `runGenerationPipeline()` or
 * anything else in the pipeline — reaching "ai_validated" (the persisted
 * analogue of the pipeline's "validated") never implies "published" on
 * its own. A caller (a repository's own `decide()`, see @ipmat/db) must
 * invoke this explicitly, once, per human decision.
 */
export type PublicationDecisionAction = "publish" | "reject";

export const PUBLICATION_DECISION_ERROR_CODES = [
  "already_terminal",
  "validation_incomplete",
  "human_review_required",
  "missing_provenance"
] as const;
export type PublicationDecisionErrorCode = (typeof PUBLICATION_DECISION_ERROR_CODES)[number];

/**
 * Fail-closed guard for a refused publication decision — mirrors
 * `@ipmat/attempt`'s `AttemptLifecycleError` style (throw a typed error
 * with a stable code, never return a "maybe" result a caller could
 * silently ignore).
 */
export class PublicationDecisionError extends Error {
  readonly code: PublicationDecisionErrorCode;

  constructor(code: PublicationDecisionErrorCode, message: string) {
    super(message);
    this.name = "PublicationDecisionError";
    this.code = code;
  }
}

export interface PublicationDecisionInput {
  /** The Question's REAL, server-loaded validationState — never a value a caller merely claims (the same lesson as docs/DECISIONS.md D-048, one layer over). */
  currentValidationState: ValidationState;
  difficultyTier: DifficultyTier;
  /** Whether a Provenance record is actually attached — mirrors the DB-level CHECK constraint `questions_published_requires_provenance` (migration 0001_init); this is a defense-in-depth check, not a replacement for it. */
  hasProvenance: boolean;
}

/**
 * Decides the next `ValidationState` for an explicit "publish" or
 * "reject" decision, or throws `PublicationDecisionError` if the decision
 * is not currently allowed. `published` and `rejected` are both terminal —
 * neither can be the CURRENT state of an incoming decision (docs/DECISIONS.md
 * D-006/D-035's "no reversing a terminal state" principle, applied here to
 * content). Hard/Extreme/Novel tiers must reach `human_reviewed` before
 * `publish` is allowed, reusing `requiresHumanReview()` (Phase 3/D-008)
 * rather than restating the tier rule; Standard/Advanced may publish
 * directly from `ai_validated`, but ONLY via this explicit call — nothing
 * does so automatically.
 */
export function decidePublication(action: PublicationDecisionAction, input: PublicationDecisionInput): ValidationState {
  const { currentValidationState, difficultyTier, hasProvenance } = input;

  if (currentValidationState === "published" || currentValidationState === "rejected") {
    throw new PublicationDecisionError(
      "already_terminal",
      `Cannot ${action}: validationState is already terminal ("${currentValidationState}").`
    );
  }

  if (action === "reject") {
    return "rejected";
  }

  if (currentValidationState !== "ai_validated" && currentValidationState !== "human_reviewed") {
    throw new PublicationDecisionError(
      "validation_incomplete",
      `Cannot publish: validationState "${currentValidationState}" has not completed validation.`
    );
  }

  if (requiresHumanReview(difficultyTier) && currentValidationState !== "human_reviewed") {
    throw new PublicationDecisionError(
      "human_review_required",
      `Cannot publish: difficultyTier "${difficultyTier}" requires human review first (currently "${currentValidationState}").`
    );
  }

  if (!hasProvenance) {
    throw new PublicationDecisionError(
      "missing_provenance",
      "Cannot publish: no Provenance record exists for this question (content provenance is mandatory)."
    );
  }

  return "published";
}
