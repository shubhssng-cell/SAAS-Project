import type { AttemptState } from "./types.js";

/** One point in the answer-change sequence — what the student's chosen answer was, and when it became that. */
export interface AnswerChangePoint {
  answer: string;
  occurredAt: string;
}

/**
 * The full answer-change picture (Phase 4A §4) — deliberately NOT
 * collapsed into only the final answer. Computed on every call from the
 * event log, never stored as its own column (the same "derive, don't
 * cache" discipline as `deriveCombinations()`/coverage computation —
 * docs/DECISIONS.md D-015).
 */
export interface AnswerChangeHistory {
  initialAnswer: string | null;
  finalAnswer: string | null;
  /** Number of times the answer changed AFTER the initial pick — 0 if only one answer_selected event exists (or none). */
  changeCount: number;
  /** Every answer_selected/answer_changed event in order — e.g. A -> C -> B -> D reconstructs as 4 entries. */
  sequence: AnswerChangePoint[];
}

/**
 * `answer_selected` and `answer_changed` are treated uniformly here — both
 * represent "the student's chosen answer became X at this moment." The
 * raw event log still preserves which literal event type was recorded, in
 * case a future UI/analytics layer wants that distinction; this derived
 * view does not need it.
 */
export function deriveAnswerChangeHistory(attempt: AttemptState): AnswerChangeHistory {
  const sequence: AnswerChangePoint[] = [];
  for (const event of attempt.events) {
    if (event.type !== "answer_selected" && event.type !== "answer_changed") continue;
    const selectedAnswer = event.payload?.["selectedAnswer"];
    if (typeof selectedAnswer === "string") {
      sequence.push({ answer: selectedAnswer, occurredAt: event.occurredAt });
    }
  }

  return {
    initialAnswer: sequence[0]?.answer ?? null,
    finalAnswer: sequence[sequence.length - 1]?.answer ?? null,
    changeCount: Math.max(0, sequence.length - 1),
    sequence
  };
}
