import type { RepairPlan } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import {
  determineSatisfiedReasons,
  buildTrainingNeedContext,
  isProgressionReady,
  rankCandidates,
  computeExposureCounts,
  selectNextQuestion,
  type AdaptiveCandidateQuestion,
  type AdaptiveSelectionResult,
  type AutopsyQuestionContext,
  type MasteryAttemptRecord
} from "../src/index.js";
import { STUDENT, computeMasteryFor, makeAttemptRecord, makeCandidate } from "./fixtures.js";

/**
 * Phase 3 Unit 4 -- the SELECTION POLICY. The stages, in order (selectNextQuestion.ts):
 *   1 eligibility + global no-immediate-repeat  2 need reasons  3 difficulty fit  4 bucket by highest reason  5 overuse avoidance within the bucket
 *   6 lexicographic ranking: difficulty fit > family coverage > cell coverage > question exposure > easier first > id
 * These tests build explicit CONFLICTS between two candidates and pin which one wins and why. No score exists anywhere in the policy.
 */

type Step = { o: "c" | "w" | "s"; q?: string; concept?: string; family?: string; cell?: string; tier?: "standard" | "advanced" | "hard"; novelty?: AutopsyQuestionContext["noveltyLevel"] };

function history(steps: Step[], o: { studentId?: string } = {}): MasteryAttemptRecord[] {
  return steps.map((s, i) =>
    makeAttemptRecord({
      isCorrect: s.o === "s" ? null : s.o === "c",
      status: s.o === "s" ? "skipped" : "submitted",
      offsetSeconds: i * 100,
      questionId: s.q ?? `hist-${i}`,
      studentId: o.studentId,
      question: {
        conceptName: s.concept ?? "Percentages",
        patternFamilyName: s.family ?? "F1",
        patternTaxonomyCellId: s.cell ?? "c1",
        difficultyTier: s.tier ?? "standard",
        noveltyLevel: s.novelty ?? "standard"
      }
    })
  );
}
const rep = (n: number, step: Step): Step[] => Array.from({ length: n }, () => step);

function cand(id: string, o: { concept?: string; family?: string; cell?: string; tier?: "standard" | "advanced" | "hard"; novelty?: AutopsyQuestionContext["noveltyLevel"]; state?: "published" | "ai_validated" } = {}): AdaptiveCandidateQuestion {
  return makeCandidate(
    { questionId: id, conceptName: o.concept ?? "Percentages", patternFamilyName: o.family ?? "F1", patternTaxonomyCellId: o.cell ?? "c1", difficultyTier: o.tier ?? "standard", noveltyLevel: o.novelty ?? "standard" },
    { expectedTimeSeconds: 90, validationState: o.state ?? "published" }
  );
}

function select(candidates: AdaptiveCandidateQuestion[], records: MasteryAttemptRecord[], plans: RepairPlan[] = [], concepts: string[] = ["Percentages"]): AdaptiveSelectionResult {
  const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: concepts.map((c) => computeMasteryFor(records, c)), attemptRecords: records, activeRepairPlans: plans, candidates });
  if (outcome.status !== "selected") throw new Error(`expected a selection, got ${outcome.reason}`);
  return outcome.result;
}

// An accuracy-weak history (2/4 correct, last answer correct so no error run): accuracy_weakness fires, nothing stronger does.
const WEAK: Step[] = [{ o: "w" }, { o: "c" }, { o: "w" }, { o: "c" }];

