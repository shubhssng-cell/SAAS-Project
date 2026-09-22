# AI Architecture

Phase 3 (docs/MASTER_PLAN.md) implemented the provider abstraction (`@ipmat/ai`), independent answer verification and quality validation (`@ipmat/validation`), and the single-question generation pipeline (`@ipmat/question-engine`). Phase 3.1 hardened it: fixed an answer-leakage structural gap in the independent verifiers, expanded blueprint-compliance checking to every field a candidate could drift on, fixed a type-blind bug in the Lens comparison's combination categorization, made answer-parsing fail closed instead of silently skipping, marked difficulty calibration explicitly provisional, added validated generation limits with a runtime budget circuit breaker, and fixed a real type-signature bug in `generateStructured` found while building the real-provider smoke test (docs/DECISIONS.md D-020 through D-026). Phase 3.1.1 then fixed every correctness/safety issue an implementation-level code review of that hardening work found ([PHASE_3_1_CODE_REVIEW.md](PHASE_3_1_CODE_REVIEW.md)): the budget breaker now fails closed on any model without known pricing instead of silently treating it as free, the arithmetic verifier's grammar is narrower and now bounds expression length/magnitude/complexity, a deterministic (explicitly non-semantic) guard catches a generated stem leaking its own answer, Examiner Lens concept-name matching is now case/whitespace-normalized, the AnthropicProvider output-token cap and the pipeline's cost-safety assumptions are now one documented and tested coupling, and the generation prompt now explicitly states every field blueprint compliance enforces (docs/DECISIONS.md D-027 through D-033; see [PHASE_3_1_1_REVIEW.md](PHASE_3_1_1_REVIEW.md)). Phase 5B added a 5th task type, `autopsy-hypothesis` (§4, §10a) — the HYPOTHESIS layer of Question Autopsy, consuming Phase 5A's deterministic `AutopsyOutput` rather than raw `Attempt`/`AttemptEvent` rows, and subject to the same "never trust the model's output, always schema-validate, student confirmation required before anything downstream trusts it" discipline as every other task here. **A real ANTHROPIC_API_KEY has still not been available in this environment through Phase 5C-2** — the smoke-test scripts are written and ready but have not yet been run against a live model; everything below, including the hypothesis task, is still exercised through a deterministic `FixtureProvider` in tests and demo scripts. There are now TWO smoke-test scripts, not one: `npm run smoke:anthropic --workspace @ipmat/question-engine` (unchanged since Phase 3.1 — `examiner-lens-analysis`, `question-generation`, `answer-reverification`, `validation-judge`) and `npm run smoke:anthropic --workspace @ipmat/autopsy` (added when this gap was found during a smoke-test attempt — `autopsy-hypothesis`). They are separate scripts, in separate workspaces, specifically because `@ipmat/autopsy` already depends on `@ipmat/question-engine` for Question-DNA-shaped types — a single script covering all 5 tasks from `question-engine`'s workspace would need the reverse dependency too, creating a cycle. See [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md), [PHASE_3_1_1_REVIEW.md](PHASE_3_1_1_REVIEW.md), and [PHASE_5B_REVIEW.md](PHASE_5B_REVIEW.md) for the full account of what changed and what remains unverified against a live provider. **This is a proof-of-concept pipeline for one blueprint at a time — not a production content factory** (docs/MASTER_PLAN.md Phase 3 explicitly excludes large-scale generation).

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

**A `null` cost must never be treated as `$0` by a caller that spends real money (docs/DECISIONS.md D-027).** `isKnownModel(model)` is the pre-flight check a caller makes BEFORE any call, not something inferred from a null cost afterward — see §9a for how `runGenerationPipeline()` uses it.

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
| `autopsy-hypothesis` | `autopsyHypothesisAiSchema` | Phase 5B — proposes ONE hypothesis for why a submitted answer was incorrect, from Phase 5A's deterministic `AutopsyOutput`. Never auto-confirmed (§10a). |

