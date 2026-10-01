import type { AttemptHistoryReader, EnrollmentReader, TrainingSessionRepository } from "@ipmat/db";
import type { TrainingRecommendationService } from "@ipmat/training-recommendation";
import type { TrainingDimension, TrainingSystemAvailability } from "@ipmat/training-session";
import type { PracticeApiService } from "./service.js";
import type { StudentQuestionView } from "./types.js";

/**
 * Phase 5 Unit 1 -- the student-facing Training Session boundary (docs/DECISIONS.md D-075).
 * Like `PracticeApiService`, `TrainingApiService` COORDINATES existing services -- the
 * recommendation service for "run this training system", the practice API for starting an
 * attempt in the session's block -- and contains no selection, grading or mastery logic.
 */
export interface TrainingApiDependencies {
  trainingRecommendationService: Pick<TrainingRecommendationService, "runTrainingSystems">;
  trainingSessionRepository: TrainingSessionRepository;
  /** Reads a session's attempts in `blockSequenceNumber` order. */
  attemptHistoryReader: Pick<AttemptHistoryReader, "findByPracticeBlockId">;
  enrollmentReader: EnrollmentReader;
  /** Starts the attempt (in the session's block) through the one existing attempt lifecycle -- never a second one. */
  practiceApi: Pick<PracticeApiService, "startAttempt">;
}

/** One card on the Training entry point. Never carries a provider id, a provider explanation, requirement, diagnostics, or any score. */
export interface TrainingSystemCardView {
  systemId: string;
  dimension: TrainingDimension;
  label: string;
  /** What a session in this system deliberately trains. */
  trains: string;
  availability: TrainingSystemAvailability;
  /** Hand-authored, student-safe sentence for the availability -- never a model/provider string. */
  note: string;
}

export type TrainingCompletionView = { kind: "fixed_question_count"; questionCount: number } | { kind: "fixed_duration"; durationSeconds: number };

export interface TrainingSessionView {
  sessionId: string;
  systemId: string;
  systemLabel: string;
  dimension: TrainingDimension;
  objective: { statement: string; targetConceptName: string | null };
  status: "active" | "completed" | "abandoned";
  completion: TrainingCompletionView;
  progress: {
    completedQuestionCount: number;
    submittedCount: number;
    skippedCount: number;
    elapsedSeconds: number;
    remainingQuestions: number | null;
    remainingSeconds: number | null;
    completionReached: boolean;
    /** True when a question was started and not yet answered/skipped. */
    hasOpenQuestion: boolean;
  };
  startedAt: string;
  endedAt: string | null;
}

export interface TrainingHubView {
  systems: TrainingSystemCardView[];
  activeSession: TrainingSessionView | null;
}

export interface StartTrainingSessionResult {
  session: TrainingSessionView;
  /** True when this call resumed the student's already-active session for the SAME system instead of creating one. */
  resumed: boolean;
}

export type TrainingNextView =
  | { status: "question"; session: TrainingSessionView; attemptId: string; question: StudentQuestionView; elapsedSeconds: number }
  | { status: "completed"; session: TrainingSessionView }
  /** The session is still active but no further published question qualifies right now; the student can end the session. */
  | { status: "no_question"; session: TrainingSessionView; message: string };
