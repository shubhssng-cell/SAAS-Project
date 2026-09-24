# 12 — Dependency Graph

> Part of the [project memory](00_MASTER_CONTEXT.md). Companion to [11_PACKAGE_ARCHITECTURE.md](11_PACKAGE_ARCHITECTURE.md) — this file is the topological/visual view; that one is the table of exact per-package dependencies.

## Layered view (top depends on bottom; nothing depends upward)

```
apps/web, apps/training-playground                      (consumers only)
        |
@ipmat/practice-loop     [future] training-recommendation composition
        |                              |
        |                    @ipmat/training-orchestration
        |                       /      |        \
        |          repair-selection  training-systems  adaptive-selection
        |                 |          /   |   |   |   \        |
        |                 |    calc-gym speed trap novelty pressure
        |                 |         \    |    |     |      /
        |                 |          (each depends on training-systems + subset of mastery/autopsy)
        |                 |
@ipmat/db  <---------------+---------------------------------------+
   |    \                                                          |
   |     \--- @ipmat/mastery ---------\                            |
   |                                   \-- @ipmat/autopsy --- @ipmat/attempt
   |     /--- @ipmat/practice-session (zero deps)                  |
   |     \--- @ipmat/practice-block (zero deps)                    |
   |     /--- @ipmat/prep-phase (zero deps)                        |
   |     \--- @ipmat/question-engine --- @ipmat/examiner-lens --- @ipmat/concept-graph
   |
@prisma/client

@ipmat/ai   <-------- depended on by question-engine, autopsy, and (via those) most of the tree
   (zero dependency on any domain package -- D-017)
```

## Critical, load-bearing facts this graph encodes

1. **`@ipmat/ai` has zero dependency on any domain package (D-017).** Its Zod schemas restate domain shapes rather than import them — this is what makes the AI trust boundary a fixed, independently-validated contract rather than something that silently drifts if a domain type changes.
2. **`@ipmat/db` depends on domain packages, never the reverse** — this is the single most repeated architectural rule in the whole decisions log (D-043, restated at nearly every subsequent persistence-touching decision).
3. **`@ipmat/db` does NOT depend on `@ipmat/training-orchestration`/`@ipmat/training-systems`/any provider/`@ipmat/repair-selection`/`@ipmat/adaptive-selection`.** This is a real, verified boundary (checked directly, package.json read in full) with a direct consequence for the next architectural unit: a new question-read-model type needed by the future Training Recommendation Composition layer cannot be `TrainingCandidateQuestion` (which lives in `@ipmat/training-orchestration`) — it must be a new, independently-declared type inside `@ipmat/db` itself. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §8.
4. **`@ipmat/training-orchestration` sits ABOVE both `@ipmat/repair-selection` and `@ipmat/adaptive-selection`**, the one deliberate, intentional exception to "siblings don't depend on each other" (D-052) — it coordinates, it does not merge.
5. **`@ipmat/training-systems` sits BELOW `@ipmat/training-orchestration`**, not the reverse — the shared contract doesn't know about the orchestrator that will eventually consume providers built against it (D-053).
6. **Every one of the five concrete training-system providers is a peer, never depending on a sibling provider.** Each independently reimplements its own local exposure-counting helper (`computeLocalExposureCounts()`) rather than sharing one, by design — a provider must never accidentally couple its correctness to another provider's internals.
7. **`@ipmat/trap-lab` and `@ipmat/novelty-training` are the two "lightest" providers** — neither depends on `@ipmat/mastery` (Trap Lab's recurrence gate is a discrete count, not a statistical-reliability floor; Novelty Training's exposure gate reuses `MASTERY_CONSTANTS` only, not a full dependency need — actually verify: Novelty Training DOES depend on `@ipmat/mastery` per D-058's own decision text, for `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT`; Trap Lab is the one that skips `@ipmat/mastery` entirely, per D-056).
8. **`@ipmat/practice-session` and `@ipmat/practice-block` are deliberate zero-dependency siblings** — neither depends on the other, neither depends on `@ipmat/attempt`, by design (D-060) — cross-entity checks take the relevant fact as a caller-supplied boolean rather than importing across the boundary.
9. **`@ipmat/pressure-training` does NOT depend on `@ipmat/practice-block`/`@ipmat/practice-session`** even though it consumes block-grouped evidence — that evidence arrives only as `@ipmat/training-systems`' own restated, primitive `TrainingPracticeBlockContext` shape (D-061). This is the same "restate at the boundary, don't import across it" pattern used throughout the whole training-systems layer.
10. **`@ipmat/practice-loop` depends on `@ipmat/attempt` + `@ipmat/db`, never `@ipmat/question-engine` directly** — it consumes only `@ipmat/db`'s own restated `CanonicalQuestion`/`ValidationState` types (D-048).

## New dependency edges the next architectural unit will introduce

The (not-yet-implemented) Training Recommendation Composition package is designed to depend on: `@ipmat/db`, `@ipmat/training-orchestration`, `@ipmat/mastery` (called directly — training-orchestration never re-exports `computeMasteryState()` itself), `@ipmat/attempt` (for `toMasteryContribution()`), `@ipmat/practice-session`, `@ipmat/practice-block`, `@ipmat/question-engine`. This is a **new top-level package**, not a domain package, for the same reason `@ipmat/practice-loop` isn't one — it depends on persistence ports. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) for the complete, implementation-ready dependency specification.

## `npm install` history note

Every time a new workspace package was added and resolved by name for the first time by a sibling, `npm install` was required to link it and `package-lock.json` reflects the change (noted explicitly in D-052, D-053, D-054, D-055, D-056's own consequences sections, and again for `apps/web` in this session's own work).
