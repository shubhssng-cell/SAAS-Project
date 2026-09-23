import { selectNextQuestion } from "@ipmat/adaptive-selection";
import { selectRepairQuestion, RepairSelectionError } from "@ipmat/repair-selection";
import { derivePriorExposureForRepair } from "./priorExposure.js";
import { selectPlanForOrchestration } from "./repairPlanSelection.js";
import type {
  AdaptiveSelectionOutcome,
  RepairSelectionOutcome,
  TrainingOrchestrationDiagnostics,
  TrainingOrchestrationInput,
  TrainingOrchestrationResult
} from "./types.js";

/**
 * Named, explicit policy constants — never a buried if-statement
 * (requirement: "make the exact rule explicit"). Both are PROVISIONAL
 * authored policy, the same honest caveat `MASTERY_CONSTANTS`/
 * `AUTOPSY_THRESHOLDS`/`REPAIR_SELECTION_CONSTANTS`/`ADAPTIVE_SELECTION_CONSTANTS`
 * already carry — not calibrated against real outcome data.
 */
export const TRAINING_ORCHESTRATION_POLICY = {
  /**
   * A confirmed, eligible RepairPlan is ALWAYS attempted before adaptive
   * practice — an already-confirmed, student-specific learning need
   * takes precedence over a general ranking heuristic. Currently the
   * only value this constant can hold — modeled as a named constant
   * anyway so the rule is documented, not implicit in the function's
   * control flow.
   */
  REPAIR_PRECEDES_ADAPTIVE: true,
  /**
   * When the chosen RepairPlan's targeted selection returns `"no_match"`
   * (no candidate question currently exists for it), the orchestrator IS
   * permitted to fall back to adaptive practice. The confirmed diagnosis
   * itself is never treated as wrong just because no matching QUESTION
   * exists today — that is a content-availability gap, not a signal to
   * discard the diagnosis. See `shouldAttemptAdaptivePractice()` for the
   * exact, independently-testable decision this constant feeds.
   */
  ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH: true
} as const;

/**
 * The exact fallback decision, extracted as its own named, independently
 * testable function rather than inlined — both real outcomes
 * (`true`/`false`) are exercised by tests via the explicit `override`
 * parameter, even though `orchestrateNextTrainingAction()` itself always
 * calls this with the fixed policy constant above (V1 exposes no
 * per-call override on its own public input).
 */
export function shouldAttemptAdaptivePractice(
  repairAttempted: boolean,
  repairOutcome: RepairSelectionOutcome | null,
  allowFallbackOnNoMatch: boolean = TRAINING_ORCHESTRATION_POLICY.ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH
): boolean {
  if (!repairAttempted) return true; // no eligible repair plan at all -- adaptive is the only applicable path
  if (!repairOutcome) return true; // repair attempt was invalid (see the safety net in attemptTargetedRepair) -- treat as unavailable, same as no plan
  if (repairOutcome.status === "selected") return false; // repair already succeeded -- no reason to also run adaptive
  return allowFallbackOnNoMatch; // repairOutcome.status === "no_match"
}

export interface TargetedRepairAttempt {
  attempted: boolean;
  planChosen: { targetConceptName: string; targetPatternFamilyName: string; priority: string; confirmedAt: string } | null;
  excludedAsUnconfirmedCount: number;
  outcome: RepairSelectionOutcome | null;
}

/**
 * Standalone, independently callable — the ONE place `@ipmat/repair-selection`
 * is invoked. Chooses a plan via `selectPlanForOrchestration()` (this
 * package's own, narrow priority policy — never repair-selection's
 * internal match-tier/tie-break logic, which stays entirely inside that
 * package), derives prior exposure by REUSING `@ipmat/adaptive-selection`'s
 * `computeExposureCounts()` (never a third counting pass), and preserves
 * `selectRepairQuestion()`'s result completely unmodified. A future
 * additional provider (e.g. a Speed Lab) would follow this exact shape —
 * `{attempted, outcome}` — and slot into `orchestrateNextTrainingAction()`'s
 * sequence without this function's own logic changing at all.
 */
export function attemptTargetedRepair(input: TrainingOrchestrationInput): TargetedRepairAttempt {
  const { chosen, excludedAsUnconfirmedCount } = selectPlanForOrchestration(input.activeRepairPlans);

  if (!chosen) {
    return { attempted: false, planChosen: null, excludedAsUnconfirmedCount, outcome: null };
  }

  const planChosen = {
    targetConceptName: chosen.plan.targetConceptName,
    targetPatternFamilyName: chosen.plan.targetPatternFamilyName,
    priority: chosen.plan.priority,
    confirmedAt: chosen.plan.confirmationSource.hypothesisConfirmedAt
  };

  try {
    const outcome = selectRepairQuestion({
      repairPlan: chosen.plan,
      candidateQuestions: input.candidates,
      behaviorSignals: chosen.behaviorSignals,
      targetDifficultyTier: chosen.targetDifficultyTier,
      priorExposure: derivePriorExposureForRepair(input.studentId, input.attemptRecords)
    });
    return { attempted: true, planChosen, excludedAsUnconfirmedCount, outcome };
  } catch (error) {
    // Defense-in-depth safety net: selectPlanForOrchestration() already filters to
    // confirmed plans (the same check RepairSelectionError("not_confirmed") itself
    // guards), so this should be unreachable in practice -- checked explicitly rather
    // than assumed, the same fail-closed style used throughout this codebase.
    if (error instanceof RepairSelectionError) {
      return { attempted: true, planChosen, excludedAsUnconfirmedCount, outcome: null };
    }
    throw error;
  }
}

