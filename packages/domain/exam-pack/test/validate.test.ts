import { describe, expect, it } from "vitest";
import { validateExamPack, validateExamPackSet, type ExamPack, type ExamPackIssueCode } from "../src/index.js";
import { concept, makePack, prov, relation } from "./fixtures.js";

const errorCodes = (pack: ExamPack): ExamPackIssueCode[] =>
  validateExamPack(pack)
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);

describe("validateExamPack - a sound pack", () => {
  it("accepts the baseline fixture with no errors", () => {
    const result = validateExamPack(makePack());
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("is deterministic and does not mutate its input", () => {
    const pack = makePack({ relations: [...makePack().relations, relation("a", "zzz")] });
    const snapshot = JSON.stringify(pack);
    expect(validateExamPack(pack)).toEqual(validateExamPack(pack));
    expect(JSON.stringify(pack)).toBe(snapshot);
  });

  it("warns (does not fail) about a concept with no relationships", () => {
    const pack = makePack({ concepts: [...makePack().concepts, concept("lonely")] });
    const result = validateExamPack(pack);
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "isolated_concept", severity: "warning" }));
  });
});

describe("validateExamPack - identity, sections and hierarchy", () => {
  it.each([["lower_case"], [""], ["HAS SPACE"], ["1STARTS_WITH_DIGIT"]])("rejects exam code %j", (examCode) => {
    expect(errorCodes(makePack({ examCode }))).toContain("invalid_exam_code");
  });

  it("rejects a blank pack version or name", () => {
    expect(errorCodes(makePack({ packVersion: " " }))).toContain("invalid_pack_identity");
    expect(errorCodes(makePack({ name: "" }))).toContain("invalid_pack_identity");
  });

  it("rejects duplicate section keys, names (after normalization) and orders", () => {
    const base = makePack();
    const dupKey = makePack({ sections: [base.sections[0]!, { ...base.sections[1]!, key: "s1" }] });
    expect(errorCodes(dupKey)).toContain("duplicate_key");
    const dupName = makePack({ sections: [base.sections[0]!, { ...base.sections[1]!, name: "  SECTION   one " }] });
    expect(errorCodes(dupName)).toContain("duplicate_name");
    const dupOrder = makePack({ sections: [base.sections[0]!, { ...base.sections[1]!, order: 1 }] });
    expect(errorCodes(dupOrder)).toContain("duplicate_order");
  });

  it.each([[0], [-1], [1.5], [Number.NaN]])("rejects section order %s", (order) => {
    const base = makePack();
    expect(errorCodes(makePack({ sections: [{ ...base.sections[0]!, order }, base.sections[1]!] }))).toContain("invalid_order");
  });

  it("rejects a syllabus node in an unknown section", () => {
    const base = makePack();
    const pack = makePack({ syllabus: [...base.syllabus, { ...base.syllabus[0]!, key: "x/y", sectionKey: "nope", name: "Y" }] });
    expect(errorCodes(pack)).toContain("unknown_section");
  });

  it("rejects an unknown parent and a parent in another section", () => {
    const base = makePack();
    const orphan = makePack({ syllabus: [...base.syllabus, { ...base.syllabus[0]!, key: "s1/o", parentKey: "missing", name: "O", order: 9 }] });
    expect(errorCodes(orphan)).toContain("invalid_hierarchy");
    const crossSection = makePack({ syllabus: [...base.syllabus, { ...base.syllabus[0]!, key: "s1/x", parentKey: "s2/ch1", name: "X", order: 9 }] });
    expect(errorCodes(crossSection)).toContain("invalid_hierarchy");
  });

  it("rejects a syllabus cycle without hanging", () => {
    const base = makePack();
    const pack = makePack({
      syllabus: [
        { ...base.syllabus[0]!, key: "s1/p", parentKey: "s1/q", name: "P", order: 5 },
        { ...base.syllabus[0]!, key: "s1/q", parentKey: "s1/p", name: "Q", order: 6 },
        ...base.syllabus
      ]
    });
    expect(errorCodes(pack)).toContain("syllabus_cycle");
  });

  it("allows the same chapter name in different sections but not among siblings", () => {
    expect(errorCodes(makePack())).toEqual([]);
    const base = makePack();
    const pack = makePack({ syllabus: [...base.syllabus, { ...base.syllabus[0]!, key: "s1/dup", name: "chapter ONE", order: 9 }] });
    expect(errorCodes(pack)).toContain("duplicate_name");
  });

  it("rejects duplicate sibling order", () => {
    const base = makePack();
    const pack = makePack({ syllabus: [...base.syllabus, { ...base.syllabus[0]!, key: "s1/dup", name: "Another", order: 1 }] });
    expect(errorCodes(pack)).toContain("duplicate_order");
  });

  it.each([["Has Caps"], ["trailing-"], ["a//b"], [""], ["a b"]])("rejects malformed key %j", (key) => {
    const base = makePack();
    expect(errorCodes(makePack({ sections: [{ ...base.sections[0]!, key }, base.sections[1]!] }))).toContain("invalid_key");
  });
});

