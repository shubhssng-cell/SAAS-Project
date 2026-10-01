import { randomUUID } from "node:crypto";
import { PersistenceError, SerializationFailureError, type StoredTrainingSession } from "@ipmat/db";
import { assertEnrollmentOwnership } from "@ipmat/training-recommendation";
import {
  TRAINING_SYSTEM_CATALOG,
  TrainingSessionError,
  buildTrainingObjective,
  deriveTrainingSessionProgress,
  findTrainingSystem,
  parseTrainingObjective,
  toAvailability,
  toBlockSettings,
  validateTrainingSessionConfig,
  type TrainingSessionConfig,
  type TrainingSessionProgress,
  type TrainingSystemAvailability
} from "@ipmat/training-session";
import { toPracticeApiError } from "./errors.js";
import type {
  StartTrainingSessionResult,
  TrainingApiDependencies,
  TrainingHubView,
  TrainingNextView,
  TrainingSessionView,
  TrainingSystemCardView
} from "./trainingTypes.js";
import { PracticeApiError, type StudentRequestClaim } from "./types.js";
import { assertNonEmptyString, assertValidClaim } from "./validation.js";

/** Hand-authored, student-safe sentence per availability. Never derived from a provider's own explanation text (which is written for engineers). */
const AVAILABILITY_NOTES: Record<TrainingSystemAvailability, string> = {
  available: "Ready to train.",
  not_applicable: "Your recorded practice doesn't call for this yet.",
  no_eligible_question: "No published question fits this training right now.",
  unavailable: "Temporarily unavailable.",
  not_built: "Not built yet."
};

const NO_FURTHER_QUESTION_MESSAGE = "No further published question fits this training right now. You can end the session.";

/**
 * The Training Session application boundary (Phase 5 Unit 1, docs/DECISIONS.md D-075). Every method:
 * (1) validates its input, (2) verifies enrollment ownership and -- for an existing session -- that the
 * session belongs to the SAME student and enrollment, (3) delegates every decision to an existing service,
 * (4) returns a student-safe view. Status and progress are re-derived from persisted rows on every call,
 * so a restart (or a second instance) reconstructs exactly the same session.
 */
export class TrainingApiService {
  constructor(private readonly deps: TrainingApiDependencies) {}

  /** The Training entry point: every system with its honest availability right now, plus the student's active session (if any). Read-only. */
  async getHub(claim: StudentRequestClaim, input: { now?: string } = {}): Promise<TrainingHubView> {
    assertValidClaim(claim);
    const now = input.now ?? new Date().toISOString();
    try {
      assertEnrollmentOwnership(await this.deps.enrollmentReader.findById(claim.enrollmentId), claim);
      const runs = await this.deps.trainingRecommendationService.runTrainingSystems(claim, TRAINING_SYSTEM_CATALOG.map((definition) => definition.systemId));
      const systems: TrainingSystemCardView[] = runs.map((run) => {
        const availability = toAvailability(run);
        return { systemId: run.definition.systemId, dimension: run.definition.dimension, label: run.definition.label, trains: run.definition.trains, availability, note: AVAILABILITY_NOTES[availability] };
      });
      const active = await this.deps.trainingSessionRepository.findActiveByEnrollmentId(claim.enrollmentId);
      return { systems, activeSession: active ? await this.toView(this.assertOwned(active, claim), now) : null };
    } catch (error) {
      throw this.rethrow(error);
    }
  }

