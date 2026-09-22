import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateStructured } from "../src/generateStructured.js";
import { AiGenerationError } from "../src/types.js";
import { FixtureProvider } from "../src/providers/fixtureProvider.js";

const schema = z.object({ answer: z.number() });

function baseInput(overrides: Partial<Parameters<typeof generateStructured>[1]> = {}) {
  return {
    task: "test-task",
    promptVersion: "v1",
    systemPrompt: "system",
    userPrompt: "user",
    schema,
    ...overrides
  };
}

describe("generateStructured — never trusts raw JSON without validation", () => {
  it("returns validated data and success metadata on a clean first response", async () => {
    const provider = new FixtureProvider([JSON.stringify({ answer: 42 })]);
    const result = await generateStructured(provider, baseInput());
    expect(result.data).toEqual({ answer: 42 });
    expect(result.metadata.success).toBe(true);
    expect(result.metadata.validationOutcome).toBe("valid");
    expect(result.metadata.attempts).toBe(1);
    expect(result.metadata.provider).toBe("fixture");
  });

  it("retries after malformed JSON and succeeds on the second attempt", async () => {
    const provider = new FixtureProvider(["not json at all", JSON.stringify({ answer: 7 })]);
    const result = await generateStructured(provider, baseInput({ options: { maxRetries: 2 } }));
    expect(result.data).toEqual({ answer: 7 });
    expect(result.metadata.attempts).toBe(2);
  });

  it("retries after a schema validation failure and succeeds", async () => {
    const provider = new FixtureProvider([
      JSON.stringify({ answer: "not-a-number" }),
      JSON.stringify({ answer: 99 })
    ]);
    const result = await generateStructured(provider, baseInput({ options: { maxRetries: 2 } }));
    expect(result.data).toEqual({ answer: 99 });
  });

  it("strips markdown code fences before parsing", async () => {
    const provider = new FixtureProvider(["```json\n" + JSON.stringify({ answer: 5 }) + "\n```"]);
    const result = await generateStructured(provider, baseInput());
    expect(result.data).toEqual({ answer: 5 });
  });

  it("throws AiGenerationError after exhausting retries on persistent invalid output", async () => {
    const provider = new FixtureProvider([
      JSON.stringify({ answer: "bad" }),
      JSON.stringify({ answer: "still bad" }),
      JSON.stringify({ answer: "bad again" })
    ]);
    await expect(generateStructured(provider, baseInput({ options: { maxRetries: 2 } }))).rejects.toThrow(
      AiGenerationError
    );
  });

  it("failure metadata on the thrown error reflects the outcome, never fabricating success", async () => {
    const provider = new FixtureProvider(["broken", "still broken", "broken again"]);
    try {
      await generateStructured(provider, baseInput({ options: { maxRetries: 2 } }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AiGenerationError);
      const aiError = error as AiGenerationError;
      expect(aiError.metadata.success).toBe(false);
      expect(aiError.metadata.attempts).toBe(3);
    }
  });

  it("times out a slow provider and still throws a well-formed AiGenerationError", async () => {
    const slowProvider = {
      name: "slow",
      model: "slow-model",
      complete: () => new Promise<never>(() => {}) // never resolves
    };
    await expect(
      generateStructured(slowProvider, baseInput({ options: { timeoutMs: 20, maxRetries: 0 } }))
    ).rejects.toThrow(AiGenerationError);
  });
});
