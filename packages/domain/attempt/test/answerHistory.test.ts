import { describe, expect, it } from "vitest";
import { deriveAnswerChangeHistory } from "../src/answerHistory.js";
import { recordAttemptEvent, startAttempt, submitAttempt } from "../src/lifecycle.js";
import { ENROLLMENT_ID, mcqQuestionContext, STUDENT_ID } from "../fixtures/questionContext.js";

const BASE = Date.parse("2026-09-22T10:00:00.000Z");
const t = (offsetSeconds: number): string => new Date(BASE + offsetSeconds * 1000).toISOString();
const claim = { studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId };

describe("deriveAnswerChangeHistory — retains the full sequence, not just the final answer", () => {
  it("A -> C -> B -> D reconstructs initial, final, count, and the full sequence", () => {
    let attempt = startAttempt({ id: "a1", studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId, enrollmentId: ENROLLMENT_ID, now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, claim); // A
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(2), selectedAnswer: "480" }, claim); // C
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(3), selectedAnswer: "450" }, claim); // B
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(4), selectedAnswer: "500" }, claim); // D

    const history = deriveAnswerChangeHistory(attempt);
    expect(history.initialAnswer).toBe("420");
    expect(history.finalAnswer).toBe("500");
    expect(history.changeCount).toBe(3);
    expect(history.sequence.map((p) => p.answer)).toEqual(["420", "480", "450", "500"]);
  });

  it("a single selection with no changes has changeCount 0 and initialAnswer === finalAnswer", () => {
    let attempt = startAttempt({ id: "a2", studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId, enrollmentId: ENROLLMENT_ID, now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);

    const history = deriveAnswerChangeHistory(attempt);
    expect(history.initialAnswer).toBe("480");
    expect(history.finalAnswer).toBe("480");
    expect(history.changeCount).toBe(0);
  });

  it("no answer ever selected: everything is null/empty, never a fabricated value", () => {
    const attempt = startAttempt({ id: "a3", studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId, enrollmentId: ENROLLMENT_ID, now: t(0) });
    const history = deriveAnswerChangeHistory(attempt);
    expect(history.initialAnswer).toBeNull();
    expect(history.finalAnswer).toBeNull();
    expect(history.changeCount).toBe(0);
    expect(history.sequence).toEqual([]);
  });

  it("survives submission — the answer_submitted event itself is not counted as an additional change", () => {
    let attempt = startAttempt({ id: "a4", studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId, enrollmentId: ENROLLMENT_ID, now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });

    const history = deriveAnswerChangeHistory(attempt);
    expect(history.changeCount).toBe(0);
    expect(history.finalAnswer).toBe("480");
  });
});
