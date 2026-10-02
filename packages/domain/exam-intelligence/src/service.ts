import { buildCalibrationReport, type CalibrationRecord, type CalibrationReport, type QuestionOutcome } from "./calibration.js";
import { computeCoverage, type ExamCoverageReport } from "./coverage.js";
import { ExamIntelligenceQueries } from "./queries.js";
import { selectQuestions, type QuestionSelectionConstraints, type SelectionResult } from "./selection.js";
import { ExamIntelligenceError, type ExamIntelligenceSnapshot } from "./types.js";
import type { AssessmentOptions } from "./quality.js";

/** Assembles the snapshot of ONE exam (database or in-memory). It must return that exam's data only. */
export interface ExamIntelligenceSource {
  loadSnapshot(examCode: string): Promise<ExamIntelligenceSnapshot>;
}

/** Aggregation-ready graded outcomes of one exam's questions. Opaque student keys; never identities. */
export interface OutcomeSource {
  loadOutcomes(examCode: string): Promise<QuestionOutcome[]>;
}

export class InMemoryExamIntelligenceSource implements ExamIntelligenceSource, OutcomeSource {
  constructor(private readonly snapshots: readonly ExamIntelligenceSnapshot[], private readonly outcomes: readonly (QuestionOutcome & { examCode: string })[] = []) {}
  async loadSnapshot(examCode: string): Promise<ExamIntelligenceSnapshot> {
    const found = this.snapshots.find((s) => s.examCode === examCode);
    if (!found) throw new ExamIntelligenceError("exam_mismatch", `no exam intelligence for "${examCode}"`);
    return found;
  }
  async loadOutcomes(examCode: string): Promise<QuestionOutcome[]> {
    return this.outcomes.filter((o) => o.examCode === examCode).map((o) => ({ questionId: o.questionId, studentKey: o.studentKey, timeSpentSeconds: o.timeSpentSeconds, isCorrect: o.isCorrect }));
  }
}

/**
 * Application layer. Every call loads ONE exam's snapshot and re-verifies that
 * it really is that exam (a source that returns another exam's data is an
 * error, never silently served). It composes the pure functions; it holds no
 * state, reads no student, and makes no prediction.
 */
export class ExamIntelligenceService {
  constructor(private readonly source: ExamIntelligenceSource, private readonly outcomes?: OutcomeSource) {}

  async snapshot(examCode: string): Promise<ExamIntelligenceSnapshot> {
    const s = await this.source.loadSnapshot(examCode);
    if (s.examCode !== examCode || s.pack.examCode !== examCode) throw new ExamIntelligenceError("exam_mismatch", `the source returned "${s.examCode}" for "${examCode}"`);
    return s;
  }

  async queries(examCode: string, options: AssessmentOptions = {}): Promise<ExamIntelligenceQueries> {
    return new ExamIntelligenceQueries(await this.snapshot(examCode), options);
  }

  async coverage(examCode: string, options: AssessmentOptions = {}): Promise<ExamCoverageReport> {
    return computeCoverage(await this.snapshot(examCode), options);
  }

  async select(examCode: string, constraints: QuestionSelectionConstraints = {}, options: AssessmentOptions = {}): Promise<SelectionResult> {
    return selectQuestions(await this.snapshot(examCode), constraints, options);
  }

  async calibration(examCode: string, records: readonly CalibrationRecord[] = []): Promise<CalibrationReport> {
    const outcomes = this.outcomes ? await this.outcomes.loadOutcomes(examCode) : [];
    return buildCalibrationReport(await this.snapshot(examCode), outcomes, records);
  }
}