describe("validateExamPack - concepts", () => {
  it("rejects duplicate concept keys and duplicate normalized names", () => {
    const base = makePack();
    expect(errorCodes(makePack({ concepts: [...base.concepts, concept("a")] }))).toContain("duplicate_key");
    expect(errorCodes(makePack({ concepts: [...base.concepts, concept("a2", { name: "  A " })] }))).toContain("duplicate_concept");
  });

  it("does NOT fold genuinely different names (D-030): Percentage vs Percentages are two concepts", () => {
    const base = makePack();
    const pack = makePack({
      concepts: [...base.concepts, concept("percentage", { name: "Percentage" }), concept("percentages", { name: "Percentages" })],
      relations: [...base.relations, relation("percentage", "percentages", "related_but_distinct")]
    });
    expect(errorCodes(pack)).toEqual([]);
  });

  it("rejects a concept located under an unknown syllabus node", () => {
    expect(errorCodes(makePack({ concepts: [...makePack().concepts, concept("z", { syllabusNodeKey: "nope" })] }))).toContain("unknown_syllabus_node");
  });

  it("rejects blank description, bad status, duplicate skills and unjustified importance", () => {
    const base = makePack();
    const bad = (c: ReturnType<typeof concept>) => errorCodes(makePack({ concepts: [...base.concepts, c], relations: [...base.relations, relation("a", c.key, "directly_related")] }));
    expect(bad(concept("z", { description: " " }))).toContain("malformed_concept");
    expect(bad(concept("z", { status: "bogus" as never }))).toContain("malformed_concept");
    expect(bad(concept("z", { skills: ["x", "X"] }))).toContain("malformed_concept");
    expect(bad(concept("z", { importance: { level: "core", rationale: "" } }))).toContain("malformed_concept");
    expect(bad(concept("z", { importance: { level: "core", rationale: "Tested in every sample paper we reviewed." } }))).toEqual([]);
  });
});

