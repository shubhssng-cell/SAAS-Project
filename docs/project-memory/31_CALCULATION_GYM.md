# 31 — Calculation Gym (`@ipmat/calculation-gym`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-054 (read in full). First concrete `TrainingSystemProvider` (Phase 5E-2).

## Purpose

Narrow calculation/mechanical-friction training — "a student may know the concept but still have calculation friction." Explicitly NOT a second global adaptive engine, a generic arithmetic queue, a generic speed system, or a composite "calculation ability" score.

## The core signal: `CalculationFrictionEvidence`

For one concept and student, graded attempts split into high-`computationalLoad` (≥ `HIGH_COMPUTATIONAL_LOAD_THRESHOLD`) vs. low-load slices. Each slice's accuracy is `null` below `MIN_OBSERVATIONS_FOR_COMPONENT` observations. `frictionDetected` is `true` **only** when both slices are sufficiently observed AND `lowLoad.accuracy - highLoad.accuracy >= CALCULATION_FRICTION_ACCURACY_GAP`. A concept with equally-low accuracy on both slices (ordinary conceptual weakness) never triggers this — the structural distinction, not just a documented one.

## Applicability

`evaluateCalculationGym()` fails closed with two distinguishable reasons: `insufficient_evidence` vs. `no_calculation_friction_detected`. Among concepts showing friction, targets the single largest observed accuracy gap, lexicographic concept name as final tie-break.

## Progression — three independently-gated stages

`foundational → mixed → time_pressured` (`CALCULATION_TRAINING_STAGES`, provisional, grows deliberately). Each transition requires its OWN independent evidence slice — mastering `foundational` is necessary but never sufficient to unlock `mixed`. A dedicated regression test proves a 100%-accuracy, foundational-only history advances to `mixed` but can never reach `time_pressured` on that evidence alone.

## Selection — provider-local, exactly three tie-break steps

Filter by requirement (concept, load floor, testing-mode requirements, published, structurally valid) → least prior exposure (own local counter, not shared with any sibling) → computational-load closest to the requirement's floor → lexicographic questionId. No composite score. `RepairPlan` is never read — orchestration's repair-precedes-everything policy already means a confirmed diagnosis is routed elsewhere first.

## Ten candidate calculation dimensions named in the original brief — none implemented

Fractions, ratios, decimals, estimation, simplification, shortcuts, etc. have no existing DNA tag; inventing one was explicitly rejected as unrepresentable, not narrowly scoped. Only `computationalLoad` (continuous, provisional) and `multi_step`/`time_pressured` testing modes (categorical, already-existing) are used.

## Dependency footprint

`@ipmat/training-systems` + `@ipmat/mastery` (for `MIN_OBSERVATIONS_FOR_COMPONENT` only). Never `@ipmat/adaptive-selection`/`@ipmat/repair-selection`/`@ipmat/training-orchestration`/any sibling provider — verified by its own `dependencyBoundary.test.ts`.

## Status

Wired into orchestration since D-062. No real-data calibration of any threshold has ever occurred.
