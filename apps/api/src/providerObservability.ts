import type { AiCompletion, AiProvider } from "@ipmat/ai";
import { NOOP_LOGGER, NOOP_METRICS, type Logger, type Metrics } from "@ipmat/observability";

/**
 * Provider call observability (Phase 9 Unit 3, docs/DECISIONS.md D-099): a transparent decorator around any `@ipmat/ai` provider.
 * It records provider name, model, latency and a COARSE failure category, and nothing else: never the system prompt, the user
 * prompt, the completion text, a student's words or the provider's own error message (which can echo request content or a key).
 * The original error is rethrown unchanged, so `generateStructured`'s explicit, bounded retry/timeout policy is unaffected.
 */
export type ProviderFailureCategory = "rate_limited" | "timeout" | "server_error" | "client_error" | "unknown";

export function classifyProviderError(error: unknown): ProviderFailureCategory {
  const e = error as { name?: unknown; status?: unknown; statusCode?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : null;
  if (status === 429) return "rate_limited";
  if (typeof e?.name === "string" && /timeout/i.test(e.name)) return "timeout";
  if (status !== null && status >= 500) return "server_error";
  if (status !== null && status >= 400) return "client_error";
  return "unknown";
}

export function observeProvider(provider: AiProvider, observability: { metrics?: Metrics; logger?: Logger } = {}): AiProvider {
  const metrics = observability.metrics ?? NOOP_METRICS;
  const logger = observability.logger ?? NOOP_LOGGER;
  return {
    name: provider.name,
    model: provider.model,
    async complete(input): Promise<AiCompletion> {
      const start = Date.now();
      try {
        const completion = await provider.complete(input);
        const latencyMs = Date.now() - start;
        metrics.observeMs("provider_latency_ms", latencyMs, { provider: provider.name, outcome: "ok" });
        logger.info("provider.call", { provider: provider.name, model: provider.model, latencyMs, outcome: "ok" });
        return completion;
      } catch (error) {
        const latencyMs = Date.now() - start;
        const category = classifyProviderError(error);
        metrics.observeMs("provider_latency_ms", latencyMs, { provider: provider.name, outcome: "error" });
        metrics.inc("provider_errors_total", { provider: provider.name, category });
        logger.warn("provider.call", { provider: provider.name, model: provider.model, latencyMs, outcome: "error", failureCategory: category });
        throw error;
      }
    }
  };
}
