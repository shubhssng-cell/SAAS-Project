import { describe, expect, it } from "vitest";
import { abandonPracticeSession, completePracticeSession, createPracticeSession } from "../src/lifecycle.js";
import { PracticeSessionLifecycleError, type PracticeSessionState } from "../src/types.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:30:00.000Z";

function makeSession(overrides: Partial<PracticeSessionState> = {}): PracticeSessionState {
  return {
    id: "session-1",
    enrollmentId: "enrollment-1",
    status: "active",
    startedAt: T0,
    endedAt: null,
    sessionTimeBudgetSeconds: null,
    ...overrides
  };
}

describe("createPracticeSession", () => {
  it("creates an active session with null endedAt", () => {
    const session = createPracticeSession({ id: "s1", enrollmentId: "e1", now: T0 });
    expect(session).toEqual({ id: "s1", enrollmentId: "e1", status: "active", startedAt: T0, endedAt: null, sessionTimeBudgetSeconds: null });
  });

  it("accepts a positive integer sessionTimeBudgetSeconds", () => {
    const session = createPracticeSession({ id: "s1", enrollmentId: "e1", now: T0, sessionTimeBudgetSeconds: 3600 });
    expect(session.sessionTimeBudgetSeconds).toBe(3600);
  });

  it("rejects a zero or negative sessionTimeBudgetSeconds", () => {
    expect(() => createPracticeSession({ id: "s1", enrollmentId: "e1", now: T0, sessionTimeBudgetSeconds: 0 })).toThrow(PracticeSessionLifecycleError);
    expect(() => createPracticeSession({ id: "s1", enrollmentId: "e1", now: T0, sessionTimeBudgetSeconds: -5 })).toThrow(PracticeSessionLifecycleError);
  });

  it("rejects a non-integer sessionTimeBudgetSeconds", () => {
    expect(() => createPracticeSession({ id: "s1", enrollmentId: "e1", now: T0, sessionTimeBudgetSeconds: 1.5 })).toThrow(PracticeSessionLifecycleError);
  });

  it("rejects an unparseable now", () => {
    expect(() => createPracticeSession({ id: "s1", enrollmentId: "e1", now: "not-a-date" })).toThrow(PracticeSessionLifecycleError);
  });
});

describe("completePracticeSession / abandonPracticeSession", () => {
  it("completes an active session with no active blocks", () => {
    const session = makeSession();
    const completed = completePracticeSession(session, { now: T1, hasActiveBlock: false });
    expect(completed.status).toBe("completed");
    expect(completed.endedAt).toBe(T1);
  });

  it("abandons an active session with no active blocks", () => {
    const session = makeSession();
    const abandoned = abandonPracticeSession(session, { now: T1, hasActiveBlock: false });
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.endedAt).toBe(T1);
  });

  it("rejects completion when an active block exists", () => {
    const session = makeSession();
    expect(() => completePracticeSession(session, { now: T1, hasActiveBlock: true })).toThrow(PracticeSessionLifecycleError);
    try {
      completePracticeSession(session, { now: T1, hasActiveBlock: true });
    } catch (error) {
      expect((error as PracticeSessionLifecycleError).code).toBe("has_active_block");
    }
  });

  it("rejects abandonment when an active block exists -- same precondition as completion", () => {
    const session = makeSession();
    expect(() => abandonPracticeSession(session, { now: T1, hasActiveBlock: true })).toThrow(PracticeSessionLifecycleError);
  });

  it("terminal-state immutability: cannot complete an already-completed session", () => {
    const completed = makeSession({ status: "completed", endedAt: T1 });
    expect(() => completePracticeSession(completed, { now: T1, hasActiveBlock: false })).toThrow(PracticeSessionLifecycleError);
  });

  it("terminal-state immutability: cannot abandon an already-abandoned session", () => {
    const abandoned = makeSession({ status: "abandoned", endedAt: T1 });
    expect(() => abandonPracticeSession(abandoned, { now: T1, hasActiveBlock: false })).toThrow(PracticeSessionLifecycleError);
  });

  it("terminal-state immutability: cannot move from one terminal state to the other", () => {
    const completed = makeSession({ status: "completed", endedAt: T1 });
    expect(() => abandonPracticeSession(completed, { now: T1, hasActiveBlock: false })).toThrow(PracticeSessionLifecycleError);
    const abandoned = makeSession({ status: "abandoned", endedAt: T1 });
    expect(() => completePracticeSession(abandoned, { now: T1, hasActiveBlock: false })).toThrow(PracticeSessionLifecycleError);
  });

  it("throws session_not_found for a null/undefined session", () => {
    expect(() => completePracticeSession(null, { now: T1, hasActiveBlock: false })).toThrow(PracticeSessionLifecycleError);
    expect(() => completePracticeSession(undefined, { now: T1, hasActiveBlock: false })).toThrow(PracticeSessionLifecycleError);
  });

  it("rejects a termination timestamp before startedAt", () => {
    const session = makeSession();
    expect(() => completePracticeSession(session, { now: "2025-01-01T00:00:00.000Z", hasActiveBlock: false })).toThrow(PracticeSessionLifecycleError);
  });
});
