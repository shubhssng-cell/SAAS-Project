import { orchestrateNextTrainingAction, type TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import type { ObservationEvidence } from "@ipmat/autopsy";
import type { AutopsyOutput } from "@ipmat/autopsy";
import { composeAttemptAutopsyOutput, composeAttemptObservationEvidence } from "./attemptEvidence.js";
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

  /**
   * Phase 4 Unit 1 -- the observation-only evidence for ONE finalized attempt (see `composeAttemptObservationEvidence`). Read-only,
   * ownership-verified, `null` when the attempt is not one of this student's finalized attempts.
   */
  /** Phase 4 Unit 3 -- observation evidence plus the full (server-side) `AutopsyOutput` for one finalized attempt; `null` when it cannot be resolved. Read-only, ownership-verified. */
  async getAttemptAutopsyOutput(request: TrainingRecommendationRequest & { attemptId: string }): Promise<{ observation: ObservationEvidence; output: AutopsyOutput } | null> {
    return composeAttemptAutopsyOutput(this.deps, request);
  }

  async getAttemptObservationEvidence(request: TrainingRecommendationRequest & { attemptId: string }): Promise<ObservationEvidence | null> {
    return composeAttemptObservationEvidence(this.deps, request);
  }
}
