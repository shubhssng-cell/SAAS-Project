import { selectNextQuestion } from "@ipmat/adaptive-selection";
import { selectRepairQuestion, RepairSelectionError } from "@ipmat/repair-selection";
import { derivePriorExposureForRepair } from "./priorExposure.js";
import { selectPlanForOrchestration } from "./repairPlanSelection.js";
import { attemptTrainingSystems, type TrainingSystemProvidersAttempt } from "./trainingSystemProviders.js";
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
   * A confirmed, eligible RepairPlan is ALWAYS attempted before anything
   * else — an already-confirmed, student-specific learning need takes
   * precedence over both the training-system tier (candidate-level
   * evidence, never confirmed) and the general adaptive-ranking
   * heuristic. Currently the only value this constant can hold — modeled
   * as a named constant anyway so the rule is documented, not implicit in
   * the function's control flow.
   */
  REPAIR_PRECEDES_ADAPTIVE: true,
  /**
   * When the chosen RepairPlan's targeted selection returns `"no_match"`
   * (no candidate question currently exists for it), the orchestrator IS
   * permitted to try the NEXT tier — as of docs/DECISIONS.md D-062, that
   * next tier is the training-system providers, not adaptive practice
   * directly (adaptive remains reachable only if the training-system tier
   * ALSO fails to select — see `ALLOW_ADAPTIVE_FALLBACK_ON_NO_TRAINING_SYSTEM_MATCH`
   * below). The confirmed diagnosis itself is never treated as wrong just
   * because no matching QUESTION exists today — that is a content-
   * availability gap, not a signal to discard the diagnosis. See
   * `shouldAttemptTrainingSystems()` for the exact, independently-testable
   * decision this constant now feeds; `shouldAttemptAdaptivePractice()`
   * (below) is preserved UNCHANGED and remains independently correct and
   * tested, but is no longer called from `orchestrateNextTrainingAction()`'s
   * own sequence now that a tier sits between repair and adaptive.
   */
  ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH: true,
  /**
   * (docs/DECISIONS.md D-062) A confirmed, eligible RepairPlan aside, the
   * five concrete `TrainingSystemProvider`s are ALWAYS tried, in their
   * fixed priority order, before adaptive practice — each is narrow,
   * candidate-level evidence for one specific training mode, more
   * specific than adaptive-selection's own general, cross-concept
   * ranking. Currently the only value this constant can hold — modeled as
   * a named constant for the same documentation reason as
   * `REPAIR_PRECEDES_ADAPTIVE` above.
   */
  TRAINING_SYSTEMS_PRECEDE_ADAPTIVE: true,
  /**
   * (docs/DECISIONS.md D-062) When NO training-system provider selects a
   * question (every one is `not_applicable`, `no_eligible_question`, or
   * `error`), the orchestrator IS permitted to fall back to adaptive
   * practice — the same "a content-availability or applicability gap is
   * never a reason to give up entirely" reasoning as
   * `ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH` above, one tier further
   * out. See `shouldAttemptAdaptivePracticeAfterTrainingSystems()`.
   */
  ALLOW_ADAPTIVE_FALLBACK_ON_NO_TRAINING_SYSTEM_MATCH: true
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

/**
 * (docs/DECISIONS.md D-062) STRUCTURALLY IDENTICAL to
 * `shouldAttemptAdaptivePractice()` above (same three branches, same
 * policy shape) but governs the NEW immediate-next tier after repair —
 * the training-system providers, not adaptive practice directly. Kept as
 * its OWN, separately-named function (rather than reusing/renaming
 * `shouldAttemptAdaptivePractice()`) so each function's name still
 * accurately describes what it decides — `shouldAttemptAdaptivePractice()`
 * itself is preserved completely unchanged, still exported, still
 * independently correct and tested, simply no longer called from
 * `orchestrateNextTrainingAction()`'s own sequence.
 */
export function shouldAttemptTrainingSystems(
  repairAttempted: boolean,
  repairOutcome: RepairSelectionOutcome | null,
  allowFallbackOnNoMatch: boolean = TRAINING_ORCHESTRATION_POLICY.ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH
): boolean {
  if (!repairAttempted) return true; // no eligible repair plan at all -- training systems are the next tier to try
  if (!repairOutcome) return true; // repair attempt was invalid -- treat as unavailable, same as no plan
  if (repairOutcome.status === "selected") return false; // repair already succeeded -- no reason to try anything else
  return allowFallbackOnNoMatch; // repairOutcome.status === "no_match"
}

