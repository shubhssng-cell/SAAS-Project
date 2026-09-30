import { PublicationDecisionError, reverseAlgebraHard } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import { buildValidatedPracticeCandidates, seedPracticeContent, PRACTICE_CONTENT_FIXTURES } from "../../prisma/practiceContentSeed.js";
import { InMemoryQuestionImportRepository, type InMemoryQuestionImportWorld } from "../../src/repositories/inMemoryQuestionImportRepository.js";
import { InMemoryQuestionPublicationRepository } from "../../src/repositories/inMemoryQuestionPublicationRepository.js";
import type { ImportedQuestionRecord, QuestionImportRepository, QuestionPublicationRecord } from "../../src/repositories/types.js";

/**
 * Product Phase 2 Unit 8 -- the persisted practice content seed. These tests are database-free (level B:
 * doubles); the same seed running against real Postgres is covered by
 * apps/api/test/prismaPersistence.integration.test.ts and the Unit 8 section of the Phase 2 roadmap.
 */

describe("practice content candidates", () => {
  it("are the two publishable Phase 3.5 fixtures, run through the REAL pipeline and validated", async () => {
    const candidates = await buildValidatedPracticeCandidates();
    expect(candidates).toHaveLength(2);
    expect(PRACTICE_CONTENT_FIXTURES).toHaveLength(2);
    for (const c of candidates) {
      expect(c.blueprint.examCode).toBe("IPMAT_INDORE");
      expect(["standard", "advanced"]).toContain(c.candidate.questionDna.difficultyTier); // never hard/extreme/novel (human review required)
      expect(c.candidate.questionDna.testingModes.length).toBeGreaterThan(0); // Question DNA complete
      expect(c.candidate.solutionSteps.length).toBeGreaterThan(0); // worked solution present
      expect(c.candidate.options).toContain(c.candidate.correctAnswer);
    }
    expect(new Set(candidates.map((c) => c.candidate.stem)).size).toBe(2);
  });

  it("a hard-tier fixture can never be seeded: it does not reach 'validated', so the builder refuses it", async () => {
    await expect(buildValidatedPracticeCandidates([reverseAlgebraHard])).rejects.toThrow(/not "validated"|review_required/);
  });
});

function recordingImporter(initialState: "ai_validated" | "published") {
  const calls: Array<{ provenance: { sourceType: string; sourceRef?: string | null; attributedTo?: string | null }; status: string }> = [];
  const records = new Map<string, ImportedQuestionRecord>();
  const importer: QuestionImportRepository = {
    async importValidatedCandidate(input) {
      calls.push({ provenance: input.provenance, status: input.status });
      const id = `q-${input.candidate!.blueprintId}`;
      const existing = records.get(id);
      if (existing) return { ...existing, alreadyExisted: true };
      const record: ImportedQuestionRecord = { id, validationState: initialState, difficultyTier: input.candidate!.questionDna.difficultyTier, hasProvenance: true, alreadyExisted: false };
      records.set(id, record);
      return record;
    }
  };
  return { importer, calls, records };
}

describe("seedPracticeContent", () => {
  it("imports with honest 'original' provenance, then publishes ONLY through decidePublication (via the publication repository)", async () => {
    const candidates = await buildValidatedPracticeCandidates();
    const { importer, calls, records } = recordingImporter("ai_validated");
    const publication = new InMemoryQuestionPublicationRepository([...records.values()]);
    // The publication double must know the imported rows; seed it lazily from what the importer creates.
    const lazyPublication = {
      findById: async (id: string) => publication.findById(id),
      decide: async (id: string, action: "publish" | "reject") => {
        const rec = records.get(id)!;
        const seeded = new InMemoryQuestionPublicationRepository([{ id, validationState: rec.validationState, difficultyTier: rec.difficultyTier, hasProvenance: rec.hasProvenance } satisfies QuestionPublicationRecord]);
        return seeded.decide(id, action);
      }
    };
    const results = await seedPracticeContent({ importer, publication: lazyPublication }, candidates);
    expect(results.map((r) => r.outcome)).toEqual(["published", "published"]);
    for (const call of calls) {
      expect(call.status).toBe("validated");
      expect(call.provenance.sourceType).toBe("original");
      expect(call.provenance.sourceRef).toMatch(/^phase-2-unit-8-dev-seed:/);
      expect(call.provenance.attributedTo).toMatch(/original, internal development content/);
    }
  });

  it("is idempotent: already-published questions are left alone and publication is not attempted again", async () => {
    const candidates = await buildValidatedPracticeCandidates();
    const { importer } = recordingImporter("published");
    let decides = 0;
    const results = await seedPracticeContent(
      { importer, publication: { findById: async () => null, decide: async () => (decides++, Promise.reject(new Error("must not be called"))) } },
      candidates
    );
    expect(results.map((r) => r.outcome)).toEqual(["already_published", "already_published"]);
    expect(decides).toBe(0);
  });

  it("publication rules stay strict: if a candidate needed human review, the seed FAILS instead of publishing it", async () => {
    const candidates = await buildValidatedPracticeCandidates();
    const hard = { ...candidates[0]!, candidate: { ...candidates[0]!.candidate, questionDna: { ...candidates[0]!.candidate.questionDna, difficultyTier: "hard" as const } } };
    const { importer, records } = recordingImporter("ai_validated");
    const publication = {
      findById: async () => null,
      decide: async (id: string, action: "publish" | "reject") => {
        const rec = records.get(id)!;
        return new InMemoryQuestionPublicationRepository([{ id, validationState: rec.validationState, difficultyTier: rec.difficultyTier, hasProvenance: rec.hasProvenance }]).decide(id, action);
      }
    };
    await expect(seedPracticeContent({ importer, publication }, [hard])).rejects.toBeInstanceOf(PublicationDecisionError);
  });
});

