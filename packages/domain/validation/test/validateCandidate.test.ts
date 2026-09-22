import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { questionCandidateAiSchema } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import {
  blueprintViolationCandidate,
  combinationViolationCandidate,
  demoBlueprintExpectation,
  difficultyTierViolationCandidate,
  existingQuestionStems,
  malformedRawOutput,
  multipleCorrectAnswerCandidate,
  outOfSyllabusCandidate,
  duplicateCandidate,
  testingModeViolationCandidate,
  trapViolationCandidate,
  unsupportedCompletenessClaimCandidate,
  validCandidate,
  wrongAnswerCandidate
} from "../fixtures/candidateFixtures.js";
import { ambiguousJudgeVerdict, contradictoryJudgeVerdict, passingJudgeVerdict } from "../fixtures/judgeFixtures.js";
import { validateCandidateStructurally } from "../src/validateCandidate.js";
import { verifyComputation } from "../src/verifyComputation.js";
import { checkDuplicateRisk } from "../src/duplicateRisk.js";
import { interpretJudgeVerdict } from "../src/judgeInterpretation.js";

describe("the valid candidate passes every check", () => {
  it("passes structural validation, computation verification, duplicate check, and judge interpretation", () => {
    expect(
      validateCandidateStructurally(validCandidate, percentagesConceptGraph, demoBlueprintExpectation, "original").valid
    ).toBe(true);
    expect(
      verifyComputation({
        computation: validCandidate.groundTruthDerivation.computation,
        expectedAnswer: validCandidate.groundTruthDerivation.expectedAnswer,
        correctAnswer: validCandidate.correctAnswer
      }).valid
    ).toBe(true);
    expect(checkDuplicateRisk(validCandidate.stem, existingQuestionStems).valid).toBe(true);
    expect(interpretJudgeVerdict(passingJudgeVerdict).valid).toBe(true);
  });
});

describe("malformed AI output", () => {
  it("is not even valid JSON — @ipmat/ai's generateStructured retries/rejects it before any domain logic runs", () => {
    expect(() => JSON.parse(malformedRawOutput)).toThrow();
  });

  it("well-formed JSON that is missing required fields fails schema validation", () => {
    const result = questionCandidateAiSchema.safeParse({ stem: "too short a payload" });
    expect(result.success).toBe(false);
  });
});

describe("ambiguous question — caught by the AI-judge pass, not a deterministic check", () => {
  it("is rejected via judge interpretation", () => {
    const result = interpretJudgeVerdict(ambiguousJudgeVerdict);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("judge_ambiguous");
  });
});

describe("contradictory conditions — also a judge-only catch", () => {
  it("is rejected via judge interpretation", () => {
    const result = interpretJudgeVerdict(contradictoryJudgeVerdict);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "judge_contradictory")).toBe(true);
  });
});

describe("multiple-correct-answer question", () => {
  it("is rejected because correctAnswer appears more than once in options", () => {
    const result = validateCandidateStructurally(
      multipleCorrectAnswerCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "multiple_or_no_correct_answer")).toBe(true);
  });
});