describe("conflict 1 -- confirmed repair beats everything the student's own data would pick (and is never difficulty-adjusted)", () => {
  const plan: RepairPlan = {
    targetConceptName: "Percentages",
    targetPatternFamilyName: "F-repair",
    targetTaxonomyCellId: "c-repair",
    targetErrorCategory: "trap",
    targetErrorTaxonomyCode: "base_confusion",
    recommendedTrainingMode: "standard_practice",
    priority: "high",
    rationale: ["confirmed by student"],
    prerequisites: [],
    confirmationSource: { attemptId: "attempt-x", hypothesisConfirmedAt: "2026-09-22T10:00:00.000Z" }
  };

  it("an advanced repair-family question wins over a progression-ready step and a below-level question, even though it is harder than the last tier", () => {
    const records = history(rep(3, { o: "c" }));
    const result = select([cand("A-basic", { family: "F-new", cell: "c-new" }), cand("M-adv", { tier: "advanced" }), cand("Z-repair", { family: "F-repair", cell: "c-x", tier: "advanced" })], records, [plan]);
    expect(result.primaryReason).toBe("repair_priority");
    expect(result.question.questionId).toBe("Z-repair");
    expect(result.difficultyFitAdjustments.some((a) => a.questionId === "Z-repair")).toBe(false); // repair_priority is never adjusted by the fit stage
  });
});

describe("conflict 2 -- overuse inside one need", () => {
  it("the right-need candidate attempted twice loses to an equally-needed, unattempted candidate (its id sorts first, so only overuse explains the result)", () => {
    const records = history([{ o: "w", q: "A-overused" }, { o: "c", q: "A-overused" }, { o: "w" }, { o: "c" }]);
    const result = select([cand("A-overused"), cand("B-fresh")], records);
    expect(result.primaryReason).toBe("accuracy_weakness");
    expect(result.question.questionId).toBe("B-fresh");
  });
});

describe("conflict 3/4/5 -- coverage distinguishes otherwise equal candidates, at family grain then cell grain", () => {
  it("pattern-family exposure: within one need and one tier, the less-practised FAMILY wins (even when both cells were seen)", () => {
    const records = history([{ o: "w", family: "F1", cell: "c1" }, { o: "c", family: "F1", cell: "c1" }, { o: "w", family: "F1", cell: "c1" }, { o: "c", family: "F2", cell: "c2" }]);
    const result = select([cand("A-f1", { family: "F1", cell: "c1" }), cand("B-f2", { family: "F2", cell: "c2" })], records);
    expect(result.primaryReason).toBe("accuracy_weakness");
    expect(result.question.questionId).toBe("B-f2"); // family F1 has 3 attempts, F2 has 1
  });

  it("taxonomy-cell exposure: within ONE family, the unseen CELL wins over a practised cell", () => {
    const records = history(rep(2, { o: "w", cell: "c1" }).concat(rep(2, { o: "c", cell: "c1" })));
    const result = select([cand("A-c1", { cell: "c1" }), cand("B-c2", { cell: "c2" })], records);
    expect(result.primaryReason).toBe("accuracy_weakness");
    expect(result.question.questionId).toBe("B-c2"); // equal tier and family; cell c1 has 4 attempts, c2 has 0
  });

  it("the exposure counts include the new cell grain, from the same attempt records", () => {
    const counts = computeExposureCounts(STUDENT, history([{ o: "c", cell: "c1" }, { o: "c", cell: "c1" }, { o: "c", cell: "c2" }]));
    expect(counts.byTaxonomyCellId.get("c1")).toBe(2);
    expect(counts.byTaxonomyCellId.get("c2")).toBe(1);
  });

  it("ranking is lexicographic and explicit: fit, family, cell, question exposure, easier first, id", () => {
    const exposure = computeExposureCounts(STUDENT, history([{ o: "c", q: "Q-seen", cell: "c1" }]));
    const pool = [cand("Z", { tier: "advanced" }), cand("Q-seen", { cell: "c1" }), cand("B", { cell: "c2" }), cand("A", { cell: "c2" })];
    const order = rankCandidates(pool, { exposure, progressionTargetTierByConcept: new Map([["Percentages", "standard"]]) }).map((c) => c.question.questionId);
    expect(order).toEqual(["A", "B", "Q-seen", "Z"]); // fit (Z is one tier off) > cell coverage (c2 unseen) > id
  });
});

