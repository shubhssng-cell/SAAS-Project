import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AnthropicProvider, type AiCompletion, type AiProvider } from "@ipmat/ai";
import { generateObservationHypothesis } from "@ipmat/autopsy";
import type { HypothesisGenerator, HypothesisSealer } from "@ipmat/practice-api";

/**
 * Phase 4 Unit 2 -- how `apps/api` obtains (or does not obtain) a hypothesis generator. Explicit opt-in, fail-closed, like persistence:
 *
 *   IPMAT_AI_PROVIDER unset / "none"  -> NO generator. Every hypothesis request answers "unavailable"; nothing is ever fabricated.
 *   IPMAT_AI_PROVIDER=anthropic       -> the real model. REQUIRES ANTHROPIC_API_KEY and IPMAT_AI_MODEL (no silent default model); the server
 *                                        refuses to start without them.
 *   IPMAT_AI_PROVIDER=dev-scripted    -> a DEVELOPMENT/TEST scaffold that mimics a model by quoting the observed facts. It is NOT AI, refuses
 *                                        to run when NODE_ENV=production, and exists only so the confirmation flow can be exercised end to
 *                                        end without a paid key. Anything shown to a student in production must come from `anthropic`.
 * Anything else is an error at startup.
 *
 * IPMAT_HYPOTHESIS_SECRET seals the confirmation token. Every instance that may answer a student's response must share it; if it is unset a
 * random per-process secret is used, which is safe (a token from another process is simply refused and the student is offered a new
 * explanation) but means tokens do not survive a restart.
 */
export type AiConfig = { kind: "none" } | { kind: "anthropic"; model: string } | { kind: "dev-scripted" };

export function resolveAiConfig(env: Record<string, string | undefined>): AiConfig {
  const requested = (env.IPMAT_AI_PROVIDER ?? "none").trim().toLowerCase();
  if (requested === "none" || requested === "") return { kind: "none" };
  if (requested === "anthropic") {
    if (!env.ANTHROPIC_API_KEY?.trim()) throw new Error("IPMAT_AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY. Refusing to start without it (it never falls back to a fake).");
    const model = env.IPMAT_AI_MODEL?.trim();
    if (!model) throw new Error("IPMAT_AI_PROVIDER=anthropic requires IPMAT_AI_MODEL (an explicit model id; there is no default).");
    return { kind: "anthropic", model };
  }
  if (requested === "dev-scripted") {
    if ((env.NODE_ENV ?? "").toLowerCase() === "production") throw new Error("IPMAT_AI_PROVIDER=dev-scripted is a development scaffold and is refused when NODE_ENV=production.");
    return { kind: "dev-scripted" };
  }
  throw new Error(`Unknown IPMAT_AI_PROVIDER value "${requested}" (expected "none", "anthropic" or "dev-scripted").`);
}

/**
 * NOT an AI model. Reads the numbered OBSERVED FACTS out of the prompt and returns a hypothesis that quotes them, so the real validation,
 * schema, confirmation and UI paths run unchanged. Development and tests only (see `resolveAiConfig`).
 */
export class DevScriptedProvider implements AiProvider {
  readonly name = "dev-scripted";
  readonly model = "dev-scripted-not-a-model";

  async complete(input: { systemPrompt: string; userPrompt: string }): Promise<AiCompletion> {
    const facts = [...input.userPrompt.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1]!.trim());
    const selected = facts.find((f) => f.startsWith("Your selected answer was"));
    const verdict = facts.find((f) => f === "Your answer was incorrect.");
    const trap = facts.find((f) => f === "This question was designed around a common wrong-answer pattern.");
    const explanation = trap
      ? "The answer you selected may be one of the common wrong options for the pattern this question was built around, which is consistent with a possible slip between related ideas."
      : "The answer you selected may be one of the typical wrong options for this pattern, which is consistent with a possible slip between related ideas.";
    const supporting = [selected, verdict, trap].filter((f): f is string => f !== undefined);
    return {
      rawText: JSON.stringify({
        proposedErrorCategory: null,
        proposedExplanation: explanation,
        supportingEvidence: supporting,
        contradictoryEvidence: [],
        missingEvidence: ["The steps used to reach the selected answer are not recorded."],
        modelConfidence: null
      }),
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 1
    };
  }
}

/** AES-256-GCM: the token is both confidential (the client cannot read the hypothesis metadata inside it) and authentic (it cannot be altered or forged). */
export function createHypothesisSealer(secret: string | undefined): HypothesisSealer {
  const material = secret && secret.length >= 16 ? secret : randomBytes(32).toString("hex");
  const key = createHash("sha256").update(material).digest();
  return {
    seal(payload: unknown): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },
    open(token: string): unknown | null {
      try {
        const raw = Buffer.from(token, "base64url");
        if (raw.length < 12 + 16 + 1) return null;
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as unknown;
      } catch {
        return null;
      }
    }
  };
}

export function createHypothesisDependencies(env: Record<string, string | undefined>, wrapProvider: (provider: AiProvider) => AiProvider = (p) => p): { hypothesisGenerator: HypothesisGenerator | null; hypothesisSealer: HypothesisSealer } {
  const config = resolveAiConfig(env);
  const sealer = createHypothesisSealer(env.IPMAT_HYPOTHESIS_SECRET);
  if (config.kind === "none") return { hypothesisGenerator: null, hypothesisSealer: sealer };
  const provider: AiProvider = wrapProvider(config.kind === "anthropic" ? new AnthropicProvider(config.model) : new DevScriptedProvider());
  return { hypothesisGenerator: (observation, context) => generateObservationHypothesis(provider, { observation, designedErrorCategory: context.designedErrorCategory }), hypothesisSealer: sealer };
}
