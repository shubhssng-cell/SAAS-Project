import { ipmatIndoreExamPack, type ExamPack, type PackConcept, type PackProvenance } from "@ipmat/exam-pack";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import type { DnaValidationContext, HistoricalDnaClassification, HistoricalQuestionRecord } from "../src/index.js";

/**
 * EVERYTHING in this file is a labelled TEST FIXTURE. None of it is real
 * historical IPMAT evidence; the repository holds no authorized historical
 * material. Fixture records always carry dataOrigin "fixture", a fixtureLabel
 * and a "fixture:" source reference.
 */

export const ERROR_TAXONOMY_CODES = ["base_confusion", "sign_error", "misread_question", "careless_arithmetic", "successive_change_error", "percentage_point_confusion"];

export const FIXTURE_LABEL = "FIXTURE - synthetic test data, not real historical exam evidence";

const { dna: demoDna } = percentagesReversePercentageExample;

export const baseClassification = (over: Partial<HistoricalDnaClassification> = {}): HistoricalDnaClassification => {
  const structural: Record<string, unknown> = { ...demoDna };
  for (const k of ["provenanceSourceType", "validationState", "examRelevance"]) delete structural[k];
  return structuredClone({ ...structural, ...over }) as HistoricalDnaClassification;
};

export const ipmatContext = (): DnaValidationContext => ({
  pack: ipmatIndoreExamPack,
  patternFamilies: percentagesPatternFamilies,
  errorTaxonomyCodes: ERROR_TAXONOMY_CODES
});

export const fixtureRecord = (id: string, over: Partial<HistoricalQuestionRecord> = {}): HistoricalQuestionRecord => ({
  id,
  examCode: "IPMAT_INDORE",
  locator: { examVersion: null, year: null, session: null, questionLabel: null },
  source: { sourceType: "original", sourceRef: `fixture:${id}`, licenseRef: null, attributedTo: null },
  dataOrigin: "fixture",
  fixtureLabel: FIXTURE_LABEL,
  annotationState: "reviewed_validated",
  classification: baseClassification(),
  authorship: "human",
  proposedBy: null,
  review: { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T00:00:00.000Z" },
  editorialRelevance: null,
  ...over
});

/** A real-source record shape (used only to test validation rules - the data is synthetic and never persisted as evidence). */
export const realSourceRecord = (id: string, over: Partial<HistoricalQuestionRecord> = {}): HistoricalQuestionRecord =>
  fixtureRecord(id, {
    dataOrigin: "real_source",
    fixtureLabel: null,
    source: { sourceType: "licensed", sourceRef: `source-doc-${id}`, licenseRef: "license-ref-for-test", attributedTo: null },
    ...over
  });

const prov = (): PackProvenance => ({ kind: "authored", sourceRef: "test fixture", licenseRef: null, reviewState: "unvalidated", reviewedBy: null, note: null });
const concept = (key: string, name: string): PackConcept => ({ key, name, syllabusNodeKey: "sec/chap", description: name, status: "curated", skills: [], patternFamilyRefs: [], importance: null, provenance: prov() });

/** A second, unrelated exam pack - used to prove cross-exam isolation. Its concept names deliberately overlap IPMAT's. */
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
