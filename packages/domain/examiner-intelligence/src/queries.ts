import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import type { DifficultyTier, NoveltyLevel, TestingMode } from "@ipmat/question-engine";
import { DIFFICULTY_DIMENSION_KEYS } from "./validate.js";
import type { HistoricalAnnotationState, HistoricalDataOrigin, HistoricalDnaClassification, HistoricalQuestionRecord } from "./types.js";

/**
 * Pure, deterministic queries over historical records. Every result is
 * sorted by an explicit rule (never input order). Every answer describes
 * what has been OBSERVED in the records given - none estimates likelihood,
 * importance or what will appear in a future paper.
 *
 * Defaults are conservative: only `reviewed_validated` records from
 * `real_source` data are counted. Raw imports, unreviewed (possibly
 * AI-proposed) candidates and test fixtures are excluded unless a caller
 * opts in explicitly, so unvalidated content can never silently become
 * "intelligence".
 */

export interface RecordFilter {
  /** Required: queries never span exams. */
  examCode: string;
  states?: readonly HistoricalAnnotationState[];
  origins?: readonly HistoricalDataOrigin[];
}

export const DEFAULT_STATES: readonly HistoricalAnnotationState[] = ["reviewed_validated"];
export const DEFAULT_ORIGINS: readonly HistoricalDataOrigin[] = ["real_source"];

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const norm = normalizeConceptNameKey;

/** A record that passed the filter AND has a classification (the only kind that carries DNA facets). */
export interface ClassifiedRecord extends HistoricalQuestionRecord {
  classification: HistoricalDnaClassification;
}

export function selectRecords(records: readonly HistoricalQuestionRecord[], filter: RecordFilter): HistoricalQuestionRecord[] {
  const states = filter.states ?? DEFAULT_STATES;
  const origins = filter.origins ?? DEFAULT_ORIGINS;
  return records
    .filter((r) => r.examCode === filter.examCode && states.includes(r.annotationState) && origins.includes(r.dataOrigin))
    .sort((a, b) => cmp(a.id, b.id));
}

export function selectClassified(records: readonly HistoricalQuestionRecord[], filter: RecordFilter): ClassifiedRecord[] {
  return selectRecords(records, filter).filter((r): r is ClassifiedRecord => r.classification !== null);
}

export interface Counted<T> {
  value: T;
  count: number;
}

function tally<T extends string>(values: readonly T[]): Array<Counted<T>> {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => cmp(a.value, b.value));
}

const forConcept = (records: ClassifiedRecord[], conceptName?: string): ClassifiedRecord[] =>
  conceptName === undefined ? records : records.filter((r) => norm(r.classification.conceptName) === norm(conceptName));

/** Which pattern families have observed records for this concept, and how many instances each. */
export function patternsForConcept(records: readonly HistoricalQuestionRecord[], filter: RecordFilter, conceptName: string): Array<Counted<string>> {
  return tally(forConcept(selectClassified(records, filter), conceptName).map((r) => r.classification.patternFamilyName));
}

