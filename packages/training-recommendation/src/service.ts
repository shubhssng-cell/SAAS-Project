import { orchestrateNextTrainingAction, toTrainingSystemContext, type TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import { runTrainingSystem, type TrainingSystemRun } from "@ipmat/training-session";
import type { ObservationEvidence } from "@ipmat/autopsy";
import type { AutopsyOutput } from "@ipmat/autopsy";
import { composeAttemptAutopsyOutput, composeAttemptObservationEvidence } from "./attemptEvidence.js";
import { composeTrainingOrchestrationInput } from "./compose.js";
import { composeMasteryEvidenceView } from "./masteryEvidence.js";
import type { MasteryEvidenceView } from "@ipmat/mastery";
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
   * Phase 7 Unit 1 -- the student's mastery EVIDENCE view (evidence only: no verdict, score or threshold), derived from persisted
   * attempts through the same ownership-verified composition. Read-only; `null` when the exam has no published question pool.
   */
  async readMasteryEvidence(request: TrainingRecommendationRequest): Promise<MasteryEvidenceView | null> {
    return composeMasteryEvidenceView(this.deps, request);
  }

  /**
   * Phase 5 Unit 1 -- runs the named training systems (and ONLY those) against this student's own persisted
   * state: ONE composition (the same ownership-verified, published-only read every recommendation uses), then
   * each system's own provider via `runTrainingSystem()`. It deliberately ignores confirmed repair plans and
   * never consults adaptive selection -- a training system asks "is this dimension worth deliberately training,
   * and which published question serves it", not "what is globally next". Read-only; outcomes returned unmodified.
   */
  async runTrainingSystems(
    request: TrainingRecommendationRequest,
    systemIds: readonly string[],
    options: { excludeQuestionIds?: readonly string[]; excludeAttemptIds?: readonly string[] } = {}
  ): Promise<TrainingSystemRun[]> {
    const input = await composeTrainingOrchestrationInput(this.deps, request);
    const context = toTrainingSystemContext(input);
    // `excludeQuestionIds` only narrows the already-published candidate POOL (e.g. "not a question this session already used");
    // it adds no ranking and every provider still decides applicability and selection itself.
    const excluded = new Set(options.excludeQuestionIds ?? []);
    // `excludeAttemptIds` re-runs a system "as of before these attempts" (Phase 5 Unit 2, D-076): it lets the caller reconstruct the
    // stage a question was SERVED at from persisted history, without storing any stage. Nothing is written or cached.
    const excludedAttempts = new Set(options.excludeAttemptIds ?? []);
    const scoped = {
      ...context,
      candidates: excluded.size === 0 ? context.candidates : context.candidates.filter((candidate) => !excluded.has(candidate.question.questionId)),
      attemptRecords: excludedAttempts.size === 0 ? context.attemptRecords : context.attemptRecords.filter((record) => !excludedAttempts.has(record.contribution.attemptId))
    };
    return systemIds.map((systemId) => runTrainingSystem(systemId, scoped));
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
