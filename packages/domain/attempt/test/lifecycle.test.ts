import { describe, expect, it } from "vitest";
import {
  finalizeAttempt,
  recordAttemptEvent,
  skipAttempt,
  startAttempt,
  submitAttempt
} from "../src/lifecycle.js";
import { AttemptLifecycleError } from "../src/types.js";
import {
  ENROLLMENT_ID,
  mcqQuestionContext,
  numericEntryQuestionContext,
  otherQuestionContext,
  OTHER_STUDENT_ID,
  STUDENT_ID
} from "../fixtures/questionContext.js";

const BASE = Date.parse("2026-09-22T10:00:00.000Z");
const t = (offsetSeconds: number): string => new Date(BASE + offsetSeconds * 1000).toISOString();

function newAttempt(now = t(0)) {
  return startAttempt({
    id: "attempt-1",
    studentId: STUDENT_ID,
    questionId: mcqQuestionContext.questionId,
    enrollmentId: ENROLLMENT_ID,
    now
  });
}

const claim = { studentId: STUDENT_ID, questionId: mcqQuestionContext.questionId };

describe("1. normal correct attempt", () => {
  it("selects the correct option once and submits, deriving isCorrect from the authoritative answer", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(5), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(10) });

    expect(attempt.status).toBe("submitted");
    expect(attempt.chosenAnswer).toBe("480");
    expect(attempt.isCorrect).toBe(true);
    expect(attempt.timeSpentSeconds).toBe(10);
    expect(attempt.submittedAt).toBe(t(10));
    expect(attempt.finalizedAt).toBe(t(10));
  });
});

describe("2. normal incorrect attempt", () => {
  it("selects a wrong option and submits, correctness computed from the question, not trusted", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(5), selectedAnswer: "420" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(8) });

    expect(attempt.status).toBe("submitted");
    expect(attempt.chosenAnswer).toBe("420");
    expect(attempt.isCorrect).toBe(false);
  });
});

describe("3. answer changed multiple times", () => {
  it("A -> C -> B -> D: the final submitted answer is D, derived from the last recorded event", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, claim); // A
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(2), selectedAnswer: "480" }, claim); // C
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(3), selectedAnswer: "450" }, claim); // B
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(4), selectedAnswer: "500" }, claim); // D
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(5) });

    expect(attempt.chosenAnswer).toBe("500");
    expect(attempt.isCorrect).toBe(false); // correct is 480
  });
});

describe("4. hint opened", () => {
  it("increments hintsUsed and does not affect the submitted answer", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "hint_opened", occurredAt: t(1) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "hint_opened", occurredAt: t(2), hintIndex: 1 }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(3), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(4) });

    expect(attempt.hintsUsed).toBe(2);
    expect(attempt.isCorrect).toBe(true);
  });
});

describe("5. solution opened", () => {
  it("records solutionOpenedAt on first occurrence and does not overwrite it on a second", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "solution_opened", occurredAt: t(1) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "solution_opened", occurredAt: t(2) }, claim);
    expect(attempt.solutionOpenedAt).toBe(t(1));
  });
});

describe("6. skipped question", () => {
  it("is distinguishable from a submitted attempt: status is 'skipped', chosenAnswer/isCorrect stay null", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, claim);
    attempt = skipAttempt(attempt, claim, { now: t(5) });

    expect(attempt.status).toBe("skipped");
    expect(attempt.chosenAnswer).toBeNull();
    expect(attempt.isCorrect).toBeNull();
    expect(attempt.finalizedAt).toBe(t(5));
    expect(attempt.events.some((e) => e.type === "question_skipped")).toBe(true);
  });

  it("an abandoned attempt (finalizeAttempt) is ALSO distinguishable from both skip and submit", () => {
    const attempt = newAttempt();
    const abandoned = finalizeAttempt(attempt, claim, "abandoned", { now: t(30) });
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.chosenAnswer).toBeNull();
    expect(abandoned.isCorrect).toBeNull();
    expect(abandoned.status).not.toBe("skipped");
  });
});

