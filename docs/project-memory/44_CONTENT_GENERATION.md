# 44 — Content Generation

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/AI_ARCHITECTURE.md` §6, §9, §9a; `docs/QUESTION_ENGINE.md` §5b (read in full).

## The pipeline, exactly

```
QuestionBlueprint (deterministic, no AI)
  -> validateGenerationLimits(limits)          -- throws before ANY AI call if limits unsafe
  -> generateStructured("question-generation")  -- candidate must echo blueprintId, include groundTruthDerivation
  -> validateCandidateStructurally()            -- blueprint compliance (7 fields), syllabus, single-answer, no leakage
  -> deterministic re-derivation (verifyComputation, mathjs, allowlisted)
  -> [budget check] SECOND independent generateStructured("answer-reverification")
  -> checkDuplicateRisk()                       -- token-overlap, interim
  -> [budget check] generateStructured("validation-judge")
  -> computeLifecycleStatus(): rejected | validated | review_required
```

## The one rule this whole pipeline exists to enforce

**"The LLM says the answer is X" is never sufficient.** Every check runs regardless of an earlier failure, so a rejection report shows everything wrong, not just the first problem found.

## Independent verification, structurally guaranteed (D-020)

`PresentedQuestionView {stem, options, answerFormat}` and `JudgeView` (adds `claimedDifficultyTier`) are the **only** types the reverification/judge prompt builders accept — built via explicit field-by-field destructuring, never a spread of the full candidate. `correctAnswer`/`expectedAnswer`/`groundTruthDerivation`/`explanation`/`solutionSteps`/`reasoning` are not fields on either type, so no future change to the candidate schema can leak them through these functions without a deliberate edit. The judge specifically never sees the claimed answer.

## What this structural boundary cannot catch

The `stem` itself stating its own answer in free text — `validateNoAnswerLeakageInStem()` (D-029) is a separate, deliberately narrow, deterministic guard against a **literal, verbatim** match only; explicitly documented as not semantic leakage detection.

## Generation limits and the budget breaker (D-025, D-027, D-031)

`GenerationLimits` (blueprint count, candidates per blueprint, retries, total attempts, budget) validated before any AI call. Running `estimatedCostUsd` tracked across the pipeline's 3 calls; exceeding budget mid-run skips remaining calls (`budget_exceeded`). An unpriced model fails closed **before the first call** (`isKnownModel()`) — closing a real gap where `null` cost was previously indistinguishable from a genuinely free call. The `AnthropicProvider` output-token cap and this budget logic are one documented, tested coupling (D-031) — a single call's worst case is bounded; a full 3-call run's aggregate can still exceed budget by roughly one more call's worst case before the reactive breaker stops the next one (an accepted, disclosed limitation, not eliminated).

## Question lifecycle

```
draft -> generated -> validated ---------> published -> deprecated
                    \-> rejected      /
                      review_required -> approved
```

Standard/Advanced tiers passing every check reach `validated` (can go straight to `published`); Hard/Extreme/Novel always land in `review_required` regardless of how clean the results look (D-008).

## What was deliberately never built

A production content factory. Phase 3 proved the pipeline on exactly one blueprint at a time; Phase 3.5's expansion filled 7 more taxonomy cells but via `FixtureProvider`, never a live model — **no real AI-generated content has ever been produced in this project.** See [92_CURRENT_STATE.md](92_CURRENT_STATE.md).
