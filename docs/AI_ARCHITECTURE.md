# AI Architecture

Phase 3 (docs/MASTER_PLAN.md) implemented the provider abstraction (`@ipmat/ai`), independent answer verification and quality validation (`@ipmat/validation`), and the single-question generation pipeline (`@ipmat/question-engine`). Phase 3.1 hardened it: fixed an answer-leakage structural gap in the independent verifiers, expanded blueprint-compliance checking to every field a candidate could drift on, fixed a type-blind bug in the Lens comparison's combination categorization, made answer-parsing fail closed instead of silently skipping, marked difficulty calibration explicitly provisional, added validated generation limits with a runtime budget circuit breaker, and fixed a real type-signature bug in `generateStructured` found while building the real-provider smoke test (docs/DECISIONS.md D-020 through D-026). **A real ANTHROPIC_API_KEY was not available in this environment during Phase 3.1** — the smoke-test script (`npm run smoke:anthropic --workspace @ipmat/question-engine`) is written and ready, but has not yet been run; everything below is still exercised through a deterministic `FixtureProvider` in tests and demo scripts. See [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md) for the full account of what changed and what remains unverified against a live provider. **This is a proof-of-concept pipeline for one blueprint at a time — not a production content factory** (docs/MASTER_PLAN.md Phase 3 explicitly excludes large-scale generation).

## 1. Provider abstraction

No call site outside `@ipmat/ai/src/providers/` talks to a concrete SDK directly. Every AI call in the product goes through one function:

```ts
function generateStructured<T>(
  provider: AiProvider,
  input: {
    task: string; promptVersion: string;
    systemPrompt: string; userPrompt: string;
    schema: ZodType<T, any, any>;   // constrains only the Output type — see docs/DECISIONS.md D-026
    options?: { temperature?: number; timeoutMs?: number; maxRetries?: number };
  }
): Promise<{ data: T; metadata: AiResultMetadata }>   // throws AiGenerationError after retries — never returns unvalidated data
```

`AiProvider` is a two-method interface (`name`, `model`, `complete()`) implemented by:
- **`AnthropicProvider`** — the real provider, calls the Anthropic Messages API. Requires `ANTHROPIC_API_KEY`; never logs or exposes it.
- **`FixtureProvider`** — a deterministic, FIFO canned-response provider for tests and demonstrations. No network call, no key required (docs/QUESTION_ENGINE.md §8: the domain layer must be testable without a live AI provider).

`@ipmat/ai` has **no dependency on any domain package** (concept-graph, examiner-lens, question-engine) — its Zod schemas restate the shapes they mirror rather than importing the domain types, so the boundary between "untrusted AI JSON" and "trusted domain model" is a fixed, independently-validated contract, not something that silently drifts if a domain type changes (docs/DECISIONS.md D-017). Domain packages depend on `@ipmat/ai`, never the reverse.

Reasons this exists even with effectively one provider exercised today: (1) every structured-output call is forced through schema validation by construction, not by convention; (2) swapping or A/B-testing providers later touches one file, not every call site; (3) it's the seam that makes `FixtureProvider` possible at all.

## 2. AI result metadata

Every `generateStructured` call — success or failure — carries an `AiResultMetadata`:

```ts
interface AiResultMetadata {
  provider: string; model: string; promptVersion: string; task: string;
  timestamp: string; latencyMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number } | null;
  estimatedCostUsd: number | null;
  success: boolean; validationOutcome: "valid" | "invalid" | "not_applicable";
  attempts: number;
}
```

`estimatedCostUsd` comes from a small, hand-maintained per-model USD/million-token table in `@ipmat/ai/src/costEstimation.ts` — **not a live pricing API**. An unrecognized model returns `null` cost rather than a guess. This is retained on every generation for reproducibility/debugging and is the seam a future usage-logging job would persist to a database table (not built yet — see §7). It never includes the API key or raw provider credentials.

## 3. Schema-validated outputs, everywhere

The flow inside `generateStructured` is always:

