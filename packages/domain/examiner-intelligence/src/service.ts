import { ExamPackInvalidError, ExamPackNotFoundError, validateExamPack, type ExamPack, type ExamPackRepository } from "@ipmat/exam-pack";
import type { QuestionPatternFamilyData } from "@ipmat/question-engine";
import {
  combinationsObserved,
  difficultyDimensionsObserved,
  noveltyLevelsObserved,
  patternsForConcept,
  recordsForPattern,
  selectRecords,
  sourceSupport,
  summarizeObservedTesting,
  trapsObserved,
  transformationsObserved,
  type RecordFilter
} from "./queries.js";
import { validateHistoricalRecord } from "./validate.js";
import type {
  AnnotationAuthorship,
  HistoricalDnaClassification,
  HistoricalIssue,
  HistoricalQuestionRecord
} from "./types.js";

/** Persistence boundary. Every read is scoped to ONE exam; there is no cross-exam read. */
export interface HistoricalRecordRepository {
  save(record: HistoricalQuestionRecord): Promise<void>;
  findById(examCode: string, id: string): Promise<HistoricalQuestionRecord | null>;
  listByExamCode(examCode: string): Promise<HistoricalQuestionRecord[]>;
}

export class InMemoryHistoricalRecordRepository implements HistoricalRecordRepository {
  private readonly rows = new Map<string, HistoricalQuestionRecord>();

  async save(record: HistoricalQuestionRecord): Promise<void> {
    const existing = this.rows.get(record.id);
    if (existing && existing.examCode !== record.examCode) throw new Error(`record id "${record.id}" already belongs to another exam`);
    this.rows.set(record.id, structuredClone(record));
  }

  async findById(examCode: string, id: string): Promise<HistoricalQuestionRecord | null> {
    const row = this.rows.get(id);
    return row && row.examCode === examCode ? structuredClone(row) : null;
  }

  async listByExamCode(examCode: string): Promise<HistoricalQuestionRecord[]> {
    return [...this.rows.values()].filter((r) => r.examCode === examCode).map((r) => structuredClone(r));
  }
}

export class HistoricalRecordInvalidError extends Error {
  constructor(readonly issues: HistoricalIssue[]) {
    super(`historical record failed validation with ${issues.length} issue(s): ${issues.map((i) => `${i.field}: ${i.message}`).join("; ")}`);
    this.name = "HistoricalRecordInvalidError";
  }
}

export class InvalidAnnotationTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnnotationTransitionError";
  }
}

/**
 * raw_imported -> candidate_annotation. Records a PROPOSED classification
 * (by a person or a model). It never produces `reviewed_validated`, and
 * re-annotating an already-reviewed record drops the old review, because the
 * reviewed classification no longer exists.
 */
export function proposeAnnotation(
  record: HistoricalQuestionRecord,
  proposal: { classification: HistoricalDnaClassification; authorship: AnnotationAuthorship; proposedBy: string | null }
): HistoricalQuestionRecord {
  return {
    ...record,
    annotationState: "candidate_annotation",
    classification: proposal.classification,
    authorship: proposal.authorship,
    proposedBy: proposal.authorship === "ai_assisted" ? proposal.proposedBy : null,
    review: null
  };
}

/**
 * candidate_annotation -> reviewed_validated, only by an explicit review by
 * a named person. The review time is supplied by the caller (no clock here).
 */
export function recordReview(record: HistoricalQuestionRecord, review: { reviewedBy: string; reviewedAt: string }): HistoricalQuestionRecord {
  if (record.annotationState !== "candidate_annotation") {
    throw new InvalidAnnotationTransitionError(`only a candidate_annotation can be reviewed (record is ${record.annotationState}); a raw import has no classification to review`);
  }
  return { ...record, annotationState: "reviewed_validated", review: { ...review } };
}

export interface ExaminerIntelligenceDeps {
  records: HistoricalRecordRepository;
  packs: ExamPackRepository;
  /** The pattern families of one exam (the existing `QuestionPatternFamilyData` vocabulary). */
  patternFamiliesFor: (examCode: string) => readonly QuestionPatternFamilyData[];
  /** `ErrorTaxonomy.code` values - the single shared trap vocabulary. */
  errorTaxonomyCodes: readonly string[];
}

/**
 * Application layer. Writes are validated against the record's OWN exam's
 * pack (fail-closed on an invalid pack); reads are scoped to one exam and
 * default to reviewed, real-source records only. Holds no student state and
 * makes no prediction.
 */
export class ExaminerIntelligenceService {
  constructor(private readonly deps: ExaminerIntelligenceDeps) {}

  private async loadPack(examCode: string): Promise<ExamPack> {
    const pack = await this.deps.packs.findByExamCode(examCode);
    if (!pack) throw new ExamPackNotFoundError(examCode);
    const result = validateExamPack(pack);
    if (!result.valid) throw new ExamPackInvalidError(examCode, result.issues.filter((i) => i.severity === "error"));
    return pack;
  }

  async saveRecord(record: HistoricalQuestionRecord): Promise<void> {
    const pack = await this.loadPack(record.examCode);
    const result = validateHistoricalRecord(record, {
      pack,
      patternFamilies: this.deps.patternFamiliesFor(record.examCode),
      errorTaxonomyCodes: this.deps.errorTaxonomyCodes
    });
    if (!result.valid) throw new HistoricalRecordInvalidError(result.issues);
    await this.deps.records.save(record);
  }

  private async load(examCode: string): Promise<HistoricalQuestionRecord[]> {
    return this.deps.records.listByExamCode(examCode);
  }

  async listRecords(filter: RecordFilter): Promise<HistoricalQuestionRecord[]> {
    return selectRecords(await this.load(filter.examCode), filter);
  }
  async patternsForConcept(filter: RecordFilter, conceptName: string) {
    return patternsForConcept(await this.load(filter.examCode), filter, conceptName);
  }
  async combinationsObserved(filter: RecordFilter, conceptName?: string) {
    return combinationsObserved(await this.load(filter.examCode), filter, conceptName);
  }
  async transformationsObserved(filter: RecordFilter, conceptName?: string) {
    return transformationsObserved(await this.load(filter.examCode), filter, conceptName);
  }
  async noveltyLevelsObserved(filter: RecordFilter, conceptName?: string) {
    return noveltyLevelsObserved(await this.load(filter.examCode), filter, conceptName);
  }
  async trapsObserved(filter: RecordFilter, conceptName?: string) {
    return trapsObserved(await this.load(filter.examCode), filter, conceptName);
  }
  async difficultyDimensionsObserved(filter: RecordFilter, conceptName?: string) {
    return difficultyDimensionsObserved(await this.load(filter.examCode), filter, conceptName);
  }
  async recordsForPattern(filter: RecordFilter, patternFamilyName: string, conceptName?: string) {
    return recordsForPattern(await this.load(filter.examCode), filter, patternFamilyName, conceptName);
  }
  async sourceSupport(examCode: string, recordId: string) {
    return sourceSupport(await this.load(examCode), examCode, recordId);
  }
  async summarize(filter: RecordFilter) {
    return summarizeObservedTesting(await this.load(filter.examCode), filter);
  }
}
