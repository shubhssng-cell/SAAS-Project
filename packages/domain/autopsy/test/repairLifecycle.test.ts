import { describe, expect, it } from "vitest";
import { REPAIR_LIFECYCLE_POLICY, evaluateRepairLifecycle, type RepairLifecycleAttempt, type RepairLifecyclePlan } from "../src/repairLifecycle.js";

/**
 * Phase 4 Unit 4 -- the RepairPlan lifecycle rule. Pure and deterministic: it depends only on the SET of persisted finalized attempts.
 * Conservative by design: one correct answer is never "repaired", and a plan can never hold the student in repair forever.
 */

const CONFIRMED_AT = "2026-01-01T10:00:00.000Z";
const plan: RepairLifecyclePlan = {
  targetConceptName: "Percentages",
  targetPatternFamilyName: "Reverse Percentage",
  targetErrorTaxonomyCode: "base_confusion",
  confirmationSource: { attemptId: "diagnosed", hypothesisConfirmedAt: CONFIRMED_AT }
};

let n = 0;
const at = (minutesAfter: number) => new Date(Date.parse(CONFIRMED_AT) + minutesAfter * 60_000).toISOString();
function attempt(o: Partial<RepairLifecycleAttempt> & { minutes: number }): RepairLifecycleAttempt {
  n += 1;
  const { minutes, ...rest } = o;
  return { attemptId: `a-${n}`, questionId: `q-${n}`, conceptName: "Percentages", patternFamilyName: "Reverse Percentage", trapErrorTaxonomyCode: "base_confusion", status: "submitted", isCorrect: true, finalizedAt: at(minutes), ...rest };
}
const direct = (minutes: number, isCorrect: boolean) => attempt({ minutes, isCorrect });
const broad = (minutes: number, isCorrect: boolean) => attempt({ minutes, isCorrect, patternFamilyName: "Point Difference", trapErrorTaxonomyCode: null });

describe("evaluateRepairLifecycle -- states", () => {
  it("pending: no finalized attempt on the target concept since the confirmation", () => {
    expect(evaluateRepairLifecycle(plan, [])).toMatchObject({ status: "pending", rounds: 0, completionBasis: null });
  });

  it("in_progress after one attempt -- and ONE correct direct-match answer is NOT completion (evidence of improvement, not proof)", () => {
    const r = evaluateRepairLifecycle(plan, [direct(5, true)]);
    expect(r).toMatchObject({ status: "in_progress", rounds: 1, directMatchRounds: 1, consecutiveDirectCorrect: 1, completionBasis: null });
  });

  it("completed (demonstrated) only after the required consecutive correct direct-match answers", () => {
    expect(REPAIR_LIFECYCLE_POLICY.DEMONSTRATED_MIN_CONSECUTIVE_CORRECT).toBe(2);
    const r = evaluateRepairLifecycle(plan, [direct(5, true), direct(10, true)]);
    expect(r).toMatchObject({ status: "completed", completionBasis: "demonstrated", consecutiveDirectCorrect: 2 });
  });

  it("an incorrect answer resets the run: correct, wrong, correct is still in progress", () => {
    expect(evaluateRepairLifecycle(plan, [direct(5, true), direct(10, false), direct(15, true)])).toMatchObject({ status: "completed", completionBasis: "round_limit" }); // 3 rounds
    expect(evaluateRepairLifecycle(plan, [direct(5, true), direct(10, false)])).toMatchObject({ status: "in_progress", consecutiveDirectCorrect: 0 });
  });

  it("a skipped direct-match question breaks the correct run (not answered correctly)", () => {
    const skipped = attempt({ minutes: 8, status: "skipped", isCorrect: null });
    expect(evaluateRepairLifecycle(plan, [direct(5, true), skipped])).toMatchObject({ status: "in_progress", consecutiveDirectCorrect: 0, rounds: 2 });
  });

  it("round limit: after MAX_REPAIR_ROUNDS attempts on the concept the round is over whatever happened -- and it does NOT claim the mistake is fixed", () => {
    expect(REPAIR_LIFECYCLE_POLICY.MAX_REPAIR_ROUNDS).toBe(3);
    const r = evaluateRepairLifecycle(plan, [direct(5, false), direct(10, false), broad(15, false)]);
    expect(r).toMatchObject({ status: "completed", completionBasis: "round_limit", rounds: 3, consecutiveDirectCorrect: 0 });
  });

  it("broad (non-matching) correct answers on the concept count as rounds but never as demonstration", () => {
    const r = evaluateRepairLifecycle(plan, [broad(5, true), broad(10, true)]);
    expect(r).toMatchObject({ status: "in_progress", rounds: 2, directMatchRounds: 0, consecutiveDirectCorrect: 0 });
  });

  it("a same-error-category answer in ANOTHER pattern family counts as direct (the plan targets the error category too)", () => {
    const sameTrap = (m: number) => attempt({ minutes: m, patternFamilyName: "Successive Change", trapErrorTaxonomyCode: "base_confusion" });
    expect(evaluateRepairLifecycle(plan, [sameTrap(5), sameTrap(10)])).toMatchObject({ status: "completed", completionBasis: "demonstrated" });
  });
});

