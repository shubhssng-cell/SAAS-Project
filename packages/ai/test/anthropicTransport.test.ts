import { describe, expect, it } from "vitest";
import { ANTHROPIC_TRANSPORT_TIMEOUT_MS, AnthropicProvider } from "../src/index.js";

/**
 * Phase 9 Unit 3 (D-099): the Anthropic client must not retry on its own (retries are decided in ONE visible place,
 * `generateStructured`, with a bounded count) and must have a finite transport timeout. No request is made; no key is needed
 * to construct the client when one is supplied through the environment placeholder below.
 */
describe("AnthropicProvider transport bounds", () => {
  it("constructs its default client with maxRetries 0 and a finite timeout", () => {
    const before = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "synthetic-test-placeholder-not-a-key";
    try {
      const provider = new AnthropicProvider("synthetic-model-id");
      const client = (provider as unknown as { client: { maxRetries: number; timeout: number } }).client;
      expect(client.maxRetries).toBe(0);
      expect(client.timeout).toBe(ANTHROPIC_TRANSPORT_TIMEOUT_MS);
      expect(ANTHROPIC_TRANSPORT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before;
    }
  });
});