describe("validateExamPack - relations", () => {
  const withRelations = (...extra: ReturnType<typeof relation>[]) => makePack({ relations: [...makePack().relations, ...extra] });

  it("rejects an endpoint that is not a concept in the pack", () => {
    expect(errorCodes(withRelations(relation("a", "ghost")))).toContain("unknown_concept");
    expect(errorCodes(withRelations(relation("ghost", "a")))).toContain("unknown_concept");
  });

  it("reports an external-reference endpoint as a cross-exam relation, not an unknown concept", () => {
    const codes = errorCodes(withRelations(relation("a", "external:OTHER_EXAM:thing")));
    expect(codes).toContain("cross_exam_relation");
    expect(codes).not.toContain("unknown_concept");
  });

  it("rejects self relations", () => {
    expect(errorCodes(withRelations(relation("a", "a", "directly_related")))).toContain("self_relation");
  });

  it("rejects an exact duplicate and a reversed duplicate of a SYMMETRIC type, but allows a reversed directional pair", () => {
    expect(errorCodes(withRelations(relation("a", "b")))).toContain("duplicate_relation");
    expect(errorCodes(withRelations(relation("d", "b", "directly_related")))).toContain("duplicate_symmetric_relation");
    // application is directional: d->e exists; e->d is a different claim and legal (and not an ordering type).
    expect(errorCodes(withRelations(relation("e", "d", "application")))).toEqual([]);
  });

  it("rejects an unknown type, blank rationale/sharedKnowledge and bad enum values", () => {
    expect(errorCodes(withRelations(relation("a", "d", "bogus" as never)))).toContain("malformed_relation");
    expect(errorCodes(withRelations(relation("a", "d", "directly_related", { rationale: " " })))).toContain("malformed_relation");
    expect(errorCodes(withRelations(relation("a", "e", "directly_related", { sharedKnowledge: "" })))).toContain("malformed_relation");
    expect(errorCodes(withRelations(relation("a", "e", "directly_related", { certainty: "sure" as never })))).toContain("malformed_relation");
  });

  it("the same pair may be connected in opposite directions by DIFFERENT types (not a cycle)", () => {
    const pack = withRelations(relation("c", "a", "dependent"), relation("c", "b", "application"));
    expect(errorCodes(pack)).toEqual([]);
  });

  it("rejects a prerequisite cycle, a foundational cycle and an advanced_extension cycle", () => {
    expect(errorCodes(withRelations(relation("c", "a")))).toContain("forbidden_cycle");
    expect(errorCodes(withRelations(relation("c", "a", "foundational")))).toContain("forbidden_cycle");
    expect(errorCodes(withRelations(relation("c", "d", "advanced_extension"), relation("d", "c", "advanced_extension")))).toContain("forbidden_cycle");
  });

  it("rejects a cycle that only exists across the ordering types together", () => {
    // a -prereq-> b -prereq-> c exists; c -advanced_extension-> a closes a loop that no single type contains.
    const issues = validateExamPack(withRelations(relation("c", "a", "advanced_extension"))).issues.filter((i) => i.code === "forbidden_cycle");
    expect(issues.some((i) => i.subject === "ordering relations")).toBe(true);
  });

  it("allows cycles in relations that are intentionally non-ordering", () => {
    const pack = withRelations(relation("e", "d", "application"), relation("c", "d", "dependent"), relation("d", "c", "dependent"));
    expect(errorCodes(pack)).toEqual([]);
  });
});

describe("validateExamPack - provenance and promotion rules", () => {
  it("requires a source reference on every artifact", () => {
    expect(errorCodes(makePack({ provenance: prov({ sourceRef: "" }) }))).toContain("invalid_provenance");
  });

  it("requires a license reference for imported content", () => {
    const base = makePack();
    const bad = makePack({ concepts: [{ ...base.concepts[0]!, provenance: prov({ kind: "imported" }) }, ...base.concepts.slice(1)] });
    expect(errorCodes(bad)).toContain("invalid_provenance");
    const good = makePack({ concepts: [{ ...base.concepts[0]!, provenance: prov({ kind: "imported", licenseRef: "CC-BY-4.0 (example)" }) }, ...base.concepts.slice(1)] });
    expect(errorCodes(good)).toEqual([]);
  });

  it("a canonical claim must be reviewed; a review must name a reviewer; an unreviewed artifact must not carry one", () => {
    expect(errorCodes(makePack({ provenance: prov({ kind: "canonical" }) }))).toContain("invalid_provenance");
    expect(errorCodes(makePack({ provenance: prov({ reviewState: "reviewed" }) }))).toContain("invalid_provenance");
    expect(errorCodes(makePack({ provenance: prov({ reviewedBy: "someone" }) }))).toContain("invalid_provenance");
    expect(errorCodes(makePack({ provenance: prov({ kind: "canonical", reviewState: "reviewed", reviewedBy: "an editor" }) }))).toEqual([]);
  });

  it("an AI-suggested relation must be recorded as inferred, and an inferred one cannot be 'confirmed' before review", () => {
    const aiAuthored = relation("a", "d", "directly_related", { source: "ai_suggested", certainty: "probable" });
    expect(errorCodes(makePack({ relations: [...makePack().relations, aiAuthored] }))).toContain("provenance_source_mismatch");
    const inferredButConfirmed = relation("a", "d", "directly_related", { source: "ai_suggested", certainty: "confirmed", provenance: prov({ kind: "inferred" }) });
    expect(errorCodes(makePack({ relations: [...makePack().relations, inferredButConfirmed] }))).toContain("unreviewed_inference_promoted");
    const reviewed = relation("a", "d", "directly_related", {
      source: "ai_suggested",
      certainty: "confirmed",
      provenance: prov({ kind: "inferred", reviewState: "reviewed", reviewedBy: "a curator" })
    });
    expect(errorCodes(makePack({ relations: [...makePack().relations, reviewed] }))).toEqual([]);
  });

  it("a human-sourced relation cannot be recorded as inferred", () => {
    const wrong = relation("a", "d", "directly_related", { provenance: prov({ kind: "inferred" }) });
    expect(errorCodes(makePack({ relations: [...makePack().relations, wrong] }))).toContain("provenance_source_mismatch");
  });
});

