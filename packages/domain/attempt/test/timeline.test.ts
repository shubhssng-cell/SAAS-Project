import { describe, expect, it } from "vitest";
import { getEventTimeline } from "../src/timeline.js";
import { recordAttemptEvent, startAttempt, submitAttempt } from "../src/lifecycle.js";
import { ENROLLMENT_ID, mcqQuestionContext, STUDENT_ID } from "../fixtures/questionContext.js";

const BASE = Date.parse("2026-09-22T10:00:00.000Z");
const t = (offsetSeconds: number): string => new Date(BASE + offsetSeconds * 1000).toISOString();
const claim = { studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId };

describe("getEventTimeline — event ordering reconstruction (Phase 4A §8)", () => {
  it("returns events in chronological order matching how they were recorded", () => {
    let attempt = startAttempt({ id: "a1", studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId, enrollmentId: ENROLLMENT_ID, now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(2), selectedAnswer: "420" }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(3), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(4) });

    const timeline = getEventTimeline(attempt);
    expect(timeline.map((e) => e.type)).toEqual(["question_opened", "answer_selected", "answer_changed", "answer_submitted"]);
  });

  it("does not mutate the attempt's own events array", () => {
    let attempt = startAttempt({ id: "a2", studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId, enrollmentId: ENROLLMENT_ID, now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, claim);
    const before = attempt.events;
    getEventTimeline(attempt);
    expect(attempt.events).toBe(before);
  });
});
