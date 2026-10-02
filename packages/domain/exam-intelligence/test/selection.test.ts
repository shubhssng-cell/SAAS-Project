import { describe, expect, it } from "vitest";
import { ExamIntelligenceError, restrictCandidates, selectQuestions, type QuestionSelectionConstraints } from "../src/index.js";
import { baseDna, pub, snapshot, view } from "./fixtures.js";

const D = (over: Parameters<typeof baseDna>[0] = {}) => over;
const pool = [
  pub(D({ patternFamilyName: "Reverse Percentage", testingModes: ["reverse", "combined"], combinesWithConcepts: ["Ratio"], noveltyLevel: "standard", trapErrorTaxonomyCode: "base_confusion", expectedTimeSeconds: 40, difficultyTier: "advanced" }), { id: "a", sourceType: "original" }),
  pub(D({ patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], noveltyLevel: "novel_combination", trapErrorTaxonomyCode: "successive_change_error", expectedTimeSeconds: 120, difficultyTier: "hard" }), { id: "b", sourceType: "licensed" }),
  pub(D({ patternFamilyName: "Percentage Point vs Percentage Change", testingModes: ["contextualized"], combinesWithConcepts: [], noveltyLevel: "novel_representation", trapErrorTaxonomyCode: null, expectedTimeSeconds: 200, difficultyTier: "standard" }), { id: "c", sourceType: "original" }),
  view({ id: "d", validationState: "human_reviewed", dna: D({ noveltyLevel: "novel_context", expectedTimeSeconds: 60 }) }),
  view({ id: "e", validationState: "draft" }),
  view({ id: "f", validationState: "rejected" }),
  view({ id: "g", isFixture: true }),
  view({ id: "h", dna: D({ examCode: "JEE_MAIN" }) }),
  view({ id: "i", dna: D({ conceptName: "Nope" }) })
];
const s = snapshot(pool);
const ids = (c: QuestionSelectionConstraints = {}) => selectQuestions(s, c).candidates.map((x) => x.questionId);

describe("the default region is PUBLISHED, qualifying content of this exam", () => {
  it("only published questions, ordered by id; data-quality exclusions are counted", () => {
    const r = selectQuestions(s);
    expect(r.candidates.map((c) => c.questionId)).toEqual(["a", "b", "c"]);
    expect(r.constraints.states).toEqual(["published"]);
    expect(r.qualifying).toBe(5); // a b c d e (f rejected, g fixture, h cross-exam, i invalid are not content)
    expect(r.excludedByQuality).toEqual({ excluded_cross_exam: 1, excluded_fixture: 1, excluded_rejected: 1, excluded_invalid_metadata: 1, excluded_duplicate: 0 });
  });
  it("publication/validation state is an explicit constraint: validated states can be requested, unpublished never leaks in by default", () => {
    expect(ids({ states: ["published", "human_reviewed"] })).toEqual(["a", "b", "c", "d"]);
    expect(ids({ states: ["draft"] })).toEqual(["e"]);
    expect(ids({ states: ["rejected"] })).toEqual([]); // a rejected question is never content
  });
});

