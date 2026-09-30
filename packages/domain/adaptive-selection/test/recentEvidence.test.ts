import { describe, expect, it } from "vitest";
import {
  compareByRecentPreference,
  deriveRecentEvidence,
  recentEvidenceReasonFor,
  selectNextQuestion,
  TRAINING_NEED_PRIORITY_ORDER,
  type AdaptiveSelectionResult
} from "../src/index.js";
import { CONCEPT, STUDENT, computeMasteryFor, makeAttemptRecord, makeCandidate } from "./fixtures.js";

/**
 * Phase 3.1 -- the first adaptive layer: deterministic reaction to the student's most recent finalized attempt, using only
 * observable evidence (outcome, verdict, time vs expected) and Question DNA. Nothing here asserts anything about the student.
 */

function select(candidates: ReturnType<typeof makeCandidate>[], records: ReturnType<typeof makeAttemptRecord>[]): AdaptiveSelectionResult {
  const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [computeMasteryFor(records)], attemptRecords: records, candidates });
  if (outcome.status !== "selected") throw new Error(`expected a selection, got ${outcome.reason}`);
  return outcome.result;
}

// A small pool of one concept across two tiers and three pattern families.
const std = () => makeCandidate({ questionId: "Q-std", difficultyTier: "standard", patternFamilyName: "Point", patternTaxonomyCellId: "cell-point" }, { expectedTimeSeconds: 45 });
const advA = () => makeCandidate({ questionId: "Q-advA", difficultyTier: "advanced", patternFamilyName: "Successive", patternTaxonomyCellId: "cell-succ" }, { expectedTimeSeconds: 75 });
const advB = () => makeCandidate({ questionId: "Q-advB", difficultyTier: "advanced", patternFamilyName: "Reverse", patternTaxonomyCellId: "cell-rev" }, { expectedTimeSeconds: 90 });
const pool = () => [std(), advA(), advB()];

/** A history of exactly ONE attempt, on the given candidate's question (so the same cell/family is "attempted"). */
const attempt = (c: ReturnType<typeof makeCandidate>, o: { isCorrect: boolean | null; status?: "submitted" | "skipped" | "abandoned"; time?: number; expected?: number; offset?: number }) =>
  makeAttemptRecord({
    isCorrect: o.isCorrect,
    status: o.status,
    timeTakenSeconds: o.time ?? 40,
    expectedTimeSeconds: o.expected ?? c.expectedTimeSeconds,
    offsetSeconds: o.offset,
    questionId: c.question.questionId,
    question: { ...c.question }
  });

describe("deriveRecentEvidence -- what counts as observable evidence", () => {
  it("no attempts -> null (cold start behaves exactly as before)", () => {
    expect(deriveRecentEvidence(STUDENT, [])).toBeNull();
  });

  it("classifies the LATEST submitted-or-skipped attempt: incorrect / skipped / correct_slow / correct_on_pace", () => {
    const c = advA();
    expect(deriveRecentEvidence(STUDENT, [attempt(c, { isCorrect: false })])?.signal).toBe("incorrect");
    expect(deriveRecentEvidence(STUDENT, [attempt(c, { isCorrect: null, status: "skipped" })])?.signal).toBe("skipped");
    expect(deriveRecentEvidence(STUDENT, [attempt(c, { isCorrect: true, time: 60, expected: 75 })])?.signal).toBe("correct_on_pace");
    expect(deriveRecentEvidence(STUDENT, [attempt(c, { isCorrect: true, time: 130, expected: 90 })])?.signal).toBe("correct_slow");
  });

  it("slow uses the existing per-attempt ratio (1.3x): exactly 1.3x is slow, just under is on pace; missing/zero expected time is never slow", () => {
    const c = advA();
    expect(deriveRecentEvidence(STUDENT, [attempt(c, { isCorrect: true, time: 130, expected: 100 })])?.signal).toBe("correct_slow");
    expect(deriveRecentEvidence(STUDENT, [attempt(c, { isCorrect: true, time: 129, expected: 100 })])?.signal).toBe("correct_on_pace");
    expect(deriveRecentEvidence(STUDENT, [attempt(c, { isCorrect: true, time: 500, expected: 0 })])?.signal).toBe("correct_on_pace");
  });

  it("uses the most recent by finalizedAt regardless of array order; abandoned attempts and other students are ignored", () => {
    const c = advA();
    const older = attempt(c, { isCorrect: false, offset: 100 });
    const newer = attempt(std(), { isCorrect: true, time: 30, expected: 45, offset: 900 });
    const abandoned = attempt(advB(), { isCorrect: null, status: "abandoned", offset: 2000 });
    const other = makeAttemptRecord({ isCorrect: false, studentId: "someone-else", offsetSeconds: 5000 });
    expect(deriveRecentEvidence(STUDENT, [newer, older, abandoned, other])?.signal).toBe("correct_on_pace");
    expect(deriveRecentEvidence(STUDENT, [newer, older, abandoned, other])?.question.questionId).toBe("Q-std");
  });

  it("a submitted attempt with no verdict is not evidence of anything", () => {
    expect(deriveRecentEvidence(STUDENT, [attempt(advA(), { isCorrect: null })])).toBeNull();
  });
});