export interface AdaptivePracticeAttempt {
  attempted: boolean;
  outcome: AdaptiveSelectionOutcome | null;
}

/**
 * Standalone, independently callable — the ONE place
 * `@ipmat/adaptive-selection` is invoked. `activeRepairPlans` is passed
 * through as ONE of adaptive-selection's own ten input signals (its
 * `repair_priority`/`prerequisite_weakness` reason codes) — this is NOT
 * a duplicate repair attempt; adaptive-selection's family-level match is
 * a deliberately looser heuristic than repair-selection's precise
 * cell/trap matching, and remains useful even after a precise match
 * attempt has already failed.
 */
export function attemptAdaptivePractice(input: TrainingOrchestrationInput): AdaptivePracticeAttempt {
  const outcome = selectNextQuestion({
    studentId: input.studentId,
    masteryByConcept: input.masteryByConcept,
    attemptRecords: input.attemptRecords,
    activeRepairPlans: input.activeRepairPlans.map((c) => c.plan),
    prepPhase: input.prepPhase,
    candidates: input.candidates
  });
  return { attempted: true, outcome };
}

function buildDiagnostics(input: {
  repairPlansSupplied: number;
  repair: TargetedRepairAttempt;
  adaptive: AdaptivePracticeAttempt | null;
  fallbackOccurred: boolean;
}): TrainingOrchestrationDiagnostics {
  return {
    repairPlansSupplied: input.repairPlansSupplied,
    repairPlansExcludedAsUnconfirmed: input.repair.excludedAsUnconfirmedCount,
    repairPlanChosen: input.repair.planChosen as TrainingOrchestrationDiagnostics["repairPlanChosen"],
    repairAttempted: input.repair.attempted,
    repairOutcome: input.repair.outcome,
    adaptiveAttempted: input.adaptive?.attempted ?? false,
    adaptiveOutcome: input.adaptive?.outcome ?? null,
    fallbackPermittedByPolicy: TRAINING_ORCHESTRATION_POLICY.ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH,
    fallbackOccurred: input.fallbackOccurred
  };
}

/**
 * The Training Orchestration domain contract (Phase 5D, docs/DECISIONS.md
 * D-052). Decides `targeted_repair` vs `adaptive_practice` vs `no_action`
 * by COORDINATING `@ipmat/repair-selection` and `@ipmat/adaptive-selection`
 * through their public contracts only — never reimplementing either
 * engine's matching/ranking algorithm, never merging them into one score.
 *
 * Sequence:
 * 1. No candidates at all -> `no_action` immediately, neither engine consulted.
 * 2. `attemptTargetedRepair()` — always tried first when an eligible
 *    (confirmed) RepairPlan exists (`REPAIR_PRECEDES_ADAPTIVE`).
 * 3. If repair succeeded, done — `targeted_repair`, `wasFallbackFromRepair`
 *    does not apply (this variant never sets it).
 * 4. Otherwise, `shouldAttemptAdaptivePractice()` decides whether to
 *    consult `@ipmat/adaptive-selection` — always true unless repair
 *    genuinely succeeded (see that function's own doc comment).
 * 5. If adaptive practice succeeds, done — `adaptive_practice`, with
 *    `wasFallbackFromRepair` set to whether repair was attempted first.
 * 6. Otherwise, `no_action` — `diagnostics` on EVERY branch preserves
 *    exactly what was tried and why it did not produce a selection.
 */
export function orchestrateNextTrainingAction(input: TrainingOrchestrationInput): TrainingOrchestrationResult {
  if (input.candidates.length === 0) {
    return {
      status: "no_action",
      reason: "no_candidates_supplied",
      explanation: "No candidate questions were supplied.",
      diagnostics: buildDiagnostics({
        repairPlansSupplied: input.activeRepairPlans.length,
        repair: { attempted: false, planChosen: null, excludedAsUnconfirmedCount: 0, outcome: null },
        adaptive: null,
        fallbackOccurred: false
      })
    };
  }

  const repair = attemptTargetedRepair(input);

  if (repair.outcome?.status === "selected") {
    return {
      status: "selected",
      actionType: "targeted_repair",
      question: repair.outcome.result.question,
      explanation: repair.outcome.result.explanation,
      providerResult: repair.outcome.result,
      diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, adaptive: null, fallbackOccurred: false })
    };
  }

  if (!shouldAttemptAdaptivePractice(repair.attempted, repair.outcome)) {
    return {
      status: "no_action",
      reason: "no_eligible_action",
      explanation: "Targeted repair returned no matching question, and policy does not permit a fallback to adaptive practice for this call.",
      diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, adaptive: null, fallbackOccurred: false })
    };
  }

  const adaptive = attemptAdaptivePractice(input);
  const fallbackOccurred = repair.attempted;

  if (adaptive.outcome?.status === "selected") {
    return {
      status: "selected",
      actionType: "adaptive_practice",
      question: adaptive.outcome.result.question,
      explanation: adaptive.outcome.result.explanation,
      providerResult: adaptive.outcome.result,
      wasFallbackFromRepair: fallbackOccurred,
      diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, adaptive, fallbackOccurred })
    };
  }

  return {
    status: "no_action",
    reason: "no_eligible_action",
    explanation: repair.attempted
      ? "Targeted repair returned no matching question, and adaptive practice also produced no selection."
      : "No confirmed repair plan was eligible, and adaptive practice produced no selection.",
    diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, adaptive, fallbackOccurred })
  };
}
