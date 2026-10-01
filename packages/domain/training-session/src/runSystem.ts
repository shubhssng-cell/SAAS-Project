import { buildDefaultProviderRegistry } from "@ipmat/training-orchestration";
import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext, TrainingSystemOutcome, TrainingSystemProvider } from "@ipmat/training-systems";
import { findTrainingSystem, type TrainingSystemDefinition } from "./catalog.js";
import { readStageKey } from "./stage.js";
import { TrainingSessionError } from "./errors.js";

/**
 * Phase 5 Unit 1 -- THE EXTENSION POINT. A training system's own policy lives entirely in
 * its `@ipmat/training-systems` provider (`evaluate()` = is this dimension worth training
 * now, `select()` = which published question serves it). This function only routes a
 * catalog system id to that provider through `runTrainingSystemProvider()` -- the one
 * canonical entry point (D-053) -- and returns its outcome UNMODIFIED. It reuses the
 * orchestration package's existing provider registry; there is no second registry and no
 * selection logic here (no ranking, filtering or tie-break of any kind).
 *
 * Adding a training system later = add a catalog entry + register its provider; nothing
 * in this file or in the session machinery changes.
 */
export type TrainingSystemRun = { status: "not_built"; definition: TrainingSystemDefinition } | { status: "ran"; definition: TrainingSystemDefinition; outcome: TrainingSystemOutcome };

export function runTrainingSystem(systemId: string, context: TrainingSystemContext, registry: ReadonlyMap<string, TrainingSystemProvider> = buildDefaultProviderRegistry()): TrainingSystemRun {
  const definition = findTrainingSystem(systemId);
  if (definition === null) {
    throw new TrainingSessionError("unknown_system", "That training system does not exist.");
  }
  if (definition.providerId === null) {
    return { status: "not_built", definition };
  }
  const provider = registry.get(definition.providerId);
  if (!provider) {
    // A catalog entry that names a provider the registry lacks is a wiring bug, never a runtime "no result".
    throw new Error(`Training system "${definition.systemId}" names provider "${definition.providerId}", which is not registered.`);
  }
  return { status: "ran", definition, outcome: runTrainingSystemProvider(provider, context) };
}

/** What a student-facing entry point may say about one system right now. Derived 1:1 from the provider outcome -- never a score. */
export const TRAINING_SYSTEM_AVAILABILITIES = ["available", "not_applicable", "no_eligible_question", "unavailable", "not_built"] as const;
export type TrainingSystemAvailability = (typeof TRAINING_SYSTEM_AVAILABILITIES)[number];

export function toAvailability(run: TrainingSystemRun): TrainingSystemAvailability {
  if (run.status === "not_built") return "not_built";
  switch (run.outcome.status) {
    case "selected":
      return "available";
    case "not_applicable":
      return "not_applicable";
    case "no_eligible_question":
      return "no_eligible_question";
    case "error":
      return "unavailable";
  }
}

/**
 * The stage key a run reports, if its provider is staged. Only an outcome that carries a requirement (`selected` or
 * `no_eligible_question` -- the system IS applicable) has one; `not_applicable`/`error`/`not_built` do not, and the stage is then simply unknown.
 */
export function stageKeyOfRun(run: TrainingSystemRun): string | null {
  if (run.status !== "ran") return null;
  const outcome = run.outcome;
  return outcome.status === "selected" || outcome.status === "no_eligible_question" ? readStageKey(outcome.requirement) : null;
}
