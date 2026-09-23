import { FixtureProvider } from "@ipmat/ai";
import { percentagesConceptGraph } from "@ipmat/concept-graph";
import {
  CandidateImportError,
  coverageExpansionFixtures,
  percentagePointStandaloneStandard,
  runGenerationPipeline,
  successivePnlAdvanced,
  type CoverageExpansionFixture
} from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import { InMemoryQuestionImportRepository, type InMemoryQuestionImportWorld } from "../../src/repositories/inMemoryQuestionImportRepository.js";

/**
 * Runs the Candidate -> persisted Question import boundary (docs/DECISIONS.md
 * D-050) against the REAL 7 Phase 3.5 fixture-driven candidates
 * (`@ipmat/question-engine`'s `percentagesCoverageExpansion.ts`), through
 * the REAL, unmodified `runGenerationPipeline()` via `FixtureProvider` —
 * never a live model call, per docs/MASTER_PLAN.md. This proves the
 * importer's logic against genuine Phase 3.5 candidate shapes, not just
 * synthetic examples, while making explicit what this test does NOT do:
 * it never touches a live database (none has ever been reachable in this
 * environment), so no real `Question` row is created anywhere by this
 * test — only `InMemoryQuestionImportRepository`'s in-process store.
 */

const provenance = { sourceType: "original" as const, sourceRef: "phase-3.5-fixture" };

async function runFixture(fixture: CoverageExpansionFixture) {
  const provider = new FixtureProvider([JSON.stringify(fixture.candidate), JSON.stringify(fixture.reverification), JSON.stringify(fixture.judge)]);
  return runGenerationPipeline({
    blueprint: fixture.blueprint,
    aiProvider: provider,
    graph: percentagesConceptGraph,
    existingQuestionStems: [],
    provenanceSourceType: "original"
  });
}

function worldForPhase35(): InMemoryQuestionImportWorld {
  return {
    exams: [{ id: "exam-1", code: "IPMAT_INDORE" }],
    sections: [{ id: "section-1", examId: "exam-1", name: "Quant" }],
    chapters: [{ id: "chapter-1", sectionId: "section-1", name: "Percentages" }],
    concepts: [
      { id: "concept-percentages", chapterId: "chapter-1", name: "Percentages" },
      { id: "concept-profit-loss", chapterId: "chapter-1", name: "Profit and Loss" }
    ],
    patternFamilies: [
      { id: "family-successive", conceptId: "concept-percentages", name: "Successive Percentage Change" },
      { id: "family-point", conceptId: "concept-percentages", name: "Percentage Point vs Percentage Change" }
    ],
    errorTaxonomies: [
      { id: "trap-successive", code: "successive_change_error" },
      { id: "trap-point", code: "percentage_point_confusion" }
    ],
    taxonomyCells: [
      {
        id: "cell-successive-pnl-advanced",
        conceptId: "concept-percentages",
        patternFamilyId: "family-successive",
        testingMode: "combined",
        trapErrorTaxonomyId: "trap-successive",
        difficultyTier: "advanced"
      },
      {
        id: "cell-point-standalone-standard",
        conceptId: "concept-percentages",
        patternFamilyId: "family-point",
        testingMode: "contextualized",
        trapErrorTaxonomyId: "trap-point",
        difficultyTier: "standard"
      }
    ]
  };
}

describe("Candidate -> persisted Question import boundary x REAL Phase 3.5 fixtures (D-050)", () => {
  it("the 2 fixtures that reach 'validated' status (advanced/standard tier) import successfully", async () => {
    const repo = new InMemoryQuestionImportRepository(worldForPhase35());

    for (const fixture of [successivePnlAdvanced, percentagePointStandaloneStandard]) {
      const pipelineResult = await runFixture(fixture);
      expect(pipelineResult.status, fixture.label).toBe("validated");

      const imported = await repo.importValidatedCandidate({
        blueprint: pipelineResult.blueprint,
        candidate: pipelineResult.candidate,
        status: pipelineResult.status,
        provenance
      });

      expect(imported.alreadyExisted, fixture.label).toBe(false);
      expect(imported.validationState, fixture.label).toBe("ai_validated");
      expect(imported.hasProvenance, fixture.label).toBe(true);
    }
  });

  it("the 5 fixtures that reach 'review_required' status (hard/extreme tier) are refused by the importer -- no live database, and no import path exists for them yet either way", async () => {
    const repo = new InMemoryQuestionImportRepository(worldForPhase35());
    const reviewRequiredFixtures = coverageExpansionFixtures.filter(
      (f) => f !== successivePnlAdvanced && f !== percentagePointStandaloneStandard
    );
    expect(reviewRequiredFixtures).toHaveLength(5);

    for (const fixture of reviewRequiredFixtures) {
      const pipelineResult = await runFixture(fixture);
      expect(pipelineResult.status, fixture.label).toBe("review_required");

      await expect(
        repo.importValidatedCandidate({ blueprint: pipelineResult.blueprint, candidate: pipelineResult.candidate, status: pipelineResult.status, provenance })
      ).rejects.toThrow(CandidateImportError);
    }
  });
});
