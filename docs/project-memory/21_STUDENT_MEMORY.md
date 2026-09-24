# 21 — Student Memory (what persists, and where)

> Part of the [project memory](00_MASTER_CONTEXT.md). Companion to [20_STUDENT_MODEL.md](20_STUDENT_MODEL.md) — that file covers what the system *knows*; this one covers exactly *where* each fact lives and how long it's meant to last.

## The three kinds of "memory" this system has, and why they're kept separate

1. **Ground-truth history** — `Attempt`/`AttemptEvent` rows. Append-only, immutable once finalized (D-034/D-035: no code path re-opens a finalized attempt, no code path re-writes an existing terminal status to a different one). This is the one thing every derived signal ultimately traces back to.
2. **Point-in-time diagnostic snapshots** — `Autopsy`/`RepairPlan` rows, once persisted. These are NOT re-derived on every read the way mastery is — a `RepairPlan`'s target concept name, pattern family name, taxonomy cell, error category, training mode, and priority are frozen at the moment `buildRepairPlan()` ran, specifically so that a later rename of the underlying Concept/PatternFamily never silently rewrites what a past diagnosis said (D-039 addendum, [24_REPAIR.md](24_REPAIR.md)).
3. **Always-recomputed aggregate state** — `MasteryState`, coverage ladders, Examiner Lens combinations. Never trusted as "memory" in the sense of a cache; always recomputed fresh from the ground-truth history on every read (D-015 and its many extensions).

## Why this distinction matters concretely

If mastery were persisted and read back as memory (rather than recomputed), a bug in an earlier computation, or a later change to `MASTERY_CONSTANTS`, could leave a student's displayed mastery permanently wrong until the next write happened to overwrite it. By never trusting a stored mastery row as authoritative, this failure mode is structurally impossible — the worst case is a slightly-stale-if-cached read, never a silently-wrong one, since the *live* computation from real attempts is always the actual source of truth. This exact reasoning is why the Training Recommendation Composition design (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §9) concluded mastery must be computed fresh from persisted attempts on every recommendation call, never read from `MasteryStateRepository` as if it were memory.

The opposite reasoning applies to `RepairPlan` — it is explicitly memory of a *moment*, not a live query, because "what was diagnosed" is a historical fact about a specific past event, and re-deriving it from current state would silently rewrite history.

## `MasteryStateRepository` exists but is not wired as memory (yet)

`MasteryStateRepository.save()`/`findByStudentAndConcept()` exist in `@ipmat/db`, fully implemented and tested against an in-memory double (D-043) — but **nothing in this codebase calls `save()`**. This means the persisted `mastery_states` table is, as of the current checkpoint, authoritatively empty in any real deployment. Persisting a freshly-computed mastery result as an optional side effect (for a future dashboard read) remains an explicitly undecided question — see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §13 for the exact open item.

## Session-scoped, non-persistent memory (the `apps/web` first slice)

The current first-slice `apps/web` product ([63_DASHBOARD.md](63_DASHBOARD.md) onward) does not use any of the persistence layer above at all — its adapter (`createFixtureTrainingAdapter()`) holds attempt/repair-plan state in an **in-memory JavaScript closure**, scoped to one browser tab's lifetime, resetting on page reload. This is a deliberate, disclosed simplification for a fixture-backed demo, not a claim about how the real product will persist memory — the real Training Recommendation Composition layer is explicitly designed to read from the real `@ipmat/db` repositories instead (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md)).

## What "memory" explicitly excludes

No field anywhere in this "memory" system represents confidence, motivation, emotional state, or predicted future ability (D-005, extended to the Attempt/Autopsy/Mastery evidence contracts explicitly). Student memory is a record of what happened and what was measured — never a model of who the student is as a person.
