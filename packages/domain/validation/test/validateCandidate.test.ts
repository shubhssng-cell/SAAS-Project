import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { questionCandidateAiSchema } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import {
  answerLeakedInStemCandidate,
  blueprintIdLeakedInStemCandidate,
  blueprintViolationCandidate,
  combinationViolationCandidate,
  demoBlueprintExpectation,
  difficultyTierViolationCandidate,
  duplicateDistractorCandidate,
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

describe("duplicate distractors — a unique correct answer but two identical wrong options (Phase 3.1.1 §6, previously dead code)", () => {
  it("is rejected with distractor_quality, not multiple_or_no_correct_answer", () => {
    const result = validateCandidateStructurally(
      duplicateDistractorCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "distractor_quality")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "multiple_or_no_correct_answer")).toBe(false);
  });
});

describe("answer leakage in the stem (Phase 3.1.1 §3 / docs/DECISIONS.md D-029)", () => {
  it("is rejected when the stem states the claimed correct answer verbatim", () => {
    const result = validateCandidateStructurally(
      answerLeakedInStemCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "answer_leakage_in_stem")).toBe(true);
  });

  it("is rejected when the stem contains the internal blueprintId", () => {
    const result = validateCandidateStructurally(
      blueprintIdLeakedInStemCandidate,
      percentagesConceptGraph,
      demoBlueprintExpectation,
      "original"
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "answer_leakage_in_stem")).toBe(true);
  });

  it("does NOT false-positive on the well-formed valid candidate", () => {
    const result = validateCandidateStructurally(validCandidate, percentagesConceptGraph, demoBlueprintExpectation, "original");
    expect(result.issues.some((issue) => issue.code === "answer_leakage_in_stem")).toBe(false);
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
    expect(result.issues[0]?.message).toMatch(/outside the supported grammar/);
  });
});

describe("verifyComputation grammar and complexity bounds (Phase 3.1.1 §2 / docs/DECISIONS.md D-028)", () => {
  it("accepts a valid supported expression", () => {
    expect(verifyComputation({ computation: "4 * 150 / 1.25", expectedAnswer: 480, correctAnswer: "480" }).valid).toBe(true);
    expect(verifyComputation({ computation: "(100 - 20) * 0.5", expectedAnswer: 40, correctAnswer: "40" }).valid).toBe(true);
  });

  it("rejects unsupported syntax (letters/identifiers) before evaluation", () => {
    const result = verifyComputation({ computation: "150 * discount", expectedAnswer: 100, correctAnswer: "100" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
  });

  it("rejects a comma, since it is a statement separator in mathjs, not a thousands grouping character, and was removed from the allowlist", () => {
    const result = verifyComputation({ computation: "1,000 + 200", expectedAnswer: 1200, correctAnswer: "1200" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
    expect(result.issues[0]?.message).toMatch(/outside the supported grammar/);
  });

  it("rejects a computation with a very large numeric literal before evaluating it", () => {
    const result = verifyComputation({
      computation: "999999999999999999999999 * 2",
      expectedAnswer: 1,
      correctAnswer: "1"
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
    expect(result.issues[0]?.message).toMatch(/digit numeric literal/);
  });

  it("rejects excessive expression complexity (chained exponentiation) before evaluating it", () => {
    const result = verifyComputation({ computation: "2^2^2^2^2^2", expectedAnswer: 1, correctAnswer: "1" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
    expect(result.issues[0]?.message).toMatch(/operators, exceeding/);
  });

  it("rejects a non-finite result (division by zero)", () => {
    const result = verifyComputation({ computation: "5 / 0", expectedAnswer: 1, correctAnswer: "1" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
    expect(result.issues[0]?.message).toMatch(/finite number/);
  });

  it("rejects a malformed expression that fails to parse", () => {
    const result = verifyComputation({ computation: "4 * / 150", expectedAnswer: 1, correctAnswer: "1" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
  });

  it("rejects a plausible-charset expression whose result is implausibly large in magnitude", () => {
    const result = verifyComputation({ computation: "999999999999 * 999999999999", expectedAnswer: 1, correctAnswer: "1" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
    expect(result.issues[0]?.message).toMatch(/magnitude bound/);
  });

  it("rejects a computation string longer than the length limit", () => {
    const longComputation = Array.from({ length: 60 }, () => "1 + ").join("") + "1";
    const result = verifyComputation({ computation: longComputation, expectedAnswer: 1, correctAnswer: "1" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("impossible_computation");
    expect(result.issues[0]?.message).toMatch(/characters long/);
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
