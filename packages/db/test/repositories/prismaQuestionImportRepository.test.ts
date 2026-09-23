import type { PrismaClient } from "@prisma/client";
import type { QuestionBlueprint, QuestionCandidateAiOutput } from "@ipmat/question-engine";
import { CandidateImportError } from "@ipmat/question-engine";
import { describe, expect, it, vi } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { PrismaQuestionImportRepository } from "../../src/repositories/prismaQuestionImportRepository.js";

/**
 * Deliberately narrow, code-level tests against a hand-rolled fake
 * `PrismaClient` — NOT a claim that any of this proves real PostgreSQL
 * behavior (see `prismaQuestionPublicationRepository.test.ts`'s own doc
 * comment for the same standing caveat). What CAN be proven
 * deterministically: `Serializable` isolation is requested; the exact
 * resolution ORDER and arguments Prisma is called with; that a refused
 * candidate never reaches ANY write call; that `correctAnswer`/`options`
 * passed to `question.create()` come byte-for-byte from the candidate,
 * never from any other input field (there is no other field to have come
 * from — proving the type signature's own guarantee at the call-site
 * level too).
 */

const blueprint: QuestionBlueprint = {
  id: "bp-test",
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
  explanation: "x * 1.2 = 480, so x = 400.",
  solutionSteps: ["Let x be the original number.", "x * 1.2 = 480", "x = 400"],
  reasoning: "Reverse percentage.",
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

const provenanceInput = { sourceType: "original" as const, sourceRef: "test", attributedTo: "IPMAT AI Prep" };

function makeFakePrisma(overrides: { existingQuestion?: unknown } = {}) {
  const exam = { findUnique: vi.fn().mockResolvedValue({ id: "exam-1" }) };
  const section = { findUnique: vi.fn().mockResolvedValue({ id: "section-1" }) };
  const chapter = { findUnique: vi.fn().mockResolvedValue({ id: "chapter-1" }) };
  const concept = { findUnique: vi.fn().mockResolvedValue({ id: "concept-1" }) };
  const questionPatternFamily = { findUnique: vi.fn().mockResolvedValue({ id: "family-1" }) };
  const errorTaxonomy = { findUnique: vi.fn().mockResolvedValue({ id: "trap-1" }) };
  const patternTaxonomyCell = { findFirst: vi.fn().mockResolvedValue({ id: "cell-1" }) };
  const question = {
    findFirst: vi.fn().mockResolvedValue(overrides.existingQuestion ?? null),
    create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "question-new-1",
      validationState: data.validationState,
      difficultyTier: data.difficultyTier,
      provenanceId: data.provenanceId
    }))
  };
  const provenance = { create: vi.fn().mockResolvedValue({ id: "provenance-1" }) };

  let capturedTransactionOptions: unknown;
  const fake = {
    exam,
    section,
    chapter,
    concept,
    questionPatternFamily,
    errorTaxonomy,
    patternTaxonomyCell,
    question,
    provenance,
    async $transaction(fn: (tx: unknown) => Promise<unknown>, options?: unknown) {
      capturedTransactionOptions = options;
      return fn(fake);
    }
  };

  return { fake, exam, section, chapter, concept, questionPatternFamily, errorTaxonomy, patternTaxonomyCell, question, provenance, getTransactionOptions: () => capturedTransactionOptions };
}

