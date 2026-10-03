/**
 * Full Exam Simulation (Phase 7 Unit 4, docs/DECISIONS.md D-090).
 *
 * WHAT THIS IS. The mechanics of taking one defined paper under a server-authoritative deadline: a lifecycle, an
 * append-only answer log, deterministic expiry, idempotent finalization and a traceable raw result.
 *
 * WHAT THIS IS NOT. It contains NO exam rule. Everything exam-specific - how long the exam is, which sections it has
 * and how many questions each holds - is DATA in a `SimulationConfig` that something else must supply; this package
 * ships none. The repository specifies no IPMAT duration, section timing, question counts, marking or negative
 * marking, navigation restriction, mark-for-review behaviour or historical paper structure, so none is implemented:
 * there is no score, no per-section timer, no pause/resume, no review marking, no automatic paper composition and no
 * claim that a paper is historical. It produces no mastery score, readiness, confidence, ability or prediction, and it
 * imports nothing from training, adaptive, revision, mastery, repair or attempt code.
 */

/**
 * The ENGINE mechanics this package had to fix in order to be a working state machine. They are mechanics, not exam
 * rules, and are PROVISIONAL: no repository document specifies them.
 */
export const SIMULATION_MECHANICS = {
  /** Time comes from the server clock injected into every operation; a client-supplied time is never read. */
  timeAuthority: "server",
  /** The deadline is exclusive: an operation at `now >= deadlineAt` is too late. */
  deadlineBoundary: "exclusive",
  /** An operation that finds the deadline passed finalizes the simulation as `expired` at `deadlineAt` (not at `now`). */
  expiryFinalizedAt: "deadline",
  /** A submit racing the deadline: before it, `submitted`; at or after it, `expired` (the submit is rejected as too late). */
  submitRace: "decided_by_server_time_against_exclusive_deadline",
  pauseResume: false,
  /** Navigation (next/previous/jump) is a client concern; the engine neither restricts nor records it. */
  navigation: "not_enforced_not_recorded",
  markForReview: false,
  scoring: "not_defined"
} as const;

export const SIMULATION_STATUSES = ["in_progress", "submitted", "expired"] as const;
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];
export const FINALIZED_BY = ["student_submit", "deadline"] as const;
export type FinalizedBy = (typeof FINALIZED_BY)[number];

// ---- configuration: the exam's mechanics as DATA ----

export interface SimulationConfigProvenance {
  kind: "canonical" | "authored";
  /** Where this configuration came from - mandatory. */
  sourceRef: string;
  reviewState: "unvalidated" | "reviewed";
  reviewedBy: string | null;
  note: string | null;
}

export interface SimulationSectionConfig {
  /** Must equal the exam's section name (the existing `Section.name` / Question DNA `sectionName`); the exam pack is not duplicated here. */
  sectionName: string;
  /** Position among sections, unique and positive. */
  order: number;
  questionCount: number;
}

export interface SimulationConfig {
  examCode: string;
  /** Free string; recorded on every simulation so a result is reproducible against the exact configuration used. */
  configVersion: string;
  /** One overall, server-enforced duration. Per-section timing is NOT supported (its lock semantics are unspecified). */
  overallDurationSeconds: number;
  sections: readonly SimulationSectionConfig[];
  provenance: SimulationConfigProvenance;
}

// ---- paper: an explicit, validated list of published questions ----

/** An editor's explicit choice of questions per section. The engine never picks questions itself. */
export interface PaperSelection {
  origin: "assembled";
  sourceRef: string;
  sections: Readonly<Record<string, readonly string[]>>;
}

/** What the engine needs to know about a question to admit it to a paper. Structurally has no answer-bearing field. */
export interface PaperCandidate {
  questionId: string;
  examCode: string;
  sectionName: string;
  validationState: string;
  /** The question's provenance source kind, or `null` when it has no provenance (not admissible). */
  sourceType: string | null;
  /** Identifies the exact content version (exam + normalized body + options). */
  contentFingerprint: string;
}

export interface PaperQuestion {
  /** 1-based, contiguous across sections in section order. */
  position: number;
  sectionName: string;
  questionId: string;
  /** The content version this paper used; later edits change the fingerprint and are detected. */
  contentFingerprint: string;
  provenanceSourceType: string;
}

export interface SimulationPaper {
  /** Always `assembled`: a paper is never presented as historical (no real historical paper exists in the repository). */
  origin: "assembled";
  isHistoricalPaper: false;
  sourceRef: string;
  questions: readonly PaperQuestion[];
}

