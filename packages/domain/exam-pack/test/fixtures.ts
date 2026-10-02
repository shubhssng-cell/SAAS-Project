import type { ExamPack, PackConcept, PackProvenance, PackRelation } from "../src/index.js";

export const prov = (over: Partial<PackProvenance> = {}): PackProvenance => ({
  kind: "authored",
  sourceRef: "test fixture",
  licenseRef: null,
  reviewState: "unvalidated",
  reviewedBy: null,
  note: null,
  ...over
});

export const concept = (key: string, over: Partial<PackConcept> = {}): PackConcept => ({
  key,
  name: key.replace(/-/g, " "),
  syllabusNodeKey: "s1/ch1",
  description: `About ${key}`,
  status: "curated",
  skills: [],
  patternFamilyRefs: [],
  importance: null,
  provenance: prov(),
  ...over
});

export const relation = (from: string, to: string, type: PackRelation["type"] = "prerequisite", over: Partial<PackRelation> = {}): PackRelation => ({
  from,
  to,
  type,
  rationale: `${from} ${type} ${to}`,
  sharedKnowledge: "shared",
  usefulForQuestionGeneration: true,
  requirementLevel: "required",
  certainty: "probable",
  source: "human",
  provenance: prov(),
  ...over
});

/** A small, valid pack: a -> b -> c prerequisite chain, a -> c foundational, b <-> d directly related, plus isolated-free e. */
export function makePack(over: Partial<ExamPack> = {}): ExamPack {
  return {
    examCode: "TEST_EXAM",
    packVersion: "1",
    name: "Test Exam",
    provenance: prov(),
    sections: [
      { key: "s1", name: "Section One", order: 1, provenance: prov() },
      { key: "s2", name: "Section Two", order: 2, provenance: prov() }
    ],
    syllabus: [
      { key: "s1/ch1", sectionKey: "s1", parentKey: null, name: "Chapter One", order: 1, provenance: prov() },
      { key: "s1/ch2", sectionKey: "s1", parentKey: null, name: "Chapter Two", order: 2, provenance: prov() },
      { key: "s1/ch1/topic", sectionKey: "s1", parentKey: "s1/ch1", name: "Topic", order: 1, provenance: prov() },
      { key: "s2/ch1", sectionKey: "s2", parentKey: null, name: "Chapter One", order: 1, provenance: prov() }
    ],
    concepts: [
      concept("a"),
      concept("b", { syllabusNodeKey: "s1/ch1/topic" }),
      concept("c", { syllabusNodeKey: "s1/ch2" }),
      concept("d", { syllabusNodeKey: "s2/ch1" }),
      concept("e", { syllabusNodeKey: "s2/ch1" })
    ],
    relations: [
      relation("a", "b"),
      relation("b", "c"),
      relation("a", "c", "foundational"),
      relation("b", "d", "directly_related"),
      relation("d", "e", "application")
    ],
    terminology: [],
    ...over
  };
}

/** Deterministic PRNG (mulberry32) so property tests are reproducible without a dependency. */
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
