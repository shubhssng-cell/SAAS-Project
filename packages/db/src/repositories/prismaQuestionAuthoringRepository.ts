import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import {
  computeContentFingerprint,
  type AuthoredQuestion,
  type AuthoringOrigin,
  type IdentityRef,
  type QuestionAuthoringRepository,
  type QuestionInstanceDna,
  type UniverseQuestionRef
} from "@ipmat/content-authoring";
import type { DifficultyDimensions } from "@ipmat/examiner-lens";
import { PersistenceError } from "./errors.js";
import { asJson } from "./json.js";

/**
 * The ONE concrete, database-backed `QuestionAuthoringRepository`
 * (docs/DECISIONS.md D-084). INTERNAL: it returns answer-bearing questions and
 * reviewer data, and nothing student-facing may use it - the student readers
 * (`PrismaQuestionContentReader`, `PrismaTrainingQuestionReader`) remain
 * separate, `select`-based and published-only, and never select the new review
 * columns.
 *
 * Identity: a question's id is assigned once and never changes. An exact
 * logical duplicate (same exam, same normalized wording + options) is returned
 * as the EXISTING question, never created twice - enforced by the partial
 * unique index `questions_exam_content_fingerprint_unique` (migration 0014) as
 * well as by this repository's lookup, inside a Serializable transaction.
 * Merely similar questions are never merged.
 *
 * Every write resolves names to rows INSIDE the question's own exam (a name
 * that exists only in another exam is `missing_reference`), reusing the same
 * natural-key resolution the candidate importer uses (`PatternTaxonomyCell` is
 * looked up, never created).
 */