1. Call the provider with a system/user prompt built by a typed function (never string concatenation of raw domain objects — see `@ipmat/question-engine/src/prompts.ts`).
2. Parse the raw text as JSON (stripping markdown fences some models add despite instructions not to) — a parse failure retries with the error fed back into the prompt.
3. Validate against the task's Zod schema — a validation failure also retries with the specific error fed back, so the model can self-correct.
4. Exhausting retries throws `AiGenerationError` carrying the failed attempt's metadata — it never falls back to storing unvalidated output.
5. Only a fully validated result is returned.

Retries use exponential backoff with jitter (`@ipmat/ai/src/util.ts`); a call-level timeout wraps every attempt so a hung provider can't stall the pipeline indefinitely (Phase 3 §11 — "a failed generation must terminate safely"). This is what makes "no fake AI" enforceable rather than aspirational: there is no code path that lets a hand-written stub masquerade as a model response in production code, and `FixtureProvider` makes that boundary visible in test files rather than hidden downstream.

## 4. Task types implemented

| Task | Schema | Purpose |
|---|---|---|
| `examiner-lens-analysis` | `examinerLensAnalysisAiSchema` | Regenerate a concept's Examiner Lens for comparison against the human baseline (§5). |
| `question-generation` | `questionCandidateAiSchema` | Generate one question candidate from one `QuestionBlueprint` (§6). |
| `answer-reverification` | `answerReverificationAiSchema` | A SECOND, independent call given only the question stem, asked to re-derive the answer from scratch (§6). |
| `validation-judge` | `validationJudgeAiSchema` | Catches ambiguity and contradictory conditions — the one thing no deterministic check can substitute for, since it requires reading and understanding natural language (§6). |

