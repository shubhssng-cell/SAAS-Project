import type { TrainingCompletionViewModel, TrainingSessionViewModel } from "../adapter/index.js";

/**
 * Pure helpers for the Training screens (Phase 5 Unit 1), kept out of the components so they are testable without rendering.
 * Nothing here decides which training system applies or which question comes next -- the server already did; this only
 * words what it reported and offers the (server-validated) completion presets.
 */

export interface CompletionPreset {
  id: string;
  label: string;
  completion: TrainingCompletionViewModel;
}

/** Offered choices only. The server validates every configuration against its own bounds, so a preset is a convenience, never the authority. */
export const COMPLETION_PRESETS: readonly CompletionPreset[] = [
  { id: "q3", label: "3 questions", completion: { kind: "fixed_question_count", questionCount: 3 } },
  { id: "q5", label: "5 questions", completion: { kind: "fixed_question_count", questionCount: 5 } },
  { id: "q10", label: "10 questions", completion: { kind: "fixed_question_count", questionCount: 10 } },
  { id: "m5", label: "5 minutes", completion: { kind: "fixed_duration", durationSeconds: 300 } },
  { id: "m10", label: "10 minutes", completion: { kind: "fixed_duration", durationSeconds: 600 } }
];

export const DEFAULT_COMPLETION_PRESET_ID = "q5";

/** The presets a system allows (`kinds` = its `completionKinds`, `null` = all). Never empty: a system that allows a kind we have no preset for falls back to all presets. */
export function presetsFor(kinds: ReadonlyArray<"fixed_question_count" | "fixed_duration"> | null): readonly CompletionPreset[] {
  if (kinds === null) return COMPLETION_PRESETS;
  const allowed = COMPLETION_PRESETS.filter((preset) => kinds.includes(preset.completion.kind));
  return allowed.length > 0 ? allowed : COMPLETION_PRESETS;
}

export function describeCompletion(completion: TrainingCompletionViewModel): string {
  return completion.kind === "fixed_question_count" ? `${completion.questionCount} question${completion.questionCount === 1 ? "" : "s"}` : `${Math.round(completion.durationSeconds / 60)} minutes`;
}

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One line of progress: observable counts and the configured rule's remainder -- nothing about how the student is doing. */
export function describeProgress(session: TrainingSessionViewModel): string {
  const done = session.progress.completedQuestionCount;
  if (session.completion.kind === "fixed_question_count") return `${done} of ${session.completion.questionCount} questions done`;
  const left = session.progress.remainingSeconds ?? 0;
  return `${done} question${done === 1 ? "" : "s"} done · ${clock(left)} left`;
}

export function trainingSessionPath(sessionId: string): string {
  return `/training/${encodeURIComponent(sessionId)}`;
}

/** Where a training question's result lives: the session, the question, and the attempt id (so a refresh can re-read it from the server). */
export function trainingResultPath(sessionId: string, questionId: string, attemptId: string): string {
  return `/training/${encodeURIComponent(sessionId)}/result/${encodeURIComponent(questionId)}?attempt=${encodeURIComponent(attemptId)}`;
}

/** Cards a student can start right now. */
export function isStartable(availability: string): boolean {
  return availability === "available";
}

/** "Question 3 of 10" for a fixed-count session while a question is open; otherwise the plain progress line. Observable counts only. */
export function describeQuestionPosition(session: TrainingSessionViewModel): string {
  if (session.completion.kind === "fixed_question_count") {
    const number = Math.min(session.progress.completedQuestionCount + 1, session.completion.questionCount);
    return `Question ${number} of ${session.completion.questionCount}`;
  }
  return describeProgress(session);
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "2 of 3 correct" -- a count, never a percentage or a rating. `null` when nothing was answered (so nothing is claimed). */
export function describeAnswered(session: TrainingSessionViewModel): string | null {
  const { submittedCount, correctCount } = session.summary;
  return submittedCount === 0 ? null : `${correctCount} of ${submittedCount} correct`;
}

/** The standing caveat shown with a finished session: a session is a record of what happened, not a measure of anything permanent. */
export const SESSION_RECORD_NOTE = "This is a record of this session only. It is evidence of what you did here, not a measure of lasting progress.";

/** What the live "time left" line says. Display only: the SERVER's clock decides when a timed session is over; this is seeded from its remaining seconds. */
export function describeTimeLeft(remainingSeconds: number): string {
  return remainingSeconds > 0 ? `Time left: ${formatClock(remainingSeconds)}` : "Time is up for this session. Finish the open question; no new question will start.";
}