export class PrismaQuestionAuthoringRepository implements QuestionAuthoringRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createDraft(question: AuthoredQuestion): Promise<{ id: string; alreadyExisted: boolean }> {
    if (question.validationState !== "draft") throw new PersistenceError("invalid_record", "only a draft can be created");
    if (question.origin === "unknown") throw new PersistenceError("invalid_record", "a new question must state its origin (human_authored or ai_generated)");
    return this.prisma.$transaction(
      async (tx) => {
        const resolved = await resolve(tx, question);
        const fingerprint = computeContentFingerprint(question.dna.examCode, question.content.body, question.content.options);
        const existing = await tx.question.findFirst({
          where: { examId: resolved.examId, validationState: { not: "rejected" }, OR: [{ contentFingerprint: fingerprint }, { patternTaxonomyCellId: resolved.cellId, body: question.content.body }] },
          select: { id: true }
        });
        if (existing) return { id: existing.id, alreadyExisted: true };
        if (await tx.question.findUnique({ where: { id: question.id }, select: { id: true } })) throw new PersistenceError("conflict", `question id "${question.id}" already exists`);
        const provenance = await tx.provenance.create({ data: provenanceData(question) });
        await tx.question.create({ data: { id: question.id, ...questionData(question, resolved, fingerprint), provenanceId: provenance.id } });
        return { id: question.id, alreadyExisted: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async findById(id: string): Promise<AuthoredQuestion | null> {
    const row = await this.prisma.question.findUnique({ where: { id }, include: ROW_INCLUDE });
    return row ? this.toAuthored(this.prisma, row) : null;
  }

  async mutate(id: string, fn: (current: AuthoredQuestion) => AuthoredQuestion): Promise<AuthoredQuestion> {
    return this.mapUniqueViolation(() => this.prisma.$transaction(
      async (tx) => {
        const row = await tx.question.findUnique({ where: { id }, include: ROW_INCLUDE });
        if (!row) throw new PersistenceError("missing_reference", `no question "${id}"`);
        const current = await this.toAuthored(tx, row);
        const next = fn(structuredClone(current));
        if (next.id !== current.id) throw new PersistenceError("invalid_record", "a question's id never changes");
        if (next.dna.examCode !== current.dna.examCode) throw new PersistenceError("ownership_mismatch", "a question never moves between exams");
        if (current.validationState === "published" && JSON.stringify(next.content) !== JSON.stringify(current.content)) throw new PersistenceError("invalid_record", "a published question's content is immutable");
        if (next.origin === "unknown" && current.origin !== "unknown") throw new PersistenceError("invalid_record", "origin cannot be erased");
        const resolved = await resolve(tx, next);
        const fingerprint = computeContentFingerprint(next.dna.examCode, next.content.body, next.content.options);
        const stored = current.origin === "unknown" ? null : fingerprint;
        let provenanceId = row.provenanceId;
        if (provenanceId) await tx.provenance.update({ where: { id: provenanceId }, data: provenanceData(next) });
        else provenanceId = (await tx.provenance.create({ data: provenanceData(next) })).id;
        await tx.question.update({ where: { id }, data: { ...questionData(next, resolved, stored), provenanceId } });
        return next;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    ));
  }

  /** The partial unique index is the database backstop for "one logical question, one identity". */
  private async mapUniqueViolation<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new PersistenceError("conflict", "this content is identical to another question of the same exam (one logical question, one identity)");
      }
      throw error;
    }
  }

  async listIdentityRefs(examCode: string): Promise<IdentityRef[]> {
    const rows = await this.prisma.question.findMany({ where: { exam: { code: examCode } }, orderBy: { id: "asc" }, select: { id: true, body: true, options: true, validationState: true } });
    return rows.map((r) => ({ id: r.id, body: r.body, validationState: r.validationState, fingerprint: computeContentFingerprint(examCode, r.body, toStrings(r.options)) }));
  }

  async listUniverseRefs(examCode: string): Promise<UniverseQuestionRef[]> {
    const rows = await this.prisma.question.findMany({ where: { exam: { code: examCode } }, orderBy: { id: "asc" }, include: ROW_INCLUDE });
    const names = await conceptNames(this.prisma, rows);
    return rows.map((r) => ({ id: r.id, dna: toDna(r, names), validationState: r.validationState }));
  }

  private async toAuthored(db: Pick<PrismaClient, "concept">, row: Row): Promise<AuthoredQuestion> {
    const names = await conceptNames(db, [row]);
    const options = toStrings(row.options);
    const derivation = row.groundTruthDerivation as { computation?: unknown; expectedAnswer?: unknown } | null;
    return {
      id: row.id,
      dna: toDna(row, names),
      content: {
        body: row.body,
        answerFormat: options.length > 0 ? "multiple_choice" : "numeric_entry",
        options,
        correctAnswer: row.correctAnswer,
        solutionSteps: toStrings(row.solutionSteps),
        groundTruthDerivation: derivation && typeof derivation.computation === "string" && typeof derivation.expectedAnswer === "number" ? { computation: derivation.computation, expectedAnswer: derivation.expectedAnswer } : null
      },
      source: row.provenance
        ? { sourceType: row.provenance.sourceType, sourceRef: row.provenance.sourceRef, licenseRef: row.provenance.licenseRef, attributedTo: row.provenance.attributedTo }
        : { sourceType: "original", sourceRef: null, licenseRef: null, attributedTo: null },
      origin: (row.authoringOrigin ?? "unknown") as AuthoringOrigin,
      validationState: row.validationState,
      review: row.reviewedBy && row.reviewedAt ? { reviewedBy: row.reviewedBy, reviewedAt: row.reviewedAt.toISOString(), notes: row.reviewNotes, answerVerifiedByReviewer: row.answerVerifiedByReviewer === true, reviewedAsDistinct: row.reviewedAsDistinct === true } : null,
      independentReverification: row.independentReverificationAnswer !== null ? { derivedAnswer: row.independentReverificationAnswer } : null
    };
  }
}

const ROW_INCLUDE = {
  exam: { select: { code: true } },
  section: { select: { name: true } },
  chapter: { select: { name: true } },
  concept: { select: { name: true } },
  patternTaxonomyCell: { select: { patternFamily: { select: { name: true } } } },
  trapErrorTaxonomy: { select: { code: true } },
  provenance: true
} satisfies Prisma.QuestionInclude;
type Row = Prisma.QuestionGetPayload<{ include: typeof ROW_INCLUDE }>;

const toStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

async function conceptNames(db: Pick<PrismaClient, "concept">, rows: Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => [...r.subconcepts, ...r.prerequisites, ...r.combinesWithConceptIds]))];
  if (ids.length === 0) return new Map();
  return new Map((await db.concept.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
}

function toDna(row: Row, names: Map<string, string>): QuestionInstanceDna {
  const nameOf = (id: string): string => {
    const n = names.get(id);
    if (!n) throw new PersistenceError("invalid_record", `dangling concept reference "${id}"`);
    return n;
  };
  return {
    examCode: row.exam.code,
    sectionName: row.section.name,
    chapterName: row.chapter.name,
    conceptName: row.concept.name,
    subconcepts: row.subconcepts.map(nameOf),
    prerequisites: row.prerequisites.map(nameOf),
    combinesWithConcepts: row.combinesWithConceptIds.map(nameOf),
    patternFamilyName: row.patternTaxonomyCell.patternFamily.name,
    skill: row.skill,
    difficultyTier: row.difficultyTier,
    difficultyDimensions: row.difficultyDimensions as unknown as DifficultyDimensions,
    noveltyLevel: row.noveltyLevel,
    examRelevance: row.examRelevance,
    expectedTimeSeconds: row.expectedTimeSeconds,
    testingModes: row.testingModes,
    trapErrorTaxonomyCode: row.trapErrorTaxonomy?.code ?? null
  };
}

interface Resolved {
  examId: string;
  sectionId: string;
  chapterId: string;
  conceptId: string;
  subconceptIds: string[];
  prerequisiteIds: string[];
  combinesWithConceptIds: string[];
  cellId: string;
  trapId: string | null;
}

/** Resolves every natural key of a question's DNA to a row, inside the question's OWN exam. Mirrors the importer's rules. */
async function resolve(tx: Prisma.TransactionClient, q: AuthoredQuestion): Promise<Resolved> {
  const dna = q.dna;
  const norm = normalizeConceptNameKey;
  const exam = await tx.exam.findUnique({ where: { code: dna.examCode }, select: { id: true } });
  if (!exam) throw new PersistenceError("missing_reference", `No Exam found with code "${dna.examCode}".`);
  const sections = await tx.section.findMany({ where: { examId: exam.id }, select: { id: true, name: true } });
  const section = sections.find((s) => norm(s.name) === norm(dna.sectionName));
  if (!section) throw new PersistenceError("missing_reference", `No Section "${dna.sectionName}" under exam "${dna.examCode}".`);
  const chapters = await tx.chapter.findMany({ where: { sectionId: section.id }, select: { id: true, name: true, concepts: { select: { id: true, name: true } } } });
  const chapter = chapters.find((c) => norm(c.name) === norm(dna.chapterName));
  if (!chapter) throw new PersistenceError("missing_reference", `No Chapter "${dna.chapterName}" under section "${dna.sectionName}".`);
  const primary = chapter.concepts.find((c) => norm(c.name) === norm(dna.conceptName));
  if (!primary) throw new PersistenceError("missing_reference", `No Concept "${dna.conceptName}" in chapter "${dna.chapterName}".`);
  const related = (name: string): string => {
    const matches = chapters.flatMap((c) => c.concepts).filter((c) => norm(c.name) === norm(name));
    if (matches.length === 0) throw new PersistenceError("missing_reference", `No Concept "${name}" in section "${dna.sectionName}".`);
    if (matches.length > 1) throw new PersistenceError("invalid_record", `Concept name "${name}" is ambiguous in section "${dna.sectionName}".`);
    return matches[0]!.id;
  };
  const family = await tx.questionPatternFamily.findUnique({ where: { conceptId_name: { conceptId: primary.id, name: dna.patternFamilyName } }, select: { id: true } });
  if (!family) throw new PersistenceError("missing_reference", `No QuestionPatternFamily "${dna.patternFamilyName}" for concept "${dna.conceptName}".`);
  let trapId: string | null = null;
  if (dna.trapErrorTaxonomyCode !== null) {
    const trap = await tx.errorTaxonomy.findUnique({ where: { code: dna.trapErrorTaxonomyCode }, select: { id: true } });
    if (!trap) throw new PersistenceError("missing_reference", `No ErrorTaxonomy with code "${dna.trapErrorTaxonomyCode}".`);
    trapId = trap.id;
  }
  const testingMode = dna.testingModes[0] ?? null;
  const cell = await tx.patternTaxonomyCell.findFirst({ where: { conceptId: primary.id, patternFamilyId: family.id, testingMode, trapErrorTaxonomyId: trapId, difficultyTier: dna.difficultyTier }, select: { id: true } });
  if (!cell) throw new PersistenceError("missing_reference", `No PatternTaxonomyCell for concept "${dna.conceptName}", family "${dna.patternFamilyName}", mode "${String(testingMode)}", trap "${String(dna.trapErrorTaxonomyCode)}", tier "${dna.difficultyTier}" - taxonomy cells must already exist; authoring never creates one.`);
  return { examId: exam.id, sectionId: section.id, chapterId: chapter.id, conceptId: primary.id, subconceptIds: dna.subconcepts.map(related), prerequisiteIds: dna.prerequisites.map(related), combinesWithConceptIds: dna.combinesWithConcepts.map(related), cellId: cell.id, trapId };
}

const provenanceData = (q: AuthoredQuestion) => ({ sourceType: q.source.sourceType, sourceRef: q.source.sourceRef, licenseRef: q.source.licenseRef, attributedTo: q.source.attributedTo });

function questionData(q: AuthoredQuestion, r: Resolved, fingerprint: string | null) {
  return {
    examId: r.examId,
    sectionId: r.sectionId,
    chapterId: r.chapterId,
    conceptId: r.conceptId,
    subconcepts: r.subconceptIds,
    prerequisites: r.prerequisiteIds,
    combinesWithConceptIds: r.combinesWithConceptIds,
    patternTaxonomyCellId: r.cellId,
    skill: q.dna.skill,
    difficultyTier: q.dna.difficultyTier,
    difficultyDimensions: asJson(q.dna.difficultyDimensions),
    noveltyLevel: q.dna.noveltyLevel,
    examRelevance: q.dna.examRelevance,
    expectedTimeSeconds: q.dna.expectedTimeSeconds,
    testingModes: q.dna.testingModes,
    trapErrorTaxonomyId: r.trapId,
    body: q.content.body,
    options: asJson(q.content.options),
    correctAnswer: q.content.correctAnswer,
    solutionSteps: asJson(q.content.solutionSteps),
    groundTruthDerivation: asJson(q.content.groundTruthDerivation ?? {}),
    validationState: q.validationState,
    authoringOrigin: q.origin === "unknown" ? null : q.origin,
    contentFingerprint: fingerprint,
    reviewedBy: q.review?.reviewedBy ?? null,
    reviewedAt: q.review ? new Date(q.review.reviewedAt) : null,
    reviewNotes: q.review?.notes ?? null,
    answerVerifiedByReviewer: q.review ? q.review.answerVerifiedByReviewer : null,
    reviewedAsDistinct: q.review ? q.review.reviewedAsDistinct : null,
    independentReverificationAnswer: q.independentReverification?.derivedAnswer ?? null
  };
}
