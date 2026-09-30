import type { RepairPlan } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { selectNextQuestion, TRAINING_NEED_PRIORITY_ORDER, type AdaptiveCandidateQuestion, type AdaptiveSelectionResult, type MasteryAttemptRecord, type TrainingNeedReasonCode } from "../src/index.js";
import { STUDENT, computeMasteryFor, makeAttemptRecord, makeCandidate } from "./fixtures.js";

/**
 * Phase 3 Unit 5 -- POLICY CONSISTENCY MATRIX.
 *   observable evidence  ->  training need (reason)  ->  candidate eligibility / adjustment  ->  selection stage  ->  explanation
 * One constructive scenario per reason proves that EVERY reason is reachable as the deciding reason (none is dead code) and that the
 * explanation matches it. The mapping is reproduced in PHASE_3_ADAPTIVE_PRACTICE.md. Synthetic fixtures only -- this is not outcome data.
 */

type Step = { o: "c" | "w" | "s"; slow?: boolean; concept?: string; tier?: "standard" | "advanced"; family?: string; cell?: string };

function history(steps: Step[]): MasteryAttemptRecord[] {
  return steps.map((s, i) =>
    makeAttemptRecord({
      isCorrect: s.o === "s" ? null : s.o === "c",
      status: s.o === "s" ? "skipped" : "submitted",
      offsetSeconds: i * 100,
      timeTakenSeconds: s.slow ? 200 : 60,
      expectedTimeSeconds: 90,
      questionId: `hist-${i}`,
      question: { conceptName: s.concept ?? "Percentages", patternFamilyName: s.family ?? "F1", patternTaxonomyCellId: s.cell ?? "c1", difficultyTier: s.tier ?? "standard" }
    })
  );
}
const rep = (n: number, s: Step): Step[] => Array.from({ length: n }, () => s);
const cand = (id: string, o: { concept?: string; tier?: "standard" | "advanced"; family?: string; cell?: string; novelty?: "standard" | "novel_representation"; modes?: Array<"reverse" | "time_pressured"> } = {}): AdaptiveCandidateQuestion =>
  makeCandidate({ questionId: id, conceptName: o.concept ?? "Percentages", difficultyTier: o.tier ?? "standard", patternFamilyName: o.family ?? "F1", patternTaxonomyCellId: o.cell ?? "c1", noveltyLevel: o.novelty ?? "standard", testingModes: o.modes ?? ["reverse"] }, { expectedTimeSeconds: 90 });

function run(candidates: AdaptiveCandidateQuestion[], records: MasteryAttemptRecord[], plans: RepairPlan[] = [], concepts: string[] = ["Percentages"]): AdaptiveSelectionResult {
  const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: concepts.map((c) => computeMasteryFor(records, c)), attemptRecords: records, activeRepairPlans: plans, candidates });
  if (outcome.status !== "selected") throw new Error(`expected a selection, got ${outcome.reason}`);
  return outcome.result;
}
const plan = (o: Partial<RepairPlan> = {}): RepairPlan => ({
  targetConceptName: "Percentages", targetPatternFamilyName: "F-repair", targetTaxonomyCellId: "c-repair", targetErrorCategory: "trap", targetErrorTaxonomyCode: "base_confusion",
  recommendedTrainingMode: "standard_practice", priority: "high", rationale: ["confirmed by student"], prerequisites: [], confirmationSource: { attemptId: "attempt-x", hypothesisConfirmedAt: "2026-09-22T10:00:00.000Z" }, ...o
});
const WEAK: Step[] = [{ o: "w" }, { o: "c" }, { o: "w" }, { o: "c" }];
const READY = rep(3, { o: "c" });

