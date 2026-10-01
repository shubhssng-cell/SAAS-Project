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

/**
 * One stage of a staged training system, in order, with hand-authored student-safe words. The KEYS restate the provider's own stage
 * vocabulary (e.g. `CALCULATION_TRAINING_STAGES`) -- this package cannot import a concrete provider -- and a test asserts they stay equal.
 * The copy names what a stage is about; it never states a threshold, a score, or anything about the student.
 */
export interface TrainingStageDefinition {
  key: string;
  label: string;
  summary: string;
}

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
  /** Optional title shown on the session screen (defaults to "<label> training"), e.g. "Calculation Gym". */
  sessionTitle?: string;
  /** Present only for a system whose provider works in ordered stages (Phase 5 Unit 2: Calculation). The stage itself is always decided by the provider, from history. */
  stages?: readonly TrainingStageDefinition[];
  /** Optional system-specific, student-safe sentence for "not applicable right now" (what the student would need to have done first), replacing the generic one. */
  notApplicableNote?: string;
}

/** Display order. Deterministic and fixed -- never sorted by any score. */
export const TRAINING_SYSTEM_CATALOG: readonly TrainingSystemDefinition[] = [
  {
    systemId: "calculation-gym",
    dimension: "calculation",
    label: "Calculation",
    sessionTitle: "Calculation Gym",
    trains: "Deliberate calculation practice: accuracy on questions that need heavier arithmetic.",
    providerId: "calculation-gym",
    stages: [
      { key: "foundational", label: "Stage 1 · Foundations", summary: "Lighter arithmetic, to build a reliable base." },
      { key: "mixed", label: "Stage 2 · Heavier arithmetic", summary: "Questions with more demanding calculation." },
      { key: "time_pressured", label: "Stage 3 · Under time pressure", summary: "Demanding calculation on questions built to be timed." }
    ],
    notApplicableNote: "Needs recorded answers on both lighter and heavier-arithmetic questions of the same concept first."
  },
  {
    systemId: "speed-lab",
    dimension: "speed",
    label: "Speed",
    sessionTitle: "Speed Lab",
    trains: "Improve solving speed: working within the expected time on concepts you already answer correctly.",
    providerId: "speed-lab",
    stages: [
      { key: "steady_pace", label: "Stage 1 · Steady pace", summary: "Straightforward questions, to be solved within the expected time." },
      { key: "mixed_pace", label: "Stage 2 · Mixed pace", summary: "Questions with more conceptual weight, still within the expected time." },
      { key: "time_constrained", label: "Stage 3 · Time-constrained", summary: "Questions built to be answered under a time limit." }
    ],
    notApplicableNote: "Needs several recorded answers on straightforward questions of the same concept first."
  },
  { systemId: "trap-lab", dimension: "trap", label: "Traps", trains: "Spotting the specific trap a question is built around.", providerId: "trap-lab" },
  { systemId: "novelty-training", dimension: "novelty", label: "Novelty", trains: "Unfamiliar twists on concepts you have already practised.", providerId: "novelty-training" },
  { systemId: "pressure-training", dimension: "pressure", label: "Pressure", trains: "Holding your performance across a timed run of questions.", providerId: "pressure-training" },
  { systemId: "revision", dimension: "revision", label: "Revision", trains: "Revisiting concepts after time has passed.", providerId: null },
  { systemId: "overtraining", dimension: "overtraining", label: "Overtraining", trains: "Keeping repeated practice from over-narrowing.", providerId: null }
];

export function findTrainingSystem(systemId: string): TrainingSystemDefinition | null {
  return TRAINING_SYSTEM_CATALOG.find((definition) => definition.systemId === systemId) ?? null;
}