describe("conflict 6/8 -- appropriate difficulty beats gratuitous difficulty; remediation is not pushed upward", () => {
  it("accuracy weakness at the standard tier: a same-level, practised-family question beats an unseen-family ADVANCED one", () => {
    const result = select([cand("A-adv", { tier: "advanced", family: "F2", cell: "c2" }), cand("Z-std")], history(WEAK));
    expect(result.primaryReason).toBe("accuracy_weakness");
    expect(result.question.questionId).toBe("Z-std");
    expect(result.difficultyFitAdjustments).toEqual([{ questionId: "A-adv", rule: "too_aggressive_for_remediation", reasonsRemoved: expect.arrayContaining(["accuracy_weakness"]) }]);
  });

  it("repeated errors: the not-harder question wins; with NO not-harder alternative the harder one is still served and nothing is adjusted (documented)", () => {
    const records = history([{ o: "w" }, { o: "w" }]);
    const both = select([cand("A-adv", { tier: "advanced", family: "F2", cell: "c2" }), cand("Z-std")], records);
    expect(both.primaryReason).toBe("repeated_error");
    expect(both.question.questionId).toBe("Z-std");
    const only = select([cand("A-adv", { tier: "advanced", family: "F2", cell: "c2" })], records);
    expect(only.primaryReason).toBe("repeated_error");
    expect(only.question.questionId).toBe("A-adv");
    expect(only.difficultyFitAdjustments).toEqual([]);
  });
});

describe("conflict 7/C -- a progression-ready student progresses when the pool supports it", () => {
  const ready = history(rep(3, { o: "c", family: "F-h", cell: "cell-h" }));

  it("the progression step beats a basic, never-seen coverage question (which would have won before the fit stage)", () => {
    const pool = [cand("A-basic", { family: "F-new", cell: "cell-new" }), cand("Z-adv", { tier: "advanced", family: "F-h", cell: "cell-h" })];
    const before = determineSatisfiedReasons(pool[0]!, buildTrainingNeedContext({ studentId: STUDENT, masteryByConcept: [computeMasteryFor(ready)], attemptRecords: ready, activeRepairPlans: [] }));
    expect(before).toContain("coverage_gap"); // the raw reason exists...
    const result = select(pool, ready);
    expect(result.question.questionId).toBe("Z-adv"); // ...but the below-level candidate no longer gets a bucket for it
    expect(result.primaryReason).toBe("difficulty_progression");
    expect(result.isFallback).toBe(false);
    expect(result.difficultyFitAdjustments).toEqual([{ questionId: "A-basic", rule: "below_progression_level", reasonsRemoved: expect.arrayContaining(["coverage_gap"]) }]);
  });

  it("guard: when the pool has nothing at/above the target tier, the basic coverage question is still served (a thin pool must yield an answer)", () => {
    const result = select([cand("A-basic", { family: "F-new", cell: "cell-new" })], ready);
    expect(result.primaryReason).toBe("coverage_gap");
    expect(result.difficultyFitAdjustments).toEqual([]);
  });

  it("CASE A: with no at-target question in the pool, an unseen-family question one tier easier beats a seen-family one TWO tiers harder (no two-step jump)", () => {
    const result = select([cand("A-easier", { tier: "standard", family: "F-new", cell: "cell-new" }), cand("B-harder", { tier: "hard", family: "F-h", cell: "cell-h" })], ready);
    expect(result.question.questionId).toBe("A-easier"); // target is advanced; B would only be reachable through the lowest reason (recent_correct_on_pace)
    expect(result.primaryReason).toBe("coverage_gap");
  });

  it("CASE A2: with an at-target question present, BOTH the below-level and the above-level candidates lose their exploration reasons", () => {
    const result = select([cand("A-easier", { family: "F-new", cell: "cell-new" }), cand("B-harder", { tier: "hard", family: "F-x", cell: "c-x" }), cand("M-target", { tier: "advanced", family: "F-h", cell: "cell-h" })], ready);
    expect(result.question.questionId).toBe("M-target");
    expect(result.difficultyFitAdjustments.map((a) => [a.questionId, a.rule])).toEqual([["A-easier", "below_progression_level"], ["B-harder", "above_progression_level"]]);
  });
});

