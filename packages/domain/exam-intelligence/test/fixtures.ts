import { computeContentFingerprint, type QuestionInstanceDna } from "@ipmat/content-authoring";
import { ipmatIndoreExamPack, type ExamPack, type PackConcept, type PackProvenance } from "@ipmat/exam-pack";
import type { HistoricalQuestionRecord } from "@ipmat/examiner-intelligence";
import { percentagesPatternFamilies, percentagesReversePercentageExample, type ValidationState } from "@ipmat/question-engine";
import type { ContentQuestionView, ExamIntelligenceSnapshot } from "../src/index.js";

/**
 * EVERYTHING here is a labelled TEST FIXTURE. The repository holds no real
 * historical IPMAT data and no real student/outcome data; every question view,
 * historical record and outcome in these tests is synthetic.
 */

export const ERROR_TAXONOMY_CODES = ["base_confusion", "sign_error", "misread_question", "careless_arithmetic", "successive_change_error", "percentage_point_confusion"];
export const FIXTURE_LABEL = "FIXTURE - synthetic test data, not real historical exam evidence";

export const baseDna = (over: Partial<QuestionInstanceDna> = {}): QuestionInstanceDna => {
  const d: Record<string, unknown> = { ...percentagesReversePercentageExample.dna };
  delete d.provenanceSourceType;
  delete d.validationState;
  return structuredClone({ ...d, ...over }) as QuestionInstanceDna;
};

let counter = 0;
export const view = (over: Omit<Partial<ContentQuestionView>, "dna"> & { dna?: Partial<QuestionInstanceDna> } = {}): ContentQuestionView => {
  const id = over.id ?? `q-${String(++counter).padStart(4, "0")}`;
  const { dna, ...rest } = over;
  return {
    id,
    dna: baseDna(dna),
    validationState: "published" as ValidationState,
    sourceType: "original",
    fingerprint: computeContentFingerprint("IPMAT_INDORE", `fixture question body ${id}`, []),
    isFixture: false,
    ...rest
  };
};

export const pub = (dna: Partial<QuestionInstanceDna> = {}, over: Omit<Partial<ContentQuestionView>, "dna"> = {}) => view({ dna, ...over });

export const record = (id: string, over: Partial<HistoricalQuestionRecord> & { dna?: Partial<QuestionInstanceDna> } = {}): HistoricalQuestionRecord => {
  const { dna, classification, ...rest } = over;
  const d = baseDna(dna) as unknown as Record<string, unknown>;
  delete d.examRelevance;
  return {
    id,
    examCode: "IPMAT_INDORE",
    locator: { examVersion: null, year: null, session: null, questionLabel: null },
    source: { sourceType: "licensed", sourceRef: `source-doc-${id}`, licenseRef: "license-ref", attributedTo: null },
    dataOrigin: "real_source",
    fixtureLabel: null,
    annotationState: "reviewed_validated",
    classification: classification !== undefined ? classification : (d as never),
    authorship: "human",
    proposedBy: null,
    review: { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T00:00:00.000Z" },
    editorialRelevance: null,
    ...rest
  };
};

export const fixtureRecord = (id: string, over: Parameters<typeof record>[1] = {}) =>
  record(id, { dataOrigin: "fixture", fixtureLabel: FIXTURE_LABEL, source: { sourceType: "original", sourceRef: `fixture:${id}`, licenseRef: null, attributedTo: null }, ...over });

export const snapshot = (questions: ContentQuestionView[] = [], historicalRecords: HistoricalQuestionRecord[] = [], over: Partial<ExamIntelligenceSnapshot> = {}): ExamIntelligenceSnapshot => ({
  examCode: "IPMAT_INDORE",
  examVersion: ipmatIndoreExamPack.packVersion,
  pack: ipmatIndoreExamPack,
  patternFamilies: percentagesPatternFamilies,
  errorTaxonomyCodes: ERROR_TAXONOMY_CODES,
  questions,
  historicalRecords,
  ...over
});

const prov = (): PackProvenance => ({ kind: "authored", sourceRef: "test fixture", licenseRef: null, reviewState: "unvalidated", reviewedBy: null, note: null });
const concept = (key: string, name: string): PackConcept => ({ key, name, syllabusNodeKey: "sec/chap", description: name, status: "curated", skills: [], patternFamilyRefs: [], importance: null, provenance: prov() });

/** A second, unrelated exam whose concept names overlap IPMAT's - for exam isolation. */
export const otherExamPack = (): ExamPack => ({
  examCode: "OTHER_EXAM",
  packVersion: "1",
  name: "Other Exam",
  provenance: prov(),
  sections: [{ key: "sec", name: "Quant", order: 1, provenance: prov() }],
  syllabus: [{ key: "sec/chap", sectionKey: "sec", parentKey: null, name: "Percentages", order: 1, provenance: prov() }],
  concepts: [concept("percentages", "Percentages"), concept("ratio", "Ratio")],
  relations: [],
  terminology: []
});

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const resetCounter = (): void => {
  counter = 0;
};
