import type { QuestionCandidateAiOutput, QuestionBlueprint, QuestionLifecycleStatus } from "@ipmat/question-engine";
import { CandidateImportError } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { InMemoryQuestionImportRepository, type InMemoryQuestionImportWorld } from "../../src/repositories/inMemoryQuestionImportRepository.js";
import { InMemoryQuestionPublicationRepository } from "../../src/repositories/inMemoryQuestionPublicationRepository.js";

/**
 * Phase 3.5 (Candidate -> persisted Question import boundary, docs/DECISIONS.md
 * D-050): proves the persistence boundary against `InMemoryQuestionImportRepository`
 * — the same interface `PrismaQuestionImportRepository` implements — since
 * no live database has ever been reachable (docs/MASTER_PLAN.md "Current
 * state"). Every import goes through the SAME `assertCandidateIsImportable()`
 * domain gate this repository shares with its Prisma counterpart.
 */

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

function fullWorld(): InMemoryQuestionImportWorld {
  return {
    exams: [{ id: "exam-1", code: "IPMAT-IND" }],
    sections: [{ id: "section-1", examId: "exam-1", name: "Quantitative Ability" }],
    chapters: [{ id: "chapter-1", sectionId: "section-1", name: "Percentages" }],
    concepts: [{ id: "concept-percentages", chapterId: "chapter-1", name: "Percentages" }],
    patternFamilies: [{ id: "family-reverse-percentage", conceptId: "concept-percentages", name: "Reverse Percentage" }],
    errorTaxonomies: [{ id: "trap-base-confusion", code: "base_confusion" }],
    taxonomyCells: [
      {
        id: "cell-1",
        conceptId: "concept-percentages",
        patternFamilyId: "family-reverse-percentage",
        testingMode: "reverse",
        trapErrorTaxonomyId: "trap-base-confusion",
        difficultyTier: "standard"
      }
    ]
  };
}

const provenance = { sourceType: "original" as const, sourceRef: "phase-3.5-fixture", attributedTo: "IPMAT AI Prep (original)" };

function importInput(status: QuestionLifecycleStatus = "validated") {
  return { blueprint, candidate, status, provenance };
}

