import { describe, expect, it } from "vitest";
import { estimateCostUsd, isKnownModel } from "../src/costEstimation.js";

describe("estimateCostUsd", () => {
  it("computes cost from a known model's per-million-token pricing", () => {
    const cost = estimateCostUsd("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBe(3 + 15);
  });

  it("returns 0 for the fixture model (no real cost)", () => {
    expect(estimateCostUsd("fixture-deterministic-v1", { inputTokens: 500, outputTokens: 500 })).toBe(0);
  });

  it("returns null for an unrecognized model rather than guessing", () => {
    expect(estimateCostUsd("some-future-model-not-in-the-table", { inputTokens: 100, outputTokens: 100 })).toBeNull();
  });

  it("returns null when there is no usage data at all", () => {
    expect(estimateCostUsd("claude-sonnet-5", null)).toBeNull();
  });
});

describe("isKnownModel (Phase 3.1.1 §1 / docs/DECISIONS.md D-027) — the pre-flight check a budget breaker must use before trusting any cost estimate", () => {
  it("is true for every model the pricing table actually knows", () => {
    expect(isKnownModel("claude-sonnet-5")).toBe(true);
    expect(isKnownModel("claude-haiku-4-5-20251001")).toBe(true);
    expect(isKnownModel("claude-opus-5")).toBe(true);
    expect(isKnownModel("fixture-deterministic-v1")).toBe(true);
  });

  it("is false for an unrecognized model — this is the fact a caller must check BEFORE spending, not infer from a null cost afterward", () => {
    expect(isKnownModel("some-future-model-not-in-the-table")).toBe(false);
    expect(isKnownModel("")).toBe(false);
  });
});
