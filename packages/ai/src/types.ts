import type { ZodType } from "zod";

/**
 * This package is intentionally provider-agnostic and has NO dependency on
 * any @ipmat domain package (see docs/ARCHITECTURE.md §4/§6) — domain
 * packages depend on this package's interfaces, never the reverse. Every
 * task-specific shape (Examiner Lens output, question candidates, ...)
 * lives in ./schemas as its own self-contained Zod schema, restated rather
 * than imported from the domain packages it happens to mirror — this is a
 * trust boundary: what an LLM is allowed to produce is a fixed contract,
 * not something that silently changes if a domain type is refactored.
 */

export interface AiCallOptions {
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCompletion {
  rawText: string;
  usage: TokenUsage | null;
  latencyMs: number;
}

/**
 * The provider abstraction. No call site outside this package's providers/
 * talks to a concrete SDK — everything else goes through generateStructured().
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(input: { systemPrompt: string; userPrompt: string; options?: AiCallOptions }): Promise<AiCompletion>;
}

export type ValidationOutcome = "valid" | "invalid" | "not_applicable";

/**
 * Retained for every AI generation for reproducibility/debugging (docs/
 * AI_ARCHITECTURE.md §2). Never includes API keys, raw prompts with
 * secrets, or anything beyond what's listed here — this is metadata about
 * the call, not the call's credentials.
 */
export interface AiResultMetadata {
  provider: string;
  model: string;
  promptVersion: string;
  task: string;
  timestamp: string;
  latencyMs: number;
  tokenUsage: TokenUsage | null;
  estimatedCostUsd: number | null;
  success: boolean;
  validationOutcome: ValidationOutcome;
  attempts: number;
}

export interface GenerateStructuredInput<T> {
  task: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  /**
   * `ZodType<T, any, any>` rather than `ZodSchema<T>` (which is `ZodType<T,
   * ZodTypeDef, T>` — it forces the schema's Input type to equal T too).
   * Several task schemas use `.default(...)` on a field (e.g.
   * suggestedCombinations), which makes their Input and Output types
   * legitimately differ; only the Output type matters here, since
   * generateStructured only ever consumes the *parsed* result.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Def/Input positions are deliberately unconstrained; only Output (T) matters here, and `any` in these two positions is Zod's own convention (mirrored by its ZodTypeAny helper).
  schema: ZodType<T, any, any>;
  options?: AiCallOptions;
}

export interface GenerateStructuredResult<T> {
  data: T;
  metadata: AiResultMetadata;
}

/**
 * Thrown when a call fails after retries — either the provider itself
 * errored (timeout, network, rate limit) or every attempt's output failed
 * schema validation. Always carries the metadata for the failed attempt(s)
 * so the caller can log/report without re-deriving it.
 */
export class AiGenerationError extends Error {
  readonly metadata: AiResultMetadata;
  override readonly cause?: unknown;

  constructor(message: string, metadata: AiResultMetadata, cause?: unknown) {
    super(message);
    this.name = "AiGenerationError";
    this.metadata = metadata;
    this.cause = cause;
  }
}
