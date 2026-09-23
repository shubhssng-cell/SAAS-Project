import { CalculationGymProvider } from "@ipmat/calculation-gym";
import { NoveltyTrainingProvider } from "@ipmat/novelty-training";
import { PressureTrainingProvider } from "@ipmat/pressure-training";
import { SpeedLabProvider } from "@ipmat/speed-lab";
import { TrapLabProvider } from "@ipmat/trap-lab";
import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext, TrainingSystemOutcome, TrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingOrchestrationInput, TrainingSystemProviderOutcomeRecord } from "./types.js";

/**
 * Fixed, named, PROVISIONAL priority order (docs/DECISIONS.md D-062) —
 * NEVER a numeric score. Ordered by specificity/urgency of the underlying
 * signal, the same reasoning `@ipmat/adaptive-selection`'s own
 * `TRAINING_NEED_PRIORITY_ORDER` already uses one level up: a recurring,
 * specific failure (Trap Lab) is more urgent than a specific, evidenced
 * accuracy gap (Calculation Gym), which is more urgent than a general
 * pace inefficiency (Speed Lab), which is more urgent than sustained-
 * sequence behavioral evidence (Pressure Training — the newest and most
 * infrastructure-dependent signal, since no real caller ever supplies
 * `practiceBlocks` yet), which is more urgent than a deliberate exposure
 * opportunity (Novelty Training — D-058's own "exposure-first, not
 * weakness-first" character makes it an opportunity, not a problem, the
 * lowest-urgency tier here — mirroring how adaptive-selection's own
 * `difficulty_progression` is its deliberate lowest-priority fallback).
 * This is authored policy, not calibrated against real outcome data —
 * the same honest caveat every other priority order in this codebase
 * carries.
 */
export const TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER = ["trap-lab", "calculation-gym", "speed-lab", "pressure-training", "novelty-training"] as const;

/**
 * One instance per provider, keyed by its own `providerId` — built once,
 * reused across calls (every provider here is a stateless pure-function
 * wrapper). A future 6th provider (Mock Simulation, Revision) is added
 * HERE and to the priority order above — never by adding a new
 * `TrainingActionType` (docs/DECISIONS.md D-062).
 */
function buildProviderRegistry(): Map<string, TrainingSystemProvider> {
  const providers: TrainingSystemProvider[] = [
    new TrapLabProvider(),
    new CalculationGymProvider(),
    new SpeedLabProvider(),
    new PressureTrainingProvider(),
    new NoveltyTrainingProvider()
  ];
  return new Map(providers.map((provider) => [provider.providerId, provider]));
}

const PROVIDER_REGISTRY = buildProviderRegistry();

/** Exposed for tests only (e.g. proving a provider-level `error` outcome never crashes or blocks the rest of the sequence) — `attemptTrainingSystems()`'s real call site in `orchestrate.ts` never passes a second argument, so production behavior is unaffected. */
export function buildDefaultProviderRegistry(): Map<string, TrainingSystemProvider> {
  return PROVIDER_REGISTRY;
}

/**
 * Maps `TrainingOrchestrationInput` onto `@ipmat/training-systems`'s
 * `TrainingSystemContext` — the SAME field-for-field restatement
 * `apps/training-playground/src/domain/runScenario.ts`'s own
 * `toTrainingSystemContext()` already performs (a real, working
 * precedent followed here, not invented). Deliberately does NOT forward
 * `activeRepairPlans` — no provider has, or should have, a field for it;
 * the repair/training-systems interaction is handled entirely by
 * ORCHESTRATION SEQUENCING in `orchestrate.ts`, never by threading
 * RepairPlan data into a provider's own applicability decision (docs/
 * DECISIONS.md D-062).
 */
export function toTrainingSystemContext(input: TrainingOrchestrationInput): TrainingSystemContext {
  return {
    studentId: input.studentId,
    masteryByConcept: input.masteryByConcept,
    attemptRecords: input.attemptRecords,
    errorTaxonomy: input.errorTaxonomy,
    prepPhase: input.prepPhase,
    candidates: input.candidates,
    practiceBlocks: input.practiceBlocks
  };
}

export interface TrainingSystemProvidersAttempt {
  /** Every provider actually invoked, in priority-tried order, with its RAW, unmodified outcome. */
  outcomes: TrainingSystemProviderOutcomeRecord[];
  /** The first provider (in priority order) whose outcome was `status: "selected"` — `null` if none was. */
  selected: { providerId: string; outcome: Extract<TrainingSystemOutcome, { status: "selected" }> } | null;
}

/**
 * Tries each provider, in `TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER`, via
 * `runTrainingSystemProvider()` — the ONLY entry point (docs/DECISIONS.md
 * D-053, D-062; `evaluate()`/`select()` are never called directly here) —
 * stopping at the FIRST `status: "selected"`. Every OTHER outcome
 * (`not_applicable`, `no_eligible_question`, `error`) is recorded and the
 * next provider is tried — a content gap, a mode simply not applying, or
 * one provider's own impossible-execution error never blocks trying the
 * rest (mirrors `orchestrate.ts`'s existing repair-no_match -> adaptive
 * fallback reasoning, generalized here to an N-way chain across all five
 * providers before ever falling through to adaptive practice).
 */
export function attemptTrainingSystems(input: TrainingOrchestrationInput, registry: Map<string, TrainingSystemProvider> = PROVIDER_REGISTRY): TrainingSystemProvidersAttempt {
  const context = toTrainingSystemContext(input);
  const outcomes: TrainingSystemProviderOutcomeRecord[] = [];

  for (const providerId of TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER) {
    const provider = registry.get(providerId);
    if (!provider) continue; // structurally unreachable against the real registry -- every id in the priority order has a registered provider (proven by a dedicated test); a test-injected registry may legitimately omit one

    const outcome = runTrainingSystemProvider(provider, context);
    outcomes.push({ providerId, outcome });

    if (outcome.status === "selected") {
      return { outcomes, selected: { providerId, outcome } };
    }
  }

  return { outcomes, selected: null };
}
