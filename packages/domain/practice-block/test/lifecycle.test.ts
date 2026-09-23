import { describe, expect, it } from "vitest";
import { abandonPracticeBlock, completePracticeBlock, createPracticeBlock } from "../src/lifecycle.js";
import { PracticeBlockLifecycleError, type PracticeBlockState } from "../src/types.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:30:00.000Z";

function makeBlock(overrides: Partial<PracticeBlockState> = {}): PracticeBlockState {
  return {
    id: "block-1",
    practiceSessionId: "session-1",
    sequenceNumber: 1,
    status: "active",
    startedAt: T0,
    endedAt: null,
    targetQuestionCount: null,
    blockTimeBudgetSeconds: null,
    ...overrides
  };
}

describe("createPracticeBlock", () => {
  it("creates an active block under an active session", () => {
    const block = createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: 1, now: T0, sessionIsActive: true });
    expect(block).toEqual({
      id: "b1",
      practiceSessionId: "s1",
      sequenceNumber: 1,
      status: "active",
      startedAt: T0,
      endedAt: null,
      targetQuestionCount: null,
      blockTimeBudgetSeconds: null
    });
  });

  it("rejects creation under a non-active (terminal) session -- caller-supplied sessionIsActive: false", () => {
    expect(() => createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: 1, now: T0, sessionIsActive: false })).toThrow(PracticeBlockLifecycleError);
    try {
      createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: 1, now: T0, sessionIsActive: false });
    } catch (error) {
      expect((error as PracticeBlockLifecycleError).code).toBe("session_not_active");
    }
  });

  it("accepts a positive targetQuestionCount and blockTimeBudgetSeconds", () => {
    const block = createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: 1, now: T0, sessionIsActive: true, targetQuestionCount: 10, blockTimeBudgetSeconds: 600 });
    expect(block.targetQuestionCount).toBe(10);
    expect(block.blockTimeBudgetSeconds).toBe(600);
  });

  it("rejects a zero/negative/non-integer sequenceNumber", () => {
    expect(() => createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: 0, now: T0, sessionIsActive: true })).toThrow(PracticeBlockLifecycleError);
    expect(() => createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: -1, now: T0, sessionIsActive: true })).toThrow(PracticeBlockLifecycleError);
    expect(() => createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: 1.5, now: T0, sessionIsActive: true })).toThrow(PracticeBlockLifecycleError);
  });

  it("rejects a zero/negative targetQuestionCount", () => {
    expect(() => createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: 1, now: T0, sessionIsActive: true, targetQuestionCount: 0 })).toThrow(PracticeBlockLifecycleError);
  });

  it("rejects a zero/negative blockTimeBudgetSeconds", () => {
    expect(() => createPracticeBlock({ id: "b1", practiceSessionId: "s1", sequenceNumber: 1, now: T0, sessionIsActive: true, blockTimeBudgetSeconds: -1 })).toThrow(PracticeBlockLifecycleError);
  });
});

describe("completePracticeBlock / abandonPracticeBlock", () => {
  it("completes an active block", () => {
    const completed = completePracticeBlock(makeBlock(), { now: T1 });
    expect(completed.status).toBe("completed");
    expect(completed.endedAt).toBe(T1);
  });

  it("abandons an active block", () => {
    const abandoned = abandonPracticeBlock(makeBlock(), { now: T1 });
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.endedAt).toBe(T1);
  });

  it("terminal-state immutability: cannot complete/abandon an already-terminal block, or cross terminal states", () => {
    const completed = makeBlock({ status: "completed", endedAt: T1 });
    expect(() => completePracticeBlock(completed, { now: T1 })).toThrow(PracticeBlockLifecycleError);
    expect(() => abandonPracticeBlock(completed, { now: T1 })).toThrow(PracticeBlockLifecycleError);

    const abandoned = makeBlock({ status: "abandoned", endedAt: T1 });
    expect(() => abandonPracticeBlock(abandoned, { now: T1 })).toThrow(PracticeBlockLifecycleError);
    expect(() => completePracticeBlock(abandoned, { now: T1 })).toThrow(PracticeBlockLifecycleError);
  });

  it("throws block_not_found for a null/undefined block", () => {
    expect(() => completePracticeBlock(null, { now: T1 })).toThrow(PracticeBlockLifecycleError);
    expect(() => abandonPracticeBlock(undefined, { now: T1 })).toThrow(PracticeBlockLifecycleError);
  });

  it("rejects a termination timestamp before startedAt", () => {
    expect(() => completePracticeBlock(makeBlock(), { now: "2025-01-01T00:00:00.000Z" })).toThrow(PracticeBlockLifecycleError);
  });
});
