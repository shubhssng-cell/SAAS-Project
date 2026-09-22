# Phase 3.1 Review — AI Pipeline Hardening

**Scope:** fix the weaknesses [PHASE_REVIEW.md](PHASE_REVIEW.md) identified in Phases 1–3, before trusting any real AI-generated content. No new product features, no Phase 4, no student-facing UI, no batch generation. See [DECISIONS.md](DECISIONS.md) D-020 through D-026 for the individual decision records this report summarizes.

**Update (Phase 3.1.1):** an implementation-level code review of this phase's own work ([PHASE_3_1_CODE_REVIEW.md](PHASE_3_1_CODE_REVIEW.md)) found several real gaps in the hardening below — most notably that the budget breaker silently disabled itself for any unpriced model. All of them were fixed in Phase 3.1.1 ([PHASE_3_1_1_REVIEW.md](PHASE_3_1_1_REVIEW.md), docs/DECISIONS.md D-027–D-033). §11 below is updated in place to reflect the current, post-3.1.1 state; the rest of this document is left as originally written, as the historical record of what Phase 3.1 itself did.

**Headline result:** every code fix requested is implemented and tested against deterministic fixtures (118 tests, up from 92). **The real Anthropic smoke test was NOT run** — no `ANTHROPIC_API_KEY` was available in this environment; the user was asked directly and chose to defer it rather than provide one now. The script is written, typechecked, and ready (`npm run smoke:anthropic --workspace @ipmat/question-engine`). This report says so plainly in every section that would otherwise report a real result, rather than presenting fixture-based confidence as if it answered the same question.

---

## 1. Exact changes

