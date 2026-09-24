# 41 — Examiner Lens (`@ipmat/examiner-lens`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/QUESTION_ENGINE.md` §2/§2a, `docs/DECISIONS.md` D-015, D-023, D-030 (read in full).

## What it is

A structured analysis, one per `(concept, version)`, answering four questions in normalized fields and controlled vocabularies — never free prose, never one opaque JSON blob.

1. **What is being tested** — `concept`, `subconcept`, `skill`, `prerequisite` (a real graph reference) as four separate fields.
2. **How it can be tested** — a subset of the 10-value `TestingMode` vocabulary: `direct, reverse, transformed, combined, contextualized, represented_differently, constrained, time_pressured, multi_step, novel_representation`.
3. **What it can be combined with** — computed **live** from the concept graph (`deriveCombinations()`, D-015), never independently authored or stored. An `ExaminerLensAnalysis` row has no combinations column at all.
4. **What can go wrong** — `{category, errorTaxonomyCode, description}[]`, `category` sharing `ErrorTaxonomy.category`'s same 5-value vocabulary (D-013).

## Difficulty is dimensional, not a label

`difficultyDimensions` is a fixed 6-field struct (`conceptualLoad`, `computationalLoad`, `trapDensity`, `representationNovelty`, `timePressure`, `multiStepDepth`, each 0–1), calibrated as a standard-tier baseline that harder tiers push specific dimensions up from, never a vaguer "harder" claim.

## Authorship tracked honestly

`authoredBy` (`human`/`ai`) is separate from `status` (the review workflow). Percentages' canonical, human-authored analysis remains the evaluation baseline and is never overwritten by an AI regeneration.

## Structural validation without a live AI provider

`validateExaminerLensAnalysis()` checks references are real, testing modes are vocabulary-sanctioned, and — via `findCompletenessClaims()` — that no free-text field asserts literal completeness. Fully testable against deterministic fixtures.

## Human baseline vs. AI regeneration — the comparison report (D-023)

`buildLensComparisonReport()` diffs a human-authored analysis against an AI-regenerated one, **never modifying either.** Combinations split into **four**, not two, categories — this is the fix for a real, found bug:

| Category | Meaning |
|---|---|
| `validGenerationCombination` | A real, generation-useful edge exists |
| `relatedButNonCombinable` | A real edge exists (often `related_but_distinct`), but explicitly not combinable |
| `unsupportedByGraph` | No edge at all — invented |
| `missedByAi` | A real, useful edge the AI never mentioned |

The original two-category version conflated "an edge exists" with "valid to combine on" — an AI proposal matching `related_but_distinct` would have counted as support, when that relationship type exists **specifically** to flag confusion risk, not combinability.

**A real, documented run result:** against Percentages, the AI correctly identified the Ratio prerequisite and 3 real combinations, proposed Probability (a real `related_but_distinct` edge, correctly landed in `relatedButNonCombinable` — its stated rationale, "both are numbers between 0 and 100," is exactly the surface-level confusion the human Lens already warns about), invented one relationship (Time and Work) with no supporting edge, and missed 3 real combinations. It made no completeness claim in this run.

## Concept-name normalization (D-030)

`normalizeConceptNameKey()` (trim, collapse whitespace, lowercase) closes a real false-positive gap — an AI returning "ratio" instead of "Ratio" no longer gets misreported as an invented relationship. Exact-match-after-normalization only, never fuzzy — a genuinely misspelled name still correctly falls to `unsupportedByGraph`.

## Versioning

Re-running the Lens on a concept produces a new version; old pattern families/questions keep their original `examiner_lens_analysis_id`, so provenance never breaks.
