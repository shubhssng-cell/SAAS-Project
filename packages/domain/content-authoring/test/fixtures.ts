import { ipmatIndoreExamPack, type ExamPack, type PackConcept, type PackProvenance } from "@ipmat/exam-pack";
import { percentagesPatternFamilies, percentagesReversePercentageExample } from "@ipmat/question-engine";
import { createDraft, type AuthoredQuestion, type GateContext, type NewQuestionInput, type QuestionInstanceDna } from "../src/index.js";

/**
 * Labelled TEST FIXTURES. The question below is the repository's own worked
 * demonstration question (original content written for this project, D-016),
 * reshaped into the authoring model. Nothing here is real historical exam
 * content and nothing is seeded.
 */

export const ERROR_TAXONOMY_CODES = ["base_confusion", "sign_error", "misread_question", "careless_arithmetic", "successive_change_error", "percentage_point_confusion"];

const { dna: demoDna, content: demoContent } = percentagesReversePercentageExample;

export const baseDna = (over: Partial<QuestionInstanceDna> = {}): QuestionInstanceDna => {
  const structural: Record<string, unknown> = { ...demoDna };
  delete structural.provenanceSourceType;
  delete structural.validationState;
  return structuredClone({ ...structural, ...over }) as QuestionInstanceDna;
};

export const baseInput = (id: string, over: Partial<NewQuestionInput> = {}): NewQuestionInput => ({
  id,
  dna: baseDna(),
  content: {
    body: demoContent.body,
    answerFormat: "multiple_choice",
    options: [...demoContent.options],
    correctAnswer: demoContent.correctAnswer,
    solutionSteps: [...demoContent.solutionSteps],
    groundTruthDerivation: { computation: "(3 * 8000) / 1.20", expectedAnswer: 20000 }
  },
  source: { sourceType: "original", sourceRef: null, licenseRef: null, attributedTo: null },
  origin: "human_authored",
  ...over
});

export const baseQuestion = (id = "q-1", over: Partial<AuthoredQuestion> = {}): AuthoredQuestion => ({ ...createDraft(baseInput(id)), ...over });

export const ctx = (over: Partial<GateContext> = {}): GateContext => ({
  pack: ipmatIndoreExamPack,
  patternFamilies: percentagesPatternFamilies,
  errorTaxonomyCodes: ERROR_TAXONOMY_CODES,
  existing: [],
  ...over
});

export const REVIEW = { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T10:00:00.000Z", notes: "internal note", answerVerifiedByReviewer: false, reviewedAsDistinct: false };

const prov = (): PackProvenance => ({ kind: "authored", sourceRef: "test fixture", licenseRef: null, reviewState: "unvalidated", reviewedBy: null, note: null });
const concept = (key: string, name: string): PackConcept => ({ key, name, syllabusNodeKey: "sec/chap", description: name, status: "curated", skills: [], patternFamilyRefs: [], importance: null, provenance: prov() });

/** A second exam whose concept names overlap IPMAT's - for cross-exam isolation tests. */
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