describe("the four rules select differently from the SAME pool", () => {
  it("1. no prior performance: selection stays valid and safe, with no recent evidence and no recent_* reason", () => {
    const result = select(pool(), []);
    expect(result.recentEvidence).toBeNull();
    expect(result.primaryReason).not.toMatch(/^recent_/);
    expect(pool().map((c) => c.question.questionId)).toContain(result.question.questionId);
  });

  it("2. INCORRECT on an advanced question -> a related question that is not harder, never the missed question itself", () => {
    const last = advA();
    const result = select(pool(), [attempt(last, { isCorrect: false })]);
    expect(result.primaryReason).toBe("recent_incorrect");
    expect(result.question.questionId).not.toBe("Q-advA");
    expect(result.recentEvidence?.signal).toBe("incorrect");
    expect(result.question.questionId).toBe("Q-std"); // no same-family option, so the strictly easier tier is preferred
    expect(result.explanation).toMatch(/answer was incorrect/);
  });

  it("2b. INCORRECT prefers the SAME pattern family as the missed question over merely a lower tier", () => {
    const sameFamilyEqualTier = makeCandidate({ questionId: "Q-sameFam", difficultyTier: "advanced", patternFamilyName: "Successive", patternTaxonomyCellId: "cell-succ-2" });
    const result = select([std(), advA(), sameFamilyEqualTier], [attempt(advA(), { isCorrect: false })]);
    expect(result.primaryReason).toBe("recent_incorrect");
    expect(result.question.questionId).toBe("Q-sameFam");
  });

  it("2c. INCORRECT never picks an UNRELATED concept, and never a harder tier -- with no eligible related item nothing is forced (falls through, still selects)", () => {
    const unrelated = makeCandidate({ questionId: "Q-unrelated", conceptName: "Geometry", difficultyTier: "standard", patternFamilyName: "Other", patternTaxonomyCellId: "cell-other" });
    const harder = makeCandidate({ questionId: "Q-hard", difficultyTier: "hard", patternFamilyName: "Hard", patternTaxonomyCellId: "cell-hard" });
    const result = select([advA(), unrelated, harder], [attempt(advA(), { isCorrect: false })]);
    expect(result.primaryReason).not.toBe("recent_incorrect");
    expect(result.question.questionId).toBeTruthy(); // fails safe: a valid published question is still returned
  });

  it("2d. a concept the missed question is built on (combinesWithConcepts) counts as related", () => {
    const last = makeCandidate({ questionId: "Q-last", difficultyTier: "advanced", combinesWithConcepts: ["Ratio"], patternFamilyName: "A", patternTaxonomyCellId: "cell-a" });
    const ratioQ = makeCandidate({ questionId: "Q-ratio", conceptName: "Ratio", difficultyTier: "standard", patternFamilyName: "R", patternTaxonomyCellId: "cell-r" });
    const result = select([last, ratioQ], [attempt(last, { isCorrect: false })]);
    expect(result.primaryReason).toBe("recent_incorrect");
    expect(result.question.questionId).toBe("Q-ratio");
  });

  it("3. SKIP is distinct evidence: not harder, ANY concept, lower tier first, then shorter expected time", () => {
    const last = advA();
    const otherConceptEasy = makeCandidate({ questionId: "Q-geo", conceptName: "Geometry", difficultyTier: "standard", patternFamilyName: "G", patternTaxonomyCellId: "cell-g" }, { expectedTimeSeconds: 30 });
    const result = select([last, std(), otherConceptEasy, advB()], [attempt(last, { isCorrect: null, status: "skipped" })]);
    expect(result.primaryReason).toBe("recent_skip");
    expect(result.recentEvidence?.signal).toBe("skipped");
    expect(result.question.questionId).toBe("Q-geo"); // lower tier, and the shortest expected time (30s vs 45s)
    expect(result.explanation).toMatch(/was skipped/);
  });

  it("3b. skip and incorrect produce DIFFERENT picks from an identical pool (a skip is not treated as an incorrect answer)", () => {
    const last = advA();
    const sameFamilyEqualTier = makeCandidate({ questionId: "Q-sameFam", difficultyTier: "advanced", patternFamilyName: "Successive", patternTaxonomyCellId: "cell-succ-2" });
    const p = () => [std(), last, sameFamilyEqualTier];
    const afterIncorrect = select(p(), [attempt(last, { isCorrect: false })]);
    const afterSkip = select(p(), [attempt(last, { isCorrect: null, status: "skipped" })]);
    expect(afterIncorrect.question.questionId).toBe("Q-sameFam");
    expect(afterSkip.question.questionId).toBe("Q-std");
    expect(afterIncorrect.primaryReason).toBe("recent_incorrect");
    expect(afterSkip.primaryReason).toBe("recent_skip");
  });

  it("4. SLOW but correct consumes elapsed-vs-expected: stays at the same tier and concept instead of stepping up", () => {
    const last = std();
    const result = select([last, makeCandidate({ questionId: "Q-std2", difficultyTier: "standard", patternFamilyName: "P2", patternTaxonomyCellId: "cell-p2" }), advA()], [attempt(last, { isCorrect: true, time: 100, expected: 45 })]);
    expect(result.recentEvidence?.signal).toBe("correct_slow");
    expect(result.primaryReason).toBe("recent_slow");
    expect(result.question.questionId).toBe("Q-std2");
    expect(result.explanation).toMatch(/took 100s against 45s expected/);
  });

  it("4b. the same correct answer ON PACE is NOT treated as slow (elapsed time actually changes the outcome)", () => {
    const last = std();
    const p = () => [last, makeCandidate({ questionId: "Q-std2", difficultyTier: "standard", patternFamilyName: "P2", patternTaxonomyCellId: "cell-p2" }), advA()];
    expect(select(p(), [attempt(last, { isCorrect: true, time: 100, expected: 45 })]).primaryReason).toBe("recent_slow");
    expect(select(p(), [attempt(last, { isCorrect: true, time: 30, expected: 45 })]).primaryReason).not.toBe("recent_slow");
  });

  it("5. CORRECT on pace is not treated as weakness: no weakness/recent-problem reason, and the answered question is not re-served", () => {
    const last = std();
    const result = select(pool(), [attempt(last, { isCorrect: true, time: 30, expected: 45 })]);
    expect(result.recentEvidence?.signal).toBe("correct_on_pace");
    expect(["recent_incorrect", "recent_skip", "recent_slow", "accuracy_weakness", "repeated_error", "speed_weakness"]).not.toContain(result.primaryReason);
    expect(result.question.questionId).not.toBe("Q-std");
  });

  it("5b. correct_on_pace decides only when nothing else stands out, and then steps UP by the smallest step (never a repeat)", () => {
    // Every family/cell already attempted 3x correctly & on pace, all candidates standard: no coverage/underexposure/progression need.
    const cands = ["1", "2", "3"].map((n) => makeCandidate({ questionId: `Q-s${n}`, difficultyTier: "standard", patternFamilyName: `F${n}`, patternTaxonomyCellId: `cell-${n}` }));
    const history = cands.flatMap((c, i) => [0, 1, 2].map((k) => makeAttemptRecord({ isCorrect: true, timeTakenSeconds: 40, expectedTimeSeconds: 90, offsetSeconds: i * 10 + k, questionId: `hist-${c.question.questionId}-${k}`, question: { ...c.question } })));
    const last = makeAttemptRecord({ isCorrect: true, timeTakenSeconds: 40, expectedTimeSeconds: 90, offsetSeconds: 10_000, questionId: "Q-s1", question: { ...cands[0]!.question } });
    const result = select(cands, [...history, last]);
    expect(result.primaryReason).toBe("recent_correct_on_pace");
    expect(result.question.questionId).not.toBe("Q-s1");
  });
});

