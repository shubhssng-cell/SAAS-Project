import { REVISION_CONSTANTS } from "@ipmat/revision-training";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveRevisionSignals, RevisionIntelligenceError, SIGNAL_DEFINITIONS, REVISION_SIGNAL_KINDS } from "../src/index.js";
import { attempt, candidate, contextOf, daysAgo, dormantWorld, evidenceOf, EXAM, NOW, question, resetCounter, STUDENT } from "./fixtures.js";

beforeEach(resetCounter);
const signalsOf = (records: ReturnType<typeof attempt>[], candidates: ReturnType<typeof candidate>[], ctx: Parameters<typeof contextOf>[2] = {}, names?: string[]) =>
  deriveRevisionSignals(evidenceOf(records, names), contextOf(records, candidates, ctx));
const kinds = (s: ReturnType<typeof signalsOf>) => s.map((x) => x.kind);

describe("every signal kind has one fixed definition and is evidence-defined", () => {
  it("has a non-empty fixed definition per kind", () => {
    for (const k of REVISION_SIGNAL_KINDS) expect(SIGNAL_DEFINITIONS[k].length, k).toBeGreaterThan(40);
    const { records, candidates } = dormantWorld();
    for (const s of signalsOf(records, candidates)) expect(s.definition).toBe(SIGNAL_DEFINITIONS[s.kind]);
  });
  it("carries ids, facts, contributing attempts and an explanation, and no score/rank/verdict field", () => {
    const { records, candidates } = dormantWorld();
    for (const s of signalsOf(records, candidates)) {
      expect(s.id).toBe(`${s.kind}|${s.conceptName ?? "*"}|${s.subject ?? "*"}`);
      if (!s.kind.endsWith("without_graded_evidence")) expect(s.contributingAttemptIds.length).toBeGreaterThan(0); // an absence-of-evidence gap may legitimately have no attempts at all
      expect(Object.keys(s).sort()).toEqual(["conceptName", "contributingAttemptIds", "definition", "dimension", "explanation", "facts", "id", "kind", "subject"]);
    }
  });
});

describe("dormant_concept reuses Revision's own rule and constants", () => {
  const q = (id: string) => question(id);
  it("fires at exactly the dormancy interval and not a moment before; correctness is irrelevant", () => {
    const at = (days: number, correct = true) => [1, 2, 3].map((i) => attempt(q(`q${i}`), { daysAgo: days, isCorrect: i === 1 ? correct : true }));
    expect(kinds(signalsOf(at(REVISION_CONSTANTS.DORMANCY_DAYS), []))).toContain("dormant_concept");
    expect(kinds(signalsOf(at(REVISION_CONSTANTS.DORMANCY_DAYS - 0.01), []))).not.toContain("dormant_concept");
    expect(kinds(signalsOf(at(30, false), []))).toContain("dormant_concept");
  });
  it("needs the minimum number of GRADED attempts; skips and abandons never count", () => {
    const two = [attempt(q("a"), { daysAgo: 30 }), attempt(q("b"), { daysAgo: 30 })];
    const skips = [attempt(q("c"), { status: "skipped", daysAgo: 30 }), attempt(q("d"), { status: "abandoned", daysAgo: 30 })];
    expect(kinds(signalsOf([...two, ...skips], []))).not.toContain("dormant_concept");
    expect(kinds(signalsOf([...two, attempt(q("e"), { daysAgo: 30 })], []))).toContain("dormant_concept");
  });
  it("reports EVERY eligible concept (the provider itself targets only one) with exact facts and graded attempt ids", () => {
    const records = [
      ...[1, 2, 3].map((i) => attempt(question(`p${i}`), { daysAgo: 20 + i })),
      ...[1, 2, 3].map((i) => attempt(question(`r${i}`, { conceptName: "Ratio", chapterName: "Ratio" }), { daysAgo: 40 }))
    ];
    const dormant = signalsOf(records, []).filter((s) => s.kind === "dormant_concept");
    expect(dormant.map((s) => s.conceptName)).toEqual(["Percentages", "Ratio"]);
    expect(dormant[0]!.facts).toMatchObject({ gradedAttempts: 3, wholeDaysSinceLastGradedAttempt: 21, minimumGradedAttempts: 3, dormancyDays: 14 });
    expect(dormant[0]!.contributingAttemptIds).toHaveLength(3);
  });
  it("a recently attempted concept is not dormant, however old its other attempts are", () => {
    const records = [attempt(q("a"), { daysAgo: 60 }), attempt(q("b"), { daysAgo: 50 }), attempt(q("c"), { daysAgo: 3 })];
    expect(kinds(signalsOf(records, []))).not.toContain("dormant_concept");
  });
  it("fails closed without a usable evaluation time", () => {
    const records = [1, 2, 3].map((i) => attempt(q(`q${i}`), { daysAgo: 30 }));
    expect(kinds(signalsOf(records, [], { now: undefined }))).not.toContain("dormant_concept");
    expect(kinds(signalsOf(records, [], { now: "not-a-date" }))).not.toContain("dormant_concept");
  });
});

