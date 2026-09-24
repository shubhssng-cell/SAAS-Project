# 52 — Practice Blocks (`@ipmat/practice-block`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-060 (read in full).

## What it is

A block is a sub-grouping of attempts within a `PracticeSession` — the unit Pressure Training's block-level evidence (see [35_PRESSURE_TRAINING.md](35_PRESSURE_TRAINING.md)) is computed over.

## Three independently-derived, non-summing time measures

`deriveBlockWallClockDurationSeconds()` (null while the block is still `active`), `deriveBlockActiveSolvingTimeSeconds()`, `deriveInterAttemptGapsSeconds()` (one entry per finalized-then-next-started consecutive pair — may be shorter than `attemptIdsInOrder.length - 1`, never zero-filled). These are pure functions, zero dependencies, deliberately not summed or reconciled against each other — wall-clock time and active solving time answer genuinely different questions and are never asserted to relate by a formula.

## `AttemptState.blockMembership` — one nullable object, not two nullable fields

`{practiceBlockId, blockSequenceNumber} | null` — making the illegal partial-pair state structurally unrepresentable at the TypeScript level. `@ipmat/attempt`'s own `startAttempt()` is entirely **unchanged** and stays block-unaware; the ONE place a non-null value is ever constructed is `AttemptRepository.save()`'s optional `blockAllocationRequest` parameter.

## Sequence numbers are server-assigned, never inferred from timestamps

`PracticeBlock.sequenceNumber`/`Attempt.blockSequenceNumber` are both `(current max for the parent) + 1`, computed inside a `Serializable`-isolated transaction, backstopped by DB-level `@@unique` constraints.

## The security fix — ownership re-derived from scratch, every time (D-060 addendum)

The original implementation verified a `PracticeBlock`'s existence, active status, and retry inheritance — but **not** that it actually belongs to the same student/enrollment as the attempt being created. Fixed by re-deriving `PracticeBlock -> PracticeSession -> Enrollment -> {id, studentId}` from scratch, **inside the same transaction, on every allocation**, failing closed (`PersistenceError("ownership_mismatch")`) unless both match — proven safe even when the fast, non-authoritative `PracticeBlockReader` pre-check is bypassed entirely. No redundant ownership column was added anywhere; the authoritative chain remains exactly `Attempt -> PracticeBlock -> PracticeSession -> Enrollment -> Student`. See [54_SECURITY_AND_OWNERSHIP.md](54_SECURITY_AND_OWNERSHIP.md).

## Zero dependencies, deliberately not depending on `@ipmat/practice-session` either

Both packages are siblings — neither imports the other.

See also: [35_PRESSURE_TRAINING.md](35_PRESSURE_TRAINING.md), [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §15.
