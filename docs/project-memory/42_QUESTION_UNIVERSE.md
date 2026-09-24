# 42 — Question Universe (`@ipmat/question-engine` — pattern families, taxonomy, coverage)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/QUESTION_ENGINE.md` §3/§4, `docs/DECISIONS.md` D-007, D-014 (read in full).

## Two levels, not one (D-014)

- **`QuestionPatternFamily`** describes the **structure** of a question (e.g. "Reverse Percentage") — `name`, `skill`, `description`, `expectedDifficultyTier`, and three "potential" fields (combinations, traps, testing modes) describing the legitimate space it can draw from. One family generates many valid questions.
- **`PatternTaxonomyCell`** is one **concrete, narrow slice** of that family's space — a specific combination × testing mode × trap × difficulty tier — and is the unit `coverage_status` is tracked against.

Percentages has 4 seeded families (Reverse Percentage, Successive Percentage Change, Percentage Point vs. Percentage Change, Percentage Share in DI) and 8 seeded cells (2 per family).

## The explicit non-claim (D-007)

The product does not claim mathematical completeness ("every possible percentage question"). It claims and tracks **coverage against a curated, explainable taxonomy**, using "known/mapped/covered/uncovered" language exclusively. `QuestionUniverseSnapshot` structurally cannot express "complete" — there is no field for it — and `findCompletenessClaims()` guards the surrounding free text.

## The readiness ladder — computed, never stored

```
mapped -> has_questions -> validated -> practice_ready
```

`computePatternFamilyReadiness()` computes this fresh from real `PatternTaxonomyCell`/`Question` rows on every read — the same "derived, never input" discipline as `MasteryState` (D-015). A family starts `mapped` the moment it's documented and climbs only as real, validated, published content backs it.

## Per-cell coverage — a finer-grained, separate view (D-045)

`computeTaxonomyCellCoverage()` answers the narrower "does THIS EXACT cell have one question," reporting a 3-value status (`uncovered`/`underrepresented`/`covered`) — `"covered"` still means at least one **published** question, never merely validated or review-queued. Cells are matched by natural key (the real schema's own `@@unique` constraint fields), never a synthetic id.

## Coverage vs. mastery's own "pattern coverage" — two different axes (see [25_MASTERY.md](25_MASTERY.md))

`@ipmat/question-engine`'s coverage answers "does content exist for this cell at all" (content-readiness). `@ipmat/mastery`'s `patternCoverage` answers "has THIS student attempted this cell" (student exposure). Both real, both needed, never conflated into one coverage model — `@ipmat/mastery` reuses `computePatternFamilyReadiness()` directly for the content-readiness half rather than building a second one.

## The Question Universe snapshot

`buildQuestionUniverseSnapshot()` assembles, for a concept: mapped pattern families, related concepts (from the graph), each family's potential combinations/traps/testing modes, difficulty tiers in use, and a per-family coverage-stage breakdown. Demonstrated end to end via `npm run demo:percentages --workspace @ipmat/question-engine`.

## Current, honest coverage status (see [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for exact numbers)

1 of 8 seeded cells was `covered` after Phase 2 (one hand-authored demonstration question); Phase 3.5's fixture-driven expansion filled all 7 remaining cells to `underrepresented` (validated/review-queued content exists, nothing published) — **0 of 8 cells are `covered`** as of the current checkpoint, since 0 questions have ever been published.
