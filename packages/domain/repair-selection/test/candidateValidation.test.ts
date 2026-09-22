import { describe, expect, it } from "vitest";
import { validateRepairCandidateQuestion } from "../src/candidateValidation.js";
import { makeCandidate } from "./fixtures.js";

describe("validateRepairCandidateQuestion — malformed/incomplete Question DNA rejected, never silently accepted (Phase 5C-2 §7 point P)", () => {
  it("a fully-formed candidate is valid", () => {
    const result = validateRepairCandidateQuestion(makeCandidate());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a candidate missing questionId", () => {
    const candidate = makeCandidate();
    candidate.question.questionId = "";
    const result = validateRepairCandidateQuestion(candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "question.questionId")).toBe(true);
  });

  it("rejects a candidate missing patternTaxonomyCellId", () => {
    const candidate = makeCandidate();
    candidate.question.patternTaxonomyCellId = "";
    const result = validateRepairCandidateQuestion(candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "question.patternTaxonomyCellId")).toBe(true);
  });

  it("rejects a candidate with no testing modes", () => {
    const candidate = makeCandidate({ testingModes: [] });
    const result = validateRepairCandidateQuestion(candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "question.testingModes")).toBe(true);
  });

  it("rejects a candidate with a non-positive expectedTimeSeconds", () => {
    const candidate = makeCandidate({ expectedTimeSeconds: 0 });
    const result = validateRepairCandidateQuestion(candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "expectedTimeSeconds")).toBe(true);
  });

  it("rejects a candidate with a non-finite expectedTimeSeconds", () => {
    const candidate = makeCandidate({ expectedTimeSeconds: Number.NaN });
    const result = validateRepairCandidateQuestion(candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "expectedTimeSeconds")).toBe(true);
  });

  it("rejects a candidate missing validationState", () => {
    const candidate = makeCandidate();
    // @ts-expect-error — deliberately constructing a malformed candidate to prove the guard fires
    candidate.validationState = "";
    const result = validateRepairCandidateQuestion(candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "validationState")).toBe(true);
  });

  it("reports every issue at once, not just the first", () => {
    const candidate = makeCandidate({ testingModes: [] });
    candidate.question.questionId = "";
    candidate.expectedTimeSeconds = -5;
    const result = validateRepairCandidateQuestion(candidate);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});