describe("PrismaQuestionImportRepository — code-level resolution/write-shape properties (no live database)", () => {
  it("requests Serializable isolation, matching the same discipline as the Attempt and Publication repositories", async () => {
    const { fake, getTransactionOptions } = makeFakePrisma();
    const repo = new PrismaQuestionImportRepository(fake as unknown as PrismaClient);

    await repo.importValidatedCandidate({ blueprint, candidate, status: "validated", provenance: provenanceInput });

    expect(getTransactionOptions()).toEqual({ isolationLevel: "Serializable" });
  });

  it("a refused candidate (status !== 'validated') never issues a single query -- assertCandidateIsImportable() runs before anything touches Prisma", async () => {
    const { fake, exam } = makeFakePrisma();
    const repo = new PrismaQuestionImportRepository(fake as unknown as PrismaClient);

    await expect(repo.importValidatedCandidate({ blueprint, candidate, status: "review_required", provenance: provenanceInput })).rejects.toThrow(CandidateImportError);
    expect(exam.findUnique).not.toHaveBeenCalled();
  });

  it("a candidate whose blueprintId does not match the supplied blueprint's id is refused and never issues a single query -- an unrelated blueprint's examCode/sectionName/chapterName must never be trusted for FK resolution", async () => {
    const { fake, exam } = makeFakePrisma();
    const unrelatedBlueprint = { ...blueprint, id: "bp-unrelated", examCode: "SOME_OTHER_EXAM" };
    const repo = new PrismaQuestionImportRepository(fake as unknown as PrismaClient);

    await expect(repo.importValidatedCandidate({ blueprint: unrelatedBlueprint, candidate, status: "validated", provenance: provenanceInput })).rejects.toThrow(
      CandidateImportError
    );
    expect(exam.findUnique).not.toHaveBeenCalled();
  });

  it("question.create() receives correctAnswer/options/stem byte-for-byte from the candidate -- there is no other input field they could have come from", async () => {
    const { fake, question } = makeFakePrisma();
    const repo = new PrismaQuestionImportRepository(fake as unknown as PrismaClient);

    await repo.importValidatedCandidate({ blueprint, candidate, status: "validated", provenance: provenanceInput });

    expect(question.create).toHaveBeenCalledTimes(1);
    const call = question.create.mock.calls[0]![0];
    expect(call.data.correctAnswer).toBe(candidate.correctAnswer);
    expect(call.data.options).toEqual(candidate.options);
    expect(call.data.body).toBe(candidate.stem);
    expect(call.data.difficultyTier).toBe(candidate.questionDna.difficultyTier);
    expect(call.data.validationState).toBe("ai_validated");
  });

  it("provenance is created from the caller-supplied metadata and linked via provenanceId, never an existing/arbitrary id", async () => {
    const { fake, provenance, question } = makeFakePrisma();
    const repo = new PrismaQuestionImportRepository(fake as unknown as PrismaClient);

    await repo.importValidatedCandidate({ blueprint, candidate, status: "validated", provenance: provenanceInput });

    expect(provenance.create).toHaveBeenCalledWith({ data: { sourceType: "original", sourceRef: "test", licenseRef: null, attributedTo: "IPMAT AI Prep" } });
    expect(question.create.mock.calls[0]![0].data.provenanceId).toBe("provenance-1");
  });

  it("a missing Exam fails closed with PersistenceError and never reaches question.create()", async () => {
    const { fake, exam, question } = makeFakePrisma();
    exam.findUnique.mockResolvedValue(null);
    const repo = new PrismaQuestionImportRepository(fake as unknown as PrismaClient);

    await expect(repo.importValidatedCandidate({ blueprint, candidate, status: "validated", provenance: provenanceInput })).rejects.toThrow(PersistenceError);
    expect(question.create).not.toHaveBeenCalled();
  });

  it("a missing PatternTaxonomyCell fails closed and never reaches question.create() -- this importer never creates a cell", async () => {
    const { fake, patternTaxonomyCell, question } = makeFakePrisma();
    patternTaxonomyCell.findFirst.mockResolvedValue(null);
    const repo = new PrismaQuestionImportRepository(fake as unknown as PrismaClient);

    await expect(repo.importValidatedCandidate({ blueprint, candidate, status: "validated", provenance: provenanceInput })).rejects.toThrow(/No PatternTaxonomyCell found/);
    expect(question.create).not.toHaveBeenCalled();
  });

  it("an already-imported row (found via patternTaxonomyCellId + body) is returned as-is -- provenance.create()/question.create() are never called", async () => {
    const { fake, provenance, question } = makeFakePrisma({ existingQuestion: { id: "existing-question-1", validationState: "ai_validated", difficultyTier: "standard", provenanceId: "existing-provenance-1" } });
    const repo = new PrismaQuestionImportRepository(fake as unknown as PrismaClient);

    const result = await repo.importValidatedCandidate({ blueprint, candidate, status: "validated", provenance: provenanceInput });

    expect(result).toEqual({ id: "existing-question-1", validationState: "ai_validated", difficultyTier: "standard", hasProvenance: true, alreadyExisted: true });
    expect(provenance.create).not.toHaveBeenCalled();
    expect(question.create).not.toHaveBeenCalled();
  });
});