describe("progression-readiness is withdrawn by observed problems (no stale 'ready')", () => {
  const strong = rep(15, { o: "c", family: "F-h", cell: "cell-h" });
  const readyFor = (steps: Step[]) => {
    const records = history(steps);
    const ctx = buildTrainingNeedContext({ studentId: STUDENT, masteryByConcept: [computeMasteryFor(records)], attemptRecords: records, activeRepairPlans: [] });
    return isProgressionReady("Percentages", ctx);
  };
  it("a demonstrated tier with a clean recent record is ready", () => {
    expect(readyFor(strong)).toBe(true);
  });
  it("the same demonstrated tier is NOT ready after a recent decline (trend: deteriorating), after an incorrect latest answer, or with no demonstrated tier at all", () => {
    expect(readyFor([...strong, { o: "w" }, { o: "c" }, { o: "w" }])).toBe(false);
    expect(readyFor([...strong, { o: "w" }])).toBe(false);
    expect(readyFor(rep(2, { o: "c" }))).toBe(false);
  });
});

describe("conflict 9/B/D -- novelty never blindly overrides an active need or the right level", () => {
  it("CASE B: an overused remediation candidate still beats an unseen, novel question from another concept", () => {
    const records = history([{ o: "w", q: "Z-remedial" }, { o: "c", q: "Z-remedial" }, { o: "w" }, { o: "c" }]);
    const result = select([cand("A-novel", { concept: "Ratios", family: "F-r", cell: "c-r", novelty: "novel_representation" }), cand("Z-remedial")], records);
    expect(result.primaryReason).toBe("accuracy_weakness");
    expect(result.question.questionId).toBe("Z-remedial");
  });

  it("CASE D: for a progression-ready student, a novel but below-level question loses to the less novel, right-level step", () => {
    const ready = history(rep(3, { o: "c", family: "F-h", cell: "cell-h" }));
    const result = select([cand("A-nov", { family: "F-n", cell: "c-n", novelty: "novel_representation" }), cand("Z-adv", { tier: "advanced", family: "F-h", cell: "cell-h" })], ready);
    expect(result.question.questionId).toBe("Z-adv");
  });

  it("...but novelty at the right level does win: a novel ADVANCED question outranks the plain progression step", () => {
    const ready = history(rep(3, { o: "c", family: "F-h", cell: "cell-h" }));
    const result = select([cand("A-novadv", { tier: "advanced", family: "F-n", cell: "c-n", novelty: "novel_representation" }), cand("Z-adv", { tier: "advanced", family: "F-h", cell: "cell-h" })], ready);
    expect(result.question.questionId).toBe("A-novadv");
    expect(["coverage_gap", "underexposure", "novelty_gap"]).toContain(result.primaryReason);
  });
});

describe("conflict 10/11 -- recent, accumulated and trend evidence keep their places", () => {
  it("one correct answer after an accuracy problem does not erase it (accumulated still decides), and the fit stage respects the last graded tier", () => {
    const result = select([cand("A-adv", { tier: "advanced", family: "F2", cell: "c2" }), cand("Z-std")], history([{ o: "w" }, { o: "w" }, { o: "w" }, { o: "c" }]));
    expect(result.primaryReason).toBe("accuracy_weakness");
    expect(result.question.questionId).toBe("Z-std");
  });

  it("a deteriorating trend keeps difficulty steady and is not treated as progression-ready even with a demonstrated tier", () => {
    const records = history([...rep(15, { o: "c" }), { o: "w" }, { o: "c" }, { o: "w" }]);
    const result = select([cand("A-adv", { tier: "advanced", family: "F2", cell: "c2" }), cand("Z-std")], records);
    expect(result.trendEvidence?.kind).toBe("deteriorating");
    expect(result.primaryReason).toBe("recent_deterioration");
    expect(result.question.questionId).toBe("Z-std");
  });
});

