import type { ActiveRepairPlanContext, RepairPriority } from "./types.js";

/**
 * The SAME invariant `@ipmat/repair-selection`'s own `assertRepairPlanConfirmed()`
 * checks internally, re-verified HERE so an unconfirmed plan can be
 * excluded from orchestration BEFORE ever calling `selectRepairQuestion()`
 * (which would otherwise throw) — this is a one-field input-validity
 * check, never a restatement of that package's matching/ranking logic.
 * `buildRepairPlan()` (`@ipmat/autopsy`) is the only real constructor of a
 * genuine `RepairPlan`, and it never omits this field for a truly
 * confirmed hypothesis — a plan missing it here means either a caller
 * hand-constructed something bypassing that gate, or an
 * awaiting/rejected/corrected hypothesis was (incorrectly) turned into a
 * plan-shaped object.
 */
export function isConfirmedForOrchestration(context: ActiveRepairPlanContext): boolean {
  return Boolean(context.plan.confirmationSource?.hypothesisConfirmedAt);
}

const REPAIR_PRIORITY_RANK: Record<RepairPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * The named, deterministic policy for choosing ONE plan to attempt when
 * several confirmed RepairPlans are active simultaneously (requirement:
 * "make the exact rule explicit rather than burying it in an
 * if-statement"):
 *
 * 1. Higher `RepairPlan.priority` wins (`high` > `medium` > `low` — the
 *    SAME field `@ipmat/autopsy`'s `buildRepairPlan()` already computes,
 *    never re-derived here).
 * 2. Ties broken by the MORE RECENTLY confirmed plan (a fresher
 *    diagnosis is preferred over a stale one at equal priority).
 * 3. Final, fully deterministic tie-break: `targetConceptName`
 *    lexicographic.
 *
 * V1 attempts exactly ONE plan per orchestration call — if it returns
 * `no_match`, the orchestrator falls back to adaptive practice (subject
 * to policy) rather than trying a second-priority plan; see
 * `orchestrate.ts`'s own doc comment for why.
 */
export function selectPlanForOrchestration(contexts: ActiveRepairPlanContext[]): {
  chosen: ActiveRepairPlanContext | null;
  excludedAsUnconfirmedCount: number;
} {
  const confirmed = contexts.filter(isConfirmedForOrchestration);
  const excludedAsUnconfirmedCount = contexts.length - confirmed.length;

  if (confirmed.length === 0) {
    return { chosen: null, excludedAsUnconfirmedCount };
  }

  const sorted = [...confirmed].sort((a, b) => {
    const rankDiff = REPAIR_PRIORITY_RANK[a.plan.priority] - REPAIR_PRIORITY_RANK[b.plan.priority];
    if (rankDiff !== 0) return rankDiff;

    const dateDiff = Date.parse(b.plan.confirmationSource.hypothesisConfirmedAt) - Date.parse(a.plan.confirmationSource.hypothesisConfirmedAt);
    if (dateDiff !== 0) return dateDiff;

    return a.plan.targetConceptName.localeCompare(b.plan.targetConceptName);
  });

  return { chosen: sorted[0] ?? null, excludedAsUnconfirmedCount };
}
