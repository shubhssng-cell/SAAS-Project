# Phase 3.1.1 Review — Final Hardening From Code Review

**Scope:** fix every correctness/safety issue [PHASE_3_1_CODE_REVIEW.md](PHASE_3_1_CODE_REVIEW.md) identified in the Phase 3.1 implementation. No new product features, no Phase 4, no Phase 3.5, no batch/large-scale question generation, no real Anthropic smoke test run (none was already configured in this environment, and the phase instructions were explicit: only run it if a key is already present).

**Headline result:** every issue the code review raised is fixed and tested against deterministic fixtures. 146 tests pass (up from 118 before this phase), typecheck/lint/build are all clean. One item — stem-embedded answer leakage — is **partially** fixed: the concrete, checkable case (a verbatim answer/metadata match) is caught deterministically; paraphrased or algebraically-derivable leakage is explicitly, deliberately left unresolved, because no deterministic mechanism can catch it without becoming exactly the "brittle keyword blacklist" the phase instructions said not to build. See §6 for the full, honest accounting of what remains.

---

## 1. Every finding, exact change, files/functions, tests

### 1.1 Budget breaker — unknown model must fail closed

**Finding (code review §6, §10.1):** `trackCost()` in `runGenerationPipeline()` only advanced `runningCostUsd` when `metadata.estimatedCostUsd` was non-null. `estimateCostUsd()` returns `null` — not `0` — for any model absent from the pricing table, so an unrecognized model silently disabled the entire budget circuit breaker: it could never trip, no matter how much was actually spent.

**Exact change:**
- New export `isKnownModel(model: string): boolean` in [packages/ai/src/costEstimation.ts](../packages/ai/src/costEstimation.ts) — checks membership in the same pricing table `estimateCostUsd()` already uses.
- [packages/domain/question-engine/src/generationPipeline.ts](../packages/domain/question-engine/src/generationPipeline.ts): immediately after `validateGenerationLimits(limits)`, a new pre-flight check — `if (!isKnownModel(input.aiProvider.model))` — returns a full `rejected` result (all 5 checks = a new `unverifiable_cost` failure, `metadata: {generation: null, reverification: null, judge: null}`) WITHOUT making any AI call. This works because every call in one pipeline run shares the same `input.aiProvider`, so the model (and therefore its pricing) is knowable before the first call, not just discoverable after one completes.
- `trackCost()` itself was also tightened from a truthy check (`if (metadata?.estimatedCostUsd)`) to an explicit null check (`if (metadata && metadata.estimatedCostUsd !== null)`) as defense in depth — with the pre-flight guard in place this should never matter in practice, but it removes a latent edge case (a cost of exactly `$0` was already handled correctly by the old truthy check too, so this is a clarity fix, not a behavior fix).
- New `RejectionCode`: `"unverifiable_cost"` ([packages/domain/validation/src/types.ts](../packages/domain/validation/src/types.ts)).

**Decision record:** [DECISIONS.md](DECISIONS.md) D-027.

**Tests added** ([packages/domain/question-engine/test/generationPipeline.test.ts](../packages/domain/question-engine/test/generationPipeline.test.ts), describe block "budget breaker fail-closed on unpriced models"):
- (a) a known model (`claude-sonnet-5`) with modest, realistic token usage across all 3 calls: asserts each call's `estimatedCostUsd` is the exact expected value (~$0.009), asserts no `budget_exceeded`/`unverifiable_cost` fires, asserts the run reaches `validated`.
- (b) an unknown model (`claude-hypothetical-future-model`): asserts the mock provider's `complete()` is called **zero** times, the result is `rejected`, `candidate` and `metadata.generation` are both `null`, and every check's issue code is `unverifiable_cost`.
- (c) five repeated invocations against an unknown model: asserts every single one is rejected identically and the provider's `complete()` is never called across all five — proving "repeated calls cannot run indefinitely" is trivially true here, since none of them can even start.

Also: [packages/ai/test/costEstimation.test.ts](../packages/ai/test/costEstimation.test.ts) gained a dedicated `isKnownModel` describe block (true for all 4 table entries, false for an unrecognized string and an empty string).

---

### 1.2 Arithmetic verifier — tighten the language

