import Anthropic from "@anthropic-ai/sdk";
import type { AiCallOptions, AiCompletion, AiProvider } from "../types.js";

/**
 * Hard ceiling on a single call's OUTPUT tokens, passed as `max_tokens` on
 * every Messages API request below. This number is not just a formatting
 * choice — it is the actual bound on how much a single call can cost,
 * since the running-cost circuit breaker in
 * `@ipmat/question-engine/src/generationLimits.ts` is REACTIVE (checked
 * between calls, not during one): nothing stops a single call's cost from
 * being large before the pipeline notices, EXCEPT this cap on output
 * tokens (input tokens are bounded separately, by this codebase's own
 * prompt construction, not by anything the model controls). This is the
 * one place that coupling is made explicit and documented
 * (docs/DECISIONS.md D-031) — `worstCaseSingleCallCostUsd()` in
 * `generationLimits.ts` imports this exact constant and is tested against
 * it, so a change here that breaks that assumption fails a test, not
 * silently drifts. Raising this value is a real cost-safety decision, not
 * a formatting tweak — re-read D-031 before doing so.
 */
export const ANTHROPIC_MAX_OUTPUT_TOKENS_PER_CALL = 4096;

/**
 * The real provider — talks to the Anthropic Messages API. Requires
 * ANTHROPIC_API_KEY in the environment (the SDK reads it directly; this
 * class never touches or logs the key itself, satisfying "never expose
 * internal secrets" in the metadata it hands back to generateStructured).
 *
 * Not exercised in this repo's tests or demo scripts — no API key is
 * configured in the implementing environment (see the Phase 3 report).
 * It is fully implemented and typechecked so it's ready to use the moment
 * a key is available, without changing any call site (every call site
 * depends on the AiProvider interface, never this class directly).
 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(model: string, client?: Anthropic) {
    this.model = model;
    this.client = client ?? new Anthropic();
  }

  async complete(input: { systemPrompt: string; userPrompt: string; options?: AiCallOptions }): Promise<AiCompletion> {
    const start = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: ANTHROPIC_MAX_OUTPUT_TOKENS_PER_CALL,
      temperature: input.options?.temperature ?? 0,
      system: input.systemPrompt,
      messages: [{ role: "user", content: input.userPrompt }]
    });
    const latencyMs = Date.now() - start;
    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");

    return {
      rawText: textBlock?.text ?? "",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      },
      latencyMs
    };
  }
}