describe("7. submit after skip is rejected (this model treats skip as terminal)", () => {
  it("throws already_finalized when submitAttempt is called on an already-skipped attempt", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = skipAttempt(attempt, claim, { now: t(2) });

    expect(() => submitAttempt(attempt, claim, mcqQuestionContext, { now: t(3) })).toThrow(AttemptLifecycleError);
    try {
      submitAttempt(attempt, claim, mcqQuestionContext, { now: t(3) });
    } catch (error) {
      expect((error as AttemptLifecycleError).code).toBe("already_finalized");
    }
  });
});

describe("8. duplicate submission", () => {
  it("throws already_finalized when submitAttempt is called again on the now-finalized returned state", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });

    expect(() => submitAttempt(attempt, claim, mcqQuestionContext, { now: t(3) })).toThrow(AttemptLifecycleError);
    try {
      submitAttempt(attempt, claim, mcqQuestionContext, { now: t(3) });
    } catch (error) {
      expect((error as AttemptLifecycleError).code).toBe("already_finalized");
    }
  });

  it("finalizeAttempt also refuses to finalize an already-finalized attempt a second time", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });
    expect(() => finalizeAttempt(attempt, claim, "abandoned", { now: t(3) })).toThrow(/already_finalized|already "submitted"/);
  });
});

describe("9. event after finalization", () => {
  it("recordAttemptEvent throws already_finalized on a submitted attempt", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });

    expect(() => recordAttemptEvent(attempt, { type: "hint_opened", occurredAt: t(3) }, claim)).toThrow(AttemptLifecycleError);
  });

  it("recordAttemptEvent throws already_finalized on a skipped attempt", () => {
    let attempt = newAttempt();
    attempt = skipAttempt(attempt, claim, { now: t(1) });
    expect(() => recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(2) }, claim)).toThrow(AttemptLifecycleError);
  });
});

describe("10. invalid timestamp sequence", () => {
  it("rejects an event whose occurredAt is before the attempt's startedAt", () => {
    const attempt = newAttempt(t(10));
    expect(() => recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(5) }, claim)).toThrow(AttemptLifecycleError);
  });

  it("rejects an event whose occurredAt is before the previously recorded event", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(5) }, claim);
    expect(() => recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(2), selectedAnswer: "480" }, claim)).toThrow(
      AttemptLifecycleError
    );
  });

  it("rejects a submission whose 'now' is before the last recorded event", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(10), selectedAnswer: "480" }, claim);
    expect(() => submitAttempt(attempt, claim, mcqQuestionContext, { now: t(3) })).toThrow(AttemptLifecycleError);
  });

  it("rejects a completely unparseable timestamp", () => {
    const attempt = newAttempt();
    expect(() => recordAttemptEvent(attempt, { type: "question_opened", occurredAt: "not-a-date" }, claim)).toThrow(
      AttemptLifecycleError
    );
  });
});

describe("11. forged client correctness", () => {
  it("submitAttempt's signature has no parameter through which a caller could pass isCorrect — correctness is always computed from the authoritative question", () => {
    let attempt = newAttempt();
    // the wrong option, deliberately, to prove the pipeline doesn't just trust "the student says they were right"
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });
    expect(attempt.isCorrect).toBe(false);

    // even if the AUTHORITATIVE question context were (hypothetically) tampered with by a caller to claim
    // a different correct answer, isCorrect is still derived fresh from whatever is passed as `question` —
    // there is no leftover/cached "client said true" value anywhere in AttemptState to fall back on.
    let attempt2 = newAttempt();
    attempt2 = recordAttemptEvent(attempt2, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "420" }, claim);
    attempt2 = submitAttempt(attempt2, claim, { ...mcqQuestionContext, correctAnswer: "420" }, { now: t(2) });
    expect(attempt2.isCorrect).toBe(true); // this is legitimate: the authoritative source itself said 420 was correct this time
  });
});

describe("12. forged client timeTaken", () => {
  it("finalizeAttempt/submitAttempt/skipAttempt accept no duration parameter — timeSpentSeconds is always finalizedAt - startedAt", () => {
    let attempt = newAttempt(t(0));
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(37) });
    expect(attempt.timeSpentSeconds).toBe(37);
  });

  it("a skip's timeSpentSeconds is likewise only ever startedAt-to-finalizedAt", () => {
    let attempt = newAttempt(t(0));
    attempt = skipAttempt(attempt, claim, { now: t(12) });
    expect(attempt.timeSpentSeconds).toBe(12);
  });
});

