# 34 — Novelty Training (`@ipmat/novelty-training`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-058 (read in full). Fourth concrete `TrainingSystemProvider` (Phase 5E-5).

## Purpose — the first EXPOSURE-first, not weakness-first, provider

Deliberate exposure to Question DNA's existing `noveltyLevel` vocabulary (`novel_representation`/`novel_combination`/`novel_context`) — never `testingModes`' coincidentally-named values, never the continuous/provisional `difficultyDimensions.representationNovelty` estimate.

## Applicability is computed ENTIRELY from attempt history — a structural guarantee

`evaluateNoveltyTraining()` reads only `context.studentId`/`context.attemptRecords` — `context.candidates` is read for the first time inside `selection.ts`, never inside `evaluate()`. Proven two ways: a candidate-pool-invariance test (identical decision regardless of what candidates are supplied) AND a source-level, comment-stripped regression test scanning the actual `evaluate()` function body for any reference to `context.candidates`. This is one of the strongest structural guarantees in the whole training-systems layer — not merely "tested to behave this way" but "verified the source code cannot do otherwise."

## Concept-specific standard-exposure baseline

Requires ≥3 standard-`noveltyLevel` attempts for THAT concept specifically before evaluating at all — another concept's activity never satisfies it, proven by a dedicated cross-concept isolation test. Exposure counts are labeled consistently: 0 = "limited prior exposure," 1–2 = "underexposed," 3+ = "sufficient exposure," reusing `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` — no second invented threshold.

## No progression — the three levels are peers

Unlike Calculation Gym/Speed Lab, there is no ladder. Targeting the globally lowest-exposure `(concept, level)` pair already produces an emergent rotation across all three novelty levels without a stage machine.

## Dependency footprint

`@ipmat/training-systems` + `@ipmat/mastery` only — alongside Trap Lab, one of the two lightest providers. Zero new provisional numeric constants introduced.

## Selection

Prefer an unseen taxonomy cell at the target level → least exposure → lexicographic questionId.

## Priority position and why

Given **lowest** priority in the fixed orchestration order (`trap-lab > calculation-gym > speed-lab > pressure-training > novelty-training`) — the reasoning stated directly in the decisions log: "exposure is an opportunity, not a problem," so a genuine weakness signal (any of the other four) should always be addressed before a rotation-for-breadth signal.

## Status

Wired into orchestration since D-062.