Every schema forbids nothing about *content* except: `testingModes`/`errorModes.category` must be drawn from the fixed controlled vocabularies (never free text), and — enforced separately, not by the schema — no free-text field may assert literal completeness (`findCompletenessClaims()` in `@ipmat/examiner-lens`, reused across every task's output). `autopsy-hypothesis`'s `modelConfidence` field is the one place a numeric "confidence" appears anywhere in this codebase's AI outputs — it is explicitly the MODEL's confidence in its own hypothesis (for ranking only), never the student's, and the system prompt tells the model so directly (docs/DECISIONS.md D-038).

## 5. Examiner Lens regeneration — human baseline vs AI

The AI is given the concept's name/description and its neighbors' names/descriptions **without being told the real relationship types or rationale** — otherwise it would just echo the graph, not propose anything (docs/QUESTION_ENGINE.md §2a). Its output uses the same `TestingMode`/`ErrorCategory` vocabulary as the human-authored Lens but a **lighter combinations shape** (`{ concept, rationale }`) — the AI proposes candidates, it never gets to unilaterally mint a governed `ConceptRelation` edge (with `certainty`/`requirementLevel`/`source`), because those are curation decisions, not something an LLM's confidence should determine.

`buildLensComparisonReport()` (`@ipmat/question-engine`) never modifies the human baseline or the graph. It reports, per concept:
- Skill focus and prerequisite agreement (exact-match comparison)
- Testing modes: agreed / human-only (AI under-discovered) / AI-only (AI over-discovered)
- Difficulty dimensions: numeric deltas per dimension, not just pass/fail
- Error categories: agreed / human-only / AI-only
- **Combinations, split into FOUR categories (docs/DECISIONS.md D-023): `validGenerationCombination` (a real, generation-useful edge — `commonly_combined`/`application`/`dependent` with `usefulForQuestionGeneration: true`) vs `relatedButNonCombinable` (a real edge exists, e.g. `related_but_distinct`, but it explicitly does NOT mean "combine these") vs `unsupportedByGraph` (no edge at all — invented) vs `missedByAi` (a real, useful edge the AI never mentioned).** A graph edge existing is not the same claim as "valid to combine on" — the first version of this report conflated the two. **Concept-name matching is by normalized key, not raw string equality (docs/DECISIONS.md D-030)** — case and incidental whitespace differences between the AI's proposed name and the graph's canonical spelling (e.g. "ratio" vs "Ratio") no longer cause a real relationship to be misreported as invented. This is exact-match-after-normalization only, never fuzzy/typo correction — an unrecognized name still correctly falls into `unsupportedByGraph`.
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

**This structural boundary does not, and cannot, prevent the `stem` field itself from stating its own answer** — the verifiers must be able to see the real question, so `stem` is necessarily included in both views. `validateNoAnswerLeakageInStem()` (`@ipmat/validation`, docs/DECISIONS.md D-029) is a separate, deliberately narrow, deterministic guard against exactly that: the claimed `correctAnswer` appearing verbatim in the stem, or the internal `blueprintId` leaking into student-facing text. It is explicitly NOT semantic leakage detection (see docs/QUESTION_ENGINE.md §5b) — a paraphrased or algebraically-derivable leak is out of scope, by design, not by oversight.

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

**Unpriced models fail closed, before any AI call (Phase 3.1.1 §1 / docs/DECISIONS.md D-027).** Immediately after `validateGenerationLimits()`, the pipeline checks `isKnownModel(input.aiProvider.model)` — since every call in one run shares the same provider/model, pricing is knowable up front. If the model has no entry in `@ipmat/ai`'s cost table, the pipeline refuses to make even the first call, returning `rejected` with a new `unverifiable_cost` code on every check. This closes a real gap the pre-Phase-3.1.1 breaker had: `estimateCostUsd()` returning `null` for an unknown model was previously indistinguishable, to the running-cost tracker, from a genuinely free call — meaning the breaker could be silently disabled entirely just by using a model string absent from the pricing table.

**The output-token cap and the budget breaker's assumptions are one documented, tested coupling (docs/DECISIONS.md D-031).** The running-cost breaker above is REACTIVE — checked only BETWEEN calls, never during one — so on its own it cannot stop a single call from costing a lot before the pipeline notices. What actually bounds a single call's worst case is `AnthropicProvider`'s `ANTHROPIC_MAX_OUTPUT_TOKENS_PER_CALL` constant (currently 4096). `worstCaseSingleCallCostUsd(model)` (`@ipmat/question-engine/src/generationLimits.ts`) computes exactly that worst case for a given model at a documented, conservative input-token assumption, and a test asserts it stays under `DEFAULT_SINGLE_RUN_LIMITS.maxEstimatedBudgetUsd` for every currently priced model — so a future change to either the output cap or the pricing table that breaks this assumption fails a test, not silently drifts. This bounds a single call, not the three-call aggregate: because the breaker is reactive, a full run's actual spend can still exceed the budget by up to roughly one more call's worst case before the next call is skipped — a real, bounded property, not eliminated by this decision.

## 10. Question Autopsy pipeline — OBSERVATION/EVIDENCE (Phase 5A) and HYPOTHESIS/CONFIRMATION (Phase 5B) implemented; persistence/UI/repair-question-selection are Phase 5C

```
Attempt (finalized, via @ipmat/attempt) [Phase 4A]
  → toAutopsyEvidence(): OBSERVATION — raw per-attempt facts, reused verbatim downstream
  → @ipmat/autopsy's buildAutopsyOutput(): EVIDENCE [Phase 5A]
      - deterministic behaviorSignals/hintSolutionEvidence/historicalSignals/candidateErrorEvidence
      - integrates the EXISTING ErrorTaxonomy; candidate error is explicitly NOT a confirmed one
      - no AI call anywhere in this step
  → @ipmat/autopsy's generateHypothesis(): HYPOTHESIS [Phase 5B]
      - generateStructured("autopsy-hypothesis", schema=autopsyHypothesisAiSchema) — the ONLY AI call
        in this whole pipeline; refuses to run at all if candidateErrorEvidence is null (nothing to
        diagnose)
      - output is always phrased as a hypothesis, never an assertion (system-prompt instruction);
        `proposedErrorCategory` drawn from the SAME controlled vocabulary ErrorTaxonomy.category uses
      - ALWAYS created with confirmationStatus: "awaiting_confirmation" — no code path can skip this
  → shown to student for confirm / reject / correct — applyConfirmationResponse() [Phase 5B]
       - "confirmed": hypothesis.confirmationStatus becomes "confirmed", the ONLY way it can
       - "corrected": the student's own text is preserved as NEW evidence (studentCorrectionText),
         never overwriting the model's original proposedExplanation
  → on confirm: buildRepairPlan() [Phase 5B] — target concept/pattern family/taxonomy cell/error
    category/training mode/priority/prerequisites, refusing anything but a confirmationStatus ===
    "confirmed" hypothesis. Still does NOT select or generate actual follow-up questions
    (no `followUpQuestionIds` field exists on RepairPlan) — that step, and the actual
    `prisma.autopsy.create()`/`prisma.repairPlan.create()` persistence calls, are Phase 5C
    (docs/MASTER_PLAN.md).
```

More evidence does not mean a stronger claim of certainty — richer evidence changes what the hypothesis can *ask about*, not whether the system asserts it knows the answer. The `confirmed` gate in [DATABASE.md](DATABASE.md) §Question Autopsy is unaffected by how much evidence went in, and needed NO schema change: `confirmed: Boolean?` + `student_correction_text: String?` already jointly encode all 4 confirmation states (docs/DECISIONS.md D-039). `retry_of_attempt_id`-chain evidence and cross-question "recent Autopsy history on related concepts" are not yet wired into `@ipmat/autopsy`'s `HistoricalAttemptRecord[]` input — the historical-signal machinery exists and is tested (Phase 5A §7), but nothing yet populates it from a real `retry_of_attempt_id` chain (that's a persistence-adapter concern, Phase 5C).

