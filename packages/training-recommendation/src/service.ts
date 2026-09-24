import { orchestrateNextTrainingAction, type TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import { composeTrainingOrchestrationInput } from "./compose.js";
import type { TrainingRecommendationDependencies, TrainingRecommendationRequest } from "./types.js";

/**
 * The top-level Training Recommendation Composition entry point
 * (docs/project-memory/37_TRAINING_RECOMMENDATION.md §3-4). Dependencies
 * are injected `@ipmat/db` ports — the same construction pattern as
 * `@ipmat/practice-loop`'s `PracticeLoopService`.
 */
export class TrainingRecommendationService {
  constructor(private readonly deps: TrainingRecommendationDependencies) {}

  /**
   * Verifies enrollment ownership, assembles `TrainingOrchestrationInput`
   * from persisted state, and returns `orchestrateNextTrainingAction()`'s
   * result VERBATIM — no second result model, no added diagnostics (§17).
   * Read-only. Fails closed (`TrainingRecommendationError`) on a missing
   * enrollment, a student mismatch, or any cross-student/cross-enrollment
   * row; repository failures propagate unchanged.
   */
  async recommendNextTrainingAction(request: TrainingRecommendationRequest): Promise<TrainingOrchestrationResult> {
    const input = await composeTrainingOrchestrationInput(this.deps, request);
    return orchestrateNextTrainingAction(input);
  }
}
