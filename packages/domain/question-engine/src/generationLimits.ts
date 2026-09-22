/**
 * Explicit, validated limits the generation pipeline requires before it
 * will run (Phase 3.1 §9 — "before generation is ever run in batches,
 * ensure the generation infrastructure requires explicit limits"). No
 * batch generator is built in this phase; this is the guard rail it will
 * be required to supply when it exists — `runGenerationPipeline()`
 * already validates and enforces these today, on the single-blueprint
 * path, so the pattern is proven before anything scales.
 */
export interface GenerationLimits {
  /** How many distinct blueprints a run is allowed to touch. Always 1 until a batch orchestrator exists. */
  maxBlueprints: number;
  /** How many candidate questions may be generated per blueprint in one run. */
  maxCandidatesPerBlueprint: number;
  /** Per-AI-call retry ceiling, passed through to every generateStructured() call. */
  maxRetries: number;
  /** Total AI generation attempts (across all blueprints/candidates) a run may make — the hard stop against a runaway loop. */
  maxGenerationAttempts: number;
  /** Running estimated cost (docs/AI_ARCHITECTURE.md §2) above which the pipeline stops making further AI calls and fails closed. */
  maxEstimatedBudgetUsd: number;
}

/** Safe defaults for exactly what this phase actually does: one blueprint, one candidate. */
export const DEFAULT_SINGLE_RUN_LIMITS: GenerationLimits = {
  maxBlueprints: 1,
  maxCandidatesPerBlueprint: 1,
  maxRetries: 2,
  maxGenerationAttempts: 1,
  maxEstimatedBudgetUsd: 1.0
};

/**
 * Throws with every violated rule listed, not just the first — fails
 * loudly and immediately, before any AI call is made. There is no path
 * through `runGenerationPipeline()` that skips this check.
 */
export function validateGenerationLimits(limits: GenerationLimits): void {
  const checks: Array<[boolean, string]> = [
    [Number.isInteger(limits.maxBlueprints) && limits.maxBlueprints > 0, "maxBlueprints must be a positive integer"],
    [
      Number.isInteger(limits.maxCandidatesPerBlueprint) && limits.maxCandidatesPerBlueprint > 0,
      "maxCandidatesPerBlueprint must be a positive integer"
    ],
    [Number.isInteger(limits.maxRetries) && limits.maxRetries >= 0, "maxRetries must be a non-negative integer"],
    [
      Number.isInteger(limits.maxGenerationAttempts) && limits.maxGenerationAttempts > 0,
      "maxGenerationAttempts must be a positive integer"
    ],
    [
      limits.maxGenerationAttempts >= limits.maxBlueprints * limits.maxCandidatesPerBlueprint,
      "maxGenerationAttempts must be at least maxBlueprints * maxCandidatesPerBlueprint"
    ],
    [Number.isFinite(limits.maxEstimatedBudgetUsd) && limits.maxEstimatedBudgetUsd > 0, "maxEstimatedBudgetUsd must be > 0"],
    [
      limits.maxEstimatedBudgetUsd <= 50,
      "maxEstimatedBudgetUsd above $50 requires deliberately raising this check, not just passing a bigger number — this phase's proof-of-concept scope does not need anywhere near that"
    ]
  ];
  const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
  if (failures.length > 0) {
    throw new Error(`Invalid generation limits: ${failures.join("; ")}`);
  }
}