describe("conflict 12/13/E -- no immediate repeat, globally, with a documented fallback", () => {
  const records = history([{ o: "w" }, { o: "c" }, { o: "w", q: "Q-just" }]); // accuracy_weakness; Q-just was the last attempt

  it("when alternatives exist the just-attempted question is never re-served, even if it would be the ONLY member of the winning reason bucket", () => {
    const healthy = cand("Z-other", { concept: "Ratios", family: "F-r", cell: "c-r" });
    const result = select([cand("Q-just"), healthy], records);
    expect(result.question.questionId).toBe("Z-other");
    expect(result.excludedJustAttempted).toBe(true);
    expect(result.repeatFallback).toBe(false);
    expect(result.rankedAlternatives.map((a) => a.questionId)).not.toContain("Q-just");
  });

  it("DOCUMENTED FALLBACK: when it is the ONLY eligible candidate it is re-served and the result says so", () => {
    const result = select([cand("Q-just")], records);
    expect(result.question.questionId).toBe("Q-just");
    expect(result.repeatFallback).toBe(true);
    expect(result.excludedJustAttempted).toBe(false);
  });

  it("an unpublished alternative is not an alternative: the repeat fallback still applies when the only other candidate is unpublished", () => {
    const result = select([cand("Q-just"), cand("Z-draft", { state: "ai_validated" })], records);
    expect(result.question.questionId).toBe("Q-just");
    expect(result.repeatFallback).toBe(true);
    expect(result.excludedUnpublishedCount).toBe(1);
  });
});

describe("conflict 14-19 -- safety, isolation, determinism", () => {
  it("published-only and malformed-exclusion hold in front of the new stages", () => {
    const ready = history(rep(3, { o: "c", family: "F-h", cell: "cell-h" }));
    const malformed = cand("A-bad", { tier: "advanced" });
    (malformed.question as { patternTaxonomyCellId: string }).patternTaxonomyCellId = "";
    const result = select([cand("A-draft", { tier: "advanced", state: "ai_validated" }), malformed, cand("Z-adv", { tier: "advanced", family: "F-h", cell: "cell-h" })], ready);
    expect(result.question.questionId).toBe("Z-adv");
    expect(result.excludedUnpublishedCount).toBe(1);
    expect(result.excludedMalformedCount).toBe(1);
  });

  it("another student's history never changes the selection", () => {
    const pool = () => [cand("A-basic", { family: "F-new", cell: "cell-new" }), cand("Z-adv", { tier: "advanced", family: "F-h", cell: "cell-h" })];
    const foreign = history(rep(3, { o: "c", family: "F-h", cell: "cell-h" }), { studentId: "someone-else" });
    const withForeign = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: foreign, candidates: pool() });
    const cold = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: pool() });
    expect(withForeign).toEqual(cold);
  });

  it("identical inputs give identical selections, in any candidate order", () => {
    const ready = history(rep(3, { o: "c", family: "F-h", cell: "cell-h" }));
    const pool = [cand("A-basic", { family: "F-new", cell: "cell-new" }), cand("Z-adv", { tier: "advanced", family: "F-h", cell: "cell-h" }), cand("M-x", { family: "F-m", cell: "c-m" })];
    expect(select(pool, ready)).toEqual(select([...pool].reverse(), ready));
    expect(select(pool, ready)).toEqual(select(pool, ready));
  });

  it("no composite score, confidence or psychological field exists on the result, and nothing answer-bearing leaks into it", () => {
    const result = select([cand("A"), cand("B", { tier: "advanced" })], history(WEAK));
    const forbidden = ["score", "overallmastery", "confidence", "motivation", "emotion", "intelligence", "predictedability", "anxiety"];
    const keys = (value: unknown): string[] => (value && typeof value === "object" ? Object.entries(value as object).flatMap(([k, v]) => [k, ...keys(v)]) : []);
    for (const key of keys(result)) expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/correctAnswer|solutionSteps|groundTruth|expectedAnswer/);
  });
});
