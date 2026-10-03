import { assertValidSimulationConfig, orderedSections } from "./config.js";
import {
  SimulationError,
  type AnswerEvent,
  type AnswerKey,
  type AnswerOutcome,
  type FinalizedBy,
  type SimulationConfig,
  type SimulationPaper,
  type SimulationQuestionOutcome,
  type SimulationResult,
  type SimulationSectionOutcome,
  type SimulationState,
  type SimulationView,
  type SubmitOutcome
} from "./types.js";

/** Longest accepted answer text. Not an exam rule - a bound on what is stored. */
export const MAX_ANSWER_LENGTH = 500;

/** Parses an ISO-8601 server time. Fails closed: an unparseable time is never treated as "no time". */
export function parseServerTime(iso: string, label: string): number {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) throw new SimulationError("invalid_time", `${label} is not a valid time.`);
  return ms;
}

export interface StartSimulationInput {
  id: string;
  studentId: string;
  enrollmentId: string;
  config: SimulationConfig;
  paper: SimulationPaper;
  /** SERVER time. The deadline is `now + overallDurationSeconds`. */
  now: string;
}

/** Creates an in-progress simulation. The configuration is snapshotted so a later change cannot alter it. */
export function startSimulation(input: StartSimulationInput): SimulationState {
  assertValidSimulationConfig(input.config);
  const startedMs = parseServerTime(input.now, "start time");
  // Plain-data deep copies: the simulation must not change if the caller later mutates the configuration or the paper it supplied.
  const config = JSON.parse(JSON.stringify(input.config)) as SimulationConfig;
  const paper = JSON.parse(JSON.stringify(input.paper)) as SimulationPaper;
  return {
    id: input.id,
    studentId: input.studentId,
    enrollmentId: input.enrollmentId,
    examCode: config.examCode,
    config,
    paper,
    status: "in_progress",
    startedAt: new Date(startedMs).toISOString(),
    deadlineAt: new Date(startedMs + config.overallDurationSeconds * 1000).toISOString(),
    finalizedAt: null,
    finalizedBy: null,
    events: [],
    result: null
  };
}

/** The deadline is EXCLUSIVE: at `now >= deadlineAt` an in-progress simulation is past its deadline. */
export function isPastDeadline(state: SimulationState, now: string): boolean {
  return state.status === "in_progress" && parseServerTime(now, "now") >= parseServerTime(state.deadlineAt, "deadline");
}

// ---- answers derived from the append-only log ----

interface CurrentAnswer {
  answer: string;
  firstAnsweredAt: string;
  lastAnsweredAt: string;
  changes: number;
}

/** The current answer per position (its last event), with first/last acceptance times and how many events changed the answer. */
export function deriveCurrentAnswers(events: readonly AnswerEvent[]): Map<number, CurrentAnswer> {
  const out = new Map<number, CurrentAnswer>();
  for (const e of events) {
    const existing = out.get(e.position);
    if (!existing) {
      out.set(e.position, { answer: e.answer, firstAnsweredAt: e.occurredAt, lastAnsweredAt: e.occurredAt, changes: 0 });
    } else {
      existing.changes += existing.answer === e.answer ? 0 : 1;
      existing.answer = e.answer;
      existing.lastAnsweredAt = e.occurredAt;
    }
  }
  return out;
}

// ---- the student's view: never an answer key, never result detail ----

export function buildSimulationView(state: SimulationState, now: string): SimulationView {
  const current = deriveCurrentAnswers(state.events);
  const nowMs = parseServerTime(now, "now");
  const remaining = state.status === "in_progress" ? Math.max(0, Math.floor((parseServerTime(state.deadlineAt, "deadline") - nowMs) / 1000)) : 0;
  return {
    simulationId: state.id,
    status: state.status,
    examCode: state.examCode,
    startedAt: state.startedAt,
    deadlineAt: state.deadlineAt,
    remainingSeconds: remaining,
    sections: orderedSections(state.config).map((s) => ({
      sectionName: s.sectionName,
      order: s.order,
      questionCount: s.questionCount,
      positions: state.paper.questions.filter((q) => q.sectionName === s.sectionName).map((q) => q.position)
    })),
    questions: state.paper.questions.map((q) => {
      const a = current.get(q.position);
      return { position: q.position, sectionName: q.sectionName, questionId: q.questionId, status: a ? "answered" : "unanswered", chosenAnswer: a ? a.answer : null };
    }),
    resultAvailable: state.result !== null
  };
}

