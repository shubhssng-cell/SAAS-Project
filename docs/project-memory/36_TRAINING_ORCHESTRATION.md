# 36 — Training Orchestration (`@ipmat/training-orchestration`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-052, D-062 (read in full).

## What it coordinates, and the exact precedence

```
targeted_repair  ->  training_system_practice (5 providers, fixed order)  ->  adaptive_practice  ->  no_action
```

`orchestrateNextTrainingAction(input: TrainingOrchestrationInput): TrainingOrchestrationResult`:

1. `candidates.length === 0` → `no_action: no_candidates_supplied` immediately, nothing else consulted.
2. `attemptTargetedRepair()` — always tried first when an eligible (confirmed) `RepairPlan` exists (`REPAIR_PRECEDES_ADAPTIVE`). With multiple active plans, `selectPlanForOrchestration()` picks exactly ONE (priority `high > medium > low` → most-recently-confirmed → concept name lexicographic) — V1 never retries a second-priority plan if the first `no_match`es.
3. If repair `selected` → done, `targeted_repair`.
4. Otherwise `shouldAttemptTrainingSystems()` decides whether to try the provider tier — true unless repair genuinely succeeded.
5. `attemptTrainingSystems()` tries all five providers **in fixed priority order**, stopping at the first `"selected"`:

```
trap-lab > calculation-gym > speed-lab > pressure-training > novelty-training
```

If one selects → done, `training_system_practice`, identified by `providerId` (never a separate literal per provider).
6. Otherwise `shouldAttemptAdaptivePracticeAfterTrainingSystems()` decides whether to fall through — true unless policy disallows it (never actually false in V1).
7. `attemptAdaptivePractice()` — if selected, done, `adaptive_practice`, with both `wasFallbackFromRepair` and `wasFallbackFromTrainingSystems` correctly reported (both can be true simultaneously).
8. Otherwise `no_action: no_eligible_action` — `diagnostics` preserves exactly what was tried and why nothing produced a selection, on **every** branch.

## Why one generic action type, not five (D-062, a deliberate departure from D-052/D-053's original wording)

`TrainingActionType` gained exactly **one** new value, `training_system_practice` — not five separate literals. The concrete provider that fired is identified by `TrainingOrchestrationSelectedTrainingSystem.providerId`. This was a reasoned, explicitly-flagged deviation from the original design intent ("one literal per provider"), chosen so a future 6th provider (Mock, Revision) never requires touching this union again.

## No provider ever receives `RepairPlan` data

The repair/training-systems interaction is handled entirely by **sequencing** — orchestration tries repair first, and if it succeeds nothing else runs. No provider's own applicability decision is ever influenced by threading confirmed-diagnosis data into it.

## Coordinate, never reimplement — verified by source-scanning tests

`classifyMatchTier`/`applyOveruseAvoidance`/`pickWinner`/`REPAIR_MATCH_TIER_ORDER` (repair-selection's internals) and `determineSatisfiedReasons`/`rankCandidates`/`computeProgressionTargetTier` (adaptive-selection's internals) are never imported by name — enforced by a dedicated test inspecting `orchestrate.ts`'s own source text, not merely a convention.

## Prior exposure for repair's overuse avoidance is reused, not recomputed

`derivePriorExposureForRepair()` reuses `@ipmat/adaptive-selection`'s already-exported `computeExposureCounts()` — a Map→array reshape, never a third counting pass.

## A `no_match` never silently becomes success

`TrainingOrchestrationDiagnostics` is present on **every** result regardless of final `status`, preserving the raw outcome from whichever engine(s)/providers were actually consulted. `wasFallbackFromRepair`/`wasFallbackFromTrainingSystems` are explicit booleans, not something a reader has to infer from the diagnostics shape.

## A real naming collision, documented and left alone

`@ipmat/adaptive-selection`'s own `pressure_gap`/`novelty_gap`/`speed_weakness` reason codes are **completely independent** of the concrete Pressure Training/Novelty Training/Speed Lab providers — explicitly documented and regression-tested as harmless (the two vocabularies never interact), never renamed or resolved.

## Extensibility is structural, not a plugin registry

`attemptTargetedRepair()`/`attemptTrainingSystems()`/`attemptAdaptivePractice()` are standalone, independently callable functions sharing a common `{attempted, outcome}` shape a future provider function would also implement — this is exactly what let D-062 add the middle tier without changing either pre-existing function's internal logic.

## Never leaks an answer

Reuses `AutopsyQuestionContext` and each engine's own result type directly — none of which has ever carried an answer-bearing field.

## Current, honest status

**Nothing calls `orchestrateNextTrainingAction()` from a real, persisted-data flow.** Every real exercise of this function (tests, `apps/training-playground`, and this session's `apps/web` first slice) uses hand-built or fixture-derived input, never data read from `@ipmat/db`. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) for the design that will close this gap.