describe("recurring_trap_failure reuses Trap Lab's own rule", () => {
  const trapQ = (id: string, code = "base_confusion") => question(id, { trapErrorTaxonomyCode: code });
  it("needs distinct failing QUESTIONS, not repeated attempts on one", () => {
    expect(kinds(signalsOf([attempt(trapQ("a"), { isCorrect: false }), attempt(trapQ("a"), { isCorrect: false }), attempt(trapQ("a"), { isCorrect: false })], []))).not.toContain("recurring_trap_failure");
    const two = signalsOf([attempt(trapQ("a"), { isCorrect: false }), attempt(trapQ("b"), { isCorrect: false })], []);
    const s = two.find((x) => x.kind === "recurring_trap_failure")!;
    expect(s).toMatchObject({ conceptName: null, subject: "base_confusion", dimension: "error_code" });
    expect(s.facts).toMatchObject({ distinctFailingQuestions: 2, minimumDistinctFailingQuestions: 2 });
    expect(s.contributingAttemptIds).toHaveLength(2);
  });
  it("correct attempts never cancel it; different codes never combine; skips are not failures", () => {
    const records = [attempt(trapQ("a"), { isCorrect: false }), attempt(trapQ("b"), { isCorrect: false }), attempt(trapQ("c"), { isCorrect: true })];
    expect(kinds(signalsOf(records, []))).toContain("recurring_trap_failure");
    expect(kinds(signalsOf([attempt(trapQ("a", "x"), { isCorrect: false }), attempt(trapQ("b", "y"), { isCorrect: false })], []))).not.toContain("recurring_trap_failure");
    expect(kinds(signalsOf([attempt(trapQ("a"), { isCorrect: false }), attempt(trapQ("b"), { status: "skipped" })], []))).not.toContain("recurring_trap_failure");
  });
  it("is aggregated across concepts (concept is not part of a trap's identity)", () => {
    const s = signalsOf([attempt(trapQ("a"), { isCorrect: false }), attempt(question("b", { conceptName: "Ratio", trapErrorTaxonomyCode: "base_confusion" }), { isCorrect: false })], []).find((x) => x.kind === "recurring_trap_failure")!;
    expect(s.facts.conceptsInvolved).toEqual(["Percentages", "Ratio"]);
  });
});

describe("attempts_exceed_distinct_questions is a fact about exposure only", () => {
  it("fires only when a question was attempted more than once, and lists which", () => {
    const a = question("a");
    const s = signalsOf([attempt(a), attempt(a), attempt(question("b"))], []).find((x) => x.kind === "attempts_exceed_distinct_questions")!;
    expect(s.facts).toMatchObject({ attempts: 3, distinctQuestions: 2, repeatedQuestionIds: ["a"] });
    expect(kinds(signalsOf([attempt(question("a")), attempt(question("b"))], []))).not.toContain("attempts_exceed_distinct_questions");
  });
  it("a skip of a question already attempted still counts as an exposure repeat (skips are visible, not graded)", () => {
    const a = question("a");
    expect(kinds(signalsOf([attempt(a), attempt(a, { status: "skipped" })], []))).toContain("attempts_exceed_distinct_questions");
  });
});