// ---- finalization ----

export interface Finalization {
  status: "submitted" | "expired";
  finalizedAt: string;
  finalizedBy: FinalizedBy;
}

/**
 * Builds the traceable, RAW result: per-question outcomes, per-section counts, timing evidence and totals. It computes no
 * score (no marking scheme exists in the repository) and carries no interpretation. A question whose content changed after
 * the paper was fixed is reported `question_content_changed`, never graded against a different version.
 */
export function buildResult(state: SimulationState, finalization: Finalization, answerKey: AnswerKey): SimulationResult {
  const current = deriveCurrentAnswers(state.events);
  const questions: SimulationQuestionOutcome[] = state.paper.questions.map((q) => {
    const a = current.get(q.position);
    if (!a) {
      return { position: q.position, sectionName: q.sectionName, questionId: q.questionId, answered: false, chosenAnswer: null, isCorrect: null, gradingStatus: "unanswered", answerChangeCount: 0, firstAnsweredAt: null, lastAnsweredAt: null };
    }
    const key = answerKey[q.questionId];
    const gradable = key !== undefined && key.contentFingerprint === q.contentFingerprint;
    return {
      position: q.position,
      sectionName: q.sectionName,
      questionId: q.questionId,
      answered: true,
      chosenAnswer: a.answer,
      isCorrect: gradable ? a.answer.trim() === key.correctAnswer.trim() : null,
      gradingStatus: gradable ? "graded" : "question_content_changed",
      answerChangeCount: a.changes,
      firstAnsweredAt: a.firstAnsweredAt,
      lastAnsweredAt: a.lastAnsweredAt
    };
  });
  const sections: SimulationSectionOutcome[] = orderedSections(state.config).map((s) => {
    const mine = questions.filter((q) => q.sectionName === s.sectionName);
    return {
      sectionName: s.sectionName,
      order: s.order,
      questionCount: s.questionCount,
      answered: mine.filter((q) => q.answered).length,
      unanswered: mine.filter((q) => !q.answered).length,
      correct: mine.filter((q) => q.isCorrect === true).length,
      incorrect: mine.filter((q) => q.isCorrect === false).length,
      notGraded: mine.filter((q) => q.answered && q.isCorrect === null).length
    };
  });
  const sum = (f: (s: SimulationSectionOutcome) => number): number => sections.reduce((t, s) => t + f(s), 0);
  const startedMs = parseServerTime(state.startedAt, "start");
  const finalizedMs = parseServerTime(finalization.finalizedAt, "finalization time");
  return {
    simulationId: state.id,
    examCode: state.examCode,
    configVersion: state.config.configVersion,
    paperSourceRef: state.paper.sourceRef,
    isHistoricalPaper: false,
    status: finalization.status,
    timing: {
      startedAt: state.startedAt,
      deadlineAt: state.deadlineAt,
      finalizedAt: new Date(finalizedMs).toISOString(),
      allowedSeconds: state.config.overallDurationSeconds,
      elapsedSeconds: Math.floor((finalizedMs - startedMs) / 1000),
      finalizedBy: finalization.finalizedBy
    },
    questions,
    sections,
    totals: { questionCount: questions.length, answered: sum((s) => s.answered), unanswered: sum((s) => s.unanswered), correct: sum((s) => s.correct), incorrect: sum((s) => s.incorrect), notGraded: sum((s) => s.notGraded) },
    scoring: { defined: false, reason: "No marking scheme is specified in the repository, so no score is computed." },
    interpretation: "none"
  };
}

// ---- mutations: pure decisions, applied atomically by whoever persists the state ----

export type SimulationMutation =
  | { kind: "none" }
  | { kind: "append_event"; event: AnswerEvent }
  | { kind: "finalize"; status: "submitted" | "expired"; finalizedAt: string; finalizedBy: FinalizedBy; result: SimulationResult };

export type AnswerKeyLoader = () => Promise<AnswerKey>;

/** Applies a mutation to a state, returning a new state. The single definition of what each mutation means. */
export function applyMutation(state: SimulationState, mutation: SimulationMutation): SimulationState {
  switch (mutation.kind) {
    case "none":
      return state;
    case "append_event":
      return { ...state, events: [...state.events, mutation.event] };
    case "finalize":
      return { ...state, status: mutation.status, finalizedAt: mutation.finalizedAt, finalizedBy: mutation.finalizedBy, result: mutation.result };
  }
}

