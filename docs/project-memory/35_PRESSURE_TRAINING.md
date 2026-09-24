# 35 — Pressure Training (`@ipmat/pressure-training`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-059, D-060, D-061 (read in full). Fifth concrete `TrainingSystemProvider` (Phase 5G).

## The full arc — deferred, then unblocked, then built

**D-059 (originally deferred):** a full design review concluded NOT to implement, because no `sessionId`/`practiceBlockId`, no persisted attempt-sequence-membership construct, no cumulative block-level time budget existed anywhere in the schema. `finalizedAt` alone cannot safely define an intentional training sequence — timestamp adjacency doesn't distinguish a genuine sustained block from two unrelated attempts that merely happen to be chronologically adjacent. `testingModes.includes("time_pressured")` (the one pressure-adjacent signal that WAS safely available) was already owned by Speed Lab's `time_constrained` stage. Implementing Pressure Training then would have either duplicated Speed Lab or invented unsupported session semantics — both rejected. The named prerequisite: a general Practice Session/Block abstraction, designed as general infrastructure (also needed for a future Mock system), not Pressure-Training-specific plumbing.

**D-060 (the prerequisite, built):** `@ipmat/practice-session` + `@ipmat/practice-block` — see [51_PRACTICE_SESSIONS.md](51_PRACTICE_SESSIONS.md)/[52_PRACTICE_BLOCKS.md](52_PRACTICE_BLOCKS.md).

**D-061 (built, this phase):** the fifth concrete `TrainingSystemProvider`, genuinely block-level sustained-sequence evidence.

## The three block-level signals, structurally distinct from Speed Lab

1. **Reduced recovery** — a short median inter-attempt gap within a block (`SHORT_RECOVERY_GAP_SECONDS = 5`).
2. **Within-block degradation** — second-half accuracy meaningfully below first-half accuracy across a block's sequence (`DEGRADATION_ACCURACY_DROP_THRESHOLD = 0.4`, a 40-percentage-point drop).
3. **Budget consumption** — active solving time at or beyond a block's configured time budget.

**`evaluate()` is unconditionally `not_applicable: insufficient_evidence` whenever `context.practiceBlocks` is absent/empty**, regardless of how much single-question, Speed-Lab-shaped evidence exists elsewhere — the two providers are **structurally incapable** of firing off the same evidence, not merely tested to avoid it.

## The resolved contract gap

`TrainingSystemContext` had no way to carry block-grouped evidence at all before this decision. Fixed by adding **one** new, optional, deliberately generic field, `practiceBlocks?: TrainingPracticeBlockContext[]` (purely primitive, no import of `@ipmat/practice-block`/`@ipmat/db`) — **not** by extending `@ipmat/mastery`'s `MasteryAttemptRecord`/`AttemptMasteryContribution`, which would have blurred mastery's own "attempts + question DNA + time" input boundary and touched three packages instead of one. See [30_TRAINING_SYSTEMS.md](30_TRAINING_SYSTEMS.md).

## Both new constants are explicitly disclosed as uncalibrated

No live attempt-timing telemetry has ever existed in this environment. `SHORT_RECOVERY_GAP_SECONDS`/`DEGRADATION_ACCURACY_DROP_THRESHOLD` are provisional policy, same as every other threshold in this codebase.

## The self-inflicted epistemic bug, and its fix

Pressure Training's own generated `notes` string originally included: "This reflects observed sequence-level behavior, not a measured psychological state" — the word "psycholog" tripped its own `/psycholog/i` forbidden-pattern regression test (the same discipline established for Trap Lab). Fixed by moving the disclaimer from the runtime string entirely into a source doc comment, matching Novelty Training's own established "regression test scans runtime text, not doc-comment prose" precedent.

## Dependency footprint

`@ipmat/training-systems` + `@ipmat/mastery`. **Never** `@ipmat/practice-block`/`@ipmat/practice-session` directly — block evidence arrives only as the restated primitive `TrainingPracticeBlockContext` shape.

## Current, honest status

**No caller anywhere assembles a real `TrainingSystemContext.practiceBlocks` from persisted `PracticeSession`/`PracticeBlock` data.** Pressure Training is therefore *always* `insufficient_evidence` against any real flow today — the exact gap the future Training Recommendation Composition layer is designed to close. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §15.
