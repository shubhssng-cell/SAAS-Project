import { describe, expect, it } from "vitest";
import { orchestrateNextTrainingAction } from "../src/orchestrate.js";
import { selectPlanForOrchestration } from "../src/repairPlanSelection.js";
import type { TrainingOrchestrationInput, TrainingOrchestrationResult } from "../src/types.js";
import { activeRepairContext, computeMasteryFor, makeAttemptRecord, makeCandidate, STUDENT } from "./fixtures.js";

/**
 * Phase 3 Unit 5 -- the WHOLE orchestration (repair -> five training-system providers -> adaptive) is a pure function of its inputs:
 * the order in which candidates, attempt records or repair plans are supplied never changes the decision. Fixed-seed generated scenarios
 * (mulberry32), so a failure is reproducible from its seed. Technical validation only.
 */

function rngFor(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T;
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  return { int, pick, shuffle };
}

const TRAPS = ["base_confusion", "careless_arithmetic", "successive_change_error"] as const;
const TIERS = ["standard", "advanced"] as const;

function scenario(seed: number): TrainingOrchestrationInput {
  const r = rngFor(seed);
  const nCand = 1 + r.int(9);
  const cells = ["c1", "c2", "c3"];
  const candidates = Array.from({ length: nCand }, (_, i) => {
    const cell = r.pick(cells);
    return makeCandidate(
      { questionId: `Q${i}`, patternFamilyName: `F-${cell}`, patternTaxonomyCellId: cell, difficultyTier: r.pick(TIERS), trapErrorTaxonomyCode: r.pick(TRAPS), testingModes: r.int(5) === 0 ? ["time_pressured"] : ["reverse"], noveltyLevel: r.int(4) === 0 ? "novel_representation" : "standard" },
      { validationState: r.int(7) === 0 ? "ai_validated" : "published" }
    );
  });
  const n = r.int(14);
  const attemptRecords = Array.from({ length: n }, (_, i) => {
    const o = r.int(10);
    const cell = r.pick(cells);
    return makeAttemptRecord({
      isCorrect: o >= 9 ? null : o <= 4,
      status: o >= 9 ? "skipped" : "submitted",
      offsetSeconds: Math.floor(i / 3) * 100, // deliberate equal timestamps
      timeTakenSeconds: r.int(3) === 0 ? 220 : 50,
      expectedTimeSeconds: 90,
      questionId: r.int(3) === 0 ? `Q${r.int(nCand)}` : `H${seed}-${i}`,
      question: { patternFamilyName: `F-${cell}`, patternTaxonomyCellId: cell, difficultyTier: r.pick(TIERS), trapErrorTaxonomyCode: r.pick(TRAPS) }
    });
  });
  // 0-3 confirmed plans, deliberately tied on priority/time so only the tie-break chain can order them
  const activeRepairPlans = Array.from({ length: r.int(4) }, () => activeRepairContext({ targetPatternFamilyName: `F-${r.pick(cells)}`, targetTaxonomyCellId: r.pick(cells), priority: r.pick(["high", "medium"] as const), targetErrorTaxonomyCode: r.pick(TRAPS) }));
  return { studentId: STUDENT, activeRepairPlans, masteryByConcept: [computeMasteryFor(attemptRecords)], attemptRecords, candidates };
}

function decision(result: TrainingOrchestrationResult): unknown {
  return JSON.parse(JSON.stringify(result));
}

describe("orchestration determinism", () => {
  it("400 generated scenarios: the decision (and every diagnostic) is identical for any candidate, attempt and repair-plan order", () => {
    const tiers = new Set<string>();
    for (let seed = 5000; seed < 5400; seed++) {
      const input = scenario(seed);
      const base = orchestrateNextTrainingAction(input);
      if (base.status === "selected") tiers.add(base.actionType);
      const r = rngFor(seed + 991);
      expect(decision(orchestrateNextTrainingAction(input)), `seed ${seed} repeat`).toEqual(decision(base));
      for (let k = 0; k < 3; k++) {
        const shuffled: TrainingOrchestrationInput = { ...input, candidates: r.shuffle(input.candidates), attemptRecords: r.shuffle(input.attemptRecords), activeRepairPlans: r.shuffle(input.activeRepairPlans) };
        expect(decision(orchestrateNextTrainingAction(shuffled)), `seed ${seed} shuffle ${k}`).toEqual(decision(base));
      }
    }
    // the generator really exercises all three tiers, so the property is not vacuous
    expect([...tiers].sort()).toEqual(["adaptive_practice", "targeted_repair", "training_system_practice"]);
  });

  it("repair-plan choice: priority, then recency, then a COMPLETE tie-break chain -- including unparseable timestamps and plans that differ only in family/cell/code", () => {
    const a = activeRepairContext({ targetPatternFamilyName: "F-b", targetTaxonomyCellId: "c1", targetErrorTaxonomyCode: "x" });
    const b = activeRepairContext({ targetPatternFamilyName: "F-a", targetTaxonomyCellId: "c2", targetErrorTaxonomyCode: "x" });
    const c = activeRepairContext({ targetPatternFamilyName: "F-a", targetTaxonomyCellId: "c1", targetErrorTaxonomyCode: null });
    const d = activeRepairContext({ targetPatternFamilyName: "F-a", targetTaxonomyCellId: "c1", targetErrorTaxonomyCode: "y" });
    const pick = (xs: typeof a[]) => selectPlanForOrchestration(xs).chosen?.plan;
    const orders = [[a, b, c, d], [d, c, b, a], [b, d, a, c], [c, a, d, b]];
    const chosen = orders.map((o) => JSON.stringify(pick(o)));
    expect(new Set(chosen).size).toBe(1);
    expect(pick(orders[0]!)).toMatchObject({ targetPatternFamilyName: "F-a", targetTaxonomyCellId: "c1", targetErrorTaxonomyCode: null });

    const bad = activeRepairContext({ confirmationSource: { attemptId: "x", hypothesisConfirmedAt: "not-a-date" }, targetPatternFamilyName: "F-z" });
    const good = activeRepairContext({ confirmationSource: { attemptId: "y", hypothesisConfirmedAt: "2026-09-22T10:00:00.000Z" }, targetPatternFamilyName: "F-y" });
    expect(pick([bad, good])?.targetPatternFamilyName).toBe("F-y"); // an unparseable time counts as oldest, never NaN
    expect(pick([good, bad])?.targetPatternFamilyName).toBe("F-y");
    // priority still dominates, and only CONFIRMED plans are ever chosen
    const low = activeRepairContext({ priority: "low", targetPatternFamilyName: "F-low" });
    const unconfirmed = activeRepairContext({ priority: "high", confirmationSource: { attemptId: "z", hypothesisConfirmedAt: "" } });
    expect(pick([low, unconfirmed])?.targetPatternFamilyName).toBe("F-low");
  });
});