**Finding (code review §2, §10.3):** the allowlist included `,`, which does not do what its own comment claimed (mathjs treats a top-level comma as a statement separator, not a thousands-grouping character); there was no bound on computation length, numeric-literal magnitude, exponentiation complexity, or result magnitude, so a pathological (but charset-legal) string could reach `evaluate()` uncapped.

**Exact change** ([packages/domain/validation/src/verifyComputation.ts](../packages/domain/validation/src/verifyComputation.ts)):
- `SAFE_ARITHMETIC_PATTERN` changed from `/^[\d\s+\-*/^().,]+$/` to `/^[\d\s+\-*/^().]+$/` — comma removed.
- Four new checks, all before `evaluate()` is called (except the last, which is necessarily post-evaluation):
  1. `MAX_COMPUTATION_LENGTH = 200` — string length cap.
  2. `MAX_NUMERIC_LITERAL_DIGITS = 15` — no single numeric literal (matched via `/\d+/g`) may exceed 15 digits.
  3. `MAX_EXPONENTIATION_OPERATORS = 3` — no more than 3 `^` characters (chained/tower exponentiation is the primary way a short, charset-legal string stays computationally explosive).
  4. `MAX_RESULT_MAGNITUDE = 1e12` — checked immediately after the existing finite-number check; a numerically valid but implausibly large result is rejected.
- All four rejections use the existing `impossible_computation` code, each with a distinct, specific message.
- Every doc comment in the file was rewritten to state the exact supported grammar plainly: digits, whitespace, `.`, and `+ - * / ^ ( )` — nothing else — and to explain precisely why the comma was removed (its assumed behavior was never real).

