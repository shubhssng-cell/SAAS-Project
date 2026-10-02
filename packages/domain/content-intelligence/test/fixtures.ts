import { InMemoryExamPackRepository, ipmatIndoreExamPack, type ExamPack, type PackConcept, type PackProvenance } from "@ipmat/exam-pack";
import {
  ContentIntelligencePipeline,
  DeterministicConceptProvider,
  InMemoryContentIntelligenceRepository,
  type ConceptExtractionProvider,
  type PipelineDeps,
  type RelationshipExtractionProvider,
  type SourceInput
} from "../src/index.js";

/**
 * EVERYTHING here is a labelled TEST FIXTURE: synthetic text invented for these
 * tests. It is not, and does not pretend to be, a real exam source - the
 * repository holds no authorized source corpus.
 */

export const FIXTURE_LABEL = "FIXTURE - synthetic test document, not a real exam source";

export const fixtureSource = (key = "fixture-notes", over: Partial<SourceInput> = {}): SourceInput => ({
  examCode: "IPMAT_INDORE",
  sourceKey: key,
  title: "Synthetic fixture notes",
  sourceType: "original",
  sourceRef: `fixture:${key}`,
  licenseRef: null,
  attributedTo: null,
  authority: null,
  dataOrigin: "fixture",
  fixtureLabel: FIXTURE_LABEL,
  ...over
});

export const FIXTURE_NOTES = `# Synthetic Fixture Notes

## Percentages

A percentage expresses a quantity as parts per hundred. Understanding Ratio is required before Percentages make sense, and Number Systems underlies both.

| Quantity | Value |
|---|---|
| Base | 200 |
| Rate | 10 |

1. In this synthetic example, what is 10 percent of the base quantity 200?
A) 10
B) 20
C) 30
D) 40
Answer: B

## Averages

An average of percentages is not the percentage of an average. Weighted reasoning links Averages with Percentages.
`;

export function makeEnv(over: Partial<PipelineDeps> & { pack?: ExamPack } = {}) {
  const repo = new InMemoryContentIntelligenceRepository();
  const pack = over.pack ?? ipmatIndoreExamPack;
  const pipeline = new ContentIntelligencePipeline({
    repo,
    packs: new InMemoryExamPackRepository([pack]),
    conceptProviders: over.conceptProviders ?? [new DeterministicConceptProvider()],
    relationshipProviders: over.relationshipProviders,
    chunker: over.chunker
  });
  return { repo, pipeline, pack };
}

export type { ConceptExtractionProvider, RelationshipExtractionProvider };

const prov = (): PackProvenance => ({ kind: "authored", sourceRef: "test fixture", licenseRef: null, reviewState: "unvalidated", reviewedBy: null, note: null });
const concept = (key: string, name: string): PackConcept => ({ key, name, syllabusNodeKey: "sec/chap", description: name, status: "curated", skills: [], patternFamilyRefs: [], importance: null, provenance: prov() });

/** A second, unrelated exam whose concept names overlap IPMAT's - for cross-exam isolation. */
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

export const REVIEW = { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-02T10:00:00.000Z" };
