import type { AiCompletion, AiProvider } from "../types.js";

/**
 * Deterministic provider for tests and demonstrations — no network call,
 * no API key required (docs/QUESTION_ENGINE.md §8: the domain layer must
 * be testable without a live AI provider). Responses are consumed FIFO;
 * calling complete() more times than responses were supplied is a test
 * bug, not a runtime fallback, so it throws loudly.
 */
export class FixtureProvider implements AiProvider {
  readonly name = "fixture";
  readonly model = "fixture-deterministic-v1";
  private readonly queue: string[];
  private callCount = 0;

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async complete(): Promise<AiCompletion> {
    const rawText = this.queue.shift();
    if (rawText === undefined) {
      throw new Error(
        `FixtureProvider: no canned response left for call #${this.callCount + 1} — supply more fixtures`
      );
    }
    this.callCount += 1;
    return {
      rawText,
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 1
    };
  }
}