const MATRIX: Array<{ reason: TrainingNeedReasonCode; evidence: string; build: () => AdaptiveSelectionResult; explains: RegExp }> = [
  { reason: "repair_priority", evidence: "a confirmed RepairPlan targets this concept + family", build: () => run([cand("Z", { family: "F-repair", cell: "c-x" }), cand("A")], history(READY), [plan()]), explains: /confirmed diagnosis is actively targeting/ },
  { reason: "repeated_error", evidence: "the current run of incorrect graded answers is >= 2", build: () => run([cand("Z")], history([{ o: "w" }, { o: "w" }])), explains: /most recent 2 graded answers .* were all incorrect/ },
  { reason: "recent_deterioration", evidence: "earlier graded accuracy >= 0.8, recent window < 0.6, no trailing run of 2", build: () => run([cand("Z"), cand("A", { tier: "advanced", family: "F2", cell: "c2" })], history([...rep(4, { o: "c" }), { o: "w" }, { o: "c" }, { o: "w" }])), explains: /of your last 3 graded answers were correct, compared with 4 of 4 earlier ones/ },
  { reason: "prerequisite_weakness", evidence: "a confirmed plan lists this concept as a prerequisite and its accuracy is below threshold or unmeasured", build: () => run([cand("Z", { concept: "Percentages" })], [], [plan({ targetConceptName: "Fractions", targetPatternFamilyName: "F-x", prerequisites: ["Percentages"] })]), explains: /prerequisite/ },
  { reason: "accuracy_weakness", evidence: "mean graded accuracy < 0.6 with >= 3 graded attempts", build: () => run([cand("Z")], history(WEAK)), explains: /of 4 graded answers on "Percentages" were incorrect/ },
  { reason: "speed_weakness", evidence: "mean time/expected >= 1.3 over >= 3 timed attempts", build: () => run([cand("Z")], history(rep(3, { o: "c", slow: true }))), explains: /took on average 2\.22x the expected time/ },
  { reason: "recent_improvement", evidence: "earlier accuracy < 0.6 and all of the last 3 correct", build: () => run([cand("Z"), cand("A", { tier: "advanced", family: "F2", cell: "c2" })], history([...rep(3, { o: "w" }), ...rep(3, { o: "c" })])), explains: /last 3 graded answers were all correct, compared with 0 of 3 earlier ones/ },
  { reason: "recent_incorrect", evidence: "the latest attempt was incorrect (fewer than 2 in a row)", build: () => run([cand("Z")], history([{ o: "w" }])), explains: /answer was incorrect/ },
  { reason: "recent_skip", evidence: "the latest attempt was skipped", build: () => run([cand("Z")], history([{ o: "s" }])), explains: /was skipped/ },
  { reason: "recent_slow", evidence: "the latest attempt was correct but >= 1.3x the expected time", build: () => run([cand("Z")], history([{ o: "c", slow: true }])), explains: /answered correctly but took 200s against 90s expected/ },
  { reason: "coverage_gap", evidence: "the candidate's taxonomy cell has never been attempted (cold start)", build: () => run([cand("Z")], []), explains: /never attempted this exact taxonomy cell/ },
  { reason: "underexposure", evidence: "the pattern family has <= 2 attempts while the student has history", build: () => run([cand("Z")], history([{ o: "c" }])), explains: /very few prior attempts/ },
  { reason: "pressure_gap", evidence: "a time-pressured candidate and unmeasured pressure performance", build: () => run([cand("Z", { modes: ["time_pressured"] })], history(READY)), explains: /time-pressured questions/ },
  { reason: "novelty_gap", evidence: "a non-standard-novelty candidate and unmeasured novelty handling", build: () => run([cand("Z", { novelty: "novel_representation" })], history(READY)), explains: /novel-representation content/ },
  { reason: "difficulty_progression", evidence: "a tier with >= 3 graded attempts at >= 0.8 makes the next tier the target", build: () => run([cand("Z", { tier: "advanced" })], history(READY)), explains: /appropriate next step/ },
  { reason: "recent_correct_on_pace", evidence: "the latest attempt was correct within the expected time (never a need on its own)", build: () => run([cand("Z")], history(READY)), explains: /answered correctly within the expected time/ }
];

