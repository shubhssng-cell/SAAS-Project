import type {
  ErrorTaxonomyEntry,
  MasteryAttemptRecord,
  MasteryStateResult,
  PrepPhaseResult,
  TrainingCandidateQuestion,
  TrainingSystemOutcome
} from "@ipmat/training-systems";
import type { ActiveRepairPlanContext, TrainingOrchestrationResult } from "@ipmat/training-orchestration";

/**
 * The internal development playground (docs/DECISIONS.md D-057) never
 * invents a second decision engine — it only dispatches to the REAL
 * public domain entry points and displays their REAL, unmodified output.
 * These four are the only systems it knows how to invoke; adding a fifth
 * (e.g. a future concrete provider) means adding one more case to
 * `runScenario.ts`'s dispatcher, never new decision logic.
 */
export const TRAINING_PLAYGROUND_SYSTEM_IDS = ["calculation-gym", "speed-lab", "trap-lab", "training-orchestration"] as const;
export type TrainingPlaygroundSystemId = (typeof TRAINING_PLAYGROUND_SYSTEM_IDS)[number];

/**
 * Shared input building blocks. `candidates` reuses `@ipmat/training-systems`'s
 * `TrainingCandidateQuestion` directly — the SAME structurally-identical
 * shape `@ipmat/training-orchestration`/`@ipmat/calculation-gym`/
 * `@ipmat/speed-lab`/`@ipmat/trap-lab` all already use, so the identical
 * array is passed to whichever system(s) a scenario exercises with no
 * conversion function (there is nothing to convert).
 */
export interface TrainingPlaygroundFixture {
  studentId: string;
  attemptRecords: MasteryAttemptRecord[];
  candidates: TrainingCandidateQuestion[];
  errorTaxonomy?: ErrorTaxonomyEntry[];
  masteryByConcept?: MasteryStateResult[];
  /** Only consumed when `systemsToRun` includes `"training-orchestration"`. */
  activeRepairPlans?: ActiveRepairPlanContext[];
  prepPhase?: PrepPhaseResult | null;
}

/**
 * For REGRESSION/TESTING purposes only (per the design brief) — the UI
 * must never blindly display this; it always displays the ACTUAL outcome
 * `runTrainingPlaygroundScenario()` returns. `status` is checked exactly
 * against the real outcome's own `status` field in tests.
 */
export interface TrainingPlaygroundExpectedOutcome {
  systemId: TrainingPlaygroundSystemId;
  status: string;
  note?: string;
}

export interface TrainingPlaygroundScenario {
  /** Stable, never reused once published. */
  id: string;
  displayName: string;
  description: string;
  /**
   * Plain-language, OBSERVABLE fixture facts only (e.g. "5 correct
   * attempts on low-computationalLoad questions") — never phrased as the
   * student's private reasoning or a confirmed diagnosis of anything.
   */
  evidenceSummary: string[];
  systemsToRun: TrainingPlaygroundSystemId[];
  fixture: TrainingPlaygroundFixture;
  expectedOutcomes: TrainingPlaygroundExpectedOutcome[];
}

export interface TrainingPlaygroundSystemResult {
  systemId: TrainingPlaygroundSystemId;
  /** The COMPLETE, unmodified result object the real domain function returned. */
  outcome: TrainingSystemOutcome | TrainingOrchestrationResult;
}

export interface TrainingPlaygroundRunResult {
  scenarioId: string;
  systemResults: TrainingPlaygroundSystemResult[];
}