/** What a configuration source returns: the mechanics and an explicit paper selection. */
export interface SimulationDefinition {
  config: SimulationConfig;
  selection: PaperSelection;
}

// ---- state ----

export interface AnswerEvent {
  position: number;
  answer: string;
  /** Server time the answer was accepted (strictly before the deadline). */
  occurredAt: string;
}

export interface SimulationState {
  id: string;
  studentId: string;
  enrollmentId: string;
  examCode: string;
  /** Snapshot of the configuration used, so the simulation never changes if a configuration later does. */
  config: SimulationConfig;
  paper: SimulationPaper;
  status: SimulationStatus;
  startedAt: string;
  deadlineAt: string;
  finalizedAt: string | null;
  finalizedBy: FinalizedBy | null;
  /** Append-only, in acceptance order. The current answer for a position is its last event. */
  events: readonly AnswerEvent[];
  /** Set exactly once, at finalization. */
  result: SimulationResult | null;
}

/** Answer keys, server-side only: used at finalization, never placed in a view or a result. */
export type AnswerKey = Readonly<Record<string, { correctAnswer: string; contentFingerprint: string }>>;

// ---- result: raw observable outcomes only ----

export interface SimulationQuestionOutcome {
  position: number;
  sectionName: string;
  questionId: string;
  answered: boolean;
  chosenAnswer: string | null;
  /** `null` when unanswered, or when the question content changed after the paper was fixed (then `gradingStatus` says so). */
  isCorrect: boolean | null;
  gradingStatus: "graded" | "unanswered" | "question_content_changed";
  /** Events whose answer differed from the previous answer for this position. */
  answerChangeCount: number;
  firstAnsweredAt: string | null;
  lastAnsweredAt: string | null;
}

export interface SimulationSectionOutcome {
  sectionName: string;
  order: number;
  questionCount: number;
  answered: number;
  unanswered: number;
  correct: number;
  incorrect: number;
  /** Answered but not gradable (content changed since the paper was fixed). */
  notGraded: number;
}

export interface SimulationResult {
  simulationId: string;
  examCode: string;
  configVersion: string;
  paperSourceRef: string;
  isHistoricalPaper: false;
  status: Exclude<SimulationStatus, "in_progress">;
  timing: {
    startedAt: string;
    deadlineAt: string;
    finalizedAt: string;
    allowedSeconds: number;
    elapsedSeconds: number;
    finalizedBy: FinalizedBy;
  };
  questions: readonly SimulationQuestionOutcome[];
  sections: readonly SimulationSectionOutcome[];
  totals: { questionCount: number; answered: number; unanswered: number; correct: number; incorrect: number; notGraded: number };
  /** No marking scheme exists in the repository, so no score is computed. */
  scoring: { defined: false; reason: string };
  /** Always "none": the result carries no readiness, mastery or other interpretation. */
  interpretation: "none";
}

// ---- student-facing view (never carries an answer key or a result detail) ----

export interface SimulationViewQuestion {
  position: number;
  sectionName: string;
  questionId: string;
  status: "answered" | "unanswered";
  chosenAnswer: string | null;
}

export interface SimulationView {
  simulationId: string;
  status: SimulationStatus;
  examCode: string;
  startedAt: string;
  deadlineAt: string;
  /** Computed from the server clock: whole seconds left, 0 once finalized or at/after the deadline. */
  remainingSeconds: number;
  sections: readonly { sectionName: string; order: number; questionCount: number; positions: readonly number[] }[];
  questions: readonly SimulationViewQuestion[];
  /** True once a result exists (the result itself is a separate, ownership-checked read). */
  resultAvailable: boolean;
}

// ---- outcomes of operations ----

export type AnswerOutcome = "recorded" | "rejected_expired" | "rejected_finalized";
export type SubmitOutcome = "submitted" | "expired_before_submit" | "already_submitted" | "already_expired";

export const SIMULATION_ERROR_CODES = [
  "invalid_config",
  "invalid_paper",
  "invalid_time",
  "no_simulation_configured",
  "enrollment_not_found",
  "enrollment_ownership_mismatch",
  "simulation_not_found",
  "invalid_position",
  "invalid_answer",
  "question_content_changed",
  "not_finalized",
  "simulation_finalized"
] as const;
export type SimulationErrorCode = (typeof SIMULATION_ERROR_CODES)[number];

export class SimulationError extends Error {
  readonly code: SimulationErrorCode;
  readonly problems: readonly string[];
  constructor(code: SimulationErrorCode, message: string, problems: readonly string[] = []) {
    super(message);
    this.name = "SimulationError";
    this.code = code;
    this.problems = problems;
  }
}
