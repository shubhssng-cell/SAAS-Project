# 82 — AI Usage Rules

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/AI_ARCHITECTURE.md` §1–§3 (read in full), `docs/DECISIONS.md` D-003, D-017.

## The one entry point

```ts
function generateStructured<T>(provider, input: {task, promptVersion, systemPrompt, userPrompt, schema: ZodType<T,any,any>, options?}): Promise<{data: T, metadata: AiResultMetadata}>
```

No call site outside `@ipmat/ai/src/providers/` talks to a concrete SDK directly. `AiProvider` is implemented by `AnthropicProvider` (real, never yet exercised in this environment) and `FixtureProvider` (deterministic, no network, used everywhere in tests/demos).

## Zero dependency on any domain package (D-017)

`@ipmat/ai`'s Zod schemas restate small controlled vocabularies (`TestingMode`, `ErrorCategory`, `DifficultyTier`, `DifficultyDimensions`) rather than importing domain types — a trust boundary that shouldn't silently change just because an unrelated domain type gets refactored.

## The flow, always

Call provider with a typed-function-built prompt → parse JSON (stripping stray markdown fences) → validate against the task's Zod schema → retry with the specific error fed back on failure → throw `AiGenerationError` after exhausting retries, **never** falling back to unvalidated output.

## The five task types (as of the current checkpoint)

| Task | Purpose |
|---|---|
| `examiner-lens-analysis` | Regenerate a concept's Lens for comparison against the human baseline |
| `question-generation` | Generate one candidate from one blueprint |
| `answer-reverification` | A second, independent answer re-derivation, given only `PresentedQuestionView` |
| `validation-judge` | Ambiguity/contradiction catch, given only `JudgeView` |
| `autopsy-hypothesis` | Propose ONE hypothesis from deterministic `AutopsyOutput` — never auto-confirmed |

## Cost/failure control

Every call has a timeout (default 30s) and bounded retries (default 2) with exponential backoff + jitter. `estimatedCostUsd` comes from a hand-maintained per-model USD/million-token table — **not a live pricing API**. `isKnownModel()` must be checked before any call in a budget-tracked run; a `null` cost must never be treated as `$0` (D-027).

## Never trust the model's stated answer alone

Every numeric answer is independently recomputed deterministically (`verifyComputation()`) AND cross-checked against a second, independent AI call that never saw the first one's answer. A mismatch on either is an automatic rejection — see [45_CONTENT_VALIDATION.md](45_CONTENT_VALIDATION.md).

## The standing, unchanged caveat across this project's entire history

**No `ANTHROPIC_API_KEY` has ever been configured in this environment.** Every AI-task code path — all five task types, the full generation pipeline, the autopsy hypothesis flow — has been proven **only** via `FixtureProvider`. Two smoke-test scripts exist and are ready (`npm run smoke:anthropic --workspace @ipmat/question-engine` for 4 tasks, `npm run smoke:anthropic --workspace @ipmat/autopsy` for `autopsy-hypothesis`) but **neither has ever been run**. This is not a gap introduced by any recent session — it has been true, disclosed, and explicitly deferred (not revisited) since Phase 3.1. See [91_OPEN_BLOCKERS.md](91_OPEN_BLOCKERS.md).

## `apps/web`'s use of `FixtureProvider` is consistent with this rule, not an exception to it

The first-slice UI's autopsy hypothesis call genuinely goes through `generateHypothesis()` → `generateStructured()` → `FixtureProvider` — a real, schema-validated call path with canned-but-question-specific responses, never a hand-written stub that bypasses `generateStructured()` entirely. See [65_AUTOPSY_UX.md](65_AUTOPSY_UX.md).
