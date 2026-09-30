import type { RepairPlan } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import {
  buildTrainingNeedContext,
  DIFFICULTY_TIER_ORDER,
  determineSatisfiedReasons,
  isProgressionReady,
  REMEDIATION_REASONS,
  EXPLORATION_REASONS,
  selectNextQuestion,
  TRAINING_NEED_PRIORITY_ORDER,
  validateAdaptiveCandidateQuestion,
  type AdaptiveCandidateQuestion,
  type AdaptiveSelectionResult,
  type DifficultyTier,
  type MasteryAttemptRecord,
  type TrainingNeedReasonCode
} from "../src/index.js";
import { STUDENT, computeMasteryFor, makeAttemptRecord, makeCandidate } from "./fixtures.js";

/**
 * Phase 3 Unit 5 -- the POLICY VALIDATION FRAMEWORK.
 *
 * This is TECHNICAL and POLICY validation only: it proves the code follows its documented rules over many generated situations. It says
 * NOTHING about whether the rules or thresholds help anyone learn -- that needs real outcome data (see PHASE_3_ADAPTIVE_PRACTICE.md,
 * "Validation levels"). Scenarios come from a fixed-seed PRNG, so every run is identical and any failure is reproducible from its seed.
 */

// ---- deterministic generator (mulberry32) ----
function rngFor(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T;
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  return { next, int, pick, shuffle };
}

const CONCEPTS = ["Percentages", "Ratios"] as const;
const TIERS: DifficultyTier[] = ["standard", "advanced", "hard"];
const NOVELTY = ["standard", "novel_representation"] as const;
const tierRank = (t: DifficultyTier) => TIERS.indexOf(t);

interface Scenario {
  seed: number;
  own: MasteryAttemptRecord[];
  foreign: MasteryAttemptRecord[];
  candidates: AdaptiveCandidateQuestion[];
  plans: RepairPlan[];
}

function buildScenario(seed: number): Scenario {
  const r = rngFor(seed);
  const nCand = 1 + r.int(8);
  const candIds = Array.from({ length: nCand }, (_, i) => `Q${i}`);
  const cell = () => `c${1 + r.int(4)}`;
  const question = (id: string) => {
    const c = cell();
    return { questionId: id, conceptName: r.pick(CONCEPTS), patternFamilyName: `F-${c}`, patternTaxonomyCellId: c, difficultyTier: r.pick(TIERS), noveltyLevel: r.pick(NOVELTY), testingModes: r.int(4) === 0 ? ["time_pressured" as const] : ["reverse" as const] };
  };
  const candidates: AdaptiveCandidateQuestion[] = candIds.map((id) => {
    const cand = makeCandidate(question(id), { expectedTimeSeconds: 90, validationState: r.int(6) === 0 ? "ai_validated" : "published" });
    if (r.int(10) === 0) (cand.question as { patternTaxonomyCellId: string }).patternTaxonomyCellId = ""; // malformed
    return cand;
  });
  if (r.int(8) === 0 && candidates.length > 0) candidates.push(JSON.parse(JSON.stringify(candidates[0])) as AdaptiveCandidateQuestion); // an exact duplicate

  const history = (studentId: string | undefined, n: number): MasteryAttemptRecord[] =>
    Array.from({ length: n }, (_, i) => {
      const o = r.int(10); // 0-5 correct, 6-8 wrong, 9 skip/abandoned
      const reuse = r.int(3) === 0 ? r.pick(candIds) : `H-${studentId ?? "me"}-${i}`;
      const q = question(reuse);
      return makeAttemptRecord({
        isCorrect: o >= 9 ? null : o <= 5,
        status: o === 9 ? (r.int(2) === 0 ? "skipped" : "abandoned") : "submitted",
        offsetSeconds: Math.floor(i / 2) * 100, // deliberate equal timestamps in pairs
        timeTakenSeconds: r.int(4) === 0 ? 200 : 60,
        expectedTimeSeconds: 90,
        questionId: q.questionId,
        studentId,
        question: { conceptName: q.conceptName, patternFamilyName: q.patternFamilyName, patternTaxonomyCellId: q.patternTaxonomyCellId, difficultyTier: q.difficultyTier, noveltyLevel: q.noveltyLevel, testingModes: q.testingModes }
      });
    });
  const own = history(undefined, r.int(16));
  const foreign = history("someone-else", r.int(12));
  const plans: RepairPlan[] =
    r.int(5) === 0
      ? [{ targetConceptName: r.pick(CONCEPTS), targetPatternFamilyName: `F-${cell()}`, targetTaxonomyCellId: cell(), targetErrorCategory: "trap", targetErrorTaxonomyCode: "base_confusion", recommendedTrainingMode: "standard_practice", priority: "high", rationale: ["confirmed by student"], prerequisites: [], confirmationSource: { attemptId: "attempt-x", hypothesisConfirmedAt: "2026-09-22T10:00:00.000Z" } }]
      : [];
  return { seed, own, foreign, candidates, plans };
}