describe("13. invalid option", () => {
  it("rejects a final answer that is not one of the multiple_choice question's real options", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "999" }, claim);
    expect(() => submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) })).toThrow(AttemptLifecycleError);
    try {
      submitAttempt(attempt, claim, mcqQuestionContext, { now: t(2) });
    } catch (error) {
      expect((error as AttemptLifecycleError).code).toBe("invalid_answer_option");
    }
  });

  it("numeric_entry questions accept any recorded answer without an options-membership check", () => {
    let attempt = startAttempt({
      id: "attempt-numeric",
      studentId: STUDENT_ID,
      questionId: numericEntryQuestionContext.questionId,
      enrollmentId: ENROLLMENT_ID,
      now: t(0)
    });
    const numericClaim = { studentId: STUDENT_ID, questionId: numericEntryQuestionContext.questionId };
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "480" }, numericClaim);
    attempt = submitAttempt(attempt, numericClaim, numericEntryQuestionContext, { now: t(2) });
    expect(attempt.isCorrect).toBe(true);
  });
});

describe("14. attempt belonging to another student/question", () => {
  it("rejects recordAttemptEvent when the claimed studentId does not match the attempt's own", () => {
    const attempt = newAttempt();
    expect(() =>
      recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, { studentId: OTHER_STUDENT_ID, questionId: claim.questionId })
    ).toThrow(AttemptLifecycleError);
  });

  it("rejects submitAttempt when the supplied question context is for a different question", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "1" }, claim);
    expect(() => submitAttempt(attempt, claim, otherQuestionContext, { now: t(2) })).toThrow(AttemptLifecycleError);
  });

  it("the ownership_mismatch error code is used consistently", () => {
    const attempt = newAttempt();
    try {
      recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, { studentId: OTHER_STUDENT_ID, questionId: claim.questionId });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AttemptLifecycleError).code).toBe("ownership_mismatch");
    }
  });
});

describe("15. event ordering reconstruction", () => {
  it("the finalized attempt's events array preserves the exact chronological order they were recorded in", () => {
    let attempt = newAttempt();
    attempt = recordAttemptEvent(attempt, { type: "question_opened", occurredAt: t(1) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "hint_opened", occurredAt: t(2) }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(3), selectedAnswer: "420" }, claim);
    attempt = recordAttemptEvent(attempt, { type: "answer_changed", occurredAt: t(4), selectedAnswer: "480" }, claim);
    attempt = recordAttemptEvent(attempt, { type: "solution_opened", occurredAt: t(5) }, claim);
    attempt = submitAttempt(attempt, claim, mcqQuestionContext, { now: t(6) });

    const types = attempt.events.map((e) => e.type);
    expect(types).toEqual([
      "question_opened",
      "hint_opened",
      "answer_selected",
      "answer_changed",
      "solution_opened",
      "answer_submitted"
    ]);
    const timestamps = attempt.events.map((e) => Date.parse(e.occurredAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });
});

describe("additional invariants: malformed payloads and nonexistent attempts", () => {
  it("rejects an answer_selected event with an empty selectedAnswer", () => {
    const attempt = newAttempt();
    expect(() => recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "" }, claim)).toThrow(
      AttemptLifecycleError
    );
  });

  it("rejects submitting when no answer was ever recorded (missing_answer)", () => {
    const attempt = newAttempt();
    try {
      submitAttempt(attempt, claim, mcqQuestionContext, { now: t(1) });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AttemptLifecycleError).code).toBe("missing_answer");
    }
  });

  it("cannot submit a nonexistent attempt", () => {
    expect(() => submitAttempt(null, claim, mcqQuestionContext, { now: t(1) })).toThrow(AttemptLifecycleError);
    try {
      submitAttempt(undefined, claim, mcqQuestionContext, { now: t(1) });
    } catch (error) {
      expect((error as AttemptLifecycleError).code).toBe("attempt_not_found");
    }
  });

  it("recordAttemptEvent also refuses a nonexistent attempt", () => {
    expect(() => recordAttemptEvent(null, { type: "question_opened", occurredAt: t(1) }, claim)).toThrow(AttemptLifecycleError);
  });
});