/**
 * (docs/DECISIONS.md D-062) The symmetric decision for the FINAL tier —
 * whether to fall back to adaptive practice once the training-system tier
 * has been (or would have been) exhausted. `trainingSystemsAttempted`
 * mirrors `repairAttempted`'s own role above: when the training-system
 * tier was never reached at all (repair already blocked it, which cannot
 * actually happen in the real call sequence but is checked explicitly
 * here for the same independent-testability reason
 * `shouldAttemptAdaptivePractice()`'s own `repairAttempted` branch is),
 * adaptive is still the only remaining path.
 */
export function shouldAttemptAdaptivePracticeAfterTrainingSystems(
  trainingSystemsAttempted: boolean,
  trainingSystemsSelected: boolean,
  allowFallbackOnNoMatch: boolean = TRAINING_ORCHESTRATION_POLICY.ALLOW_ADAPTIVE_FALLBACK_ON_NO_TRAINING_SYSTEM_MATCH
): boolean {
  if (!trainingSystemsAttempted) return true;
  if (trainingSystemsSelected) return false; // a provider already succeeded -- no reason to also run adaptive
  return allowFallbackOnNoMatch;
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

/** Extracts `requirement.targetConceptName` when present — several providers' requirements carry it, but it is NOT part of the shared `TrainingRequirement` base type, and Trap Lab's own is optional (D-056) and typically absent. Never coerced to a fake value. */
function targetConceptNameOf(requirement: unknown): string | null {
  const value = (requirement as { targetConceptName?: unknown } | null | undefined)?.targetConceptName;
  return typeof value === "string" ? value : null;
}

function buildDiagnostics(input: {
  repairPlansSupplied: number;
  repair: TargetedRepairAttempt;
  trainingSystems: TrainingSystemProvidersAttempt | null;
  adaptive: AdaptivePracticeAttempt | null;
  fallbackOccurred: boolean;
}): TrainingOrchestrationDiagnostics {
  return {
    repairPlansSupplied: input.repairPlansSupplied,
    repairPlansExcludedAsUnconfirmed: input.repair.excludedAsUnconfirmedCount,
    repairPlanChosen: input.repair.planChosen as TrainingOrchestrationDiagnostics["repairPlanChosen"],
    repairAttempted: input.repair.attempted,
    repairOutcome: input.repair.outcome,
    trainingSystemProviderOutcomes: input.trainingSystems?.outcomes ?? [],
    trainingSystemProviderChosen: input.trainingSystems?.selected
      ? { providerId: input.trainingSystems.selected.providerId, targetConceptName: targetConceptNameOf(input.trainingSystems.selected.outcome.requirement) }
      : null,
    adaptiveAttempted: input.adaptive?.attempted ?? false,
    adaptiveOutcome: input.adaptive?.outcome ?? null,
    fallbackPermittedByPolicy: TRAINING_ORCHESTRATION_POLICY.ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH,
    fallbackOccurred: input.fallbackOccurred,
    fallbackPermittedToTrainingSystemsPolicy: TRAINING_ORCHESTRATION_POLICY.ALLOW_ADAPTIVE_FALLBACK_ON_REPAIR_NO_MATCH,
    fallbackPermittedToAdaptiveAfterTrainingSystemsPolicy: TRAINING_ORCHESTRATION_POLICY.ALLOW_ADAPTIVE_FALLBACK_ON_NO_TRAINING_SYSTEM_MATCH
  };
}

/**
 * The Training Orchestration domain contract (Phase 5D, docs/DECISIONS.md
 * D-052; extended by D-062). Decides `targeted_repair` vs
 * `training_system_practice` vs `adaptive_practice` vs `no_action` by
 * COORDINATING `@ipmat/repair-selection`, the five concrete
 * `@ipmat/training-systems` providers, and `@ipmat/adaptive-selection`
 * through their public contracts only — never reimplementing any engine's
 * matching/ranking algorithm, never merging them into one score.
 *
 * Sequence (D-062 inserts ONE new middle tier; the outer shape — repair
 * first, adaptive last, `no_action` as the final fallthrough — is
 * unchanged from D-052):
 * 1. No candidates at all -> `no_action` immediately, nothing consulted.
 * 2. `attemptTargetedRepair()` — always tried first when an eligible
 *    (confirmed) RepairPlan exists (`REPAIR_PRECEDES_ADAPTIVE`).
 * 3. If repair succeeded, done — `targeted_repair`.
 * 4. Otherwise, `shouldAttemptTrainingSystems()` decides whether to try
 *    the training-system tier — always true unless repair genuinely
 *    succeeded (mirrors `shouldAttemptAdaptivePractice()`'s own shape,
 *    now governing this new immediate-next tier instead).
 * 5. `attemptTrainingSystems()` tries all five providers, in
 *    `TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER`, stopping at the first
 *    `status: "selected"`. If one selects, done —
 *    `training_system_practice`, identified by `providerId`.
 * 6. Otherwise, `shouldAttemptAdaptivePracticeAfterTrainingSystems()`
 *    decides whether to fall through to adaptive practice — always true
 *    unless policy disallows it (never actually false in V1, checked
 *    explicitly anyway, the same discipline as step 4).
 * 7. If adaptive practice succeeds, done — `adaptive_practice`, with
 *    BOTH `wasFallbackFromRepair` and `wasFallbackFromTrainingSystems`
 *    correctly reported (both can be true simultaneously).
 * 8. Otherwise, `no_action` — `diagnostics` on EVERY branch preserves
 *    exactly what was tried (repair, every training-system provider
 *    actually invoked, and adaptive) and why none produced a selection.
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
        trainingSystems: null,
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
      diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, trainingSystems: null, adaptive: null, fallbackOccurred: false })
    };
  }

  if (!shouldAttemptTrainingSystems(repair.attempted, repair.outcome)) {
    return {
      status: "no_action",
      reason: "no_eligible_action",
      explanation: "Targeted repair returned no matching question, and policy does not permit trying anything further for this call.",
      diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, trainingSystems: null, adaptive: null, fallbackOccurred: false })
    };
  }

  const trainingSystems = attemptTrainingSystems(input);
  const fallbackFromRepair = repair.attempted;

  if (trainingSystems.selected) {
    const { providerId, outcome } = trainingSystems.selected;
    return {
      status: "selected",
      actionType: "training_system_practice",
      providerId,
      question: outcome.question,
      explanation: outcome.explanation,
      providerResult: outcome,
      wasFallbackFromRepair: fallbackFromRepair,
      diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, trainingSystems, adaptive: null, fallbackOccurred: fallbackFromRepair })
    };
  }

  if (!shouldAttemptAdaptivePracticeAfterTrainingSystems(true, false)) {
    return {
      status: "no_action",
      reason: "no_eligible_action",
      explanation: "No training-system provider matched, and policy does not permit a fallback to adaptive practice for this call.",
      diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, trainingSystems, adaptive: null, fallbackOccurred: fallbackFromRepair })
    };
  }

  const adaptive = attemptAdaptivePractice(input);
  const fallbackFromTrainingSystems = trainingSystems.outcomes.length > 0;

  if (adaptive.outcome?.status === "selected") {
    return {
      status: "selected",
      actionType: "adaptive_practice",
      question: adaptive.outcome.result.question,
      explanation: adaptive.outcome.result.explanation,
      providerResult: adaptive.outcome.result,
      wasFallbackFromRepair: fallbackFromRepair,
      wasFallbackFromTrainingSystems: fallbackFromTrainingSystems,
      diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, trainingSystems, adaptive, fallbackOccurred: fallbackFromRepair })
    };
  }

  return {
    status: "no_action",
    reason: "no_eligible_action",
    explanation: repair.attempted
      ? "Targeted repair returned no matching question, no training-system provider matched, and adaptive practice also produced no selection."
      : "No confirmed repair plan was eligible, no training-system provider matched, and adaptive practice produced no selection.",
    diagnostics: buildDiagnostics({ repairPlansSupplied: input.activeRepairPlans.length, repair, trainingSystems, adaptive, fallbackOccurred: fallbackFromRepair })
  };
}
