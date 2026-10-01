/**
 * Phase 5 Unit 1 -- THE TRAINING SYSTEM CATALOG (docs/DECISIONS.md D-075).
 *
 * A Training System answers "what performance dimension are we deliberately
 * training?" -- NOT "what should this student practice next?" (that stays
 * `@ipmat/adaptive-selection`'s job). Each entry names ONE dimension and, where a
 * concrete engine already exists, the `@ipmat/training-systems` provider that decides
 * (a) whether the dimension is worth training for this student RIGHT NOW and (b) which
 * published question serves it. This catalog never decides either -- it is a lookup
 * from a stable system id to its dimension, its student-facing words, and its provider.
 *
 * `providerId: null` means NO engine exists yet (Revision, Overtraining -- named in
 * docs/DECISIONS.md D-059/D-062 as future, still-undesigned work). Those entries exist
 * so the student-facing entry point can say honestly that they are not built; they can
 * never start a session.
 */
export const TRAINING_DIMENSIONS = ["calculation", "speed", "trap", "novelty", "pressure", "revision", "overtraining"] as const;
export type TrainingDimension = (typeof TRAINING_DIMENSIONS)[number];

export interface TrainingSystemDefinition {
  /** Stable id. For a built system it equals its provider's `providerId`. */
  systemId: string;
  dimension: TrainingDimension;
  /** Short student-facing name. */
  label: string;
  /** One sentence: what a session in this system deliberately trains. Never a claim about the student. */
  trains: string;
  /** The `@ipmat/training-systems` provider that serves this system, or `null` when none exists yet. */
  providerId: string | null;
}

/** Display order. Deterministic and fixed -- never sorted by any score. */
export const TRAINING_SYSTEM_CATALOG: readonly TrainingSystemDefinition[] = [
  { systemId: "calculation-gym", dimension: "calculation", label: "Calculation", trains: "Accuracy on questions that need heavier arithmetic.", providerId: "calculation-gym" },
  { systemId: "speed-lab", dimension: "speed", label: "Speed", trains: "Pace on concepts you already answer correctly.", providerId: "speed-lab" },
  { systemId: "trap-lab", dimension: "trap", label: "Traps", trains: "Spotting the specific trap a question is built around.", providerId: "trap-lab" },
  { systemId: "novelty-training", dimension: "novelty", label: "Novelty", trains: "Unfamiliar twists on concepts you have already practised.", providerId: "novelty-training" },
  { systemId: "pressure-training", dimension: "pressure", label: "Pressure", trains: "Holding your performance across a timed run of questions.", providerId: "pressure-training" },
  { systemId: "revision", dimension: "revision", label: "Revision", trains: "Revisiting concepts after time has passed.", providerId: null },
  { systemId: "overtraining", dimension: "overtraining", label: "Overtraining", trains: "Keeping repeated practice from over-narrowing.", providerId: null }
];

export function findTrainingSystem(systemId: string): TrainingSystemDefinition | null {
  return TRAINING_SYSTEM_CATALOG.find((definition) => definition.systemId === systemId) ?? null;
}
