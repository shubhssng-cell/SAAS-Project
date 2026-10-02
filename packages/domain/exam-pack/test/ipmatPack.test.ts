import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { describe, expect, it } from "vitest";
import {
  buildIpmatIndoreExamPack,
  ExamPackService,
  getLearningOrder,
  getSyllabusTree,
  InMemoryExamPackRepository,
  IPMAT_INDORE_EXAM_CODE,
  IPMAT_QUANT_CHAPTERS,
  ipmatIndoreExamPack,
  slugKey,
  summarizePackValidationState,
  validateExamPack
} from "../src/index.js";

describe("IPMAT Indore Exam Pack - integrity", () => {
  it("validates with no errors and no warnings (every concept is connected)", () => {
    const result = validateExamPack(ipmatIndoreExamPack);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("has a stable identity and is rebuilt identically each time", () => {
    expect(ipmatIndoreExamPack.examCode).toBe(IPMAT_INDORE_EXAM_CODE);
    expect(buildIpmatIndoreExamPack()).toEqual(ipmatIndoreExamPack);
  });

  it("contains ONLY the Quant section - no other section is invented", () => {
    expect(ipmatIndoreExamPack.sections.map((s) => [s.key, s.name, s.order])).toEqual([["quant", "Quant", 1]]);
  });

  it("orders the 15 chapters deterministically as seeded since Phase 1", () => {
    const [quant] = getSyllabusTree(ipmatIndoreExamPack);
    expect(quant!.nodes.map((n) => n.node.name)).toEqual([...IPMAT_QUANT_CHAPTERS]);
    expect(quant!.nodes.map((n) => n.node.order)).toEqual(IPMAT_QUANT_CHAPTERS.map((_, i) => i + 1));
    expect(IPMAT_QUANT_CHAPTERS).toHaveLength(15);
  });

  it("carries exactly the repository's concept graph: 12 concepts, 16 relations, all eight types used", () => {
    expect(ipmatIndoreExamPack.concepts).toHaveLength(percentagesConceptGraph.concepts.length);
    expect(ipmatIndoreExamPack.relations).toHaveLength(percentagesConceptGraph.relations.length);
    expect(new Set(ipmatIndoreExamPack.relations.map((r) => r.type)).size).toBe(8);
  });

  it("concept keys are unique and every concept sits under the chapter the graph says it does", () => {
    const keys = ipmatIndoreExamPack.concepts.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const node of percentagesConceptGraph.concepts) {
      const concept = ipmatIndoreExamPack.concepts.find((c) => c.name === node.name)!;
      expect(concept.syllabusNodeKey).toBe(`quant/${slugKey(node.chapterName)}`);
    }
  });

  it("preserves each relation's rationale, certainty and source from the curated graph", () => {
    for (const edge of percentagesConceptGraph.relations) {
      const found = ipmatIndoreExamPack.relations.find((r) => r.from === slugKey(edge.from) && r.to === slugKey(edge.to) && r.type === edge.type);
      expect(found, `${edge.from} -> ${edge.to} (${edge.type})`).toBeDefined();
      expect(found!.rationale).toBe(edge.rationale);
      expect(found!.certainty).toBe(edge.certainty);
      expect(found!.source).toBe(edge.source);
    }
  });

  it("the probable Probability edge is NOT promoted to confirmed", () => {
    const edge = ipmatIndoreExamPack.relations.find((r) => r.type === "related_but_distinct" && r.to === "probability" || r.from === "probability");
    expect(edge?.certainty).toBe("probable");
  });
});

describe("IPMAT Indore Exam Pack - honesty about what is not known", () => {
  it("is entirely authored + unvalidated: nothing is claimed canonical or reviewed", () => {
    const summary = summarizePackValidationState(ipmatIndoreExamPack);
    expect(summary.byKind.canonical).toBe(0);
    expect(summary.byKind.imported).toBe(0);
    expect(summary.byReviewState.reviewed).toBe(0);
    expect(summary.byReviewState.unvalidated).toBe(summary.total);
  });

  it("every artifact has a source reference, and the structure says it is not verified against an official syllabus", () => {
    expect(ipmatIndoreExamPack.provenance.sourceRef).toMatch(/NOT verified against an official/);
    for (const s of ipmatIndoreExamPack.syllabus) expect(s.provenance.sourceRef.length).toBeGreaterThan(0);
  });

  it("leaves terminology, skills, pattern references and importance empty rather than inventing them", () => {
    expect(ipmatIndoreExamPack.terminology).toEqual([]);
    for (const c of ipmatIndoreExamPack.concepts) {
      expect(c.skills).toEqual([]);
      expect(c.patternFamilyRefs).toEqual([]);
      expect(c.importance).toBeNull();
    }
  });

  it("holds no student-state field anywhere (knowledge space, not mastery)", () => {
    const text = JSON.stringify(ipmatIndoreExamPack).toLowerCase();
    for (const forbidden of ["mastery", "confidence", "studentid", "attempt", "accuracy"]) expect(text).not.toContain(forbidden);
  });
});

describe("IPMAT Indore Exam Pack - semantics of the real graph", () => {
  const service = new ExamPackService(new InMemoryExamPackRepository([ipmatIndoreExamPack]));

  it("Ratio is a prerequisite of Percentages; Number Systems is foundational (not a prerequisite)", async () => {
    expect(await service.getPrerequisites(IPMAT_INDORE_EXAM_CODE, "percentages")).toEqual(["ratio"]);
    expect(await service.getPrerequisites(IPMAT_INDORE_EXAM_CODE, "percentages", ["foundational"])).toEqual(["number-systems"]);
  });

  it("Percentages unlocks what it is a prerequisite of, and the answer is deterministic", async () => {
    const first = await service.getUnlocks(IPMAT_INDORE_EXAM_CODE, "percentages");
    expect(first).toEqual(await service.getUnlocks(IPMAT_INDORE_EXAM_CODE, "percentages"));
    expect(first).toEqual([...first].sort());
  });

  it("the Ratio<->Percentages pair (prerequisite one way, dependent the other) is accepted, not a cycle", async () => {
    const relations = await service.getRelations(IPMAT_INDORE_EXAM_CODE, "ratio");
    const types = relations.filter((r) => [r.from, r.to].includes("percentages")).map((r) => r.type).sort();
    expect(types).toEqual(["dependent", "prerequisite"]);
  });

  it("derives a complete learning order with prerequisites first", () => {
    const order = getLearningOrder(ipmatIndoreExamPack, ["prerequisite", "foundational", "advanced_extension"])!;
    expect(order).toHaveLength(ipmatIndoreExamPack.concepts.length);
    expect(order.indexOf("ratio")).toBeLessThan(order.indexOf("percentages"));
    expect(order.indexOf("number-systems")).toBeLessThan(order.indexOf("percentages"));
  });
});