describe("QuestionImportRepository — Candidate -> persisted Question import boundary (D-050)", () => {
  it("a valid ('validated' status) candidate imports successfully, with validationState 'ai_validated' and provenance attached", async () => {
    const repo = new InMemoryQuestionImportRepository(fullWorld());
    const result = await repo.importValidatedCandidate(importInput("validated"));

    expect(result.alreadyExisted).toBe(false);
    expect(result.validationState).toBe("ai_validated");
    expect(result.difficultyTier).toBe("standard");
    expect(result.hasProvenance).toBe(true);
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("an unvalidated ('draft'/'generated') candidate is refused", async () => {
    const repo = new InMemoryQuestionImportRepository(fullWorld());
    await expect(repo.importValidatedCandidate(importInput("draft"))).rejects.toThrow(CandidateImportError);
    await expect(repo.importValidatedCandidate(importInput("generated"))).rejects.toThrow(CandidateImportError);
  });

  it("a review_required candidate is refused -- nothing in the existing architecture grants it a legitimate persisted state", async () => {
    const repo = new InMemoryQuestionImportRepository(fullWorld());
    await expect(repo.importValidatedCandidate(importInput("review_required"))).rejects.toThrow(CandidateImportError);
    await expect(repo.importValidatedCandidate(importInput("review_required"))).rejects.toThrow(/not "validated"/);
  });

  it("a rejected candidate cannot be imported as usable content, and no row is created", async () => {
    const world = fullWorld();
    const repo = new InMemoryQuestionImportRepository(world);
    await expect(repo.importValidatedCandidate(importInput("rejected"))).rejects.toThrow(CandidateImportError);

    // A second, legitimate import against the SAME world must still succeed cleanly --
    // proving the refused attempt above left no partial/corrupted state behind.
    const result = await repo.importValidatedCandidate(importInput("validated"));
    expect(result.alreadyExisted).toBe(false);
  });

  it("'published' is never assigned by the importer -- even a (structurally impossible in practice) 'published' pipeline status is refused, not passed through", async () => {
    const repo = new InMemoryQuestionImportRepository(fullWorld());
    await expect(repo.importValidatedCandidate(importInput("published"))).rejects.toThrow(CandidateImportError);
  });

  it("a successful import's validationState is 'ai_validated', never 'published' -- the only later path to published remains QuestionPublicationRepository.decide()", async () => {
    const repo = new InMemoryQuestionImportRepository(fullWorld());
    const result = await repo.importValidatedCandidate(importInput());
    expect(result.validationState).not.toBe("published");
    expect(result.validationState).toBe("ai_validated");
  });

  it("provenance is preserved -- hasProvenance is true on a fresh import", async () => {
    const repo = new InMemoryQuestionImportRepository(fullWorld());
    const result = await repo.importValidatedCandidate(importInput());
    expect(result.hasProvenance).toBe(true);
  });

  it("re-importing the exact same candidate is idempotent -- the same id is returned, alreadyExisted becomes true, no second row is created", async () => {
    const world = fullWorld();
    const repo = new InMemoryQuestionImportRepository(world);

    const first = await repo.importValidatedCandidate(importInput());
    const second = await repo.importValidatedCandidate(importInput());

    expect(second.id).toBe(first.id);
    expect(second.alreadyExisted).toBe(true);
    expect(first.alreadyExisted).toBe(false);
  });

  it("a different candidate (different stem) against the SAME taxonomy cell is NOT treated as a duplicate -- imports as a distinct row", async () => {
    const repo = new InMemoryQuestionImportRepository(fullWorld());
    const first = await repo.importValidatedCandidate(importInput());

    const differentCandidate: QuestionCandidateAiOutput = { ...candidate, stem: "A completely different stem for the same taxonomy cell.", correctAnswer: "999" };
    const second = await repo.importValidatedCandidate({ blueprint, candidate: differentCandidate, status: "validated", provenance });

    expect(second.id).not.toBe(first.id);
    expect(second.alreadyExisted).toBe(false);
  });

  it("missing referenced data (unknown concept name) fails closed with PersistenceError, never a partial write", async () => {
    const world = fullWorld();
    world.concepts = []; // no concept named "Percentages" exists
    const repo = new InMemoryQuestionImportRepository(world);

    await expect(repo.importValidatedCandidate(importInput())).rejects.toThrow(PersistenceError);
    await expect(repo.importValidatedCandidate(importInput())).rejects.toThrow(/No Concept found/);
  });

  it("missing referenced data (no matching PatternTaxonomyCell) fails closed -- this importer never creates one", async () => {
    const world = fullWorld();
    world.taxonomyCells = []; // the cell for this exact combination doesn't exist
    const repo = new InMemoryQuestionImportRepository(world);

    await expect(repo.importValidatedCandidate(importInput())).rejects.toThrow(PersistenceError);
    await expect(repo.importValidatedCandidate(importInput())).rejects.toThrow(/No PatternTaxonomyCell found/);
  });

  it("missing referenced data (unknown ErrorTaxonomy trap code) fails closed", async () => {
    const world = fullWorld();
    world.errorTaxonomies = [];
    const repo = new InMemoryQuestionImportRepository(world);

    await expect(repo.importValidatedCandidate(importInput())).rejects.toThrow(/No ErrorTaxonomy found/);
  });

  it("a candidate whose blueprintId does not match the supplied blueprint's id is refused -- an unrelated blueprint must never be trusted for exam/section/chapter resolution", async () => {
    const repo = new InMemoryQuestionImportRepository(fullWorld());
    const unrelatedBlueprint = { ...blueprint, id: "bp-unrelated", examCode: "SOME_OTHER_EXAM" };

    await expect(repo.importValidatedCandidate({ blueprint: unrelatedBlueprint, candidate, status: "validated", provenance })).rejects.toThrow(
      CandidateImportError
    );
    await expect(repo.importValidatedCandidate({ blueprint: unrelatedBlueprint, candidate, status: "validated", provenance })).rejects.toThrow(
      /blueprintId/
    );
  });

  it("an imported Question is immediately usable by QuestionPublicationRepository.decide('publish') -- proving compatibility with the existing publication gate", async () => {
    const importRepo = new InMemoryQuestionImportRepository(fullWorld());
    const imported = await importRepo.importValidatedCandidate(importInput());

    const publicationRepo = new InMemoryQuestionPublicationRepository([
      { id: imported.id, validationState: imported.validationState, difficultyTier: imported.difficultyTier, hasProvenance: imported.hasProvenance }
    ]);

    const decided = await publicationRepo.decide(imported.id, "publish");
    expect(decided.validationState).toBe("published");
  });
});
