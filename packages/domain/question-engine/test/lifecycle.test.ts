import { describe, expect, it } from "vitest";
import { computeLifecycleStatus, isValidTransition, requiresHumanReview } from "../src/lifecycle.js";

describe("question lifecycle", () => {
  it("Hard, Extreme, and Novel tiers require human review; Standard and Advanced do not", () => {
    expect(requiresHumanReview("standard")).toBe(false);
    expect(requiresHumanReview("advanced")).toBe(false);
    expect(requiresHumanReview("hard")).toBe(true);
    expect(requiresHumanReview("extreme")).toBe(true);
    expect(requiresHumanReview("novel")).toBe(true);
  });

  it("a failed check always yields 'rejected', regardless of difficulty tier", () => {
    expect(computeLifecycleStatus({ allChecksPassed: false, difficultyTier: "standard" })).toBe("rejected");
    expect(computeLifecycleStatus({ allChecksPassed: false, difficultyTier: "extreme" })).toBe("rejected");
  });

  it("a fully-passed Standard/Advanced candidate becomes 'validated', never auto-'published'", () => {
    expect(computeLifecycleStatus({ allChecksPassed: true, difficultyTier: "standard" })).toBe("validated");
    expect(computeLifecycleStatus({ allChecksPassed: true, difficultyTier: "advanced" })).toBe("validated");
  });

  it("a fully-passed Hard/Extreme/Novel candidate requires review, never 'validated' directly", () => {
    expect(computeLifecycleStatus({ allChecksPassed: true, difficultyTier: "hard" })).toBe("review_required");
    expect(computeLifecycleStatus({ allChecksPassed: true, difficultyTier: "novel" })).toBe("review_required");
  });

  it("validated can reach published directly, but review_required cannot skip approval", () => {
    expect(isValidTransition("validated", "published")).toBe(true);
    expect(isValidTransition("review_required", "published")).toBe(false);
    expect(isValidTransition("review_required", "approved")).toBe(true);
    expect(isValidTransition("approved", "published")).toBe(true);
  });

  it("published and rejected and deprecated are terminal — nothing transitions out of them except the one allowed edge", () => {
    expect(isValidTransition("published", "deprecated")).toBe(true);
    expect(isValidTransition("published", "validated")).toBe(false);
    expect(isValidTransition("rejected", "validated")).toBe(false);
    expect(isValidTransition("deprecated", "published")).toBe(false);
  });
});
