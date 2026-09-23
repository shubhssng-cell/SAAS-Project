import type { QuestionCandidateAiOutput } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import { assertCandidateIsImportable, CandidateImportError } from "../src/candidateImport.js";
import type { QuestionBlueprint } from "../src/blueprint.js";

const blueprint: QuestionBlueprint = {
  id: "bp-percentages-reverse-percentage-test",
  examCode: "IPMAT-IND",
  sectionName: "Quantitative Ability",
  chapterName: "Percentages",
  conceptName: "Percentages",
  patternFamilyName: "Reverse Percentage",
  targetSkill: "reverse-calculation",
  prerequisites: [],
  combinationConcepts: [],
  difficultyTier: "standard",
  difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
  difficultyCalibrationStatus: "provisional",
  expectedTimeSeconds: 90,
  transformationDescription: null,
  trapErrorTaxonomyCode: "base_confusion",
  testingModes: ["reverse"],
  answerFormat: "multiple_choice"
};

const candidate: QuestionCandidateAiOutput = {
  blueprintId: blueprint.id,
  stem: "A number, after being increased by 20%, becomes 480. What was the original number?",
  answerFormat: "multiple_choice",
  options: ["380", "400", "420", "440"],
  correctAnswer: "400",
  explanation: "Let the number be x. x * 1.2 = 480, so x = 400.",
  solutionSteps: ["Let the original number be x.", "x * 1.2 = 480", "x = 400"],
  reasoning: "Reverse percentage: work backward from the increased value.",
  groundTruthDerivation: { computation: "480 / 1.2", expectedAnswer: 400 },
  questionDna: {
    conceptName: "Percentages",
    subconcepts: [],
    prerequisites: [],
    combinesWithConcepts: [],
    patternFamilyName: "Reverse Percentage",
    skill: "reverse-calculation",
    difficultyTier: "standard",
    difficultyDimensions: blueprint.difficultyDimensions,
    noveltyLevel: "standard",
    examRelevance: "core",
    expectedTimeSeconds: 90,
    testingModes: ["reverse"],
    trapErrorTaxonomyCode: "base_confusion"
  }
};

describe("assertCandidateIsImportable — the ONE gate deciding pipeline-result -> persisted-Question eligibility", () => {
  it("a 'validated' status candidate is importable", () => {
    const result = assertCandidateIsImportable({ blueprint, candidate, status: "validated" });
    expect(result.blueprint).toBe(blueprint);
    expect(result.candidate).toBe(candidate);
  });

  it("a 'review_required' status candidate is refused, fail closed -- there is no legitimate importable representation for unreviewed content", () => {
    expect(() => assertCandidateIsImportable({ blueprint, candidate, status: "review_required" })).toThrow(CandidateImportError);
    expect(() => assertCandidateIsImportable({ blueprint, candidate, status: "review_required" })).toThrow(/not "validated"/);
  });

  it("a 'rejected' status candidate is refused, fail closed", () => {
    expect(() => assertCandidateIsImportable({ blueprint, candidate, status: "rejected" })).toThrow(CandidateImportError);
  });

  it("every other QuestionLifecycleStatus value is also refused (draft/generated/approved/published/deprecated) -- only 'validated' qualifies", () => {
    for (const status of ["draft", "generated", "approved", "published", "deprecated"] as const) {
      expect(() => assertCandidateIsImportable({ blueprint, candidate, status })).toThrow(CandidateImportError);
    }
  });

  it("a null candidate (e.g. a failed generation call) is refused with a distinct error code, even if status were somehow 'validated'", () => {
    expect(() => assertCandidateIsImportable({ blueprint, candidate: null, status: "validated" })).toThrow(CandidateImportError);
    expect(() => assertCandidateIsImportable({ blueprint, candidate: null, status: "validated" })).toThrowError(
      expect.objectContaining({ code: "missing_candidate" })
    );
  });

  it("the not_validated error carries a distinguishable code from missing_candidate", () => {
    expect(() => assertCandidateIsImportable({ blueprint, candidate, status: "rejected" })).toThrowError(
      expect.objectContaining({ code: "not_validated" })
    );
  });

  it("a candidate whose blueprintId does not match the supplied blueprint's id is refused, even though it is genuinely 'validated' -- an unrelated blueprint must never be trusted for FK resolution", () => {
    const unrelatedBlueprint: QuestionBlueprint = { ...blueprint, id: "bp-completely-different-blueprint", examCode: "SOME_OTHER_EXAM" };
    expect(() => assertCandidateIsImportable({ blueprint: unrelatedBlueprint, candidate, status: "validated" })).toThrow(CandidateImportError);
    expect(() => assertCandidateIsImportable({ blueprint: unrelatedBlueprint, candidate, status: "validated" })).toThrowError(
      expect.objectContaining({ code: "blueprint_mismatch" })
    );
  });
});