## 10a. Hypothesis trust boundary — untrusted output, mandatory confirmation, no student confidence

The `autopsy-hypothesis` call's output is untrusted in exactly the same way every other task's output is (§3): schema-validated, never assumed correct. Three things make this task's trust boundary distinct from the generation pipeline's (§6a):

1. **Input is deterministic EVIDENCE, not raw data.** The model never sees `Attempt`/`AttemptEvent` rows directly — it receives exactly what `@ipmat/autopsy`'s `AutopsyOutput` computed (`hypothesisPrompts.ts`'s `buildHypothesisUserPrompt()`), explicitly labeled by kind ("observed fact" vs. "candidate, unconfirmed match" vs. "repetition count, not a diagnosis"), so the model cannot mistake a candidate for a fact.
2. **The system prompt forbids inventing evidence and forbids psychological claims** — "you MUST use ONLY the evidence given," "you MUST NOT make any claim about the student's confidence, motivation, emotional state, ... anxiety, ... or intent." This is a prompt instruction, not a structural guarantee: a test in `packages/domain/autopsy/test/hypothesis.test.ts` deliberately feeds a fixture response that DOES make a forbidden claim, and confirms it is still schema-valid and still wrapped into an ordinary `awaiting_confirmation` hypothesis — the model ignoring an instruction is a real, accepted possibility this codebase does not claim to prevent at the prompt level.
3. **Confirmation, not model output quality, is what's actually trusted.** `generateHypothesis()` (`@ipmat/autopsy/src/hypothesis.ts`) can ONLY produce `confirmationStatus: "awaiting_confirmation"` — there is no parameter, anywhere, through which a caller could construct a pre-confirmed hypothesis. `buildRepairPlan()` refuses to run on anything but `confirmationStatus === "confirmed"`. This is the actual enforcement mechanism (docs/DECISIONS.md D-006, D-038) — point 2's prompt instructions are a best-effort quality measure on top of it, not a substitute for it.

**`modelConfidence` is the one numeric "confidence" field anywhere in this codebase's AI-facing schemas.** It is explicitly the model's own confidence in ONE specific hypothesis, for internal ranking only, and the schema/prompt both name it that way — there is no `studentConfidence` field, and none should ever be added (docs/DECISIONS.md D-005, D-038).