describe("evaluateRepairLifecycle -- what is NOT evidence", () => {
  it("attempts before (or at) the confirmation, the diagnosed attempt itself, abandoned attempts and other concepts are ignored", () => {
    const evidence: RepairLifecycleAttempt[] = [
      attempt({ minutes: -30 }), // before the confirmation
      attempt({ minutes: 0 }), // at the confirmation instant: not strictly after
      attempt({ attemptId: "diagnosed", minutes: 5, isCorrect: false }), // the diagnosed attempt, by id
      attempt({ minutes: 6, status: "abandoned", isCorrect: null }),
      attempt({ minutes: 7, conceptName: "Ratio" }),
      attempt({ minutes: 8, finalizedAt: null })
    ];
    expect(evaluateRepairLifecycle(plan, evidence)).toMatchObject({ status: "pending", rounds: 0 });
  });

  it("an unparseable confirmation time never completes or advances anything (fails closed)", () => {
    const broken = { ...plan, confirmationSource: { attemptId: "diagnosed", hypothesisConfirmedAt: "not a date" } };
    expect(evaluateRepairLifecycle(broken, [direct(5, true), direct(10, true)])).toMatchObject({ status: "pending", rounds: 0 });
  });

  it("a plan with no targeted error category matches on pattern family only", () => {
    const noTrap = { ...plan, targetErrorTaxonomyCode: null };
    const otherFamilySameTrap = attempt({ minutes: 5, patternFamilyName: "Successive Change", trapErrorTaxonomyCode: "base_confusion" });
    expect(evaluateRepairLifecycle(noTrap, [otherFamilySameTrap])).toMatchObject({ directMatchRounds: 0, status: "in_progress" });
  });
});

describe("evaluateRepairLifecycle -- determinism", () => {
  it("the result is identical for every ordering of the same attempts (fixed-seed shuffles)", () => {
    const attempts = [direct(5, false), direct(10, true), broad(12, true), direct(15, true), attempt({ minutes: 20, status: "skipped", isCorrect: null }), direct(25, true)];
    const expected = evaluateRepairLifecycle(plan, attempts);
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 50; i++) {
      const shuffled = [...attempts].sort(() => rand() - 0.5);
      expect(evaluateRepairLifecycle(plan, shuffled)).toEqual(expected);
    }
  });

  it("equal timestamps are ordered by attempt id, so ties cannot depend on input order", () => {
    const a = attempt({ attemptId: "a-early", minutes: 5, isCorrect: false });
    const b = attempt({ attemptId: "b-late", minutes: 5, isCorrect: true });
    expect(evaluateRepairLifecycle(plan, [a, b])).toEqual(evaluateRepairLifecycle(plan, [b, a]));
  });

  it("is monotone as evidence accumulates: pending -> in_progress -> completed, never back", () => {
    const order = { pending: 0, in_progress: 1, completed: 2 } as const;
    const stream = [direct(5, true), direct(10, false), direct(15, true), direct(20, true)];
    let last = -1;
    for (let k = 0; k <= stream.length; k++) {
      const s = order[evaluateRepairLifecycle(plan, stream.slice(0, k)).status];
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});
