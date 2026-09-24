# 26 — Global Adaptive Selection (`@ipmat/adaptive-selection`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-051 (read in full).

## What it answers, and why it's different from repair selection

"What should this student practice next, globally, across every concept" — genuinely cross-concept, unlike `@ipmat/repair-selection`'s one-diagnosis-at-a-time targeting. **Never delegates to `selectRepairQuestion()`** — the two engines are peers with different scopes, coordinated (never merged) by `@ipmat/training-orchestration` (see [36_TRAINING_ORCHESTRATION.md](36_TRAINING_ORCHESTRATION.md)).

## Ten named, ordered reason codes — never a numeric score

```
repair_priority > repeated_error > prerequisite_weakness > accuracy_weakness > speed_weakness
  > coverage_gap > underexposure > pressure_gap > novelty_gap > difficulty_progression
```

A candidate is bucketed by the single **highest-priority** reason it satisfies; the first non-empty bucket, iterated in this order, wins. `difficulty_progression` is the deliberate universal fallback — if nothing satisfies any named reason, every eligible candidate is `difficulty_progression` and `isFallback: true`; a candidate that genuinely satisfies difficulty_progression's own predicate reports `isFallback: false`.

## Every signal reused from an existing, real contract — never a second model

- Accuracy/speed/novelty/pressure weaknesses read `MasteryStateResult.measures` directly.
- Repeated-error reads `MasteryComponentDetail.errorRecurrence`.
- Coverage-gap reads `MasteryComponentDetail.coverage.taxonomyCellsEncountered`.
- Underexposure/overuse-avoidance derive from the SAME `MasteryAttemptRecord[]` `@ipmat/mastery` already consumes.
- `repair_priority`/`prerequisite_weakness` read `RepairPlan` as ONE input signal among ten — `selectRepairQuestion()` is never imported or called.

## A load-bearing distinction: WEAKNESS claims vs. GAP claims

`accuracy_weakness`/`speed_weakness`/`repeated_error` require an actually-**measured** value crossing a threshold — a `null` mastery measure (insufficient observations) **never** produces a weakness claim ("missing data does not produce fake conclusions"). `coverage_gap`/`novelty_gap`/`pressure_gap` are different in kind: the **absence** of exposure IS the observable fact being reported, so a `null` measure there legitimately does indicate a gap.

## Difficulty progression is directional only, never "harder is better"

`computeProgressionTargetTier()` finds the highest tier where both sufficient observations AND accuracy above threshold hold, and targets one step above it — falling back to `"standard"` on cold start, never a random or upward-biased guess. Tier ordering carries the same non-calibration caveat as every other provisional ranking in this codebase (D-021).

## Deterministic tie-break within the winning bucket

Overuse avoidance → coverage preference (fewer prior family attempts wins) → difficulty-progression proximity (computed per-candidate's own concept, since selection is genuinely global and can span concepts with different targets) → lexicographic `questionId`.

## What's deferred, honestly

The confirm/correct UI and wiring into a real practice flow were never built at this layer — `@ipmat/adaptive-selection` has no caller of its own outside `@ipmat/training-orchestration`. `prepPhase` is accepted as an input but **not yet used in ranking** — using it would require a calibration decision (how much should phase urgency outweigh an observed weakness) this codebase deliberately does not make up. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) for why this remains deferred even in the next architectural unit.

## No composite score, no confidence/motivation field — enforced at compile time

Dedicated `@ts-expect-error` regression-guard tests prove `AdaptiveSelectionInput`/`AdaptiveCandidateQuestion`/`AdaptiveSelectionResult` structurally reject such fields — the same discipline extended from D-005/D-034/D-038 to this package.

See also: [30_TRAINING_SYSTEMS.md](30_TRAINING_SYSTEMS.md), [36_TRAINING_ORCHESTRATION.md](36_TRAINING_ORCHESTRATION.md).