describe("wrong-answer question", () => {
  it("is rejected by independent recomputation, never trusting the stated answer", () => {
    const result = verifyComputation({
      computation: wrongAnswerCandidate.groundTruthDerivation.computation,
      expectedAnswer: wrongAnswerCandidate.groundTruthDerivation.expectedAnswer,
      correctAnswer: wrongAnswerCandidate.correctAnswer
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("answer_mismatch");
  });

  it("flags an uncomputable expression as impossible, not a silent pass", () => {
    const result = verifyComputation({ computation: "1 / 0 * undefined_symbol(", expectedAnswer: 5, correctAnswer: "5" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
  });
});

describe("fail closed on unparseable correctAnswer (Phase 3.1 §3)", () => {
  it("rejects with 'unverifiable_answer' rather than silently skipping the cross-check", () => {
    const result = verifyComputation({
      computation: "4 * 150 / 1.25",
      expectedAnswer: 480,
      correctAnswer: "cannot be determined from the given information"
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("unverifiable_answer");
  });

  it("does NOT silently treat an empty correctAnswer as zero (a bug the previous Number('') coercion would have hit)", () => {
    const result = verifyComputation({ computation: "4 * 150 / 1.25", expectedAnswer: 480, correctAnswer: "" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("unverifiable_answer");
  });

  it("still supports common legitimate formats: currency prefix, thousands separator, percent suffix", () => {
    expect(verifyComputation({ computation: "480", expectedAnswer: 480, correctAnswer: "₹480" }).valid).toBe(true);
    expect(verifyComputation({ computation: "10240", expectedAnswer: 10240, correctAnswer: "10,240" }).valid).toBe(true);
    expect(verifyComputation({ computation: "25", expectedAnswer: 25, correctAnswer: "25%" }).valid).toBe(true);
  });
});

describe("computation input is treated as untrusted (AI-generated) text", () => {
  it("rejects a computation string containing non-arithmetic characters without evaluating it", () => {
    // mathjs's evaluate() has had property-injection advisories; this
    // guard rejects anything that isn't plain arithmetic BEFORE it ever
    // reaches evaluate(), regardless of the library's own patch level.
    const result = verifyComputation({
      computation: "constructor.constructor('return process')()",
      expectedAnswer: 1,
      correctAnswer: "1"
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
    expect(result.issues[0]?.message).toMatch(/outside plain arithmetic/);
  });
});

describe("blueprint violation — the generator cannot silently change any blueprint constraint (Phase 3.1 §7)", () => {
  it("is rejected when the candidate targets a different pattern family than the blueprint specified", () => {
    const result = validateCandidateStructurally(
      blueprintViolationCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "blueprint_violation")).toBe(true);
  });

  it("is rejected when the candidate claims a different difficulty tier than the blueprint specified", () => {
    const result = validateCandidateStructurally(
      difficultyTierViolationCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "blueprint_violation" && issue.field === "questionDna.difficultyTier")
    ).toBe(true);
  });

  it("is rejected when the candidate drops a testing mode the blueprint required", () => {
    const result = validateCandidateStructurally(
      testingModeViolationCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "blueprint_violation" && issue.field === "questionDna.testingModes")
    ).toBe(true);
  });

  it("is rejected when the candidate builds in a different trap than the blueprint required", () => {
    const result = validateCandidateStructurally(trapViolationCandidate, percentagesConceptGraph, demoBlueprintExpectation, "original");
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "blueprint_violation" && issue.field === "questionDna.trapErrorTaxonomyCode")
    ).toBe(true);
  });

  it("is rejected when the candidate combines with a concept the blueprint never specified", () => {
    const result = validateCandidateStructurally(
      combinationViolationCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "blueprint_violation" && issue.field === "questionDna.combinesWithConcepts")
    ).toBe(true);
  });
});

describe("out-of-syllabus question", () => {
  it("is rejected when a referenced concept does not exist in the seeded graph", () => {
    const result = validateCandidateStructurally(
      outOfSyllabusCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "out_of_syllabus")).toBe(true);
  });
});

describe("duplicate question", () => {
  it("is rejected when token-overlap similarity to an existing question is too high", () => {
    const result = checkDuplicateRisk(duplicateCandidate.stem, existingQuestionStems);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("duplicate_risk");
  });
});

describe("unsupported completeness claim", () => {
  it("is rejected regardless of how confident the phrasing sounds", () => {
    const result = validateCandidateStructurally(
      unsupportedCompletenessClaimCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "unsupported_completeness_claim")).toBe(true);
  });
});

describe("missing provenance", () => {
  it("blocks a candidate from proceeding without a provenance source type", () => {
    const result = validateCandidateStructurally(validCandidate, percentagesConceptGraph, demoBlueprintExpectation, null);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "missing_provenance")).toBe(true);
  });
});
