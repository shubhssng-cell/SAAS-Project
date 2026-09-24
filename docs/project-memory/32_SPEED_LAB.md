# 32 — Speed Lab (`@ipmat/speed-lab`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-055 (read in full). Second concrete `TrainingSystemProvider` (Phase 5E-3).

## Purpose

General time-efficiency training — "is there evidence this student takes too much time relative to expected time, independent of whether calculation is the bottleneck." Never reads `computationalLoad`; explicitly not a second Calculation Gym, not the future Pressure Training system.

## Applicability — an immutable, correctness-independent denominator

`eligibleGradedCount` counts ALL graded attempts meeting 7 exact conditions (submitted, graded, validly timed, hint-free, non-`time_pressured`, `conceptualLoad` below a provisional threshold) — **regardless of correctness**. Only `correctSlowCount` (correct AND `speedRatio >= AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO`, reusing the canonical "slow" definition directly) can trigger applicability. An incorrect-but-otherwise-eligible attempt dilutes the fraction rather than being dropped. `incorrectSlowCount` is diagnostic-only, explicitly disclosing it cannot distinguish a conceptual difficulty from a calculation one.

## A genuine bug found and fixed during implementation — worth remembering as a pattern

An initial rate-based progression gate ("75% of a stage's attempts must be good-paced") was the near-exact mathematical **complement** of the applicability trigger ("≥50% correct-and-slow over the same population") — a concept could never satisfy both simultaneously, making progression unreachable while still applicable. Fixed by making both progression gates **count-based** over a slice **disjoint** from the one the other gate reads (low-`conceptualLoad` slice vs. moderate/high slice), mirroring Calculation Gym's own foundational/mixed split. This is the single clearest example in this project's history of "hand-calculating whether thresholds interact correctly is error-prone — verify against the real code," a lesson repeated later during `apps/web`'s fixture design (see [64_QUESTION_PLAYER.md](64_QUESTION_PLAYER.md)).

## Progression

`steady_pace → mixed_pace → time_constrained`. `time_constrained` requires `testingModes.includes("time_pressured")` — documented explicitly as representing only "this question carries a time constraint," never claiming ownership of the broader, later Pressure Training domain (sustained sequences, section constraints, switching).

## Selection

Provider-local, three steps: filter by requirement → least prior exposure (own local counter) → lowest `expectedTimeSeconds` (documented only as a deterministic preference for a tighter budget, never a claim of "harder/better") → lexicographic questionId.

## Dependency footprint

`@ipmat/training-systems` + `@ipmat/mastery` + `@ipmat/autopsy` (for `SLOW_SPEED_RATIO`). Never `@ipmat/calculation-gym` — both may legitimately read the same raw `attemptRecords` for different questions, but have zero direct coupling.

## Status

Wired into orchestration since D-062.
