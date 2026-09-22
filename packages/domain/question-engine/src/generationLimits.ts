import { ANTHROPIC_MAX_OUTPUT_TOKENS_PER_CALL, estimateCostUsd } from "@ipmat/ai";

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

/**
 * A conservative, documented assumption about prompt input size (Phase
 * 3.1.1 §7): unlike output tokens, nothing in this codebase caps input
 * tokens directly, but input size is bounded by OUR OWN prompt
 * construction (`prompts.ts`) — a blueprint's fields and a question's
 * stem/options — not by anything the model controls, so this is a
 * generous ceiling on what those prompts actually run to, not a hard
 * enforced limit.
 */
export const ASSUMED_MAX_PROMPT_INPUT_TOKENS = 2000;

/**
 * THE one clearly documented place explaining how a maximum output-token
 * cap bounds worst-case provider cost per call (Phase 3.1.1 §7 /
 * docs/DECISIONS.md D-031). `runGenerationPipeline()`'s running-cost
 * circuit breaker (`overBudget()`) is REACTIVE — it is only ever checked
 * BETWEEN calls, never during one — so nothing in generationLimits.ts or
 * generationPipeline.ts, by itself, stops a single call from costing a
 * large amount before the breaker gets a chance to react. What actually
 * bounds that is `AnthropicProvider`'s hardcoded
 * `ANTHROPIC_MAX_OUTPUT_TOKENS_PER_CALL` (`@ipmat/ai`), combined with the
 * fact that input tokens are bounded by our own prompt construction. This
 * function computes exactly what that worst case is for a given model, so
 * the coupling is a testable number, not just a comment — see
 * `test/generationLimits.test.ts` for the assertion that this stays under
 * `DEFAULT_SINGLE_RUN_LIMITS.maxEstimatedBudgetUsd` for every currently
 * known model.
 *
 * This does NOT bound the total cost of a full pipeline run (three calls),
 * only a single call — see the note on `overBudget()` in
 * `generationPipeline.ts` for why the three-call aggregate can still
 * exceed `maxEstimatedBudgetUsd` by up to roughly one call's worst case
 * before the breaker stops the next one. No production billing guarantee
 * is implied by this function; it is a conservative estimate for a
 * specific, documented worst case, nothing more.
 */
export function worstCaseSingleCallCostUsd(
  model: string,
  assumedMaxInputTokens: number = ASSUMED_MAX_PROMPT_INPUT_TOKENS
): number | null {
  return estimateCostUsd(model, {
    inputTokens: assumedMaxInputTokens,
    outputTokens: ANTHROPIC_MAX_OUTPUT_TOKENS_PER_CALL
  });
}