describe("policy consistency matrix: every reason is reachable, and its explanation matches it", () => {
  it("the matrix covers exactly the reasons the policy defines -- none missing, none dead", () => {
    expect(MATRIX.map((m) => m.reason).sort()).toEqual([...TRAINING_NEED_PRIORITY_ORDER].sort());
  });

  for (const row of MATRIX) {
    it(`${row.reason}: ${row.evidence}`, () => {
      const result = row.build();
      expect(result.primaryReason).toBe(row.reason);
      expect(result.isFallback).toBe(false);
      expect(result.allReasonsSatisfied).toContain(row.reason);
      expect(result.explanation).toMatch(row.explains);
      expect(result.explanation).not.toMatch(/confiden|motivat|anxi|lazy|careless|struggl|intelligen|afraid|feel|bad at|naturally|losing|weak(?!ness)/i);
    });
  }

  it("the selected candidate is consistent with its reason (the question the explanation talks about is the one returned)", () => {
    const r = run([cand("Z", { tier: "advanced" }), cand("A", { family: "F2", cell: "c2" })], history(READY));
    expect(r.primaryReason).toBe("difficulty_progression");
    expect(r.question.difficultyTier).toBe("advanced");
    expect(r.explanation).toContain('"advanced"');
  });
});

describe("impossible or contradictory combinations are handled safely", () => {
  it("demonstrated tier at the top of the pool with no target-tier question: the demonstrated tier is the band, so a basic unseen question does not win exploration", () => {
    const records = history(rep(4, { o: "c", tier: "advanced", family: "F-h", cell: "c-h" }));
    const hard = makeCandidate({ questionId: "Z-hard", conceptName: "Percentages", difficultyTier: "hard", patternFamilyName: "F-h", patternTaxonomyCellId: "c-h" }, { expectedTimeSeconds: 90 });
    const adv = cand("M-adv", { tier: "advanced", family: "F-h", cell: "c-h" });
    const basic = cand("A-basic", { family: "F-new", cell: "c-new" });
    // target is "hard" (one above the demonstrated advanced tier): the hard question is the band
    expect(run([basic, adv, hard], records).question.questionId).toBe("Z-hard");
    // no "hard" question in the pool: the demonstrated tier ("advanced") becomes the band, and the basic question still does not win
    const r = run([basic, adv], records);
    expect(r.question.questionId).toBe("M-adv");
    expect(r.difficultyFitAdjustments).toEqual([{ questionId: "A-basic", rule: "below_progression_level", reasonsRemoved: expect.arrayContaining(["coverage_gap"]) }]);
  });

  it("a thin, single-concept pool where every candidate is harder than the remediation reference is never emptied", () => {
    const r = run([cand("A-adv", { tier: "advanced" }), cand("B-adv", { tier: "advanced", family: "F2", cell: "c2" })], history([{ o: "w" }, { o: "w" }]));
    expect(r.primaryReason).toBe("repeated_error");
    expect(r.difficultyFitAdjustments).toEqual([]);
  });

  it("an abandoned or skipped attempt never contaminates the graded trend or the accumulated counts", () => {
    const base = history([...rep(3, { o: "w" }), ...rep(3, { o: "c" })]);
    const noisy = [...base, makeAttemptRecord({ isCorrect: null, status: "abandoned", offsetSeconds: 250, questionId: "abandoned-1" }), makeAttemptRecord({ isCorrect: null, status: "skipped", offsetSeconds: 260, questionId: "skipped-1" })];
    expect(run([cand("Z"), cand("A", { tier: "advanced", family: "F2", cell: "c2" })], noisy).trendEvidence).toEqual(run([cand("Z"), cand("A", { tier: "advanced", family: "F2", cell: "c2" })], base).trendEvidence);
  });
});

describe("scale smoke test (no timing claim beyond 'not quadratic')", () => {
  it("20,000 candidates in one concept and 5,000 attempts select deterministically in seconds, not minutes", () => {
    const pool: AdaptiveCandidateQuestion[] = Array.from({ length: 20000 }, (_, i) => cand(`P${String(i).padStart(5, "0")}`, { tier: i % 3 === 0 ? "advanced" : "standard", family: `F${i % 40}`, cell: `c${i % 400}` }));
    const records = Array.from({ length: 5000 }, (_, i) => makeAttemptRecord({ isCorrect: i % 4 !== 0, offsetSeconds: i * 10, questionId: `H${i}`, question: { patternFamilyName: `F${i % 40}`, patternTaxonomyCellId: `c${i % 400}` } }));
    const started = Date.now();
    const first = run(pool, records);
    const elapsed = Date.now() - started;
    expect(run([...pool].reverse(), records)).toEqual(first);
    expect(elapsed).toBeLessThan(20000); // generous, host-independent ceiling: a quadratic pass over 20,000 candidates per candidate would not finish
  }, 120000);
});
