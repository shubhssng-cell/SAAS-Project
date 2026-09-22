import { estimateCostUsd } from "./costEstimation.js";
import type { AiProvider, AiResultMetadata, GenerateStructuredInput, GenerateStructuredResult } from "./types.js";
import { AiGenerationError } from "./types.js";
import { backoffDelayMs, safeJsonParse, sleep, withTimeout } from "./util.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * The one function every AI call in the product goes through (docs/
 * AI_ARCHITECTURE.md §1-2). No call site elsewhere constructs a prompt
 * string, parses a raw LLM response, or trusts unvalidated JSON.
 *
 * Retry policy: on a schema-validation failure, retries with the
 * validation error appended to the prompt (so the model can self-correct);
 * on a provider-level error (timeout, network), retries with exponential
 * backoff. Exhausting retries throws AiGenerationError with metadata for
 * the final failed attempt — it never returns unvalidated data.
 */
export async function generateStructured<T>(
  provider: AiProvider,
  input: GenerateStructuredInput<T>
): Promise<GenerateStructuredResult<T>> {
  const maxRetries = input.options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = input.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let userPrompt = input.userPrompt;
  let lastMetadata: AiResultMetadata | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptNumber = attempt + 1;
    try {
      const completion = await withTimeout(
        provider.complete({ systemPrompt: input.systemPrompt, userPrompt, options: input.options }),
        timeoutMs
      );

      const parsed = safeJsonParse(completion.rawText);
      const estimatedCostUsd = estimateCostUsd(provider.model, completion.usage);
      const baseMetadata = {
        provider: provider.name,
        model: provider.model,
        promptVersion: input.promptVersion,
        task: input.task,
        timestamp: new Date().toISOString(),
        latencyMs: completion.latencyMs,
        tokenUsage: completion.usage,
        estimatedCostUsd,
        attempts: attemptNumber
      };

      if (!parsed.ok) {
        lastMetadata = { ...baseMetadata, success: false, validationOutcome: "invalid" };
        if (attempt < maxRetries) {
          userPrompt = `${input.userPrompt}\n\nYour previous response was not valid JSON (${parsed.error}). Return ONLY a single valid JSON object matching the required schema — no markdown fences, no commentary.`;
          await sleep(backoffDelayMs(attempt));
          continue;
        }
        throw new AiGenerationError(`Response was not valid JSON after ${attemptNumber} attempt(s): ${parsed.error}`, lastMetadata);
      }

      const validation = input.schema.safeParse(parsed.value);
      if (!validation.success) {
        lastMetadata = { ...baseMetadata, success: false, validationOutcome: "invalid" };
        if (attempt < maxRetries) {
          userPrompt = `${input.userPrompt}\n\nYour previous response failed schema validation: ${validation.error.message}. Return ONLY a single valid JSON object matching the required schema, fixing the issues above.`;
          await sleep(backoffDelayMs(attempt));
          continue;
        }
        throw new AiGenerationError(
          `Response failed schema validation after ${attemptNumber} attempt(s): ${validation.error.message}`,
          lastMetadata
        );
      }

      const metadata: AiResultMetadata = { ...baseMetadata, success: true, validationOutcome: "valid" };
      return { data: validation.data, metadata };
    } catch (error) {
      if (error instanceof AiGenerationError) throw error;
      lastError = error;
      lastMetadata = {
        provider: provider.name,
        model: provider.model,
        promptVersion: input.promptVersion,
        task: input.task,
        timestamp: new Date().toISOString(),
        latencyMs: 0,
        tokenUsage: null,
        estimatedCostUsd: null,
        success: false,
        validationOutcome: "not_applicable",
        attempts: attemptNumber
      };
      if (attempt < maxRetries) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
    }
  }

  throw new AiGenerationError(
    `AI call for task "${input.task}" failed after ${maxRetries + 1} attempt(s)`,
    lastMetadata as AiResultMetadata,
    lastError
  );
}
