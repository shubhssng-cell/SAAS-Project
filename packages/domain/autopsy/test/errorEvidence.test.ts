import { describe, expect, it } from "vitest";
import { deriveCandidateErrorEvidence } from "../src/errorEvidence.js";
import { buildEvidence } from "../fixtures/evidence.js";
import { errorTaxonomyFixture } from "../fixtures/errorTaxonomy.js";
import {
  percentagesNoTrapQuestionContext,
  percentagesQuestionContext,
  percentagesUnknownTrapQuestionContext
} from "../fixtures/questionContext.js";

describe("deriveCandidateErrorEvidence — candidate, never confirmed, never an AI call (Phase 5A §8)", () => {
  it("proposes the question's designated trap category when the attempt is incorrect", () => {
    const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420" });
    const result = deriveCandidateErrorEvidence(evidence, percentagesQuestionContext, errorTaxonomyFixture);
    expect(result).not.toBeNull();
    expect(result?.proposedErrorCategory).toBe("misconception"); // base_confusion's category
    expect(result?.proposedErrorTaxonomyCode).toBe("base_confusion");
    expect(result?.qualification).toMatch(/CANDIDATE/);
    expect(result?.qualification).toMatch(/NOT a confirmed diagnosis/);
  });

  it("returns null for a correct attempt — nothing to categorize", () => {
    const evidence = buildEvidence({ isCorrect: true });
    expect(deriveCandidateErrorEvidence(evidence, percentagesQuestionContext, errorTaxonomyFixture)).toBeNull();
  });

  it("returns null for a skipped attempt — no wrong answer exists", () => {
    const evidence = buildEvidence({ status: "skipped", skipped: true, finalAnswer: null, isCorrect: null });
    expect(deriveCandidateErrorEvidence(evidence, percentagesQuestionContext, errorTaxonomyFixture)).toBeNull();
  });

  it("returns null for an abandoned attempt — no wrong answer exists", () => {
    const evidence = buildEvidence({ status: "abandoned", skipped: false, finalAnswer: null, isCorrect: null });
    expect(deriveCandidateErrorEvidence(evidence, percentagesQuestionContext, errorTaxonomyFixture)).toBeNull();
  });

  it("a question with no designated trap: still returns evidence, but no category proposed", () => {
    const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420" });
    const result = deriveCandidateErrorEvidence(evidence, percentagesNoTrapQuestionContext, errorTaxonomyFixture);
    expect(result).not.toBeNull();
    expect(result?.proposedErrorCategory).toBeNull();
    expect(result?.proposedErrorTaxonomyCode).toBeNull();
    expect(result?.missingEvidence.some((m) => m.includes("no designated trap"))).toBe(true);
  });

  it("a trap code not present in the supplied taxonomy: code surfaced, category left unresolved", () => {
    const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420" });
    const result = deriveCandidateErrorEvidence(evidence, percentagesUnknownTrapQuestionContext, errorTaxonomyFixture);
    expect(result?.proposedErrorCategory).toBeNull();
    expect(result?.proposedErrorTaxonomyCode).toBe("not_a_real_taxonomy_code");
    expect(result?.missingEvidence.some((m) => m.includes("not found in the supplied error taxonomy"))).toBe(true);
  });

  it("never includes a 'confirmed' field or any confirmation claim — candidate error is structurally distinct from confirmed error", () => {
    const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420" });
    const result = deriveCandidateErrorEvidence(evidence, percentagesQuestionContext, errorTaxonomyFixture);
    expect(Object.keys(result ?? {})).not.toContain("confirmed");
    expect(Object.keys(result ?? {})).not.toContain("confidence");
  });
});