/** Concept combinations with observed evidence: the primary concept plus its combination concepts, as one sorted set. */
export function combinationsObserved(records: readonly HistoricalQuestionRecord[], filter: RecordFilter, conceptName?: string): Array<{ concepts: string[]; count: number }> {
  const counts = new Map<string, { concepts: string[]; count: number }>();
  for (const r of forConcept(selectClassified(records, filter), conceptName)) {
    if (r.classification.combinesWithConcepts.length === 0) continue;
    const concepts = [...new Set([r.classification.conceptName, ...r.classification.combinesWithConcepts])].sort(cmp);
    const key = concepts.map(norm).join("|");
    const entry = counts.get(key) ?? { concepts, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.entries()].sort((a, b) => cmp(a[0], b[0])).map(([, v]) => v);
}

/** The testing modes ("transformations") observed, using the existing TestingMode vocabulary. */
export function transformationsObserved(records: readonly HistoricalQuestionRecord[], filter: RecordFilter, conceptName?: string): Array<Counted<TestingMode>> {
  return tally(forConcept(selectClassified(records, filter), conceptName).flatMap((r) => r.classification.testingModes));
}

export function noveltyLevelsObserved(records: readonly HistoricalQuestionRecord[], filter: RecordFilter, conceptName?: string): Array<Counted<NoveltyLevel>> {
  return tally(forConcept(selectClassified(records, filter), conceptName).map((r) => r.classification.noveltyLevel));
}

export function trapsObserved(records: readonly HistoricalQuestionRecord[], filter: RecordFilter, conceptName?: string): Array<Counted<string>> {
  return tally(forConcept(selectClassified(records, filter), conceptName).flatMap((r) => (r.classification.trapErrorTaxonomyCode ? [r.classification.trapErrorTaxonomyCode] : [])));
}

export function difficultyTiersObserved(records: readonly HistoricalQuestionRecord[], filter: RecordFilter, conceptName?: string): Array<Counted<DifficultyTier>> {
  return tally(forConcept(selectClassified(records, filter), conceptName).map((r) => r.classification.difficultyTier));
}

export interface ObservedRange {
  min: number;
  max: number;
  count: number;
}

/**
 * Observed range of each difficulty dimension and of expected time. Each
 * dimension is reported SEPARATELY - there is no combined score - and the
 * values are provisional annotations, not calibrated measurements (D-021).
 */
export function difficultyDimensionsObserved(
  records: readonly HistoricalQuestionRecord[],
  filter: RecordFilter,
  conceptName?: string
): { dimensions: Record<(typeof DIFFICULTY_DIMENSION_KEYS)[number], ObservedRange | null>; expectedTimeSeconds: ObservedRange | null; calibration: "provisional" } {
  const rows = forConcept(selectClassified(records, filter), conceptName);
  const range = (values: number[]): ObservedRange | null => (values.length === 0 ? null : { min: Math.min(...values), max: Math.max(...values), count: values.length });
  const dimensions = Object.fromEntries(DIFFICULTY_DIMENSION_KEYS.map((k) => [k, range(rows.map((r) => r.classification.difficultyDimensions[k]))])) as Record<(typeof DIFFICULTY_DIMENSION_KEYS)[number], ObservedRange | null>;
  return { dimensions, expectedTimeSeconds: range(rows.map((r) => r.classification.expectedTimeSeconds)), calibration: "provisional" };
}

/** The records (question INSTANCES) that map to one pattern family (the STRUCTURE), by id. */
export function recordsForPattern(records: readonly HistoricalQuestionRecord[], filter: RecordFilter, patternFamilyName: string, conceptName?: string): ClassifiedRecord[] {
  return forConcept(selectClassified(records, filter), conceptName).filter((r) => norm(r.classification.patternFamilyName) === norm(patternFamilyName));
}

/** What supports a classification: the source, locator, state and review of one record. Internal/admin data. */
export function sourceSupport(records: readonly HistoricalQuestionRecord[], examCode: string, recordId: string) {
  const record = records.find((r) => r.id === recordId && r.examCode === examCode);
  if (!record) return null;
  return {
    id: record.id,
    dataOrigin: record.dataOrigin,
    fixtureLabel: record.fixtureLabel,
    source: record.source,
    locator: record.locator,
    annotationState: record.annotationState,
    authorship: record.authorship,
    review: record.review
  };
}

/**
 * Every observed facet in one structure, ready for a later coverage engine
 * (concept / pattern / combination / transformation / novelty / difficulty /
 * trap / time-demand). It reports counts of what was OBSERVED, nothing more.
 */
export interface ObservedTestingSummary {
  examCode: string;
  recordCount: number;
  concepts: Array<Counted<string>>;
  patterns: Array<{ conceptName: string; patternFamilyName: string; count: number }>;
  combinations: Array<{ concepts: string[]; count: number }>;
  transformations: Array<Counted<TestingMode>>;
  noveltyLevels: Array<Counted<NoveltyLevel>>;
  difficultyTiers: Array<Counted<DifficultyTier>>;
  traps: Array<Counted<string>>;
  difficulty: ReturnType<typeof difficultyDimensionsObserved>;
}

export function summarizeObservedTesting(records: readonly HistoricalQuestionRecord[], filter: RecordFilter): ObservedTestingSummary {
  const rows = selectClassified(records, filter);
  const patternCounts = new Map<string, { conceptName: string; patternFamilyName: string; count: number }>();
  for (const r of rows) {
    const key = `${norm(r.classification.conceptName)}|${norm(r.classification.patternFamilyName)}`;
    const e = patternCounts.get(key) ?? { conceptName: r.classification.conceptName, patternFamilyName: r.classification.patternFamilyName, count: 0 };
    e.count += 1;
    patternCounts.set(key, e);
  }
  return {
    examCode: filter.examCode,
    recordCount: rows.length,
    concepts: tally(rows.map((r) => r.classification.conceptName)),
    patterns: [...patternCounts.entries()].sort((a, b) => cmp(a[0], b[0])).map(([, v]) => v),
    combinations: combinationsObserved(records, filter),
    transformations: transformationsObserved(records, filter),
    noveltyLevels: noveltyLevelsObserved(records, filter),
    difficultyTiers: difficultyTiersObserved(records, filter),
    traps: trapsObserved(records, filter),
    difficulty: difficultyDimensionsObserved(records, filter)
  };
}
