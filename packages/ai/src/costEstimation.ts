import type { TokenUsage } from "./types.js";

/**
 * A small, explicit, hand-maintained pricing table (USD per 1 million
 * tokens) — NOT a live pricing API call. Update when list prices change.
 * Unknown models return null cost rather than a guess (docs/AI_ARCHITECTURE.md
 * §7) — silently estimating $0 for an unrecognized model would be worse
 * than admitting we don't know.
 */
const PRICING_USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-opus-5": { input: 15, output: 75 },
  "fixture-deterministic-v1": { input: 0, output: 0 }
};

export function estimateCostUsd(model: string, usage: TokenUsage | null): number | null {
  if (!usage) return null;
  const pricing = PRICING_USD_PER_MILLION_TOKENS[model];
  if (!pricing) return null;
  return (usage.inputTokens / 1_000_000) * pricing.input + (usage.outputTokens / 1_000_000) * pricing.output;
}

/**
 * Whether `model` has a pricing entry at all — i.e. whether any future
 * `estimateCostUsd(model, ...)` call could ever return a non-null number.
 * Callers that must never let spend go unmeasured (docs/DECISIONS.md
 * D-027) check this BEFORE making a paid call, not after: a `null` cost
 * from `estimateCostUsd` is indistinguishable, on its own, from "genuinely
 * free," which is why a budget circuit breaker must never treat it as $0.
 */
export function isKnownModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRICING_USD_PER_MILLION_TOKENS, model);
}