| # | Area | What changed |
|---|---|---|
| 1 | Independent verifier input | New `PresentedQuestionView`/`JudgeView` types; reverification and judge prompts now built ONLY from these, never the full candidate |
| 2 | Lens comparison | `combinations` split into 4 categories (`validGenerationCombination`, `relatedButNonCombinable`, `unsupportedByGraph`, `missedByAi`) instead of 2 |
| 3 | Answer parsing | `verifyComputation()` fails closed (`unverifiable_answer`) on an unparseable `correctAnswer`; fixed an `Number("")===0` coercion bug; added support for ₹/$/Rs./%/comma formats |
| 4 | Difficulty calibration | `QuestionBlueprint.difficultyCalibrationStatus` added, always `"provisional"` from `buildBlueprintFromCell()` |
| 5 | Real API smoke test | Script written (`demo/runRealAnthropicSmokeTest.ts`); **not executed** — no key available |
| 6 | Real model robustness | Not verified against a real model (blocked on #5); the code paths that would handle it (retry-on-malformed-JSON, fence-stripping, schema mismatch → retry-with-feedback) are unchanged from Phase 3 and were already tested against synthetic malformed input |
| 7 | Blueprint-deviation safety | `BlueprintExpectation`/`validateBlueprintCompliance()` expanded from 3 checked fields to 7 (added difficulty tier, testing modes, trap, combination concepts) |
| 8 | AI judge trust boundary | Judge prompt no longer includes the candidate's claimed answer or explanation at all |
| 9 | Cost safety | New `GenerationLimits` type + `validateGenerationLimits()` (throws before any AI call) + running-cost circuit breaker inside `runGenerationPipeline()` |
| — | Bug found while building #5 | `@ipmat/ai`'s `generateStructured` schema parameter was mistyped (`ZodSchema<T>` forces Input=Output=T); fixed to `ZodType<T, any, any>` |

All changes are additive or corrective to existing Phase 3 code — no package was removed, no existing passing test was deleted (all 92 Phase 3 tests still pass, plus 26 new ones).

## 2. Important files/functions

**New files:**
- `packages/domain/question-engine/src/verifierView.ts` — `PresentedQuestionView`, `JudgeView`, `toPresentedQuestionView()`, `toJudgeView()`
- `packages/domain/question-engine/src/generationLimits.ts` — `GenerationLimits`, `DEFAULT_SINGLE_RUN_LIMITS`, `validateGenerationLimits()`
- `packages/domain/question-engine/demo/runRealAnthropicSmokeTest.ts` — the (unrun) real-provider smoke test
- `packages/domain/question-engine/test/verifierView.test.ts`, `test/generationLimits.test.ts`

**Modified files (function-level):**
- `packages/domain/question-engine/src/prompts.ts` — `buildReverificationUserPrompt(view: PresentedQuestionView)` (was: took a raw stem string, now takes the narrow view and formats options); `buildJudgeUserPrompt(view: JudgeView)` (was: took the full candidate and included `correctAnswer`/`explanation`)
- `packages/domain/question-engine/src/comparisonReport.ts` — `buildLensComparisonReport()` now computes `validGenerationCombination`/`relatedButNonCombinable` instead of a single `supportedByGraph`
- `packages/domain/question-engine/src/blueprint.ts` — `QuestionBlueprint` gained `difficultyCalibrationStatus`; `buildBlueprintFromCell()` sets it to `"provisional"`
- `packages/domain/question-engine/src/generationPipeline.ts` — `runGenerationPipeline()` now validates limits up front, tracks running cost, and passes the narrow views to the reverification/judge calls
- `packages/domain/validation/src/qualityValidators.ts` — `BlueprintExpectation` gained 4 fields; `validateBlueprintCompliance()` checks all 7
- `packages/domain/validation/src/verifyComputation.ts` — fail-closed `parseNumeric()`, new format support
- `packages/domain/validation/src/types.ts` — `RejectionCode` gained `unverifiable_answer`, `budget_exceeded`
- `packages/ai/src/types.ts` — `GenerateStructuredInput<T>.schema` type fixed

## 3. Real Anthropic test result

**Not run.** No `ANTHROPIC_API_KEY` was present in the environment (checked shell env and a root `.env` file, neither existed). The user was asked explicitly whether to provide a key now or defer; they chose to defer. Per the phase instructions ("do NOT use FixtureProvider as a substitute for the real smoke-test results"), this report does not synthesize, estimate, or imply a result — there is none to report.

The script (`packages/domain/question-engine/demo/runRealAnthropicSmokeTest.ts`) is complete and does the following when run:
1. Loads `ANTHROPIC_API_KEY` from a root `.env` if not already in the environment (never logs it).
2. Refuses to run and exits non-zero if no key is found — no fallback to `FixtureProvider`.
3. Makes one real `examiner-lens-analysis` call and one real `runGenerationPipeline()` run (3 more real calls: generation, reverification, judge) against `AnthropicProvider("claude-sonnet-5")`.
4. Prints and writes to `demo/real-smoke-test-output.json` every metadata field required by Phase 3.1 §5: provider, model, latency, token usage, estimated cost, validation result, lifecycle result.
5. Catches and prints the exact failure for either task independently — a failure in task 1 doesn't prevent task 2 from attempting.
6. Never overwrites the human-authored Lens baseline (it's only read) and never persists anything (there is no database connection anywhere in this repository, so this is trivially true, not a special guard added for this script).

## 4. Actual generated Examiner Lens result

**None — not run.** See §3.

## 5. Actual generated question result

**None — not run.** See §3.

## 6. Independent verification result

**No real-model result** — no live call was made. What IS proven, against deterministic fixtures:
- `toPresentedQuestionView()`/`toJudgeView()` return objects containing exactly the allowlisted keys (`{stem, options, answerFormat}` and `{...} + claimedDifficultyTier` respectively) — checked by set equality in `verifierView.test.ts`.
- Prompts built from a candidate with distinct marker strings planted in `correctAnswer`, `explanation`, `groundTruthDerivation.computation`, `reasoning`, and `solutionSteps` never contain any of those markers in either the reverification or judge prompt text.
- The prompts DO contain the stem and options — the verifiers can see the actual question, they just can't see the answer.

**Explicit limitation (see [PHASE_REVIEW.md](PHASE_REVIEW.md) §9.11):** this proves leakage is structurally impossible, not that a real "independent" model call constitutes meaningful independent evidence — a model could still happen to agree with the first candidate's answer by chance, which would look identical in the pipeline's output to "independent verification succeeded."

## 7. Validation result

Against deterministic fixtures, every rejection path Phase 3.1 asked for now has a dedicated fixture and test:
- Difficulty-tier blueprint violation → `blueprint_violation` / `questionDna.difficultyTier`
- Testing-mode blueprint violation (required mode dropped) → `blueprint_violation` / `questionDna.testingModes`
- Trap blueprint violation → `blueprint_violation` / `questionDna.trapErrorTaxonomyCode`
- Combination-concept blueprint violation → `blueprint_violation` / `questionDna.combinesWithConcepts`
- Unparseable `correctAnswer` → `unverifiable_answer` (not silently skipped)
- Empty-string `correctAnswer` → `unverifiable_answer` (not silently treated as `0`)
- Budget exceeded mid-run → `budget_exceeded` on the skipped check(s), `metadata: null`
- Invalid `GenerationLimits` → thrown `Error` before any AI call, proven by a `FixtureProvider([])` that would itself throw a different error if ever called

All of Phase 3's original 9 rejection-path fixtures (malformed, ambiguous, multiple-correct-answer, wrong-answer, blueprint-violation, out-of-syllabus, duplicate, unsupported-completeness-claim, valid) still pass unchanged.

## 8. Failures encountered

Two genuine bugs were found and fixed during this phase, both worth stating plainly rather than folding into the changelog:

1. **`@ipmat/ai`'s `generateStructured` had a real type-signature bug** (`ZodSchema<T>` instead of `ZodType<T, any, any>`) that would have caused a TypeScript compile error the first time anyone called it with an explicit type parameter against a schema using `.default()` — which is exactly the `examiner-lens-analysis` task. This was not caught by Phase 3's test suite because no test called `generateStructured` with that schema AND an explicit type parameter in a way that triggered the mismatch. Found while writing the real smoke-test script (§3), fixed before any real API call was attempted.
2. **The "valid" candidate fixture used in Phase 3's tests accidentally shared heavy vocabulary with the "duplicate" fixture** (both used a "population of Town X" template) — not a Phase 3.1 bug, but re-confirmed still fine after this phase's changes since no fixture content changed in a way that would reintroduce it.

No other failures — every other fix was implemented, typechecked, and tested successfully on the first attempt at the level of "does it compile and pass tests"; the iteration was in getting the *design* of each fix right (e.g., choosing set-equality over array-equality for the combination-concept check), not in fixing broken code after the fact.

## 9. AI cost/token information

**No real cost/token data** — no live call was made. What exists and is tested:
- `AiResultMetadata.estimatedCostUsd`/`tokenUsage` are populated by every `FixtureProvider` call (with `{inputTokens: 0, outputTokens: 0}`, cost `$0`, since fixtures don't consume real tokens).
- The budget circuit breaker is proven with a mock `AiProvider` reporting `{inputTokens: 10_000_000, outputTokens: 10_000_000}` (≈$180 at `claude-sonnet-5` pricing) — confirming the pipeline correctly computes a running cost, correctly compares it to `maxEstimatedBudgetUsd`, and correctly skips the remaining 2 calls once exceeded.
- Real cost/latency/token numbers from an actual `claude-sonnet-5` call remain entirely unverified.

## 10. Tests and results

```
typecheck  ✓  (all 7 workspaces)
lint       ✓  (0 problems)
test       ✓  118/118 passing (up from 92; +26 in Phase 3.1)
build      ✓  (tsc emits dist/ for all 7 workspaces)
```

New test files: `verifierView.test.ts` (6 tests), `generationLimits.test.ts` (8 tests). Extended: `validateCandidate.test.ts` (+7: 5 new blueprint-violation cases, 2 fail-closed-parsing cases, 1 untrusted-input-format case), `comparisonReport.test.ts` (+2: the new 4-category split plus a mutual-exclusivity check), `generationPipeline.test.ts` (+2: invalid-limits-throws, budget-circuit-breaker), `blueprint.test.ts` (+1: provisional-status check).

See [PHASE_REVIEW.md](PHASE_REVIEW.md) §10 for the general caveat this report inherits in full: passing tests prove the deterministic control flow and type contracts are correct given the inputs tested — they do not and cannot prove a real AI provider will produce inputs shaped like the fixtures, because no real provider was exercised this phase either.

## 11. Remaining known weaknesses (updated after Phase 3.1.1 — see note at top of document)

Unchanged from [PHASE_REVIEW.md](PHASE_REVIEW.md) §9 except where noted:
- Zero end-to-end validation against a real database (unchanged).
- **Zero end-to-end validation against a real AI provider (unchanged, and the specific blocker for this phase's §5-7 requirements — still true after Phase 3.1.1, see [PHASE_3_1_1_REVIEW.md](PHASE_3_1_1_REVIEW.md) §7).**
- The completeness-claim guard is still a literal substring list (unchanged).
- Duplicate detection still cannot catch a paraphrase (unchanged).
- Ambiguity/contradiction detection still has no deterministic fallback — the judge's trust boundary is tighter (no claimed answer/explanation shown), but if the judge model itself is bad at spotting ambiguity, nothing else catches it (partially improved, core limitation unchanged).
- `correctAnswer` parsing and the Lens comparison's category-blindness are **fixed** (see [PHASE_REVIEW.md](PHASE_REVIEW.md) §9 for the marked-up list).
- Single demonstration question per phase — unchanged; this phase hardened rules, it did not generate more content.
- The cost table can still silently go stale (unchanged) — **but as of Phase 3.1.1, going stale in the specific sense of "a model gets used without a pricing entry" now fails closed instead of silently disabling the budget breaker (docs/DECISIONS.md D-027).**
- The independent-verifier leakage fix is proven structurally, not behaviorally — it cannot prove a real model's "independent" answer wasn't a lucky guess (§6 above) (unchanged).
- The budget circuit breaker is reactive, not predictive — it can let one single call exceed the entire budget before stopping the next one; a true batch loop would need a pre-flight cost estimate, not built (unchanged in kind, but now bounded and tested: see docs/DECISIONS.md D-031 — the reactive gap can no longer be made arbitrarily worse by an unpriced model, and a single call's worst case is now a documented, tested number).
- **FIXED in Phase 3.1.1: an unpriced/unrecognized model could silently bypass the entire budget breaker** (the most consequential finding of [PHASE_3_1_CODE_REVIEW.md](PHASE_3_1_CODE_REVIEW.md)) — now fails closed before any AI call (docs/DECISIONS.md D-027).
- **FIXED in Phase 3.1.1: the arithmetic verifier's allowlist included a comma that did not do what its own comment implied, and had no length/magnitude/complexity bounds** — grammar narrowed, comma removed, and four new bounds added (docs/DECISIONS.md D-028).
- **FIXED in Phase 3.1.1: the structural leakage boundary said nothing about the stem itself stating its own answer** — a new, deliberately narrow, deterministic (non-semantic) guard now catches a verbatim answer/blueprintId leak (docs/DECISIONS.md D-029). **INTENTIONALLY UNRESOLVED:** paraphrased or algebraically-derivable leakage remains undetectable by any deterministic check in this codebase — documented as a real, accepted limitation, not fixed, because no deterministic mechanism can fix it without becoming exactly the "brittle keyword blacklist" the hardening work was explicitly told not to build.
- **FIXED in Phase 3.1.1: the Examiner Lens comparison matched concept names by raw string equality**, so a real model's harmless casing/whitespace variance could be misreported as an invented relationship — now matched by normalized key, exact-match only, never fuzzy (docs/DECISIONS.md D-030).
- **FIXED in Phase 3.1.1: the real bound on worst-case single-call cost (AnthropicProvider's output-token cap) was an undocumented, untested cross-file assumption** — now a named constant, a documented decision, and a regression test (docs/DECISIONS.md D-031).
- **FIXED in Phase 3.1.1: the generation prompt only named 3 of the 7 fields blueprint compliance enforces**, an avoidable-rejection gap, not a safety gap — prompt now states all 7 (docs/DECISIONS.md D-032).
- **FIXED in Phase 3.1.1: `distractor_quality` was dead code with no test reaching it** — given a dedicated fixture and test (docs/DECISIONS.md D-033).

## 12. Is the pipeline ready for small-scale real question generation?

**Not yet — one specific, well-defined step remains: run the smoke test.** Everything that can be verified without a live API key has been verified:
- Every structural safety property requested (leakage prevention, blueprint-drift detection, fail-closed parsing, judge trust boundary, cost limits) is implemented and tested.
- The pipeline's control flow, rejection reporting, and lifecycle gating are correct against every fixture scenario constructed, including adversarial ones (prototype-pollution-style computation strings, empty answers, budget overruns).
- A real type bug was found and fixed before it could block real usage.

What is genuinely unknown until the smoke test runs:
- Whether `claude-sonnet-5` reliably produces schema-conforming JSON for these 4 task shapes on the first attempt, or needs the retry-with-feedback path in practice.
- Whether its `groundTruthDerivation.computation` outputs actually satisfy the arithmetic-only allowlist, or need prompt adjustment.
- Whether real latency/cost per call is in a sane range for the $1.00 default budget.
- Whether the independent reverification call meaningfully disagrees with a wrong answer in practice, or tends to make correlated mistakes with the first call (a real risk with two calls to the same model/prompt family that fixtures cannot reveal either way).

**Recommendation: run `npm run smoke:anthropic --workspace @ipmat/question-engine` with a real key before Phase 3.5.** Given the extent of deterministic hardening completed this phase, that is expected to be a short, low-risk step rather than a phase of its own — but it is a step that has not happened, and this report does not claim otherwise.

Stopping here per the phase instructions. Not proceeding to Phase 3.5 or Phase 4 automatically.