describe("validateExamPack - terminology", () => {
  const term = (t: string, conceptKey: string | null = null, definition = "meaning") => ({ term: t, definition, conceptKey, provenance: prov() });

  it("accepts valid terms and rejects blank, duplicate and dangling ones", () => {
    expect(errorCodes(makePack({ terminology: [term("Sectional cutoff", "a")] }))).toEqual([]);
    expect(errorCodes(makePack({ terminology: [term("", null)] }))).toContain("malformed_term");
    expect(errorCodes(makePack({ terminology: [term("T", null, " ")] }))).toContain("malformed_term");
    expect(errorCodes(makePack({ terminology: [term("T"), term(" t ")] }))).toContain("duplicate_name");
    expect(errorCodes(makePack({ terminology: [term("T", "ghost")] }))).toContain("unknown_concept");
  });
});

describe("validateExamPackSet - cross-exam isolation", () => {
  const other = (): ExamPack => makePack({ examCode: "OTHER_EXAM", concepts: [concept("zeta", { syllabusNodeKey: "s1/ch1" })], relations: [] });

  it("two independent packs validate on their own", () => {
    const results = validateExamPackSet([makePack(), other()]);
    expect(results.get("TEST_EXAM")!.valid).toBe(true);
    expect(results.get("OTHER_EXAM")!.valid).toBe(true);
  });

  it("flags a relation whose endpoint exists only in ANOTHER pack", () => {
    const leaky = makePack({ relations: [...makePack().relations, relation("a", "zeta")] });
    const results = validateExamPackSet([leaky, other()]);
    const issues = results.get("TEST_EXAM")!.issues.map((i) => i.code);
    expect(results.get("TEST_EXAM")!.valid).toBe(false);
    expect(issues).toContain("cross_exam_relation");
    expect(results.get("OTHER_EXAM")!.valid).toBe(true);
  });

  it("flags duplicate exam codes", () => {
    const results = validateExamPackSet([makePack(), makePack()]);
    expect(results.get("TEST_EXAM")!.issues.map((i) => i.code)).toContain("duplicate_exam_code");
  });

  it("the same concept key in two packs is NOT a leak - keys are pack-scoped", () => {
    const twin = makePack({ examCode: "TWIN_EXAM" });
    const results = validateExamPackSet([makePack(), twin]);
    expect(results.get("TEST_EXAM")!.valid).toBe(true);
    expect(results.get("TWIN_EXAM")!.valid).toBe(true);
  });
});

describe("validateExamPack - malformed input does not throw", () => {
  it("returns issues for a thoroughly broken pack instead of crashing", () => {
    const broken = {
      ...makePack(),
      provenance: null,
      sections: [{ key: 3, name: null, order: "x", provenance: undefined }],
      relations: [{ from: null, to: undefined, type: null }]
    } as unknown as ExamPack;
    expect(() => validateExamPack(broken)).not.toThrow();
    expect(validateExamPack(broken).valid).toBe(false);
  });
});
