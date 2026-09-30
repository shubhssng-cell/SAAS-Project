import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCandidateIsImportable } from "@ipmat/question-engine";
import { PersistenceError } from "./errors.js";
import { asJson } from "./json.js";
import type { ImportedQuestionRecord, QuestionImportRepository } from "./types.js";

/**
 * The Candidate -> persisted Question import boundary (docs/DECISIONS.md
 * D-050). `importValidatedCandidate()` performs, inside one `Serializable`
 * transaction (the same discipline `PrismaAttemptRepository`/
 * `PrismaQuestionPublicationRepository` already established for a
 * read-then-write sequence — see D-046/D-049's addendum):
 *
 *  1. `assertCandidateIsImportable()` (fail closed before ANY query).
 *  2. Resolve every referenced natural key (Exam/Section/Chapter/Concept x N
 *     /PatternFamily/ErrorTaxonomy/PatternTaxonomyCell) to a real row —
 *     fail closed with `PersistenceError("missing_reference")` the moment
 *     any name/code doesn't resolve. `PatternTaxonomyCell` is LOOKED UP,
 *     never created — cells are pre-existing Question-Universe mappings
 *     (Phase 2's Examiner Lens step), never invented by an import.
 *  3. Check for an already-imported row at the SAME `(patternTaxonomyCellId,
 *     body)` — the strongest EXISTING identifiers available for "the same
 *     logical candidate" (a real resolved FK plus the exact stem text) —
 *     and return it unchanged (`alreadyExisted: true`) rather than creating
 *     a second row.
 *  4. Otherwise, create a fresh `Provenance` row from caller-supplied
 *     metadata, then create the `Question` row with `validationState:
 *     "ai_validated"` — never `"published"`.
 *
 * Like every other Prisma repository in this codebase, this has never been
 * exercised against a live database (none has ever been reachable in this
 * environment).
 *
 * Why `Serializable` specifically matters for step 3: without it, two
 * concurrent imports of the SAME logical candidate could both run the
 * `(patternTaxonomyCellId, body)` lookup, both see NO existing row (a
 * "phantom" read — nothing to conflict with yet), and both proceed to
 * `create()` a Question — a duplicate, not the idempotent single row this
 * repository claims. Postgres's `Serializable` (true serializable snapshot
 * isolation, not just `REPEATABLE READ`) is specifically documented to
 * detect exactly this "read an absence, then insert a matching row"
 * pattern via predicate/SIREAD locks, aborting one of the two transactions
 * with a serialization-failure error rather than allowing the duplicate —
 * this is the canonical example Postgres's own documentation uses for why
 * `SERIALIZABLE` exists. This has NOT been verified against a live
 * database (see above); it is correct by construction against documented
 * Postgres semantics. There is no `@@unique` constraint on `Question` for
 * `(patternTaxonomyCellId, body)` — this repository's idempotency
 * guarantee is APPLICATION-LEVEL (this transaction's isolation), unlike
 * the "published requires provenance" rule, which also has an independent
 * DB-level `CHECK` constraint backstop. Adding one was considered and
 * deliberately deferred — a schema migration is out of scope for this
 * boundary's initial version.
 */
