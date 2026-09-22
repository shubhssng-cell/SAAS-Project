export class AiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI call timed out after ${timeoutMs}ms`);
    this.name = "AiTimeoutError";
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Exponential backoff with a small jitter — attempt is 0-indexed. */
export function backoffDelayMs(attempt: number, baseMs = 250, maxMs = 4000): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.random() * exponential * 0.2;
  return Math.round(exponential + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Never trust raw JSON from an LLM (docs/AI_ARCHITECTURE.md §2) — this
 * only gets us to "is it JSON at all," schema validation still has to run
 * on whatever comes back. LLM responses sometimes wrap JSON in markdown
 * code fences despite instructions not to; stripping that is a parsing
 * convenience, not a trust decision.
 */
export function safeJsonParse(rawText: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
