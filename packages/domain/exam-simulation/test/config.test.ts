import { describe, expect, it } from "vitest";
import { assemblePaper, assertValidSimulationConfig, orderedSections, SimulationError, simulationConfigProblems, totalQuestionCount, type PaperCandidate } from "../src/index.js";
import { candidates, fixtureConfig, fixtureSelection } from "./fixtures.js";

describe("configuration validation (the exam's mechanics are DATA; the engine ships none)", () => {
  it("accepts a complete configuration", () => {
    expect(simulationConfigProblems(fixtureConfig())).toEqual([]);
    expect(() => assertValidSimulationConfig(fixtureConfig())).not.toThrow();
  });
  it("lists every problem", () => {
    const p = simulationConfigProblems(fixtureConfig({ examCode: " ", configVersion: "", overallDurationSeconds: 0, sections: [] }));
    expect(p).toEqual(expect.arrayContaining(["examCode_required", "configVersion_required", "overallDurationSeconds_must_be_a_positive_integer", "at_least_one_section_required"]));
  });
  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects duration %s", (d) => {
    expect(simulationConfigProblems(fixtureConfig({ overallDurationSeconds: d }))).toContain("overallDurationSeconds_must_be_a_positive_integer");
  });
  it("rejects duplicate section names and orders, and non-positive counts", () => {
    const p = simulationConfigProblems(fixtureConfig({ sections: [{ sectionName: "A", order: 1, questionCount: 0 }, { sectionName: "A", order: 1, questionCount: 2 }] }));
    expect(p).toEqual(expect.arrayContaining(["duplicate_sectionName:A", "duplicate_section_order:1", "section_0_questionCount_must_be_a_positive_integer"]));
  });
  it("requires provenance; a reviewed configuration names its reviewer; a canonical one must be reviewed", () => {
    expect(simulationConfigProblems(fixtureConfig({ provenance: { kind: "authored", sourceRef: "", reviewState: "unvalidated", reviewedBy: null, note: null } }))).toContain("provenance_sourceRef_required");
    expect(simulationConfigProblems(fixtureConfig({ provenance: { kind: "authored", sourceRef: "x", reviewState: "reviewed", reviewedBy: null, note: null } }))).toContain("reviewed_configuration_requires_reviewedBy");
    expect(simulationConfigProblems(fixtureConfig({ provenance: { kind: "canonical", sourceRef: "x", reviewState: "unvalidated", reviewedBy: null, note: null } }))).toContain("canonical_configuration_must_be_reviewed");
  });
  it("an invalid configuration throws a typed error carrying the problems", () => {
    try {
      assertValidSimulationConfig(fixtureConfig({ overallDurationSeconds: -1 }));
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(SimulationError);
      expect((e as SimulationError).code).toBe("invalid_config");
      expect((e as SimulationError).problems.length).toBeGreaterThan(0);
    }
  });
  it("sections are ordered by their declared order, and totals add up", () => {
    expect(orderedSections(fixtureConfig()).map((s) => s.sectionName)).toEqual(["Section A", "Section B"]);
    expect(totalQuestionCount(fixtureConfig())).toBe(3);
  });
});

describe("paper assembly: an explicit selection, validated, deterministic and never historical", () => {
  it("builds positions 1..n in section order, then selection order, with provenance and content version per question", () => {
    const paper = assemblePaper(fixtureConfig(), fixtureSelection(), candidates());
    expect(paper.questions.map((q) => [q.position, q.sectionName, q.questionId])).toEqual([[1, "Section A", "qa1"], [2, "Section A", "qa2"], [3, "Section B", "qb1"]]);
    expect(paper.questions[0]).toMatchObject({ contentFingerprint: "fp-qa1", provenanceSourceType: "original" });
    expect(paper.questions[2]).toMatchObject({ provenanceSourceType: "licensed" });
  });
  it("is NEVER presented as historical", () => {
    const paper = assemblePaper(fixtureConfig(), fixtureSelection(), candidates());
    expect(paper).toMatchObject({ origin: "assembled", isHistoricalPaper: false, sourceRef: "fixture:assembled-paper" });
  });
  it("is deterministic and independent of the candidate order", () => {
    const a = assemblePaper(fixtureConfig(), fixtureSelection(), candidates());
    expect(assemblePaper(fixtureConfig(), fixtureSelection(), [...candidates()].reverse())).toEqual(a);
    expect(assemblePaper(fixtureConfig(), fixtureSelection(), candidates())).toEqual(a);
  });
  const problemsOf = (selection = fixtureSelection(), pool: PaperCandidate[] = candidates(), config = fixtureConfig()): readonly string[] => {
    try {
      assemblePaper(config, selection, pool);
      return [];
    } catch (e) {
      expect((e as SimulationError).code).toBe("invalid_paper");
      return (e as SimulationError).problems;
    }
  };
  it("refuses an unpublished question", () => expect(problemsOf(undefined, candidates([{ questionId: "qa2", validationState: "draft" }]))).toContain("question_not_published:qa2"));
  it("refuses another exam's question", () => expect(problemsOf(undefined, candidates([{ questionId: "qa1", examCode: "JEE_MAIN" }]))).toContain("question_of_another_exam:qa1"));
  it("refuses a question placed in the wrong section", () => expect(problemsOf(undefined, candidates([{ questionId: "qb1", sectionName: "Section A" }]))).toContain("question_in_wrong_section:qb1"));
  it("refuses a question without provenance", () => expect(problemsOf(undefined, candidates([{ questionId: "qa1", sourceType: null }]))).toContain("question_without_provenance:qa1"));
  it("refuses a question that does not exist for this exam", () => expect(problemsOf(fixtureSelection({ sections: { "Section A": ["qa1", "ghost"], "Section B": ["qb1"] } }))).toContain("question_not_found_for_this_exam:ghost"));
  it("refuses a wrong question count per section, a duplicate, and a section outside the configuration", () => {
    expect(problemsOf(fixtureSelection({ sections: { "Section A": ["qa1"], "Section B": ["qb1"] } }))).toContain("section_Section A_needs_2_questions_got_1");
    expect(problemsOf(fixtureSelection({ sections: { "Section A": ["qa1", "qa1"], "Section B": ["qb1"] } }))).toContain("duplicate_question:qa1");
    expect(problemsOf(fixtureSelection({ sections: { "Section A": ["qa1", "qa2"], "Section B": ["qb1"], "Section C": ["x"] } }))).toContain("section_not_in_configuration:Section C");
  });
  it("reports every problem together, and refuses an invalid configuration or a non-assembled origin", () => {
    const p = problemsOf(fixtureSelection({ sections: { "Section A": ["qa1", "ghost"], "Section B": [] } }));
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(() => assemblePaper(fixtureConfig({ overallDurationSeconds: 0 }), fixtureSelection(), candidates())).toThrow(/configuration is invalid/);
    expect(problemsOf({ ...fixtureSelection(), origin: "historical" as never })).toContain("paper_origin_must_be_assembled");
  });
});
