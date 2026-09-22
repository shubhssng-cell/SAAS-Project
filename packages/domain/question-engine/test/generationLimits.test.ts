import { describe, expect, it } from "vitest";
import { DEFAULT_SINGLE_RUN_LIMITS, validateGenerationLimits, worstCaseSingleCallCostUsd } from "../src/generationLimits.js";

describe("validateGenerationLimits — the generation infrastructure requires explicit, sane limits (Phase 3.1 §9)", () => {
  it("accepts the default single-run limits", () => {
    expect(() => validateGenerationLimits(DEFAULT_SINGLE_RUN_LIMITS)).not.toThrow();
  });

  it("rejects a non-positive maxBlueprints", () => {
    expect(() => validateGenerationLimits({ ...DEFAULT_SINGLE_RUN_LIMITS, maxBlueprints: 0 })).toThrow(/maxBlueprints/);
  });

  it("rejects a non-integer maxCandidatesPerBlueprint", () => {
    expect(() => validateGenerationLimits({ ...DEFAULT_SINGLE_RUN_LIMITS, maxCandidatesPerBlueprint: 1.5 })).toThrow(
      /maxCandidatesPerBlueprint/
    );
  });

  it("rejects a negative maxRetries", () => {
    expect(() => validateGenerationLimits({ ...DEFAULT_SINGLE_RUN_LIMITS, maxRetries: -1 })).toThrow(/maxRetries/);
  });

  it("rejects maxGenerationAttempts too small to cover maxBlueprints * maxCandidatesPerBlueprint", () => {
    expect(() =>
      validateGenerationLimits({ ...DEFAULT_SINGLE_RUN_LIMITS, maxBlueprints: 5, maxCandidatesPerBlueprint: 3, maxGenerationAttempts: 2 })
    ).toThrow(/maxGenerationAttempts/);
  });

  it("rejects a non-positive budget", () => {
    expect(() => validateGenerationLimits({ ...DEFAULT_SINGLE_RUN_LIMITS, maxEstimatedBudgetUsd: 0 })).toThrow(/maxEstimatedBudgetUsd/);
  });

  it("rejects an unreasonably large budget rather than silently allowing it", () => {
    expect(() => validateGenerationLimits({ ...DEFAULT_SINGLE_RUN_LIMITS, maxEstimatedBudgetUsd: 500 })).toThrow(
      /maxEstimatedBudgetUsd/
    );
  });

  it("lists every violated rule at once, not just the first", () => {
    try {
      validateGenerationLimits({
        maxBlueprints: -1,
        maxCandidatesPerBlueprint: -1,
        maxRetries: -1,
        maxGenerationAttempts: -1,
        maxEstimatedBudgetUsd: -1
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/maxBlueprints/);
      expect(message).toMatch(/maxCandidatesPerBlueprint/);
      expect(message).toMatch(/maxRetries/);
    }
  });
});

describe("worstCaseSingleCallCostUsd — makes the AnthropicProvider max_tokens / cost-safety coupling explicit and testable (Phase 3.1.1 §7 / docs/DECISIONS.md D-031)", () => {
  it("returns null for an unpriced model, same as estimateCostUsd — never a silent $0", () => {
    expect(worstCaseSingleCallCostUsd("some-unpriced-model")).toBeNull();
  });

  it("bounds a single call's worst case, at the real output-token cap, under the default per-run budget for every currently priced real model", () => {
    for (const model of ["claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-opus-5"]) {
      const worstCase = worstCaseSingleCallCostUsd(model);
      expect(worstCase).not.toBeNull();
      expect(worstCase as number).toBeLessThan(DEFAULT_SINGLE_RUN_LIMITS.maxEstimatedBudgetUsd);
    }
  });

  it("scales with the assumed input-token ceiling, so the bound isn't accidentally hardcoded to a wrong constant", () => {
    const small = worstCaseSingleCallCostUsd("claude-opus-5", 100);
    const large = worstCaseSingleCallCostUsd("claude-opus-5", 100_000);
    expect((small as number) < (large as number)).toBe(true);
  });
});