function run(records: MasteryAttemptRecord[], candidates: AdaptiveCandidateQuestion[], plans: RepairPlan[]) {
  const masteryByConcept = CONCEPTS.map((c) => computeMasteryFor(records.filter((x) => x.contribution.studentId === STUDENT), c));
  return selectNextQuestion({ studentId: STUDENT, masteryByConcept, attemptRecords: records, activeRepairPlans: plans, candidates });
}

const SEEDS = Array.from({ length: 400 }, (_, i) => 1000 + i);
const PSYCH = /confiden|motivat|anxi|lazy|careless|struggl|intelligen|afraid|feel|bad at|naturally|losing/i;

describe("policy invariants over 400 fixed-seed generated scenarios", () => {
  it("INV 1/2/5: only a published, structurally valid candidate is ever selected; a no_selection is explicit; contradictory duplicates are excluded", () => {
    let selected = 0;
    for (const seed of SEEDS) {
      const s = buildScenario(seed);
      const outcome = run(s.own, s.candidates, s.plans);
      if (outcome.status === "no_selection") {
        expect(s.candidates.filter((c) => c.validationState === "published" && validateAdaptiveCandidateQuestion(c).valid).length, `seed ${seed}`).toBe(0);
        continue;
      }
      selected += 1;
      const chosen = s.candidates.find((c) => c.question.questionId === outcome.result.question.questionId)!;
      expect(chosen.validationState, `seed ${seed}`).toBe("published");
      expect(validateAdaptiveCandidateQuestion(chosen).valid, `seed ${seed}`).toBe(true);
    }
    expect(selected).toBeGreaterThan(200); // the generator produces plenty of real selections, not just empty pools
  });

  it("INV 3: another student's attempts never change the result (and never change this student's mastery)", () => {
    for (const seed of SEEDS) {
      const s = buildScenario(seed);
      for (const c of CONCEPTS) {
        expect(computeMasteryFor([...s.own, ...s.foreign], c), `seed ${seed} mastery`).toEqual(computeMasteryFor(s.own, c));
      }
      expect(run([...s.own, ...s.foreign], s.candidates, s.plans), `seed ${seed}`).toEqual(run(s.own, s.candidates, s.plans));
    }
  });

  it("INV 4/5/6: identical inputs give identical results, in ANY candidate order and ANY attempt-record order (equal timestamps included)", () => {
    for (const seed of SEEDS) {
      const s = buildScenario(seed);
      const r = rngFor(seed + 77);
      const base = run(s.own, s.candidates, s.plans);
      expect(run(s.own, s.candidates, s.plans), `seed ${seed} repeat`).toEqual(base);
      for (let k = 0; k < 3; k++) {
        expect(run(r.shuffle(s.own), r.shuffle(s.candidates), s.plans), `seed ${seed} shuffle ${k}`).toEqual(base);
      }
    }
  });

  it("INV 10/11: no immediate repeat while another eligible candidate exists; with exactly one eligible candidate the sole-candidate fallback is deterministic and reported", () => {
    let fallbacks = 0;
    let exclusions = 0;
    for (const seed of SEEDS) {
      const s = buildScenario(seed);
      const outcome = run(s.own, s.candidates, s.plans);
      if (outcome.status !== "selected") continue;
      const result = outcome.result;
      const eligibleIds = new Set(s.candidates.filter((c) => c.validationState === "published" && validateAdaptiveCandidateQuestion(c).valid).map((c) => c.question.questionId));
      const justAttempted = result.recentEvidence?.question.questionId;
      if (justAttempted !== undefined && eligibleIds.has(justAttempted)) {
        if (eligibleIds.size > 1) {
          exclusions += 1;
          expect(result.question.questionId, `seed ${seed}`).not.toBe(justAttempted);
          expect(result.excludedJustAttempted, `seed ${seed}`).toBe(true);
        } else {
          fallbacks += 1;
          expect(result.question.questionId, `seed ${seed}`).toBe(justAttempted);
          expect(result.repeatFallback, `seed ${seed}`).toBe(true);
        }
      } else {
        expect(result.repeatFallback, `seed ${seed}`).toBe(false);
      }
      if (eligibleIds.size === 1) expect(result.question.questionId, `seed ${seed}`).toBe([...eligibleIds][0]);
    }
    expect(exclusions).toBeGreaterThan(20);
    expect(fallbacks).toBeGreaterThan(3);
  });

  it("INV 7/11/12/13 (priority): the winner's highest remaining reason is never lower than any other eligible candidate's -- novelty, coverage or overuse can never defeat a higher need", () => {
    for (const seed of SEEDS) {
      const s = buildScenario(seed);
      const outcome = run(s.own, s.candidates, s.plans);
      if (outcome.status !== "selected") continue;
      const result = outcome.result;
      const records = s.own;
      const ctx = buildTrainingNeedContext({ studentId: STUDENT, masteryByConcept: CONCEPTS.map((c) => computeMasteryFor(records, c)), attemptRecords: records, activeRepairPlans: s.plans });
      const removed = new Map<string, TrainingNeedReasonCode[]>();
      for (const a of result.difficultyFitAdjustments) removed.set(a.questionId, [...(removed.get(a.questionId) ?? []), ...a.reasonsRemoved]);
      const primaryIndex = (c: AdaptiveCandidateQuestion): number => {
        const gone = removed.get(c.question.questionId) ?? [];
        const reasons = determineSatisfiedReasons(c, ctx).filter((x) => !gone.includes(x));
        const i = TRAINING_NEED_PRIORITY_ORDER.findIndex((x) => reasons.includes(x));
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const seen = new Set<string>();
      const others = s.candidates.filter((c) => {
        const id = c.question.questionId;
        const ok = c.validationState === "published" && validateAdaptiveCandidateQuestion(c).valid && id !== result.recentEvidence?.question.questionId && !seen.has(id);
        seen.add(id);
        return ok;
      });
      const winner = others.find((c) => c.question.questionId === result.question.questionId) ?? s.candidates.find((c) => c.question.questionId === result.question.questionId)!;
      const winnerIndex = primaryIndex(winner);
      if (!result.isFallback && !result.repeatFallback) {
        expect(winnerIndex, `seed ${seed}`).toBe(TRAINING_NEED_PRIORITY_ORDER.indexOf(result.primaryReason));
        for (const c of others) expect(winnerIndex, `seed ${seed} vs ${c.question.questionId}`).toBeLessThanOrEqual(primaryIndex(c));
      }
    }
  });

  it("INV 13 (repair): a confirmed plan's matching candidate always wins with repair_priority (never weakened by trend, fit, coverage or novelty)", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const s = buildScenario(seed);
      const plan = s.plans[0];
      if (!plan) continue;
      const outcome = run(s.own, s.candidates, s.plans);
      if (outcome.status !== "selected") continue;
      const ids = new Set<string>();
      const dup = new Map<string, number>();
      for (const c of s.candidates) dup.set(c.question.questionId, (dup.get(c.question.questionId) ?? 0) + 1);
      const matching = s.candidates.filter((c) => {
        if (c.validationState !== "published" || !validateAdaptiveCandidateQuestion(c).valid) return false;
        if (c.question.questionId === outcome.result.recentEvidence?.question.questionId && dup.size > 1) return false;
        ids.add(c.question.questionId);
        return c.question.conceptName === plan.targetConceptName && c.question.patternFamilyName === plan.targetPatternFamilyName;
      });
      if (matching.length === 0) continue;
      checked += 1;
      expect(outcome.result.primaryReason, `seed ${seed}`).toBe("repair_priority");
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("INV 8/9: remediation never becomes harder than the last answered tier, and exploration never leaves a progression-ready concept's target tier, when a suitable alternative existed", () => {
    let remediation = 0;
    let exploration = 0;
    for (const seed of SEEDS) {
      const s = buildScenario(seed);
      const outcome = run(s.own, s.candidates, s.plans);
      if (outcome.status !== "selected") continue;
      const result: AdaptiveSelectionResult = outcome.result;
      const pool = s.candidates.filter((c) => c.validationState === "published" && validateAdaptiveCandidateQuestion(c).valid && c.question.questionId !== result.recentEvidence?.question.questionId);
      const sameConcept = pool.filter((c) => c.question.conceptName === result.question.conceptName);
      const lastTier = result.trendEvidence?.lastGradedTier;
      if (REMEDIATION_REASONS.includes(result.primaryReason) && lastTier && tierRank(result.question.difficultyTier) > tierRank(lastTier)) {
        remediation += 1;
        expect(sameConcept.some((c) => tierRank(c.question.difficultyTier) <= tierRank(lastTier)), `seed ${seed}`).toBe(false);
      }
      if (EXPLORATION_REASONS.includes(result.primaryReason)) {
        const ctx = buildTrainingNeedContext({ studentId: STUDENT, masteryByConcept: CONCEPTS.map((c) => computeMasteryFor(s.own, c)), attemptRecords: s.own, activeRepairPlans: s.plans });
        if (isProgressionReady(result.question.conceptName, ctx)) {
          const demonstrated = result.accumulatedEvidence?.highestDemonstratedTier?.tier;
          const order = DIFFICULTY_TIER_ORDER;
          const target = demonstrated ? order[Math.min(order.indexOf(demonstrated) + 1, order.length - 1)]! : "standard";
          const has = (tier: string) => sameConcept.some((c) => c.question.difficultyTier === tier);
          // the band: the target tier when the pool has a question there, otherwise the demonstrated tier when it does, otherwise no constraint
          const band = has(target) ? target : demonstrated && has(demonstrated) ? demonstrated : null;
          if (band !== null) {
            exploration += 1;
            expect(result.question.difficultyTier, `seed ${seed}: exploration left the band`).toBe(band);
          }
        }
      }
    }
    expect(remediation + exploration).toBeGreaterThan(5); // the situations arise in the generated scenarios; any violation fails inside the loop
  });

  it("INV 13/14: nothing answer-bearing or psychological crosses the result boundary", () => {
    for (const seed of SEEDS) {
      const s = buildScenario(seed);
      const outcome = run(s.own, s.candidates, s.plans);
      if (outcome.status !== "selected") continue;
      const text = JSON.stringify(outcome.result);
      expect(text, `seed ${seed}`).not.toMatch(/correctAnswer|solutionSteps|groundTruth|expectedAnswer/);
      expect(outcome.result.explanation, `seed ${seed}`).not.toMatch(PSYCH);
      expect(outcome.result.explanation.length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it("thin pools are safe: zero, one, all-unpublished, all-malformed and all-duplicate-conflict candidates never throw and never select an ineligible question", () => {
    const base = () => makeCandidate({ questionId: "Z", patternFamilyName: "F", patternTaxonomyCellId: "c1" });
    const bad = () => { const c = base(); (c.question as { patternTaxonomyCellId: string }).patternTaxonomyCellId = ""; return c; };
    expect(selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [] })).toMatchObject({ status: "no_selection", reason: "no_candidates_supplied" });
    expect(selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [bad()] })).toMatchObject({ status: "no_selection", reason: "no_structurally_valid_candidates" });
    expect(selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [makeCandidate({ questionId: "U" }, { validationState: "ai_validated" })] })).toMatchObject({ status: "no_selection", reason: "no_published_candidates" });
    const a = base();
    const b = makeCandidate({ questionId: "Z", difficultyTier: "hard", patternFamilyName: "F", patternTaxonomyCellId: "c1" }); // same id, different content
    expect(selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [a, b] })).toMatchObject({ status: "no_selection", excludedMalformedCount: 2 });
    expect(selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [b, a] })).toMatchObject({ status: "no_selection", excludedMalformedCount: 2 });
    const one = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [a, JSON.parse(JSON.stringify(a))] });
    expect(one.status).toBe("selected"); // an exact duplicate is harmless and collapses
  });
});