**Decision record:** [DECISIONS.md](DECISIONS.md) D-028 (supersedes D-018's allowlist definition; D-018 itself, about pinning mathjs and allowlisting before evaluation, is unchanged).

**Tests added** ([packages/domain/validation/test/validateCandidate.test.ts](../packages/domain/validation/test/validateCandidate.test.ts), describe block "verifyComputation grammar and complexity bounds"):
- Valid supported expressions still pass (2 assertions).
- Unsupported syntax (letters/identifiers) rejected.
- A comma-containing expression rejected, with a message confirming it's the grammar check, not a coincidental other failure.
- A 24-digit numeric literal rejected, with a message confirming it's the digit-count check.
- Chained exponentiation (`2^2^2^2^2^2`, 5 operators) rejected, with a message confirming it's the complexity check.
- Division by zero (non-finite result) rejected.
- A syntactically malformed expression (`4 * / 150`) rejected.
- A charset-legal expression whose numeric result is implausibly large (`999999999999 * 999999999999`, ≈10^23) rejected, with a message confirming it's the magnitude check specifically (distinct from the literal-digit-count check, since neither individual literal exceeds 15 digits).
- A 241-character computation string rejected, with a message confirming it's the length check.

The existing "still supports legitimate formats" test (₹/comma/% for `correctAnswer`, a *different* field with legitimately different comma semantics) was left unchanged and re-verified to still pass — `correctAnswer` parsing is untouched by this change.

---

### 1.3 Stem-embedded answer leakage

**Finding (code review §1, §10.7):** the `PresentedQuestionView`/`JudgeView` structural boundary protects the CANDIDATE's structured fields from leaking to the independent verifiers, but does nothing about the free-text `stem` itself stating its own answer — since the stem is, correctly, shown to the verifiers in full.

**Exact change** ([packages/domain/validation/src/qualityValidators.ts](../packages/domain/validation/src/qualityValidators.ts)):
- New `validateNoAnswerLeakageInStem(candidate)`, wired into `validateCandidateStructurally()` ([packages/domain/validation/src/validateCandidate.ts](../packages/domain/validation/src/validateCandidate.ts)).
- Two concrete, deterministic checks, both using a case-insensitive whole-token/phrase regex match (`\b<escaped text>\b`, so "480" cannot match inside "4801" and is not confused by surrounding punctuation like ₹ or %):
  1. The claimed `correctAnswer` (trimmed, skipped if under 2 characters to reduce short-token false positives) must not appear verbatim in `stem`.
  2. The internal `blueprintId` must never appear in `stem` at all.
- New `RejectionCode`: `"answer_leakage_in_stem"`.
- `buildGenerationSystemPrompt()` ([packages/domain/question-engine/src/prompts.ts](../packages/domain/question-engine/src/prompts.ts)) gained an explicit instruction: "The stem must never state or imply the correct answer's value, and must never contain any internal identifier such as the blueprint id."
- **Deliberately not built:** a keyword blacklist attempting to catch paraphrased or reworded leakage. The function's own doc comment states plainly what it does and does not catch (see §6 below).

**Decision record:** [DECISIONS.md](DECISIONS.md) D-029.

**Tests added:**
- Two new fixtures in [packages/domain/validation/fixtures/candidateFixtures.ts](../packages/domain/validation/fixtures/candidateFixtures.ts): `answerLeakedInStemCandidate` (stem states "The original price was 480" verbatim, where 480 is the claimed answer) and `blueprintIdLeakedInStemCandidate` (stem has the blueprint id appended).
- Three tests in `validateCandidate.test.ts`: each fixture is rejected with `answer_leakage_in_stem`, and — importantly — the existing, unmodified `validCandidate` fixture is asserted to NOT trigger this check (a false-positive regression guard).

---

### 1.4 Concept-name normalization

**Finding (code review §5, §10.2):** `buildLensComparisonReport()`'s combination categorization used case-sensitive, whitespace-sensitive `Set` membership against AI-proposed concept names — a real model returning "ratio" instead of "Ratio" would be reported as having invented a relationship it didn't invent.

**Exact change:**
- New `normalizeConceptNameKey(name: string): string` in [packages/domain/concept-graph/src/graph.ts](../packages/domain/concept-graph/src/graph.ts) — `name.trim().replace(/\s+/g, " ").toLowerCase()`. Deliberately narrow: no stemming, no pluralization folding, no fuzzy/typo correction.
- [packages/domain/question-engine/src/comparisonReport.ts](../packages/domain/question-engine/src/comparisonReport.ts): `realCombinationConcepts`/`allRelatedConcepts` changed from `Set<string>` (raw names) to `Map<normalizedKey, canonicalName>`. Each AI-suggested concept is normalized and looked up by key; on a match, the graph's CANONICAL spelling is pushed into the result array (not the AI's raw string) — the loop tries the "valid combination" map first, then the "related but non-combinable" map, then falls through to `unsupportedByGraph` using the AI's original string (since there's no canonical form to report for something that was never matched). `missedByAi` is now computed by filtering the valid-combination map's keys against the set of normalized AI-suggested keys.

**Decision record:** [DECISIONS.md](DECISIONS.md) D-030.

