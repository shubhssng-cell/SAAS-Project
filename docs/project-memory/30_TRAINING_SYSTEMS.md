# 30 — Training Systems: the Shared Contract (`@ipmat/training-systems`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-053 (read in full). See [31](31_CALCULATION_GYM.md)–[35](35_PRESSURE_TRAINING.md) for each concrete provider, [36](36_TRAINING_ORCHESTRATION.md) for how they're coordinated.

## What a "training system" is, and is not

A training-system provider answers exactly one narrow question: "is my ONE specific training mode applicable right now, and if so, what does a qualifying question require." It is explicitly **not** a second adaptive-selection engine — it never asks "what's globally best for this student" (that stays `@ipmat/adaptive-selection`'s job) or "which question repairs this one confirmed diagnosis" (`@ipmat/repair-selection`'s job).

## The contract, exactly

```ts
interface TrainingSystemProvider {
  readonly providerId: string;
  evaluate(context: TrainingSystemContext): TrainingSystemApplicability;
  select(context: TrainingSystemContext, applicability: {requirement, explanation}): TrainingSystemSelectionOutcome;
}
```

- **`evaluate()` is the ONE authoritative applicability decision** — `{applicable: false, reason, explanation} | {applicable: true, requirement, explanation}`.
- **`select()` is called ONLY after an `applicable: true` evaluation** — its own return type structurally EXCLUDES `not_applicable` (proven by a dedicated `@ts-expect-error` test, not just documented).
- **`runTrainingSystemProvider()`** is the canonical entry point joining both steps — if `evaluate()` says not applicable, `select()` is never called at all.

## Strict `error` semantics

`error` is reserved strictly for invalid/impossible execution conditions — **never** for "no candidate matched" (that's `no_eligible_question`) and **never** for "mode doesn't apply" (that's `not_applicable`). Every non-error outcome carries `diagnostics`; `error` deliberately does not.

## No shared ranking utility, by design

The package ships only types, `buildTrainingSystemDiagnostics()` (a plain field-default constructor), and the evaluate-then-select runner — **no ranking/filtering utility of any kind**. This makes "a provider recreates adaptive-selection/repair-selection semantics" structurally unavailable from the contract itself, not merely discouraged by convention. A provider may implement its own narrow, deterministic, bounded, tested selection (genuinely intrinsic to its one mode) or delegate entirely to either engine's public entry point over a requirement-filtered pool — never import either engine's internal, non-exported functions.

## `TrainingSystemContext` — the full input shape (as it stands after D-061's addition)

```ts
interface TrainingSystemContext {
  studentId: string;
  masteryByConcept: MasteryStateResult[];       // already-computed, never recomputed by a provider
  attemptRecords: MasteryAttemptRecord[];
  errorTaxonomy?: ErrorTaxonomyEntry[];
  prepPhase?: PrepPhaseResult | null;
  candidates: TrainingCandidateQuestion[];
  practiceBlocks?: TrainingPracticeBlockContext[];   // added D-061, purely primitive, no import of practice-block/session
}
```

## `TrainingRequirement` — small, all-optional, never a scoring object

`{testingModes?, noveltyLevel?, errorTaxonomyCode?, difficultyTierPreference?, notes?}` — a provider populates only the dimensions its own mode cares about. Descriptive metadata about what a qualifying question needs, never a weighted scoring vector.

## The five concrete providers, in the fixed priority order orchestration tries them

```
trap-lab > calculation-gym > speed-lab > pressure-training > novelty-training
```

| Provider | Trigger | File |
|---|---|---|
| Trap Lab | Recurring failure on the same trap-taxonomy code, cross-concept | [33_TRAP_LAB.md](33_TRAP_LAB.md) |
| Calculation Gym | Accuracy gap conditioned on `computationalLoad` | [31_CALCULATION_GYM.md](31_CALCULATION_GYM.md) |
| Speed Lab | Correct-but-slow evidence, load-independent | [32_SPEED_LAB.md](32_SPEED_LAB.md) |
| Pressure Training | Block-level sustained-sequence degradation | [35_PRESSURE_TRAINING.md](35_PRESSURE_TRAINING.md) |
| Novelty Training | EXPOSURE-first (not weakness-first) rotation | [34_NOVELTY_TRAINING.md](34_NOVELTY_TRAINING.md) |

## No composite score, no confidence field — enforced at compile time

6 dedicated `@ts-expect-error` regression-guard tests on `TrainingSystemContext`/`TrainingCandidateQuestion`/`TrainingSystemDiagnostics`/`TrainingSystemSelectionOutcome`.

## Current, honest status

No caller ever assembles a real `TrainingSystemContext` from persisted data — every test runs against hand-built fixtures. `apps/training-playground` dispatches deterministic scenarios directly to these real entry points but is explicitly not the production flow. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) for the design that will eventually close this gap.