describe("import resolves related concepts across chapters of the section (found against real Postgres)", () => {
  function world(overrides: Partial<InMemoryQuestionImportWorld> = {}): InMemoryQuestionImportWorld {
    return {
      exams: [{ id: "exam-1", code: "IPMAT_INDORE" }],
      sections: [
        { id: "section-1", examId: "exam-1", name: "Quant" },
        { id: "section-2", examId: "exam-1", name: "Verbal" }
      ],
      chapters: [
        { id: "chapter-percentages", sectionId: "section-1", name: "Percentages" },
        { id: "chapter-pnl", sectionId: "section-1", name: "Profit and Loss" },
        { id: "chapter-verbal", sectionId: "section-2", name: "Reading" }
      ],
      concepts: [
        { id: "concept-percentages", chapterId: "chapter-percentages", name: "Percentages" },
        { id: "concept-pnl", chapterId: "chapter-pnl", name: "Profit and Loss" } // a DIFFERENT chapter, same section
      ],
      patternFamilies: [{ id: "family-successive", conceptId: "concept-percentages", name: "Successive Percentage Change" }],
      errorTaxonomies: [{ id: "trap-successive", code: "successive_change_error" }],
      taxonomyCells: [{ id: "cell-successive", conceptId: "concept-percentages", patternFamilyId: "family-successive", testingMode: "combined", trapErrorTaxonomyId: "trap-successive", difficultyTier: "advanced" }],
      ...overrides
    };
  }
  const provenance = { sourceType: "original" as const, sourceRef: "test" };
  const importFirst = async (w: InMemoryQuestionImportWorld) => {
    const [pnl] = await buildValidatedPracticeCandidates([PRACTICE_CONTENT_FIXTURES[0]!]);
    return new InMemoryQuestionImportRepository(w).importValidatedCandidate({ blueprint: pnl!.blueprint, candidate: pnl!.candidate, status: "validated", provenance });
  };

  it("a combines-with concept living in another chapter of the same section resolves", async () => {
    await expect(importFirst(world())).resolves.toMatchObject({ validationState: "ai_validated", alreadyExisted: false });
  });

  it("a related concept in a DIFFERENT SECTION does not resolve (fails closed)", async () => {
    const w = world({ concepts: [{ id: "concept-percentages", chapterId: "chapter-percentages", name: "Percentages" }, { id: "concept-pnl", chapterId: "chapter-verbal", name: "Profit and Loss" }] });
    await expect(importFirst(w)).rejects.toMatchObject({ name: "PersistenceError", code: "missing_reference" });
  });

  it("an ambiguous related-concept name (two chapters) is refused, never guessed", async () => {
    const w = world();
    w.chapters.push({ id: "chapter-other", sectionId: "section-1", name: "Other" });
    w.concepts.push({ id: "concept-pnl-2", chapterId: "chapter-other", name: "Profit and Loss" });
    await expect(importFirst(w)).rejects.toMatchObject({ name: "PersistenceError", code: "invalid_record" });
  });

  it("the PRIMARY concept is still chapter-scoped: a primary concept only found in another chapter is refused", async () => {
    const w = world({ concepts: [{ id: "concept-percentages", chapterId: "chapter-pnl", name: "Percentages" }, { id: "concept-pnl", chapterId: "chapter-pnl", name: "Profit and Loss" }] });
    await expect(importFirst(w)).rejects.toMatchObject({ code: "missing_reference" });
  });
});