  /**
   * Starts a session for ONE system under a validated configuration. The system's own provider must report it
   * applicable AND able to serve a published question -- otherwise nothing is created. At most one active session per
   * student: starting the SAME system again resumes it (a double click or a second tab is harmless); a different system is refused.
   */
  async startSession(claim: StudentRequestClaim, input: { systemId: string; config: unknown; now?: string }): Promise<StartTrainingSessionResult> {
    assertValidClaim(claim);
    assertNonEmptyString(input.systemId, "systemId");
    const now = input.now ?? new Date().toISOString();
    try {
      const config = validateTrainingSessionConfig(input.config);
      const definition = findTrainingSystem(input.systemId);
      if (definition === null) throw new TrainingSessionError("unknown_system", "That training system does not exist.");
      assertEnrollmentOwnership(await this.deps.enrollmentReader.findById(claim.enrollmentId), claim);

      return await this.serialized(`enrollment|${claim.enrollmentId}`, async () => {
        const existing = await this.deps.trainingSessionRepository.findActiveByEnrollmentId(claim.enrollmentId);
        if (existing) {
          if (existing.systemId === definition.systemId) return { session: await this.toView(this.assertOwned(existing, claim), now), resumed: true };
          throw new TrainingSessionError("session_already_active", "The student already has an active training session.");
        }

        const [run] = await this.deps.trainingRecommendationService.runTrainingSystems(claim, [definition.systemId]);
        if (!run) throw new Error("runTrainingSystems returned no result for a requested system.");
        if (run.status === "not_built") throw new TrainingSessionError("system_not_built", "This training system has no engine yet.");
        if (run.outcome.status === "not_applicable") throw new TrainingSessionError("system_not_applicable", "This training system is not applicable right now.");
        if (run.outcome.status === "no_eligible_question") throw new TrainingSessionError("no_eligible_question", "No published question fits this training right now.");
        if (run.outcome.status === "error") throw new PracticeApiError("infrastructure_failure", "This training could not be started right now. Please try again.", 500);

        const objective = buildTrainingObjective(definition, run.outcome.requirement);
        try {
          const stored = await this.deps.trainingSessionRepository.create({
            id: randomUUID(),
            practiceSessionId: randomUUID(),
            practiceBlockId: randomUUID(),
            enrollmentId: claim.enrollmentId,
            systemId: definition.systemId,
            objective,
            config,
            blockSettings: toBlockSettings(config),
            now
          });
          return { session: await this.toView(this.assertOwned(stored, claim), now), resumed: false };
        } catch (error) {
          // Another instance created a session first (the database guarantees at most one active): resume the winner when it is the same system.
          if ((error instanceof PersistenceError && error.code === "conflict") || error instanceof SerializationFailureError) {
            const winner = await this.deps.trainingSessionRepository.findActiveByEnrollmentId(claim.enrollmentId);
            if (winner && winner.systemId === definition.systemId) return { session: await this.toView(this.assertOwned(winner, claim), now), resumed: true };
            if (winner) throw new TrainingSessionError("session_already_active", "The student already has an active training session.");
          }
          throw error;
        }
      });
    } catch (error) {
      throw this.rethrow(error);
    }
  }