async function expireMutation(state: SimulationState, loadKey: AnswerKeyLoader): Promise<SimulationMutation> {
  const finalization: Finalization = { status: "expired", finalizedAt: state.deadlineAt, finalizedBy: "deadline" };
  return { kind: "finalize", status: "expired", finalizedAt: state.deadlineAt, finalizedBy: "deadline", result: buildResult(state, finalization, await loadKey()) };
}

/** Lazy expiry: if the deadline has passed, finalize as `expired` at the deadline; otherwise nothing. Idempotent. */
export async function planSettle(state: SimulationState, now: string, loadKey: AnswerKeyLoader): Promise<{ mutation: SimulationMutation; expired: boolean }> {
  if (!isPastDeadline(state, now)) return { mutation: { kind: "none" }, expired: false };
  return { mutation: await expireMutation(state, loadKey), expired: true };
}

export interface AnswerInput {
  position: number;
  answer: string;
}

export interface AnswerContext {
  /** The question's options for a multiple-choice question, `null` for a typed answer. */
  options: readonly string[] | null;
  /** The question's CURRENT content fingerprint, or `null` if unavailable. */
  currentFingerprint: string | null;
}

/**
 * Decides one answer. Order of decisions: a finalized simulation rejects it; an answer at or after the deadline is rejected
 * and the simulation finalized as expired at the deadline; otherwise the position, the answer text and the question's content
 * version are validated and the answer is appended with the SERVER time. Nothing outside this function can accept an answer.
 */
export async function planAnswer(state: SimulationState, input: AnswerInput, now: string, context: AnswerContext, loadKey: AnswerKeyLoader): Promise<{ mutation: SimulationMutation; outcome: AnswerOutcome }> {
  if (state.status !== "in_progress") return { mutation: { kind: "none" }, outcome: "rejected_finalized" };
  if (isPastDeadline(state, now)) return { mutation: await expireMutation(state, loadKey), outcome: "rejected_expired" };

  const question = state.paper.questions.find((q) => q.position === input.position);
  if (!question) throw new SimulationError("invalid_position", "No such question position in this simulation.");
  if (typeof input.answer !== "string" || input.answer.trim().length === 0 || input.answer.length > MAX_ANSWER_LENGTH) {
    throw new SimulationError("invalid_answer", "The answer must be non-empty text.");
  }
  if (context.options !== null && !context.options.some((o) => o.trim() === input.answer.trim())) {
    throw new SimulationError("invalid_answer", "The answer is not one of this question's options.");
  }
  if (context.currentFingerprint !== question.contentFingerprint) {
    throw new SimulationError("question_content_changed", "This question's content changed after the paper was fixed.");
  }
  return { mutation: { kind: "append_event", event: { position: input.position, answer: input.answer.trim(), occurredAt: new Date(parseServerTime(now, "now")).toISOString() } }, outcome: "recorded" };
}

/**
 * Decides a submission. Already finalized: no change, and the outcome says which way it ended (idempotent). Before the
 * deadline: finalized as `submitted` at `now`. At or after the deadline: the submission is too late and the simulation is
 * finalized as `expired` at the deadline. The server clock against the exclusive deadline is the only arbiter of the race.
 */
export async function planSubmit(state: SimulationState, now: string, loadKey: AnswerKeyLoader): Promise<{ mutation: SimulationMutation; outcome: SubmitOutcome }> {
  if (state.status === "submitted") return { mutation: { kind: "none" }, outcome: "already_submitted" };
  if (state.status === "expired") return { mutation: { kind: "none" }, outcome: "already_expired" };
  if (isPastDeadline(state, now)) return { mutation: await expireMutation(state, loadKey), outcome: "expired_before_submit" };
  const finalizedAt = new Date(parseServerTime(now, "now")).toISOString();
  const finalization: Finalization = { status: "submitted", finalizedAt, finalizedBy: "student_submit" };
  return { mutation: { kind: "finalize", status: "submitted", finalizedAt, finalizedBy: "student_submit", result: buildResult(state, finalization, await loadKey()) }, outcome: "submitted" };
}
