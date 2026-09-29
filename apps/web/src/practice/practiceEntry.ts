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
