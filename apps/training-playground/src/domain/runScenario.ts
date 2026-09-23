import { CalculationGymProvider } from "@ipmat/calculation-gym";
import { SpeedLabProvider } from "@ipmat/speed-lab";
import { TrapLabProvider } from "@ipmat/trap-lab";
import { orchestrateNextTrainingAction } from "@ipmat/training-orchestration";
import type { TrainingOrchestrationInput, TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext, TrainingSystemOutcome, TrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingPlaygroundFixture, TrainingPlaygroundRunResult, TrainingPlaygroundScenario, TrainingPlaygroundSystemId } from "./types.js";

/**
 * Pure input-SHAPE adapters only — zero decision logic. Each function maps
 * the shared `TrainingPlaygroundFixture` onto the EXACT input type the
 * real domain entry point already declares; nothing here re-implements
 * applicability, recurrence, selection, or priority rules that already
 * live in the domain packages themselves (docs/DECISIONS.md D-057).
 */
function toTrainingSystemContext(fixture: TrainingPlaygroundFixture): TrainingSystemContext {
  return {
    studentId: fixture.studentId,
    masteryByConcept: fixture.masteryByConcept ?? [],
    attemptRecords: fixture.attemptRecords,
    errorTaxonomy: fixture.errorTaxonomy,
    prepPhase: fixture.prepPhase,
    candidates: fixture.candidates
  };
}

function toTrainingOrchestrationInput(fixture: TrainingPlaygroundFixture): TrainingOrchestrationInput {
  return {
    studentId: fixture.studentId,
    activeRepairPlans: fixture.activeRepairPlans ?? [],
    masteryByConcept: fixture.masteryByConcept ?? [],
    attemptRecords: fixture.attemptRecords,
    prepPhase: fixture.prepPhase,
    candidates: fixture.candidates
  };
}

const SPECIALIZED_PROVIDERS: Partial<Record<TrainingPlaygroundSystemId, () => TrainingSystemProvider>> = {
  "calculation-gym": () => new CalculationGymProvider(),
  "speed-lab": () => new SpeedLabProvider(),
  "trap-lab": () => new TrapLabProvider()
};

/**
 * Dispatches to exactly ONE real, public domain entry point per system id
 * and returns its output completely unmodified. This is the ONLY function
 * in the playground that calls into the domain layer -- every UI
 * component downstream only ever reads the result this returns, never
 * recomputes anything.
 */
function runSystem(systemId: TrainingPlaygroundSystemId, fixture: TrainingPlaygroundFixture): TrainingSystemOutcome | TrainingOrchestrationResult {
  if (systemId === "training-orchestration") {
    return orchestrateNextTrainingAction(toTrainingOrchestrationInput(fixture));
  }

  const makeProvider = SPECIALIZED_PROVIDERS[systemId];
  if (!makeProvider) {
    // Structurally unreachable given TrainingPlaygroundSystemId's closed union -- fails loudly rather than silently, the same discipline the domain packages themselves use for "impossible" branches.
    throw new Error(`Unknown training playground system id: "${systemId}"`);
  }
  return runTrainingSystemProvider(makeProvider(), toTrainingSystemContext(fixture));
}

/**
 * Runs every system a scenario declares (`scenario.systemsToRun`),
 * independently, against the SAME fixture. A scenario with more than one
 * system (e.g. "mixed evidence") is never merged into one combined
 * decision -- each system's real, unmodified outcome is preserved
 * separately, exactly mirroring how the domain packages themselves never
 * merge each other's results.
 */
export function runTrainingPlaygroundScenario(scenario: TrainingPlaygroundScenario): TrainingPlaygroundRunResult {
  return {
    scenarioId: scenario.id,
    systemResults: scenario.systemsToRun.map((systemId) => ({ systemId, outcome: runSystem(systemId, scenario.fixture) }))
  };
}