  /** The session as persisted, with progress derived now. Another student's (or enrollment's) session is refused. */
  async getSession(claim: StudentRequestClaim, input: { sessionId: string; now?: string }): Promise<TrainingSessionView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.sessionId, "sessionId");
    const now = input.now ?? new Date().toISOString();
    try {
      return await this.toView(await this.loadOwned(claim, input.sessionId), now);
    } catch (error) {
      throw this.rethrow(error);
    }
  }

  /**
   * The next step of the session: resumes the one open question if there is one; otherwise, if the configured completion
   * rule is met, completes the session; otherwise asks the session's own training system for a published question (never
   * one already attempted in this session) and starts it, in this session's block, through the ordinary attempt lifecycle.
   */
  async nextQuestion(claim: StudentRequestClaim, input: { sessionId: string; now?: string }): Promise<TrainingNextView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.sessionId, "sessionId");
    const now = input.now ?? new Date().toISOString();
    try {
      const first = await this.loadOwned(claim, input.sessionId);
      return await this.serialized(`session|${first.id}`, async () => {
        let stored = await this.loadOwned(claim, input.sessionId);
        if (stored.block.status !== "active") return { status: "completed", session: await this.toView(stored, now) };

        const attempts = await this.deps.attemptHistoryReader.findByPracticeBlockId(stored.block.id);
        const progress = deriveTrainingSessionProgress({ block: stored.block, attempts, now });

        if (progress.openAttemptId !== null) {
          const open = attempts.find((attempt) => attempt.id === progress.openAttemptId)!;
          return this.questionView(stored, claim, open.questionId, now);
        }

        if (progress.completionReached) {
          stored = await this.completeIfActive(stored, now);
          return { status: "completed", session: await this.toView(stored, now) };
        }

        const [run] = await this.deps.trainingRecommendationService.runTrainingSystems(claim, [stored.systemId], { excludeQuestionIds: attempts.map((attempt) => attempt.questionId) });
        if (!run || run.status === "not_built" || run.outcome.status !== "selected") {
          return { status: "no_question", session: await this.toView(stored, now), message: NO_FURTHER_QUESTION_MESSAGE };
        }
        return this.questionView(stored, claim, run.outcome.question.questionId, now);
      });
    } catch (error) {
      throw this.rethrow(error);
    }
  }

  /** Ends the session explicitly (the student's own action). Idempotent once ended; refused while a question is still open. */
  async finishSession(claim: StudentRequestClaim, input: { sessionId: string; now?: string }): Promise<TrainingSessionView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.sessionId, "sessionId");
    const now = input.now ?? new Date().toISOString();
    try {
      const first = await this.loadOwned(claim, input.sessionId);
      return await this.serialized(`session|${first.id}`, async () => {
        let stored = await this.loadOwned(claim, input.sessionId);
        if (stored.block.status === "active") {
          const attempts = await this.deps.attemptHistoryReader.findByPracticeBlockId(stored.block.id);
          if (deriveTrainingSessionProgress({ block: stored.block, attempts, now }).openAttemptId !== null) {
            throw new TrainingSessionError("open_attempt_exists", "A question is still open in this session.");
          }
          stored = await this.completeIfActive(stored, now);
        }
        return this.toView(stored, now);
      });
    } catch (error) {
      throw this.rethrow(error);
    }
  }

  // ---------------------------------------------------------------------------------------------

  private async questionView(stored: StoredTrainingSession, claim: StudentRequestClaim, questionId: string, now: string): Promise<TrainingNextView> {
    const started = await this.deps.practiceApi.startAttempt(claim, { questionId, practiceBlockId: stored.block.id, now });
    return { status: "question", session: await this.toView(stored, now), attemptId: started.attemptId, question: started.question, elapsedSeconds: started.elapsedSeconds };
  }

  /** Completes the session's block; if another caller already ended it (a race), returns the session as it now stands. */
  private async completeIfActive(stored: StoredTrainingSession, now: string): Promise<StoredTrainingSession> {
    try {
      return await this.deps.trainingSessionRepository.complete(stored.id, { now });
    } catch (error) {
      const reread = await this.deps.trainingSessionRepository.findById(stored.id);
      if (reread && reread.block.status !== "active") return reread;
      throw error;
    }
  }

  private assertOwned(stored: StoredTrainingSession, claim: StudentRequestClaim): StoredTrainingSession {
    if (stored.studentId !== claim.studentId || stored.enrollmentId !== claim.enrollmentId) {
      throw new PracticeApiError("ownership_mismatch", "This training session does not belong to the requesting student.", 403);
    }
    return stored;
  }

  private async loadOwned(claim: StudentRequestClaim, sessionId: string): Promise<StoredTrainingSession> {
    assertEnrollmentOwnership(await this.deps.enrollmentReader.findById(claim.enrollmentId), claim);
    const stored = await this.deps.trainingSessionRepository.findById(sessionId);
    if (!stored) throw new TrainingSessionError("session_not_found", "No such training session.");
    return this.assertOwned(stored, claim);
  }

  /** Stored JSON is untrusted on the way out: it is re-validated, and a row that no longer parses is an infrastructure failure, never guessed at. */
  private async toView(stored: StoredTrainingSession, now: string): Promise<TrainingSessionView> {
    const definition = findTrainingSystem(stored.systemId);
    const objective = parseTrainingObjective(stored.objective);
    let config: TrainingSessionConfig;
    try {
      config = validateTrainingSessionConfig(stored.config);
    } catch {
      throw new PracticeApiError("infrastructure_failure", "This training session could not be loaded right now. Please try again.", 500);
    }
    if (definition === null || objective === null) {
      throw new PracticeApiError("infrastructure_failure", "This training session could not be loaded right now. Please try again.", 500);
    }
    const attempts = await this.deps.attemptHistoryReader.findByPracticeBlockId(stored.block.id);
    const progress: TrainingSessionProgress = deriveTrainingSessionProgress({ block: stored.block, attempts, now });
    return {
      sessionId: stored.id,
      systemId: definition.systemId,
      systemLabel: definition.label,
      dimension: definition.dimension,
      objective: { statement: objective.statement, targetConceptName: objective.targetConceptName },
      status: stored.block.status,
      completion: config.completion,
      progress: {
        completedQuestionCount: progress.completedQuestionCount,
        submittedCount: progress.submittedCount,
        skippedCount: progress.skippedCount,
        elapsedSeconds: progress.elapsedSeconds,
        remainingQuestions: progress.remainingQuestions,
        remainingSeconds: progress.remainingSeconds,
        completionReached: progress.completionReached,
        hasOpenQuestion: progress.openAttemptId !== null
      },
      startedAt: stored.block.startedAt,
      endedAt: stored.block.endedAt
    };
  }

  private rethrow(error: unknown): PracticeApiError {
    return error instanceof PracticeApiError ? error : toPracticeApiError(error);
  }

  private readonly tails = new Map<string, Promise<void>>();

  /** Runs `operation` after any earlier operation with the same key settles (in-process serialization; the database guarantees cover other instances). */
  private async serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => mine);
    this.tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
