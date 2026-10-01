import { describe, expect, it } from "vitest";
import { TRAINING_SESSION_BOUNDS, toBlockSettings, validateTrainingSessionConfig } from "../src/config.js";
import { TrainingSessionError } from "../src/errors.js";

function invalid(input: unknown): void {
  try {
    validateTrainingSessionConfig(input);
  } catch (error) {
    expect(error).toBeInstanceOf(TrainingSessionError);
    expect((error as TrainingSessionError).code).toBe("invalid_config");
    return;
  }
  throw new Error("expected invalid_config");
}

describe("session configuration", () => {
  it("accepts a fixed question count and maps it onto the block's target", () => {
    const config = validateTrainingSessionConfig({ completion: { kind: "fixed_question_count", questionCount: 5 } });
    expect(config).toEqual({ completion: { kind: "fixed_question_count", questionCount: 5 } });
    expect(toBlockSettings(config)).toEqual({ targetQuestionCount: 5, blockTimeBudgetSeconds: null });
  });

  it("accepts a fixed duration and maps it onto the block's time budget", () => {
    const config = validateTrainingSessionConfig({ completion: { kind: "fixed_duration", durationSeconds: 600 } });
    expect(toBlockSettings(config)).toEqual({ targetQuestionCount: null, blockTimeBudgetSeconds: 600 });
  });

  it("accepts the exact bounds and rejects one past them", () => {
    const { MIN_QUESTION_COUNT, MAX_QUESTION_COUNT, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS } = TRAINING_SESSION_BOUNDS;
    for (const questionCount of [MIN_QUESTION_COUNT, MAX_QUESTION_COUNT]) expect(() => validateTrainingSessionConfig({ completion: { kind: "fixed_question_count", questionCount } })).not.toThrow();
    for (const durationSeconds of [MIN_DURATION_SECONDS, MAX_DURATION_SECONDS]) expect(() => validateTrainingSessionConfig({ completion: { kind: "fixed_duration", durationSeconds } })).not.toThrow();
    invalid({ completion: { kind: "fixed_question_count", questionCount: MIN_QUESTION_COUNT - 1 } });
    invalid({ completion: { kind: "fixed_question_count", questionCount: MAX_QUESTION_COUNT + 1 } });
    invalid({ completion: { kind: "fixed_duration", durationSeconds: MIN_DURATION_SECONDS - 1 } });
    invalid({ completion: { kind: "fixed_duration", durationSeconds: MAX_DURATION_SECONDS + 1 } });
  });

  it("rejects non-integers, strings, NaN, Infinity, negatives and zero", () => {
    for (const questionCount of [2.5, "5", Number.NaN, Number.POSITIVE_INFINITY, -1, 0, null, undefined]) {
      invalid({ completion: { kind: "fixed_question_count", questionCount } });
    }
  });

  it("rejects non-objects, a missing completion, unknown kinds and unknown extra keys (nothing is coerced or dropped)", () => {
    for (const input of [null, undefined, "x", 5, [], {}, { completion: null }, { completion: "fixed" }, { completion: { kind: "forever" } }]) invalid(input);
    invalid({ completion: { kind: "fixed_question_count", questionCount: 5 }, extra: true });
    invalid({ completion: { kind: "fixed_question_count", questionCount: 5, durationSeconds: 60 } });
  });
});