describe("pattern / novelty / testing-mode gaps are absence of GRADED evidence, relative to the PUBLISHED pool", () => {
  const base = question("base");
  const history = [attempt(base)];
  const pool = [
    candidate(base),
    candidate(question("other-family", { patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], noveltyLevel: "novel_context" }))
  ];
  it("lists exactly the values the pool offers and the student has no graded attempt on", () => {
    const s = signalsOf(history, pool);
    expect(s.filter((x) => x.kind === "pattern_family_without_graded_evidence").map((x) => x.subject)).toEqual(["Successive Percentage Change"]);
    expect(s.filter((x) => x.kind === "novelty_level_without_graded_evidence").map((x) => x.subject)).toEqual(["novel_context"]);
    expect(s.filter((x) => x.kind === "testing_mode_without_graded_evidence").map((x) => x.subject)).toEqual(["combined"]);
    expect(s[0]!.facts).toMatchObject({ gradedAttemptsForValue: 0 });
  });
  it("only PUBLISHED, same-exam pool questions define what is available", () => {
    const s = signalsOf(history, [candidate(base), candidate(question("draft", { patternFamilyName: "Z" }), { validationState: "draft" }), candidate(question("other-exam", { patternFamilyName: "Y", examCode: "JEE_MAIN" }))]);
    expect(s.filter((x) => x.kind === "pattern_family_without_graded_evidence")).toEqual([]);
  });
  it("a skipped-only encounter still has no GRADED evidence, and the skip is visible in the facts", () => {
    const other = question("o", { patternFamilyName: "Successive Percentage Change" });
    const s = signalsOf([attempt(base), attempt(other, { status: "skipped" })], pool).find((x) => x.kind === "pattern_family_without_graded_evidence")!;
    expect(s.facts).toMatchObject({ gradedAttemptsForValue: 0, skippedAttemptsForValue: 1 });
  });
  it("graded evidence on the value removes the gap", () => {
    const s = signalsOf([attempt(base), attempt(question("o", { patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], noveltyLevel: "novel_context" }))], pool);
    expect(kinds(s).filter((k) => k.endsWith("without_graded_evidence"))).toEqual([]);
  });
  it("only concepts with graded evidence get gap signals (a concept never attempted gets none)", () => {
    const s = signalsOf(history, [...pool, candidate(question("r", { conceptName: "Ratio", patternFamilyName: "Anything" }))], {}, ["Percentages", "Ratio"]);
    expect(s.filter((x) => x.conceptName === "Ratio")).toEqual([]);
    expect(signalsOf([attempt(base, { status: "skipped" })], pool).filter((x) => x.kind.endsWith("without_graded_evidence"))).toEqual([]);
  });
  it("dimensions stay separate: a concept can lack evidence in one dimension and have it in another", () => {
    const s = signalsOf(history, [candidate(base), candidate(question("n", { noveltyLevel: "novel_context" }))]);
    expect(kinds(s)).toContain("novelty_level_without_graded_evidence");
    expect(kinds(s)).not.toContain("pattern_family_without_graded_evidence");
    expect(kinds(s)).not.toContain("testing_mode_without_graded_evidence");
  });
});

describe("scope, determinism and non-mutation", () => {
  it("another exam's records and another student's records never produce signals", () => {
    const own = [attempt(question("a"))];
    const foreign = [attempt(question("x", { examCode: "JEE_MAIN", trapErrorTaxonomyCode: "t" }), { isCorrect: false, daysAgo: 99 }), attempt(question("y", { examCode: "JEE_MAIN", trapErrorTaxonomyCode: "t" }), { isCorrect: false, daysAgo: 99 }), attempt(question("z"), { studentId: "student-2", isCorrect: false })];
    const base = signalsOf(own, []);
    expect(deriveRevisionSignals(evidenceOf(own), contextOf([...own, ...foreign], []))).toEqual(base);
  });
  it("refuses a context and an evidence view of different students", () => {
    expect(() => deriveRevisionSignals(evidenceOf([attempt(question("a"))]), contextOf([], [], { studentId: "someone-else" }))).toThrow(RevisionIntelligenceError);
  });
  it("is order independent and does not mutate its inputs", () => {
    const { records, candidates } = dormantWorld();
    const evidence = evidenceOf(records);
    const ctx = contextOf(records, candidates);
    const before = JSON.stringify([evidence, ctx]);
    const first = deriveRevisionSignals(evidence, ctx);
    expect(JSON.stringify([evidence, ctx])).toBe(before);
    expect(deriveRevisionSignals(evidenceOf([...records].reverse()), contextOf([...records].reverse(), [...candidates].reverse()))).toEqual(first);
  });
  it("signals are sorted and their ids unique", () => {
    const { records, candidates } = dormantWorld();
    const s = signalsOf(records, candidates);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    const key = (x: (typeof s)[number]) => [x.conceptName ?? "", x.kind, x.subject ?? ""];
    const cmp = (x: string[], y: string[]) => (x[0]! < y[0]! ? -1 : x[0]! > y[0]! ? 1 : x[1]! < y[1]! ? -1 : x[1]! > y[1]! ? 1 : x[2]! < y[2]! ? -1 : x[2]! > y[2]! ? 1 : 0);
    expect(s.map(key)).toEqual([...s.map(key)].sort(cmp));
  });
});
void [NOW, EXAM, STUDENT, daysAgo];
