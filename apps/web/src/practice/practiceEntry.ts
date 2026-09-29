import type { RecommendationViewModel } from "../adapter/index.js";

/**
 * Pure decision, separated from `PracticeNextRoute.tsx` so it is testable
 * without rendering (Product Phase 1 Unit 9). `RecommendationViewModel`
 * already encodes the genuine "nothing to recommend right now" case as
 * `questionId: null` -- this function only names that branch clearly for
 * the UI to render; it decides nothing about WHAT the next question is
 * (that decision already happened inside `TrainingRecommendationAdapter`).
 */
export type PracticeEntryOutcome = { kind: "ready"; questionId: string } | { kind: "unavailable" };

export function decidePracticeEntryOutcome(recommendation: RecommendationViewModel): PracticeEntryOutcome {
  return recommendation.questionId ? { kind: "ready", questionId: recommendation.questionId } : { kind: "unavailable" };
}

/**
 * The one piece of copy for the genuine "nothing to practice right now" case (Product Phase 1
 * Unit 11) -- used by both `PracticeNextRoute`'s unavailable screen and the dashboard's
 * recommendation card, so the two can't drift apart. Deliberately makes no claim about WHY
 * nothing is available (no content yet, nothing due, ...): the frontend doesn't know, and the
 * server's own "You're all caught up" wording would be misleading next to a disabled button
 * when the real cause is that no questions are published.
 */
export const PRACTICE_UNAVAILABLE_COPY = {
  headline: "Practice isn't available right now.",
  explanation: "There's nothing to practice at the moment — check back soon."
} as const;

export interface RecommendationDisplay {
  /** `null` = render no badge. */
  badge: string | null;
  headline: string;
  /** `null` = render no explanation paragraph. */
  explanation: string | null;
}

/**
 * What a `RecommendationCard` should actually show. Pure; the recommendation itself was already
 * decided server-side -- this only chooses between showing it and the honest "unavailable"
 * copy (`questionId: null`), and guards a ready recommendation whose text fields came back
 * empty from rendering an empty heading.
 */
export function describeRecommendation(recommendation: RecommendationViewModel): RecommendationDisplay {
  if (decidePracticeEntryOutcome(recommendation).kind === "unavailable") {
    return { badge: null, headline: PRACTICE_UNAVAILABLE_COPY.headline, explanation: PRACTICE_UNAVAILABLE_COPY.explanation };
  }
  return {
    badge: recommendation.modeLabel || null,
    headline: recommendation.headline || "Your next question is ready.",
    explanation: recommendation.explanation || null
  };
}
