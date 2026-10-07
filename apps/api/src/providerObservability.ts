import type { AiCompletion, AiProvider } from "@ipmat/ai";
import type { AiUsageSink } from "@ipmat/billing";
import { currentContext, NOOP_LOGGER, NOOP_METRICS, type Logger, type Metrics } from "@ipmat/observability";

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

/**
 * `usage` (Phase 9 Unit 4, D-100) additionally records one USAGE FACT per provider call - provider, model, token counts exactly
 * as the provider reported them, outcome, coarse failure category, latency, the request's correlation id and the one-way student
 * reference. Never the prompt, the completion, an answer key, a cost (no authoritative pricing exists here) or a provider message.
 * It is best-effort telemetry: a failure to record is logged and counted, and never changes the model call's result. Authoritative
 * metering (limits) is the reservation made BEFORE the work, not this record.
 */
export function observeProvider(provider: AiProvider, observability: { metrics?: Metrics; logger?: Logger; usage?: AiUsageSink } = {}): AiProvider {
  const metrics = observability.metrics ?? NOOP_METRICS;
  const logger = observability.logger ?? NOOP_LOGGER;
  const usage = observability.usage;
  const recordUsage = (fields: { inputTokens: number | null; outputTokens: number | null; outcome: "ok" | "error"; failureCategory: string | null; latencyMs: number }): void => {
    if (!usage) return;
    const ctx = currentContext();
    void usage
      .record({ requestId: ctx?.requestId ?? null, studentRef: ctx?.studentRef ?? null, occurredAt: new Date().toISOString(), provider: provider.name, model: provider.model, ...fields })
      .catch(() => {
        metrics.inc("ai_usage_record_failures_total", { provider: provider.name });
        logger.warn("billing.ai_usage_record_failed", { provider: provider.name, failureCategory: "dependency_unavailable" });
      });
  };
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
        recordUsage({ inputTokens: completion.usage?.inputTokens ?? null, outputTokens: completion.usage?.outputTokens ?? null, outcome: "ok", failureCategory: null, latencyMs });
        return completion;
      } catch (error) {
        const latencyMs = Date.now() - start;
        const category = classifyProviderError(error);
        metrics.observeMs("provider_latency_ms", latencyMs, { provider: provider.name, outcome: "error" });
        metrics.inc("provider_errors_total", { provider: provider.name, category });
        logger.warn("provider.call", { provider: provider.name, model: provider.model, latencyMs, outcome: "error", failureCategory: category });
        recordUsage({ inputTokens: null, outputTokens: null, outcome: "error", failureCategory: category, latencyMs });
        throw error;
      }
    }
  };
}