describe("constraints", () => {
  it("section and concept (case/space-insensitive, canonicalised)", () => {
    expect(ids({ sections: ["quant"] })).toEqual(["a", "b", "c"]);
    expect(ids({ concepts: [" PERCENTAGES "] })).toEqual(["a", "b", "c"]);
    expect(ids({ concepts: ["Ratio"] })).toEqual([]);
  });
  it("pattern family", () => expect(ids({ patternFamilies: ["Reverse Percentage", "percentage point vs percentage change"] })).toEqual(["a", "c"]));
  it("combination: any / all / exact / none / some", () => {
    expect(ids({ combination: { mode: "any", concepts: ["Ratio", "Profit and Loss"] } })).toEqual(["a", "b"]);
    expect(ids({ combination: { mode: "all", concepts: ["Ratio", "Profit and Loss"] } })).toEqual([]);
    expect(ids({ combination: { mode: "exact", concepts: ["Ratio"] } })).toEqual(["a"]);
    expect(ids({ combination: { mode: "none" } })).toEqual(["c"]);
    expect(ids({ combination: { mode: "some" } })).toEqual(["a", "b"]);
  });
  it("testing modes (transformations): any / all", () => {
    expect(ids({ testingModes: { mode: "any", values: ["reverse", "contextualized"] } })).toEqual(["a", "c"]);
    expect(ids({ testingModes: { mode: "all", values: ["reverse", "combined"] } })).toEqual(["a"]);
  });
  it("difficulty tiers, and each dimension filtered separately", () => {
    expect(ids({ difficultyTiers: ["hard", "standard"] })).toEqual(["b", "c"]);
    expect(ids({ difficultyDimensions: { conceptualLoad: { min: 0.35, max: 0.45 } } })).toEqual(["a", "b", "c"]);
    expect(ids({ difficultyDimensions: { conceptualLoad: { min: 0.9 } } })).toEqual([]);
    expect(ids({ difficultyDimensions: { trapDensity: { max: 0.1 } } })).toEqual([]);
  });
  it("novelty (existing levels only)", () => expect(ids({ novelty: ["novel_combination", "novel_representation"] })).toEqual(["b", "c"]));
  it("trap: specific codes, none, or any", () => {
    expect(ids({ trap: { codes: ["base_confusion"] } })).toEqual(["a"]);
    expect(ids({ trap: { none: true } })).toEqual(["c"]);
    expect(ids({ trap: { any: true } })).toEqual(["a", "b"]);
  });
  it("time demand: by provisional band and/or an expected-seconds range", () => {
    expect(ids({ timeBands: ["up_to_45s"] })).toEqual(["a"]);
    expect(ids({ timeBands: ["91_to_150s", "over_150s"] })).toEqual(["b", "c"]);
    expect(ids({ expectedTimeSeconds: { min: 100, max: 150 } })).toEqual(["b"]);
  });
  it("provenance KIND requirement", () => {
    expect(ids({ sourceTypes: ["licensed"] })).toEqual(["b"]);
    expect(ids({ sourceTypes: ["original"] })).toEqual(["a", "c"]);
    expect(ids({ sourceTypes: ["official"] })).toEqual([]);
  });
  it("explicit exclusions", () => expect(ids({ excludeQuestionIds: ["a", "zzz"] })).toEqual(["b", "c"]));
  it("a combination of constraints is an intersection (the issue's example: concept + pattern + novel representation + published + time range)", () => {
    expect(ids({ concepts: ["Percentages"], patternFamilies: ["Percentage Point vs Percentage Change"], novelty: ["novel_representation"], states: ["published"], expectedTimeSeconds: { min: 150, max: 250 } })).toEqual(["c"]);
  });
});

describe("constraints that name things the exam does not have are errors, never silently ignored", () => {
  const bad: Array<[string, QuestionSelectionConstraints]> = [
    ["unknown concept", { concepts: ["Quantum"] }],
    ["unknown section", { sections: ["Verbal"] }],
    ["unknown pattern family", { patternFamilies: ["Nope"] }],
    ["unknown combination concept", { combination: { mode: "any", concepts: ["Nope"] } }],
    ["unknown difficulty dimension", { difficultyDimensions: { bogus: { min: 0 } } as never }],
    ["inverted range", { difficultyDimensions: { conceptualLoad: { min: 0.9, max: 0.1 } } }],
    ["non-finite range", { expectedTimeSeconds: { min: Number.NaN } }],
    ["unknown time band", { timeBands: ["forever" as never] }],
    ["unknown trap code", { trap: { codes: ["made_up"] } }]
  ];
  it.each(bad)("%s", (_name, constraints) => {
    expect(() => selectQuestions(s, constraints)).toThrowError(ExamIntelligenceError);
    try {
      selectQuestions(s, constraints);
    } catch (e) {
      expect((e as ExamIntelligenceError).code).toBe("invalid_constraint");
    }
  });
});

describe("auditable: every filter step is traced and the result carries no content", () => {
  it("the trace lists each applied filter with before/after counts, in a fixed order", () => {
    const r = selectQuestions(s, { concepts: ["Percentages"], novelty: ["standard"], timeBands: ["up_to_45s"] });
    expect(r.trace.map((t) => t.filter)).toEqual(["states", "concepts", "novelty", "timeBands"]);
    expect(r.trace[0]).toEqual({ filter: "states", before: 5, after: 3 });
    for (let i = 1; i < r.trace.length; i++) expect(r.trace[i]!.before).toBe(r.trace[i - 1]!.after);
    expect(r.candidates).toHaveLength(r.trace[r.trace.length - 1]!.after);
  });
  it("candidates are DNA-level facts: no question text, options, answer, solution, reviewer or provenance reference", () => {
    const text = JSON.stringify(selectQuestions(s));
    for (const forbidden of ["body", "options", "correctAnswer", "solution", "explanation", "reviewedBy", "sourceRef", "licenseRef", "fingerprint"]) expect(text, forbidden).not.toContain(forbidden);
  });
  it("is deterministic and independent of input order", () => {
    expect(selectQuestions(snapshot([...pool].reverse()), { concepts: ["Percentages"] })).toEqual(selectQuestions(s, { concepts: ["Percentages"] }));
  });
  it("reads no student: the constraints have no student/mastery/confidence field", () => {
    const r = selectQuestions(s, {});
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/student|mastery|confidence|ability/);
  });
});

