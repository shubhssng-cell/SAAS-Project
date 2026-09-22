import { describe, expect, it } from "vitest";
import { normalizeConceptNameKey } from "../src/graph.js";

describe("normalizeConceptNameKey (Phase 3.1.1 §4 / docs/DECISIONS.md D-030)", () => {
  it("treats case and incidental whitespace variance as the same key", () => {
    const keys = ["Percentages", "percentages", "Percentages ", " Percentages", "PERCENTAGES", "  Percentages  "].map(
      normalizeConceptNameKey
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeConceptNameKey("Profit   and    Loss")).toBe(normalizeConceptNameKey("Profit and Loss"));
  });

  it("does NOT fold genuinely different names to the same key — no fuzzy/typo correction", () => {
    expect(normalizeConceptNameKey("Percentage")).not.toBe(normalizeConceptNameKey("Percentages"));
    expect(normalizeConceptNameKey("Ratio")).not.toBe(normalizeConceptNameKey("Ratios"));
  });
});