export class PrismaQuestionImportRepository implements QuestionImportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async importValidatedCandidate(
    input: Parameters<QuestionImportRepository["importValidatedCandidate"]>[0]
  ): Promise<ImportedQuestionRecord> {
    const { blueprint, candidate } = assertCandidateIsImportable(input);
    const dna = candidate.questionDna;

    return this.prisma.$transaction(
      async (tx) => {
        const exam = await tx.exam.findUnique({ where: { code: blueprint.examCode } });
        if (!exam) {
          throw new PersistenceError("missing_reference", `No Exam found with code "${blueprint.examCode}".`);
        }

        const section = await tx.section.findUnique({ where: { examId_name: { examId: exam.id, name: blueprint.sectionName } } });
        if (!section) {
          throw new PersistenceError("missing_reference", `No Section found named "${blueprint.sectionName}" under exam "${blueprint.examCode}".`);
        }

        const chapter = await tx.chapter.findUnique({ where: { sectionId_name: { sectionId: section.id, name: blueprint.chapterName } } });
        if (!chapter) {
          throw new PersistenceError("missing_reference", `No Chapter found named "${blueprint.chapterName}" under section "${blueprint.sectionName}".`);
        }

        const resolveConcept = async (name: string): Promise<string> => {
          const concept = await tx.concept.findUnique({ where: { chapterId_name: { chapterId: chapter.id, name } } });
          if (!concept) {
            throw new PersistenceError("missing_reference", `No Concept found named "${name}" in chapter "${blueprint.chapterName}".`);
          }
          return concept.id;
        };

        // Product Phase 2 Unit 8: the PRIMARY concept must live in the blueprint's own chapter, but the concepts it is
        // related to (subconcepts, prerequisites, combines-with) legitimately belong to OTHER chapters of the same
        // section -- the concept graph places e.g. "Profit and Loss" in its own chapter. Resolving them chapter-scoped
        // made every cross-chapter candidate un-importable (found against a real database; the in-memory double had
        // hidden it by putting every concept in one chapter). They now resolve by name within the exam's section,
        // failing closed if the name matches no concept, or more than one (ambiguity is never guessed at).
        const resolveRelatedConcept = async (name: string): Promise<string> => {
          const matches = await tx.concept.findMany({ where: { name, chapter: { sectionId: section.id } }, select: { id: true } });
          if (matches.length === 0) {
            throw new PersistenceError("missing_reference", `No Concept found named "${name}" in section "${blueprint.sectionName}".`);
          }
          if (matches.length > 1) {
            throw new PersistenceError("invalid_record", `Concept name "${name}" is ambiguous in section "${blueprint.sectionName}" (${matches.length} matches).`);
          }
          return matches[0]!.id;
        };

        const conceptId = await resolveConcept(dna.conceptName);
        const subconceptIds = await Promise.all(dna.subconcepts.map(resolveRelatedConcept));
        const prerequisiteIds = await Promise.all(dna.prerequisites.map(resolveRelatedConcept));
        const combinesWithConceptIds = await Promise.all(dna.combinesWithConcepts.map(resolveRelatedConcept));

        const patternFamily = await tx.questionPatternFamily.findUnique({
          where: { conceptId_name: { conceptId, name: dna.patternFamilyName } }
        });
        if (!patternFamily) {
          throw new PersistenceError(
            "missing_reference",
            `No QuestionPatternFamily found named "${dna.patternFamilyName}" for concept "${dna.conceptName}".`
          );
        }

        let trapErrorTaxonomyId: string | null = null;
        if (dna.trapErrorTaxonomyCode) {
          const trap = await tx.errorTaxonomy.findUnique({ where: { code: dna.trapErrorTaxonomyCode } });
          if (!trap) {
            throw new PersistenceError("missing_reference", `No ErrorTaxonomy found with code "${dna.trapErrorTaxonomyCode}".`);
          }
          trapErrorTaxonomyId = trap.id;
        }

        // Not findUnique(): Prisma's compound-unique input for this constraint
        // requires non-null values for its nullable columns (testingMode,
        // trapErrorTaxonomyId), which cannot express "match a NULL" the way
        // a plain filter can. findFirst() is safe here precisely BECAUSE the
        // real `@@unique([conceptId, patternFamilyId, testingMode,
        // trapErrorTaxonomyId, difficultyTier])` constraint guarantees at
        // most one matching row exists.
        const testingMode = dna.testingModes[0] ?? null;
        const cell = await tx.patternTaxonomyCell.findFirst({
          where: { conceptId, patternFamilyId: patternFamily.id, testingMode, trapErrorTaxonomyId, difficultyTier: dna.difficultyTier }
        });
        if (!cell) {
          throw new PersistenceError(
            "missing_reference",
            `No PatternTaxonomyCell found for concept "${dna.conceptName}", family "${dna.patternFamilyName}", testingMode "${String(testingMode)}", trap "${String(dna.trapErrorTaxonomyCode)}", tier "${dna.difficultyTier}" — Question Universe taxonomy cells must already exist (Phase 2's Examiner Lens step); this importer never creates one.`
          );
        }

        const existing = await tx.question.findFirst({ where: { patternTaxonomyCellId: cell.id, body: candidate.stem } });
        if (existing) {
          return { ...toRecord(existing), alreadyExisted: true };
        }

        const provenance = await tx.provenance.create({
          data: {
            sourceType: input.provenance.sourceType,
            sourceRef: input.provenance.sourceRef ?? null,
            licenseRef: input.provenance.licenseRef ?? null,
            attributedTo: input.provenance.attributedTo ?? null
          }
        });

        const created = await tx.question.create({
          data: {
            examId: exam.id,
            sectionId: section.id,
            chapterId: chapter.id,
            conceptId,
            subconcepts: subconceptIds,
            prerequisites: prerequisiteIds,
            combinesWithConceptIds,
            patternTaxonomyCellId: cell.id,
            skill: dna.skill,
            difficultyTier: dna.difficultyTier,
            difficultyDimensions: asJson(dna.difficultyDimensions),
            noveltyLevel: dna.noveltyLevel,
            examRelevance: dna.examRelevance,
            expectedTimeSeconds: dna.expectedTimeSeconds,
            testingModes: dna.testingModes,
            trapErrorTaxonomyId,
            body: candidate.stem,
            options: asJson(candidate.options ?? []),
            correctAnswer: candidate.correctAnswer,
            solutionSteps: asJson(candidate.solutionSteps),
            groundTruthDerivation: asJson(candidate.groundTruthDerivation),
            validationState: "ai_validated",
            provenanceId: provenance.id
          }
        });

        return { ...toRecord(created), alreadyExisted: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }
}

function toRecord(row: {
  id: string;
  validationState: ImportedQuestionRecord["validationState"];
  difficultyTier: ImportedQuestionRecord["difficultyTier"];
  provenanceId: string | null;
}): Omit<ImportedQuestionRecord, "alreadyExisted"> {
  return {
    id: row.id,
    validationState: row.validationState,
    difficultyTier: row.difficultyTier,
    hasProvenance: row.provenanceId !== null
  };
}
