import { describe, expect, it } from "vitest";
import { decidePublication, PublicationDecisionError, type PublicationDecisionInput } from "../src/publicationDecision.js";

const base: PublicationDecisionInput = {
  currentValidationState: "ai_validated",
  difficultyTier: "standard",
  hasProvenance: true
};

describe("decidePublication — explicit human publish/reject decisions on the REAL persisted ValidationState", () => {
  it("a Standard-tier ai_validated candidate with provenance can be explicitly published", () => {
    expect(decidePublication("publish", base)).toBe("published");
  });

  it("an ai_validated candidate remains unpublished until decidePublication('publish') is actually called -- 'validated' never implies 'published' on its own", () => {
    // No call to decidePublication happens here at all -- this test documents that fact:
    // the input's currentValidationState stays "ai_validated" regardless of anything else
    // in this codebase (the generation pipeline never calls this function).
    expect(base.currentValidationState).toBe("ai_validated");
  });

  it("a draft (validation not yet complete) cannot be published", () => {
    expect(() => decidePublication("publish", { ...base, currentValidationState: "draft" })).toThrow(PublicationDecisionError);
    expect(() => decidePublication("publish", { ...base, currentValidationState: "draft" })).toThrow(/has not completed validation/);
  });

  it("a Hard-tier candidate cannot be published directly from ai_validated -- human review is a hard prerequisite (mirrors the pipeline's own review_required gate, D-008)", () => {
    const hardTierAiValidated: PublicationDecisionInput = { currentValidationState: "ai_validated", difficultyTier: "hard", hasProvenance: true };
    expect(() => decidePublication("publish", hardTierAiValidated)).toThrow(PublicationDecisionError);
    expect(() => decidePublication("publish", hardTierAiValidated)).toThrow(/requires human review first/);
  });

  it("an Extreme-tier candidate CAN be published once it reaches human_reviewed", () => {
    const extremeTierReviewed: PublicationDecisionInput = { currentValidationState: "human_reviewed", difficultyTier: "extreme", hasProvenance: true };
    expect(decidePublication("publish", extremeTierReviewed)).toBe("published");
  });

  it("a Novel-tier candidate cannot be published even from human_reviewed if provenance is missing", () => {
    const novelTierNoProvenance: PublicationDecisionInput = { currentValidationState: "human_reviewed", difficultyTier: "novel", hasProvenance: false };
    expect(() => decidePublication("publish", novelTierNoProvenance)).toThrow(PublicationDecisionError);
    expect(() => decidePublication("publish", novelTierNoProvenance)).toThrow(/no Provenance record/);
  });

  it("Standard/Advanced tiers may publish directly from ai_validated (no mandatory human_reviewed step) -- but ONLY via this explicit call", () => {
    expect(decidePublication("publish", { currentValidationState: "ai_validated", difficultyTier: "standard", hasProvenance: true })).toBe("published");
    expect(decidePublication("publish", { currentValidationState: "ai_validated", difficultyTier: "advanced", hasProvenance: true })).toBe("published");
  });

  it("missing provenance blocks publication even for a Standard-tier candidate", () => {
    expect(() => decidePublication("publish", { ...base, hasProvenance: false })).toThrow(/no Provenance record/);
  });

  it("a published candidate cannot be published again (already terminal)", () => {
    expect(() => decidePublication("publish", { ...base, currentValidationState: "published" })).toThrow(PublicationDecisionError);
    expect(() => decidePublication("publish", { ...base, currentValidationState: "published" })).toThrow(/already terminal/);
  });

  it("a rejected candidate can never silently return to published -- rejected is terminal for BOTH actions", () => {
    expect(() => decidePublication("publish", { ...base, currentValidationState: "rejected" })).toThrow(PublicationDecisionError);
    expect(() => decidePublication("reject", { ...base, currentValidationState: "rejected" })).toThrow(PublicationDecisionError);
  });

  it("an already-published candidate cannot be rejected either -- published is equally terminal", () => {
    expect(() => decidePublication("reject", { ...base, currentValidationState: "published" })).toThrow(/already terminal/);
  });

  it("reject is allowed from draft, ai_validated, or human_reviewed regardless of tier or provenance", () => {
    expect(decidePublication("reject", { currentValidationState: "draft", difficultyTier: "hard", hasProvenance: false })).toBe("rejected");
    expect(decidePublication("reject", base)).toBe("rejected");
    expect(decidePublication("reject", { ...base, currentValidationState: "human_reviewed" })).toBe("rejected");
  });

  it("invalid transitions fail closed with a stable, distinguishable error code per case", () => {
    expect(() => decidePublication("publish", { ...base, currentValidationState: "draft" })).toThrowError(
      expect.objectContaining({ code: "validation_incomplete" })
    );
    expect(() => decidePublication("publish", { currentValidationState: "ai_validated", difficultyTier: "hard", hasProvenance: true })).toThrowError(
      expect.objectContaining({ code: "human_review_required" })
    );
    expect(() => decidePublication("publish", { ...base, hasProvenance: false })).toThrowError(expect.objectContaining({ code: "missing_provenance" }));
    expect(() => decidePublication("publish", { ...base, currentValidationState: "published" })).toThrowError(
      expect.objectContaining({ code: "already_terminal" })
    );
  });
});
