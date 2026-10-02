import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import type { HistoricalQuestionRecord, HistoricalRecordRepository } from "@ipmat/examiner-intelligence";
import type { DifficultyDimensions } from "@ipmat/examiner-lens";
import { PersistenceError } from "./errors.js";

/**
 * The ONE concrete, database-backed `HistoricalRecordRepository`
 * (docs/DECISIONS.md D-083). The domain record speaks in names (the same
 * convention as `QuestionDnaData`); this adapter resolves them to ids INSIDE
 * THE RECORD'S OWN EXAM and back.
 *
 * Cross-exam isolation, in layers: the exam is resolved from `examCode`; every
 * concept/section/chapter/pattern family is looked up only within that exam's
 * own structure (a name that exists only in another exam is `missing_reference`);
 * every read is filtered by `exam.code`; and an id that already belongs to
 * another exam cannot be overwritten (`ownership_mismatch`). The CHECK
 * constraints of migration 0013 independently guard state/origin/review rules.
 *
 * The row has no question content columns, so none can be read or written.
 */
export class PrismaHistoricalRecordRepository implements HistoricalRecordRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async loadExamStructure(examCode: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { code: examCode },
      select: {
        id: true,
        sections: {
          select: { id: true, name: true, chapters: { select: { id: true, name: true, concepts: { select: { id: true, name: true, patternFamilies: { select: { id: true, name: true } } } } } } }
        }
      }
    });
    if (!exam) throw new PersistenceError("missing_reference", `no exam with code "${examCode}"`);
    return exam;
  }

  async save(record: HistoricalQuestionRecord): Promise<void> {
    const exam = await this.loadExamStructure(record.examCode);
    const existing = await this.prisma.historicalQuestionRecord.findUnique({ where: { id: record.id }, select: { examId: true } });
    if (existing && existing.examId !== exam.id) throw new PersistenceError("ownership_mismatch", `record "${record.id}" belongs to a different exam`);

    const norm = normalizeConceptNameKey;
    const dna = record.classification;
    let classification: Partial<Prisma.HistoricalQuestionRecordUncheckedCreateInput> = {
      sectionId: null,
      chapterId: null,
      conceptId: null,
      patternFamilyId: null,
      subconceptIds: [],
      prerequisiteIds: [],
      combinesWithConceptIds: [],
      skill: null,
      difficultyTier: null,
      difficultyDimensions: Prisma.DbNull,
      noveltyLevel: null,
      expectedTimeSeconds: null,
      testingModes: [],
      trapErrorTaxonomyId: null
    };
    if (dna) {
      const section = exam.sections.find((s) => norm(s.name) === norm(dna.sectionName));
      const chapter = section?.chapters.find((c) => norm(c.name) === norm(dna.chapterName));
      const allConcepts = exam.sections.flatMap((s) => s.chapters.flatMap((c) => c.concepts));
      const conceptId = (name: string): string => {
        const found = allConcepts.find((c) => norm(c.name) === norm(name));
        if (!found) throw new PersistenceError("missing_reference", `concept "${name}" is not in exam "${record.examCode}"`);
        return found.id;
      };
      if (!section) throw new PersistenceError("missing_reference", `section "${dna.sectionName}" is not in exam "${record.examCode}"`);
      if (!chapter) throw new PersistenceError("missing_reference", `chapter "${dna.chapterName}" is not in section "${dna.sectionName}"`);
      const primary = allConcepts.find((c) => norm(c.name) === norm(dna.conceptName));
      if (!primary) throw new PersistenceError("missing_reference", `concept "${dna.conceptName}" is not in exam "${record.examCode}"`);
      const family = primary.patternFamilies.find((f) => norm(f.name) === norm(dna.patternFamilyName));
      if (!family) throw new PersistenceError("missing_reference", `pattern family "${dna.patternFamilyName}" does not exist for concept "${dna.conceptName}"`);
      let trapId: string | null = null;
      if (dna.trapErrorTaxonomyCode !== null) {
        const trap = await this.prisma.errorTaxonomy.findUnique({ where: { code: dna.trapErrorTaxonomyCode }, select: { id: true } });
        if (!trap) throw new PersistenceError("missing_reference", `error taxonomy code "${dna.trapErrorTaxonomyCode}" does not exist`);
        trapId = trap.id;
      }
      classification = {
        sectionId: section.id,
        chapterId: chapter.id,
        conceptId: primary.id,
        patternFamilyId: family.id,
        subconceptIds: dna.subconcepts.map(conceptId),
        prerequisiteIds: dna.prerequisites.map(conceptId),
        combinesWithConceptIds: dna.combinesWithConcepts.map(conceptId),
        skill: dna.skill,
        difficultyTier: dna.difficultyTier,
        difficultyDimensions: dna.difficultyDimensions as unknown as Prisma.InputJsonValue,
        noveltyLevel: dna.noveltyLevel,
        expectedTimeSeconds: dna.expectedTimeSeconds,
        testingModes: dna.testingModes,
        trapErrorTaxonomyId: trapId
      };
    }

    const data = {
      examId: exam.id,
      examVersion: record.locator.examVersion,
      examYear: record.locator.year,
      examSession: record.locator.session,
      questionLabel: record.locator.questionLabel,
      sourceType: record.source.sourceType,
      sourceRef: record.source.sourceRef,
      licenseRef: record.source.licenseRef,
      attributedTo: record.source.attributedTo,
      dataOrigin: record.dataOrigin,
      fixtureLabel: record.fixtureLabel,
      annotationState: record.annotationState,
      authorship: record.authorship,
      proposedBy: record.proposedBy,
      reviewedBy: record.review?.reviewedBy ?? null,
      reviewedAt: record.review ? new Date(record.review.reviewedAt) : null,
      editorialRelevance: record.editorialRelevance?.label ?? null,
      editorialRationale: record.editorialRelevance?.rationale ?? null,
      editorialAnnotatedBy: record.editorialRelevance?.annotatedBy ?? null,
      ...classification
    } as Prisma.HistoricalQuestionRecordUncheckedCreateInput;
    await this.prisma.historicalQuestionRecord.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data },
      update: data
    });
  }

  async findById(examCode: string, id: string): Promise<HistoricalQuestionRecord | null> {
    const rows = await this.read({ id, exam: { code: examCode } });
    return rows[0] ?? null;
  }

  async listByExamCode(examCode: string): Promise<HistoricalQuestionRecord[]> {
    return this.read({ exam: { code: examCode } });
  }

  private async read(where: Prisma.HistoricalQuestionRecordWhereInput): Promise<HistoricalQuestionRecord[]> {
    const rows = await this.prisma.historicalQuestionRecord.findMany({
      where,
      orderBy: { id: "asc" },
      include: {
        exam: { select: { code: true } },
        section: { select: { name: true } },
        chapter: { select: { name: true } },
        concept: { select: { name: true } },
        patternFamily: { select: { name: true } },
        trapErrorTaxonomy: { select: { code: true } }
      }
    });
    const ids = [...new Set(rows.flatMap((r) => [...r.subconceptIds, ...r.prerequisiteIds, ...r.combinesWithConceptIds]))];
    const names = new Map((ids.length === 0 ? [] : await this.prisma.concept.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const nameOf = (id: string): string => {
      const n = names.get(id);
      if (!n) throw new PersistenceError("invalid_record", `dangling concept reference "${id}"`);
      return n;
    };
    return rows.map((r): HistoricalQuestionRecord => ({
      id: r.id,
      examCode: r.exam.code,
      locator: { examVersion: r.examVersion, year: r.examYear, session: r.examSession, questionLabel: r.questionLabel },
      source: { sourceType: r.sourceType, sourceRef: r.sourceRef, licenseRef: r.licenseRef, attributedTo: r.attributedTo },
      dataOrigin: r.dataOrigin,
      fixtureLabel: r.fixtureLabel,
      annotationState: r.annotationState,
      authorship: r.authorship,
      proposedBy: r.proposedBy,
      review: r.reviewedBy && r.reviewedAt ? { reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt.toISOString() } : null,
      editorialRelevance:
        r.editorialRelevance && r.editorialRationale && r.editorialAnnotatedBy
          ? { label: r.editorialRelevance, rationale: r.editorialRationale, annotatedBy: r.editorialAnnotatedBy }
          : null,
      classification:
        r.concept && r.section && r.chapter && r.patternFamily && r.skill !== null && r.difficultyTier && r.difficultyDimensions && r.noveltyLevel && r.expectedTimeSeconds !== null
          ? {
              examCode: r.exam.code,
              sectionName: r.section.name,
              chapterName: r.chapter.name,
              conceptName: r.concept.name,
              subconcepts: r.subconceptIds.map(nameOf),
              prerequisites: r.prerequisiteIds.map(nameOf),
              combinesWithConcepts: r.combinesWithConceptIds.map(nameOf),
              patternFamilyName: r.patternFamily.name,
              skill: r.skill,
              difficultyTier: r.difficultyTier,
              difficultyDimensions: r.difficultyDimensions as unknown as DifficultyDimensions,
              noveltyLevel: r.noveltyLevel,
              expectedTimeSeconds: r.expectedTimeSeconds,
              testingModes: r.testingModes,
              trapErrorTaxonomyCode: r.trapErrorTaxonomy?.code ?? null
            }
          : null
    }));
  }
}
