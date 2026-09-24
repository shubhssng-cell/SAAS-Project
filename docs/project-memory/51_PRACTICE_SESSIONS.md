# 51 — Practice Sessions (`@ipmat/practice-session`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-060 (read in full). Built as the named prerequisite for Pressure Training (D-059), as **general** infrastructure, not Pressure-Training-specific plumbing.

## What it is

`Enrollment -> PracticeSession -> PracticeBlock -> Attempt`, held **alongside** the pre-existing, entirely unchanged `Enrollment -> Attempt` ordinary-practice path. A student can practice with or without session grouping.

## Lifecycle, mirroring `AttemptStatus`'s exact discipline (D-035)

`active` is the only non-terminal value; `completed`/`abandoned` are equally final. Completion/abandonment is **always** an explicit call, never automatic on reaching a target question count.

## Zero dependencies, by design

`@ipmat/practice-session` has **no** dependency on `@ipmat/practice-block` or `@ipmat/attempt` — a deliberate sibling relationship. Cross-entity checks (e.g. "no active child block" before completing a session) take the fact as a plain caller-supplied boolean, never a cross-package import.

## Ownership

Owned only via `enrollmentId -> Enrollment.studentId` — **no** `PracticeSession.studentId` column exists (redundant ownership columns are explicitly rejected throughout this codebase).

## Persistence — dedicated atomic methods, never a generic `save()`

`PracticeSessionRepository.create()`/`findById()`/`complete()`/`abandon()` — `complete()`/`abandon()` each re-read the session AND re-check "no active child block" **inside one fresh `Serializable` transaction**, reusing the real domain lifecycle functions as the source of truth (the same pattern `decidePublication()` established, D-049).

## The genuinely new bulk-read gap (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md))

`PracticeSessionRepository.findActiveByEnrollmentId(enrollmentId)` does **not exist yet** — it's a named, designed-but-unimplemented method the future Training Recommendation Composition layer needs, since currently the only lookup is `findById()` (requires already knowing the session's id).

See also: [52_PRACTICE_BLOCKS.md](52_PRACTICE_BLOCKS.md), [35_PRESSURE_TRAINING.md](35_PRESSURE_TRAINING.md).