**Tests added:**
- New fixture `aiLensRegenerationOutputWithNameVariance` in [packages/domain/question-engine/fixtures/aiLensOutputs.ts](../packages/domain/question-engine/fixtures/aiLensOutputs.ts): proposes "ratio" (lowercase), "PROFIT AND LOSS" (all-caps), "  Probability" (leading whitespace — a real but non-combinable edge), and " time and work " (whitespace-padded but still genuinely unsupported, to prove normalization doesn't invent a match for something that was never real).
- Four new tests in [packages/domain/question-engine/test/comparisonReport.test.ts](../packages/domain/question-engine/test/comparisonReport.test.ts): lowercase and all-caps proposals both land in `validGenerationCombination` under the canonical name; the whitespace-padded proposal lands in `relatedButNonCombinable`; the genuinely-unsupported whitespace-padded name stays in `unsupportedByGraph`.
- New dedicated test file [packages/domain/concept-graph/test/normalizeConceptNameKey.test.ts](../packages/domain/concept-graph/test/normalizeConceptNameKey.test.ts): case/whitespace variants all produce one key; internal whitespace runs collapse; genuinely different names ("Percentage" vs "Percentages", "Ratio" vs "Ratios") produce DIFFERENT keys — proving no fuzzy correction was introduced.

---

### 1.5 Blueprint prompt/validation alignment

**Finding (code review §8, §10.6):** `validateBlueprintCompliance()` checks 7 fields, but `buildGenerationSystemPrompt()`'s explicit "MUST NOT change" framing only named 3 (concept, pattern family, target skill) — a quality/efficiency gap (avoidable rejections), not a safety gap.

**Exact change** ([packages/domain/question-engine/src/prompts.ts](../packages/domain/question-engine/src/prompts.ts)): `buildGenerationSystemPrompt()` now explicitly enumerates all 7 fields ("the concept, the pattern family, the target skill, the difficulty tier, the required combination concepts..., the trap..., and every testing mode listed as required"), states plainly that these are checked deterministically after the response and that a mismatch on any one causes rejection, and adds the stem-leakage instruction from §1.3. **The validator itself was not touched.**

**Decision record:** [DECISIONS.md](DECISIONS.md) D-032.

**Tests:** none added specifically — this is a prompt-text change with no new deterministic branch to test; the existing blueprint-compliance rejection tests (unchanged) continue to prove the validator's behavior, which is what actually matters for safety. This is stated plainly rather than padded with a test that would only assert a string contains certain words.

---

### 1.6 Dead `distractor_quality` branch

**Finding (code review §3, §10.5):** `validateSingleCorrectAnswer()`'s duplicate-distractor branch was unreachable by any existing test — the one prior "duplicate options" fixture also duplicated the correct answer, returning early on a different check first.

**Decision:** kept (option A from the phase instructions) — duplicate wrong-answer options are a real, distinct question-quality defect independent of whether the correct answer is fine, not something to delete as unused.

**Exact change:** none to the validator logic itself. New fixture `duplicateDistractorCandidate` ([packages/domain/validation/fixtures/candidateFixtures.ts](../packages/domain/validation/fixtures/candidateFixtures.ts)): options `["480", "420", "420", "500"]` — unique correct answer ("480" appears once), but "420" appears twice among the wrong options.

**Decision record:** [DECISIONS.md](DECISIONS.md) D-033.

**Tests added:** one test in `validateCandidate.test.ts` asserting the fixture is rejected with `distractor_quality` and specifically NOT `multiple_or_no_correct_answer`.

---

### 1.7 Hidden cost-safety coupling

**Finding (code review §6, §10.4):** the real bound on a single call's worst-case cost — `AnthropicProvider`'s hardcoded `max_tokens: 4096` — was an undocumented, untested assumption `generationLimits.ts`'s reactive budget breaker depended on being true.

**Exact change:**
- [packages/ai/src/providers/anthropicProvider.ts](../packages/ai/src/providers/anthropicProvider.ts): the literal `4096` extracted into a named, exported, documented constant `ANTHROPIC_MAX_OUTPUT_TOKENS_PER_CALL`, used in the `max_tokens` field of the Messages API call. Its doc comment states plainly that this is not a formatting choice — it's the real cost-safety bound — and cross-references the decision and the function below.
- [packages/domain/question-engine/src/generationLimits.ts](../packages/domain/question-engine/src/generationLimits.ts): new `ASSUMED_MAX_PROMPT_INPUT_TOKENS = 2000` (a documented, conservative assumption — input tokens aren't capped by any code, but are bounded by this codebase's own prompt construction, not by anything the model controls) and new `worstCaseSingleCallCostUsd(model, assumedMaxInputTokens?)`, which calls `estimateCostUsd(model, {inputTokens: assumedMaxInputTokens, outputTokens: ANTHROPIC_MAX_OUTPUT_TOKENS_PER_CALL})`. This is THE one place the coupling is a real, computed, testable number rather than a comment.
- **Explicitly not claimed:** this bounds a single call, not the three-call pipeline aggregate. Because the budget check is reactive, a full run's actual worst-case spend can still exceed `maxEstimatedBudgetUsd` by up to roughly one more call's worst case before the breaker stops the next one — a real, bounded property that this change makes visible and testable, not one it eliminates. No production billing guarantee is implied.

**Decision record:** [DECISIONS.md](DECISIONS.md) D-031.

**Tests added** (`generationLimits.test.ts`, describe block "worstCaseSingleCallCostUsd"):
- Returns `null` for an unpriced model (never a silent guess).
- For every currently priced real model (`claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-opus-5`), the worst-case single-call cost is strictly less than `DEFAULT_SINGLE_RUN_LIMITS.maxEstimatedBudgetUsd` ($1.00) — the most expensive model, `claude-opus-5`, computes to ≈$0.34 at the default input-token assumption.
- The bound scales with the assumed input-token ceiling (a sanity check that the function isn't accidentally hardcoded to ignore its own parameter).

---

## 2. Full test/typecheck/lint/build results

```
typecheck   ✓   all 7 workspaces (@ipmat/ai, @ipmat/db, @ipmat/concept-graph,
                @ipmat/examiner-lens, @ipmat/prep-phase, @ipmat/question-engine,
                @ipmat/validation)
lint        ✓   0 problems
test        ✓   146/146 passing (up from 118 before this phase; +28 new)
build       ✓   tsc emits dist/ cleanly for all 7 workspaces
```

**Old test count:** 118 (end of Phase 3.1).
**New test count:** 146.
**Breakdown of the +28:**
| File | Before | After | New |
|---|---|---|---|
| `packages/ai/test/costEstimation.test.ts` | 4 | 6 | +2 (`isKnownModel`) |
| `packages/domain/question-engine/test/generationLimits.test.ts` | 8 | 11 | +3 (`worstCaseSingleCallCostUsd`) |
| `packages/domain/question-engine/test/generationPipeline.test.ts` | 6 | 9 | +3 (unknown-model a/b/c) |
| `packages/domain/question-engine/test/comparisonReport.test.ts` | 11 | 15 | +4 (name-variance) |
| `packages/domain/validation/test/validateCandidate.test.ts` | 21 | 34 | +13 (9 grammar/complexity, 1 distractor, 3 leakage) |
| `packages/domain/concept-graph/test/normalizeConceptNameKey.test.ts` | 0 (new file) | 3 | +3 |
| **Total** | **118** | **146** | **+28** |

**Failures fixed:** none of the above were failing tests to begin with — the code review found gaps in coverage and in production logic, not existing test failures. Every fix above was implemented, typechecked, and passed its new tests on assembly; the one genuine mid-implementation correction was a TypeScript error in a test file (`responses[callIndex++]` typed as `string | undefined` against `AiCompletion.rawText: string`), fixed with an explicit `?? ""` fallback — a test-file type issue, not a logic bug.

**Deliberately untestable behavior:** whether these fixes hold up against a REAL model's actual output (as opposed to the deterministic fixtures exercised here) is untestable without running the smoke test — see §7. Within that constraint, nothing here was left untested that could reasonably be tested with fixtures.

---

## 3. Remaining weaknesses

Carried over, unchanged, from [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md) §11 and [PHASE_REVIEW.md](PHASE_REVIEW.md) §9 (see those documents for the full list): zero end-to-end validation against a real database; zero end-to-end validation against a real AI provider (see §7); the completeness-claim guard is a literal substring list; duplicate detection cannot catch a paraphrase; ambiguity/contradiction detection has no deterministic fallback beyond the judge call; single demonstration question per phase; the cost table can still silently go stale in the sense of listing a wrong price for a real, known model (D-027 only fixes the *unknown*-model case, not a *mispriced*-known-model case).

**New or refined by this phase:**
- **Stem-embedded leakage beyond a verbatim match is intentionally unresolved** (§1.3, §6) — the single most important limitation to carry forward.
- **The budget breaker's reactive-not-predictive nature is now a bounded, documented, tested property** (D-031) rather than an open-ended risk, but it is still reactive — a genuinely pre-flight (predictive) cost estimate before EVERY call, not just a worst-case sanity bound, remains unbuilt.
- **`worstCaseSingleCallCostUsd()`'s input-token assumption (2000) is a documented estimate, not a measured or enforced ceiling** — nothing in this codebase actually caps input tokens sent to the provider; if a future blueprint or prompt template became large (e.g. a much longer `transformationDescription`), the assumption could become inaccurate without any test catching it, since no test constructs an oversized prompt to check this.
- **`normalizeConceptNameKey()`'s scope is deliberately narrow (case/whitespace only)** — a concept name that's off by more than that (e.g. a genuine misspelling, "Percenatges") still correctly fails to match and lands in `unsupportedByGraph`, which is correct behavior but means the normalization fix does not, and was never meant to, catch every kind of AI naming inconsistency.
- **The distractor_quality fix is coverage-only** — no logic changed, so if the underlying check itself has a subtler bug (e.g. its `.trim()`-only, case-sensitive comparison, noted in the original [PHASE_3_1_CODE_REVIEW.md](PHASE_3_1_CODE_REVIEW.md) §3), that remains as it was; only the "nothing tests this branch at all" gap was closed.

---

## 4. Is the system now ready for a real Anthropic smoke test?

**Yes, more so than before — but the smoke test itself still has not been run, and this phase did not run it,** per its own explicit instructions ("do NOT run the Anthropic smoke test unless an API key is already present") and a check of this environment (no `ANTHROPIC_API_KEY` in the shell environment, no root `.env` file) confirming none is available.

What changed that specifically improves smoke-test readiness:
- The budget breaker can no longer be silently defeated by a model-name mismatch between what the smoke-test script passes to `new AnthropicProvider(...)` and what the pricing table expects — if those ever diverge, the pipeline now refuses to spend anything at all rather than spending unboundedly.
- The arithmetic verifier is measurably harder to fool or crash with a real model's occasional odd output (e.g. a stray comma habit, or an unexpectedly large intermediate number).
- The generation prompt is now a complete, honest statement of what the deterministic validator will check — a real model is less likely to get rejected for a constraint it was never told about, which should reduce (though this is an expectation, not a measured result) the rejection rate once real calls are made.
- The stem-leakage check adds one more real, if narrow, layer of protection that would apply automatically the first time a real candidate is generated.

What is still genuinely unknown until the smoke test actually runs — unchanged from [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md) §12: whether `claude-sonnet-5` reliably produces schema-conforming JSON on the first attempt; whether its `groundTruthDerivation.computation` outputs satisfy the (now slightly narrower) arithmetic allowlist without prompt friction; whether real latency/cost per call is sane; whether independent reverification meaningfully disagrees with a wrong answer in practice. None of this phase's fixes could be validated against those unknowns, because none of them involved a real call.

**Recommendation, unchanged in substance from Phase 3.1:** run `npm run smoke:anthropic --workspace @ipmat/question-engine` with a real key before Phase 3.5. The deterministic hardening is now more thorough than at the end of Phase 3.1, which should make that a lower-risk step than it would have been then — but it remains a step that has not happened.

---

## 5. What still deserves human review even though all tests pass

1. **Stem-leakage's accepted false-positive/false-negative trade-off (§1.3, D-029) is a product judgment call, not just an engineering one.** The false-positive risk (a short/common correct-answer value coincidentally matching an unrelated given quantity in the stem, causing a legitimate question to be rejected) and the false-negative gap (paraphrased leakage is invisible to this check) are both real and both documented — but whether this specific trade-off point (2-character minimum, whole-token match, exactly these two fields) is the right one for this product is a judgment this document cannot make on its own.
2. **`ASSUMED_MAX_PROMPT_INPUT_TOKENS = 2000` (D-031) is an estimate against today's actual prompts, not a structural guarantee.** A human should periodically sanity-check this against what the prompts in `prompts.ts` actually produce (e.g. by measuring real token counts once a real provider is available), since nothing currently enforces or alarms on this assumption becoming stale.
3. **The `unverifiable_cost` pre-flight check hard-fails an entire run rather than, say, warning and proceeding at a conservative assumed cost.** This was a deliberate, conservative choice (matching "fail-safe" in the phase instructions), but it means a legitimate new model (one that's real and correctly priced, just not yet added to the hand-maintained table) cannot be used at all until a human updates `costEstimation.ts` — worth confirming that's the intended operational posture before this pipeline is used routinely.
4. **Whether `worstCaseSingleCallCostUsd()`'s test threshold (strictly under `DEFAULT_SINGLE_RUN_LIMITS.maxEstimatedBudgetUsd`) is the right assertion, versus something stricter (e.g. under half the budget, to leave headroom for the reactive gap across 3 calls) is a policy choice a human should weigh in on** — the current test proves the number is bounded and known, not that the specific bound is comfortably safe for a 3-call run.

---

Nothing above starts Phase 3.5. No question batch was generated. Stopping here.