describe("the timestamp corner cases that used to be order-dependent", () => {
  const recs = (order: number[]) => {
    const base = [
      makeAttemptRecord({ isCorrect: false, questionId: "a", offsetSeconds: 50 }),
      makeAttemptRecord({ isCorrect: true, questionId: "b", offsetSeconds: 50 }),
      makeAttemptRecord({ isCorrect: false, questionId: "c", offsetSeconds: 50 })
    ];
    return order.map((i) => base[i]!);
  };
  const latestOf = (records: MasteryAttemptRecord[]) => {
    const r = run(records, [makeCandidate({ questionId: "Zed" }), makeCandidate({ questionId: "Yod", patternFamilyName: "Other", patternTaxonomyCellId: "c9" })], []);
    return r.status === "selected" ? r.result.recentEvidence?.question.questionId : undefined;
  };
  it("the 'most recent' attempt among equal timestamps is the same for every input order (finalizedAt, then attemptId)", () => {
    const answers = new Set([[0, 1, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1], [1, 0, 2], [2, 0, 1]].map((o) => latestOf(recs(o))));
    expect(answers.size).toBe(1);
  });
  it("missing or unparseable timestamps are ordered like each other, never as NaN", () => {
    const make = (finalizedAt: string | null, id: string) => {
      const r = makeAttemptRecord({ isCorrect: false, questionId: id, offsetSeconds: 10 });
      (r.contribution as { finalizedAt: string | null }).finalizedAt = finalizedAt;
      return r;
    };
    const x = [make(null, "n1"), make("not-a-date", "n2"), make(null, "n3"), make("2026-09-22T10:00:10.000Z", "ok")];
    const y = [x[3]!, x[2]!, x[1]!, x[0]!];
    expect(computeMasteryFor(x).detail.contributingAttemptIds).toEqual(computeMasteryFor(y).detail.contributingAttemptIds);
    expect(run(x, [makeCandidate({ questionId: "Zed" }), makeCandidate({ questionId: "Yod", patternTaxonomyCellId: "c9" })], [])).toEqual(run(y, [makeCandidate({ questionId: "Zed" }), makeCandidate({ questionId: "Yod", patternTaxonomyCellId: "c9" })], []));
  });
});