Every schema forbids nothing about *content* except: `testingModes`/`errorModes.category` must be drawn from the fixed controlled vocabularies (never free text), and — enforced separately, not by the schema — no free-text field may assert literal completeness (`findCompletenessClaims()` in `@ipmat/examiner-lens`, reused across every task's output).

## 5. Examiner Lens regeneration — human baseline vs AI

The AI is given the concept's name/description and its neighbors' names/descriptions **without being told the real relationship types or rationale** — otherwise it would just echo the graph, not propose anything (docs/QUESTION_ENGINE.md §2a). Its output uses the same `TestingMode`/`ErrorCategory` vocabulary as the human-authored Lens but a **lighter combinations shape** (`{ concept, rationale }`) — the AI proposes candidates, it never gets to unilaterally mint a governed `ConceptRelation` edge (with `certainty`/`requirementLevel`/`source`), because those are curation decisions, not something an LLM's confidence should determine.

`buildLensComparisonReport()` (`@ipmat/question-engine`) never modifies the human baseline or the graph. It reports, per concept:
- Skill focus and prerequisite agreement (exact-match comparison)
- Testing modes: agreed / human-only (AI under-discovered) / AI-only (AI over-discovered)
- Difficulty dimensions: numeric deltas per dimension, not just pass/fail
- Error categories: agreed / human-only / AI-only
- **Combinations, split into FOUR categories (docs/DECISIONS.md D-023): `validGenerationCombination` (a real, generation-useful edge — `commonly_combined`/`application`/`dependent` with `usefulForQuestionGeneration: true`) vs `relatedButNonCombinable` (a real edge exists, e.g. `related_but_distinct`, but it explicitly does NOT mean "combine these") vs `unsupportedByGraph` (no edge at all — invented) vs `missedByAi` (a real, useful edge the AI never mentioned).** A graph edge existing is not the same claim as "valid to combine on" — the first version of this report conflated the two.
- Whether the AI's own text asserts a completeness claim

This operationalizes "do not assume AI is correct" (Phase 3 §9) as a structured, re-runnable comparison rather than a one-time manual read. See the Phase 3 report for the actual comparison result against Percentages.

## 6. Question generation pipeline

```
QuestionBlueprint (deterministic — built from one PatternTaxonomyCell + its pattern family; NO AI involved)
  → validateGenerationLimits(limits)   -- throws before ANY AI call if limits are unsafe (§9a)
  → generateStructured("question-generation")
       - candidate MUST echo blueprintId back
       - candidate MUST include groundTruthDerivation: { computation: <plain arithmetic string>, expectedAnswer: <number> }
  → validateCandidateStructurally() (@ipmat/validation): blueprint compliance — concept,
    pattern family, DIFFICULTY TIER, TESTING MODES, TRAP, and COMBINATION CONCEPTS must
    all match the blueprint exactly (docs/DECISIONS.md D-022) — plus syllabus compatibility,
    exactly-one-correct-answer, no completeness claim, provenance present
  → deterministic re-derivation (@ipmat/validation's verifyComputation, via mathjs)
       - computation is UNTRUSTED (AI-generated) input: first checked against a strict
         arithmetic-only character allowlist, THEN evaluated — defense in depth against
         mathjs's own property-injection advisories (docs/DECISIONS.md D-018), regardless
         of whether the specific expression would have been dangerous
       - correctAnswer that cannot be parsed as a plain number FAILS CLOSED
         (`unverifiable_answer`) rather than silently skipping the cross-check (D-024)
       - mismatch (or an expression that fails the allowlist) = automatic rejection;
         "the LLM says the answer is X" is NEVER sufficient on its own
  → [budget check — §9a] SECOND, independent generateStructured("answer-reverification") call
       - given ONLY a PresentedQuestionView { stem, options, answerFormat } — structurally
         cannot include the answer, explanation, computation, or reasoning (§6a, D-020)
       - compareReverification() rejects on disagreement, catching cases where the
         arithmetic is internally consistent but the question means something different
         than the first model thought
  → checkDuplicateRisk(): token-overlap (Jaccard) similarity against existing question
    bodies — a deliberately lightweight stand-in for real embedding-based dedup, which
    needs an embedding model and remains future work (docs/DECISIONS.md D-019)
  → [budget check — §9a] generateStructured("validation-judge") given a JudgeView
    { stem, options, answerFormat, claimedDifficultyTier } — NOT the claimed answer (§6a)
    → interpretJudgeVerdict(): ambiguity, contradictory conditions, syllabus relevance,
      difficulty-tier honesty
  → computeLifecycleStatus(): rejected | validated | review_required (never "published" directly)
```

A rejection at ANY step is recorded with its specific reason (`RejectionCode` + field + message) — never a silent discard. A failure in the generation call itself (the AI errors out after retries) is caught and converted into a `rejected` result, not an unhandled exception (Phase 3 §11).

## 6a. Independent verifier trust boundary

The reverification and judge calls exist to be **blind** to the first candidate's claims — that's the whole point of "independent." Phase 3.1 made this a structural guarantee, not a prompt-authoring convention (docs/DECISIONS.md D-020):

```ts
interface PresentedQuestionView { stem: string; options: string[] | null; answerFormat: "multiple_choice" | "numeric_entry"; }
interface JudgeView extends PresentedQuestionView { claimedDifficultyTier: DifficultyTier; }
```

`buildReverificationUserPrompt()` and `buildJudgeUserPrompt()` accept ONLY these types — built via explicit field-by-field destructuring in `toPresentedQuestionView()`/`toJudgeView()`, never a spread of the full candidate. `correctAnswer`, `expectedAnswer`, `groundTruthDerivation`, `explanation`, `solutionSteps`, and `reasoning` are not fields on either type, so no future change to `QuestionCandidateAiOutput` can leak them through these two functions without a deliberate edit to the narrow view types themselves. The judge specifically does not see the claimed answer or explanation at all — it must independently decide whether the question has exactly one defensible answer among the options shown, not check its agreement with a claim it was never given. Tested directly with marker strings planted in every field that must not leak (`packages/domain/question-engine/test/verifierView.test.ts`).

## 7. Question lifecycle

```
draft → generated → validated ─────────────→ published → deprecated
                  ↘ rejected            ↗
                    review_required → approved
```

`generated` AI questions never automatically become `published` (Phase 3 §8). Standard/Advanced-tier candidates that pass every check go straight to `validated` and CAN reach `published` directly (matching docs/DECISIONS.md D-008's auto-publish allowance); Hard/Extreme/Novel-tier candidates always land in `review_required` regardless of how clean the validation results are, and can only reach `published` via `approved`. `rejected`, `published`, and `deprecated` are terminal except for the one explicit edge each is allowed (`published → deprecated`).

## 8. Background jobs, not inline calls (design carried over from Phase 1, not built yet)

Every AI call that isn't needed to render the *current* screen synchronously is meant to run through a job queue (BullMQ, per docs/ARCHITECTURE.md) — this infrastructure is **not built in Phase 3** (explicitly excluded: "no full generation job yet"). The pipeline in §6 runs as a plain async function today, invoked directly by a demo script or test, one blueprint at a time. When a real queue is added, it wraps `runGenerationPipeline()` without needing to change its signature — the function already takes an injected `AiProvider` and returns a complete, serializable result.

## 9. Cost and failure control

- Every `generateStructured` call has a timeout (default 30s) and bounded retries (default 2) with exponential backoff + jitter — no unbounded retry loop is possible.
- A generation pipeline run makes at most 3 AI calls (generation, reverification, judge) regardless of outcome — there is no loop that could re-invoke itself on failure.
- `estimatedCostUsd` is computed per call (§2); a future usage-logging job would sum these into per-day/per-task cost dashboards — the metadata shape already supports this, the aggregation job is not built.
- Prompt/response fixtures for each task type are used in tests instead of live calls, so the test suite makes zero paid API calls (see [ARCHITECTURE.md](ARCHITECTURE.md) §3, Testing row).

## 9a. Generation limits — required and validated before any batch generator exists

Phase 3.1 §9 required this before any batch generator is built, specifically so the guard rails exist and are tested before there's a loop for them to guard:

```ts
interface GenerationLimits {
  maxBlueprints: number;             // always 1 until a batch orchestrator exists
  maxCandidatesPerBlueprint: number;
  maxRetries: number;                // passed through to every generateStructured() call
  maxGenerationAttempts: number;     // hard stop against a runaway loop
  maxEstimatedBudgetUsd: number;     // running-cost circuit breaker
}
```

`validateGenerationLimits()` throws — listing every violated rule, not just the first — before `runGenerationPipeline()` makes its first AI call; there is no path that skips it. `DEFAULT_SINGLE_RUN_LIMITS` (1 blueprint, 1 candidate, $1.00 budget) is what this phase actually uses. The pipeline also tracks running `estimatedCostUsd` across its own three calls and, if it exceeds `maxEstimatedBudgetUsd` mid-run, skips any remaining AI call and fails that check closed (`budget_exceeded`) rather than spending further — proven in tests with a mock provider reporting an artificially large token count. No batch generator exists yet (explicitly out of scope, Phase 3.1 §9/§12); this is the enforcement it will be required to go through when one is built.

## 10. Question Autopsy pipeline (Phase 5 design, unchanged from Phase 1)

```
Attempt (wrong answer)
  → assemble evidence from the Attempt aggregate AND its AttemptEvent log:
      - chosen_answer vs correct_answer, question DNA (esp. trap_error_taxonomy_id/pattern family)
      - started_at/submitted_at vs expected_time, and finer-grained AttemptEvent timing where available
        (time before first interaction, time between actions, time after a hint)
      - hints_used, solution_opened_at (did they view the solution before or after submitting?)
      - retry_of_attempt_id chain (was this a retry? how did timing/answer change across retries?)
      - reasoning_text, when the student provided one (never fabricated if absent)
      - recent Autopsy history on related concepts
  → generateStructured("autopsy-hypothesis", schema=AutopsyHypothesisSchema)
       - output is always phrased as a confirmable hypothesis, never an assertion
       - schema forces a `hypothesis_text` field ending in a question back to the student, and an
         `error_taxonomy_id` drawn from the `ErrorTaxonomy` table (not free text) so downstream repair
         logic can key off a stable id
  → shown to student for confirm / correct
  → on correction: student_correction_text stored verbatim (never overwritten or "cleaned up" by the model)
  → on confirm: RepairPlan generated by selecting/generating PatternTaxonomyCell-linked questions
    that target the confirmed error_taxonomy_id for the confirmed concept
```

More evidence does not mean a stronger claim of certainty — richer evidence changes what the hypothesis can *ask about*, not whether the system asserts it knows the answer. The `confirmed` gate in [DATABASE.md](DATABASE.md) §Question Autopsy is unaffected by how much evidence went in. Not built yet (Phase 5); `@ipmat/ai`'s `generateStructured` and metadata shape are already generic enough to serve this task without change when that phase starts.