describe("exam isolation", () => {
  it("a JEE question never becomes IPMAT intelligence", () => {
    expect(ids({ states: ["published", "human_reviewed", "ai_validated", "draft"] })).not.toContain("h");
    expect(selectQuestions(s, {}).excludedByQuality.excluded_cross_exam).toBe(1);
  });
});

describe("the training-system bridge: providers keep deciding, the layer only supplies the exam-space constraint", () => {
  const candidates = ["c", "a", "zz", "b"].map((questionId) => ({ question: { questionId }, expectedTimeSeconds: 60, validationState: "published" as const }));
  it("intersects a provider's own candidate list with a result, preserving the provider's order", () => {
    const result = selectQuestions(s, { novelty: ["novel_representation", "standard"] });
    expect(restrictCandidates(candidates, result).map((c) => c.question.questionId)).toEqual(["c", "a"]);
  });
  it("cannot add a candidate the provider did not have, and an empty region leaves none", () => {
    expect(restrictCandidates([], selectQuestions(s, {}))).toEqual([]);
    expect(restrictCandidates(candidates, selectQuestions(s, { concepts: ["Ratio"] }))).toEqual([]);
  });
  it("monotone: a narrower constraint never gives a provider MORE candidates", () => {
    const wide = restrictCandidates(candidates, selectQuestions(s, { concepts: ["Percentages"] })).length;
    const narrow = restrictCandidates(candidates, selectQuestions(s, { concepts: ["Percentages"], novelty: ["standard"] })).length;
    expect(narrow).toBeLessThanOrEqual(wide);
  });
  it("with the REAL Revision provider: the provider still decides, and the exam-space constraint only narrows the pool it chooses from", async () => {
    const { RevisionTrainingProvider } = await import("@ipmat/revision-training");
    const { runTrainingSystemProvider } = await import("@ipmat/training-systems");
    const NOW = "2026-03-15T12:00:00.000Z";
    const DAY = 86_400_000;
    const ctxQuestion = (questionId: string, noveltyLevel: string, cell: string) => ({
      questionId, examCode: "IPMAT_INDORE", sectionName: "Quant", chapterName: "Percentages", conceptName: "Percentages", patternFamilyName: "Reverse Percentage",
      patternTaxonomyCellId: cell, difficultyTier: "standard", difficultyDimensions: baseDna().difficultyDimensions, noveltyLevel, examRelevance: "core", testingModes: ["direct"], trapErrorTaxonomyCode: null, combinesWithConcepts: []
    });
    const history = Array.from({ length: 3 }, (_, i) => ({
      contribution: { attemptId: `att-${i}`, studentId: "student-1", conceptId: "Percentages", questionId: `old-${i}`, status: "submitted", isCorrect: true, timeTakenSeconds: 60, expectedTimeSeconds: 60, hintsUsed: 0, skipped: false, finalizedAt: new Date(Date.parse(NOW) - (30 + i) * DAY).toISOString() },
      question: ctxQuestion(`old-${i}`, "standard", "cell-old")
    }));
    const all = [["a", "standard", "cell-1"], ["b", "novel_combination", "cell-2"], ["c", "novel_representation", "cell-3"]].map(([id, nov, cell]) => ({ question: ctxQuestion(id!, nov!, cell!), expectedTimeSeconds: 60, validationState: "published" as const }));
    const run = (cands: typeof all) => runTrainingSystemProvider(new RevisionTrainingProvider(), { studentId: "student-1", masteryByConcept: [], attemptRecords: history as never, candidates: cands as never, now: NOW });
    const unrestricted = run(all);
    expect(unrestricted.status).toBe("selected");
    const chosen = (unrestricted as { question: { questionId: string } }).question.questionId;
    // exam-space constraint: only novel levels. The provider's own logic (unseen cell, exposure, id order) still picks.
    const result = selectQuestions(s, { novelty: ["novel_combination", "novel_representation"] });
    const restricted = restrictCandidates(all, result);
    expect(restricted.map((c) => c.question.questionId)).toEqual(["b", "c"]);
    const narrowed = run(restricted as never);
    expect(narrowed.status).toBe("selected");
    expect(["b", "c"]).toContain((narrowed as { question: { questionId: string } }).question.questionId);
    // a constraint that empties the pool leaves the provider with nothing to choose; IT reports that, not the bridge
    const emptied = run(restrictCandidates(all, selectQuestions(s, { concepts: ["Ratio"] })) as never);
    expect(emptied.status).toBe("no_eligible_question");
    void chosen;
  });
});
