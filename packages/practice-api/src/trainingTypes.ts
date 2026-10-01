import type { AttemptHistoryReader, EnrollmentReader, QuestionContentReader, TrainingSessionRepository } from "@ipmat/db";
import type { TrainingRecommendationService } from "@ipmat/training-recommendation";
import type { TrainingDimension, TrainingStageChange, TrainingStageView, TrainingSystemAvailability } from "@ipmat/training-session";
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
  /** Student-visible question content -- read only for each answered question's expected time (Phase 5 Unit 2 session summary). Never an answer key. */
  questionContentReader: Pick<QuestionContentReader, "findPublishedById">;
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
  /** The completion rules a student may choose for this system, or `null` when every rule is allowed. */
  completionKinds: Array<"fixed_question_count" | "fixed_duration"> | null;
}

export type TrainingCompletionView = { kind: "fixed_question_count"; questionCount: number } | { kind: "fixed_duration"; durationSeconds: number };

/**
 * What happened in a session, as OBSERVABLE counts and times only (Phase 5 Unit 2). Never a score, a percentage claim, or a statement
 * about improvement: a session result is evidence, not proof of anything permanent.
 */
export interface TrainingSessionSummaryView {
  submittedCount: number;
  skippedCount: number;
  correctCount: number;
  incorrectCount: number;
  /** Server-measured time on the submitted questions, in seconds. */
  totalTimeSeconds: number;
  /** The sum of those same questions' expected times, in seconds (only questions whose content could be read). */
  expectedTimeSeconds: number;
}

export interface TrainingSessionView {
  sessionId: string;
  systemId: string;
  systemLabel: string;
  /** What the session screen is called ("Calculation Gym"; otherwise "<label> training"). */
  systemTitle: string;
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
  /**
   * The system's CURRENT stage, derived from persisted history by the system's own provider on every read (never stored); `null` for a
   * system without stages, or when the provider reports none (e.g. it no longer applies).
   */
  stage: TrainingStageView | null;
  summary: TrainingSessionSummaryView;
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
  | {
      status: "question";
      session: TrainingSessionView;
      attemptId: string;
      question: StudentQuestionView;
      elapsedSeconds: number;
      /** Set when the stage this question is served at differs from the stage of the previous question in the session (derived, so it is the same after a restart). */
      stageTransition: TrainingStageChange | null;
    }
  | { status: "completed"; session: TrainingSessionView }
  /** The session is still active but no further published question qualifies right now; the student can end the session. */
  | { status: "no_question"; session: TrainingSessionView; message: string };
