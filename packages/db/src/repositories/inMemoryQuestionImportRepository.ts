import { randomUUID } from "node:crypto";
import { assertCandidateIsImportable, type DifficultyTier, type TestingMode } from "@ipmat/question-engine";
import { PersistenceError } from "./errors.js";
import type { ImportedQuestionRecord, QuestionImportRepository } from "./types.js";

/**
 * The in-memory "reference world" a test seeds `InMemoryQuestionImportRepository`
 * with — the SAME natural-key entities `PrismaQuestionImportRepository`
 * resolves against real tables (Exam/Section/Chapter/Concept/
 * PatternFamily/ErrorTaxonomy/PatternTaxonomyCell), as plain arrays instead
 * of Prisma queries. Mirrors the `FixtureProvider`/`InMemoryAttemptRepository`
 * precedent: a real, exported part of `@ipmat/db`'s production `src/`, not a
 * `test/` fixture.
 */
export interface InMemoryQuestionImportWorld {
  exams: Array<{ id: string; code: string }>;
  sections: Array<{ id: string; examId: string; name: string }>;
  chapters: Array<{ id: string; sectionId: string; name: string }>;
  concepts: Array<{ id: string; chapterId: string; name: string }>;
  patternFamilies: Array<{ id: string; conceptId: string; name: string }>;
  errorTaxonomies: Array<{ id: string; code: string }>;
  taxonomyCells: Array<{
    id: string;
    conceptId: string;
    patternFamilyId: string;
    testingMode: TestingMode | null;
    trapErrorTaxonomyId: string | null;
    difficultyTier: DifficultyTier;
  }>;
}

interface StoredImportedQuestion {
  id: string;
  patternTaxonomyCellId: string;
  body: string;
  validationState: ImportedQuestionRecord["validationState"];
  difficultyTier: DifficultyTier;
  hasProvenance: boolean;
}

export class InMemoryQuestionImportRepository implements QuestionImportRepository {
  private readonly questions: StoredImportedQuestion[] = [];

  constructor(private readonly world: InMemoryQuestionImportWorld) {}

  async importValidatedCandidate(
    input: Parameters<QuestionImportRepository["importValidatedCandidate"]>[0]
  ): Promise<ImportedQuestionRecord> {
    const { blueprint, candidate } = assertCandidateIsImportable(input);
    const dna = candidate.questionDna;

    const exam = this.world.exams.find((e) => e.code === blueprint.examCode);
    if (!exam) {
      throw new PersistenceError("missing_reference", `No Exam found with code "${blueprint.examCode}".`);
    }

    const section = this.world.sections.find((s) => s.examId === exam.id && s.name === blueprint.sectionName);
    if (!section) {
      throw new PersistenceError("missing_reference", `No Section found named "${blueprint.sectionName}" under exam "${blueprint.examCode}".`);
    }

    const chapter = this.world.chapters.find((c) => c.sectionId === section.id && c.name === blueprint.chapterName);
    if (!chapter) {
      throw new PersistenceError("missing_reference", `No Chapter found named "${blueprint.chapterName}" under section "${blueprint.sectionName}".`);
    }

    const resolveConcept = (name: string): string => {
      const concept = this.world.concepts.find((c) => c.chapterId === chapter.id && c.name === name);
      if (!concept) {
        throw new PersistenceError("missing_reference", `No Concept found named "${name}" in chapter "${blueprint.chapterName}".`);
      }
      return concept.id;
    };

    const conceptId = resolveConcept(dna.conceptName);
    dna.subconcepts.forEach(resolveConcept);
    dna.prerequisites.forEach(resolveConcept);
    dna.combinesWithConcepts.forEach(resolveConcept);

    const patternFamily = this.world.patternFamilies.find((f) => f.conceptId === conceptId && f.name === dna.patternFamilyName);
    if (!patternFamily) {
      throw new PersistenceError("missing_reference", `No QuestionPatternFamily found named "${dna.patternFamilyName}" for concept "${dna.conceptName}".`);
    }

    let trapErrorTaxonomyId: string | null = null;
    if (dna.trapErrorTaxonomyCode) {
      const trap = this.world.errorTaxonomies.find((t) => t.code === dna.trapErrorTaxonomyCode);
      if (!trap) {
        throw new PersistenceError("missing_reference", `No ErrorTaxonomy found with code "${dna.trapErrorTaxonomyCode}".`);
      }
      trapErrorTaxonomyId = trap.id;
    }

    const testingMode = dna.testingModes[0] ?? null;
    const cell = this.world.taxonomyCells.find(
      (c) =>
        c.conceptId === conceptId &&
        c.patternFamilyId === patternFamily.id &&
        c.testingMode === testingMode &&
        c.trapErrorTaxonomyId === trapErrorTaxonomyId &&
        c.difficultyTier === dna.difficultyTier
    );
    if (!cell) {
      throw new PersistenceError(
        "missing_reference",
        `No PatternTaxonomyCell found for concept "${dna.conceptName}", family "${dna.patternFamilyName}", testingMode "${String(testingMode)}", trap "${String(dna.trapErrorTaxonomyCode)}", tier "${dna.difficultyTier}".`
      );
    }

    const existing = this.questions.find((q) => q.patternTaxonomyCellId === cell.id && q.body === candidate.stem);
    if (existing) {
      return { id: existing.id, validationState: existing.validationState, difficultyTier: existing.difficultyTier, hasProvenance: existing.hasProvenance, alreadyExisted: true };
    }

    const stored: StoredImportedQuestion = {
      id: randomUUID(),
      patternTaxonomyCellId: cell.id,
      body: candidate.stem,
      validationState: "ai_validated",
      difficultyTier: dna.difficultyTier,
      hasProvenance: true // a Provenance row is always created for a fresh import (see PrismaQuestionImportRepository)
    };
    this.questions.push(stored);

    return { id: stored.id, validationState: stored.validationState, difficultyTier: stored.difficultyTier, hasProvenance: stored.hasProvenance, alreadyExisted: false };
  }
}