describe("priority, safety and determinism", () => {
  it("the multi-attempt weakness reasons still outrank a recent_* reason; recent_* outranks coverage; recent_correct_on_pace is the lowest named reason", () => {
    const o = TRAINING_NEED_PRIORITY_ORDER;
    expect(o.indexOf("repeated_error")).toBeLessThan(o.indexOf("recent_incorrect"));
    expect(o.indexOf("accuracy_weakness")).toBeLessThan(o.indexOf("recent_incorrect"));
    expect(o.indexOf("speed_weakness")).toBeLessThan(o.indexOf("recent_slow"));
    for (const r of ["recent_incorrect", "recent_skip", "recent_slow"] as const) expect(o.indexOf(r)).toBeLessThan(o.indexOf("coverage_gap"));
    expect(o[o.length - 1]).toBe("recent_correct_on_pace");
  });

  it("three incorrect answers in a row: measured repeated-error/accuracy evidence wins over the single-attempt reaction", () => {
    const records = [advA(), advA(), advA()].map((c, i) => makeAttemptRecord({ isCorrect: false, offsetSeconds: i * 10, questionId: `h${i}`, question: { ...c.question } }));
    const result = select(pool(), records);
    expect(["repeated_error", "accuracy_weakness"]).toContain(result.primaryReason);
  });

  it("published-only: an unpublished question that would be the perfect recent match is never selected", () => {
    const draftBest = makeCandidate({ questionId: "Q-draft", difficultyTier: "standard", patternFamilyName: "Successive", patternTaxonomyCellId: "cell-d" }, { validationState: "ai_validated" });
    const result = select([advA(), draftBest, advB()], [attempt(advA(), { isCorrect: false })]);
    expect(result.question.questionId).not.toBe("Q-draft");
    expect(result.excludedUnpublishedCount).toBe(1);
  });

  it("if the just-attempted question is the ONLY candidate it is still returned (a repeat beats nothing)", () => {
    const only = advA();
    const result = select([only], [attempt(only, { isCorrect: false })]);
    expect(result.question.questionId).toBe("Q-advA");
  });

  it("the just-attempted question is not re-served from any bucket while an alternative exists (even when no recent rule applies)", () => {
    const a = makeCandidate({ questionId: "Q-a", difficultyTier: "advanced", patternFamilyName: "Same", patternTaxonomyCellId: "cell-1" });
    const b = makeCandidate({ questionId: "Q-b", difficultyTier: "advanced", patternFamilyName: "Same", patternTaxonomyCellId: "cell-2" });
    const result = select([a, b], [attempt(a, { isCorrect: true, time: 30, expected: 90 })]);
    expect(result.question.questionId).toBe("Q-b");
  });

  it("recentEvidenceReasonFor: never satisfied for the just-attempted question, and null without evidence", () => {
    const last = advA();
    const evidence = deriveRecentEvidence(STUDENT, [attempt(last, { isCorrect: false })]);
    expect(recentEvidenceReasonFor(last, evidence)).toBeNull();
    expect(recentEvidenceReasonFor(std(), null)).toBeNull();
  });

  it("compareByRecentPreference is a total, deterministic order for each rule", () => {
    const evidence = deriveRecentEvidence(STUDENT, [attempt(advA(), { isCorrect: null, status: "skipped" })])!;
    const sorted = [advB(), std()].sort(compareByRecentPreference(evidence));
    expect(sorted.map((c) => c.question.questionId)).toEqual(["Q-std", "Q-advB"]);
  });

  it("is deterministic, and every recent_* explanation states observations only (no inference about the student)", () => {
    const cases: Array<[ReturnType<typeof makeAttemptRecord>[], RegExp]> = [
      [[attempt(advA(), { isCorrect: false })], /incorrect/],
      [[attempt(advA(), { isCorrect: null, status: "skipped" })], /skipped/],
      [[attempt(advA(), { isCorrect: true, time: 130, expected: 75 })], /took 130s/]
    ];
    for (const [records, expected] of cases) {
      const first = select(pool(), records);
      const second = select(pool(), records);
      expect(second).toEqual(first);
      expect(first.explanation).toMatch(expected);
      expect(first.explanation).not.toMatch(/confiden|motivat|anxi|lazy|careless|weak|understand|intelligen|struggl|afraid|feel/i);
    }
    expect(CONCEPT).toBe("Percentages");
  });
});
