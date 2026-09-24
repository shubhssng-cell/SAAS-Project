# 50 — Attempts (`@ipmat/attempt`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-010, D-034, D-035, D-046 (read in full).

## The state machine

`in_progress → submitted | skipped | abandoned` — `in_progress` is the **only** non-terminal state. All three terminal states are equally final (D-035): no code path re-opens a finalized attempt, and re-persisting a different terminal status than the one already recorded is rejected (`already_finalized`) — an idempotent resave of the *same* terminal status is allowed.

## Structurally, not just behaviorally, forgery-immune (D-034)

`submitAttempt()`'s signature has **no parameter** through which a caller could pass `isCorrect` or a duration:
- `chosenAnswer` — derived from the LAST `answer_selected`/`answer_changed` event already recorded.
- `isCorrect` — computed fresh by comparing `chosenAnswer` to the authoritative `AttemptQuestionContext.correctAnswer` the caller supplies (itself resolved server-side by `@ipmat/practice-loop`'s `QuestionReader`, never client input — D-048).
- `timeSpentSeconds` — always `finalizedAt - startedAt`, using timestamps the domain layer validates for coherence.

`question_skipped`/`answer_submitted` are excluded from `RecordableAttemptEventInput` at the **type** level — only `submitAttempt()`/`skipAttempt()` can ever append them, as part of the same operation that transitions status.

## `AttemptEvent` is the source of truth for timing (D-010)

A single, generic, append-only event log (`event_type` + `payload: jsonb` + `occurred_at`). `Attempt`'s own timestamp/count columns are denormalizations derived from it. A new timing question (hint timing, retry timing, time-between-actions) is always a new `event_type`, never a new column.

Canonical vocabulary: `question_opened, answer_selected, answer_changed, hint_opened, solution_opened, question_skipped, working_input_changed (reserved), reasoning_submitted (reserved), answer_submitted`.

## Answer-change history — derived, never stored (D-035)

`deriveAnswerChangeHistory()` (initial/final answer, change count, full sequence) is computed on every read from the event log — same "derive, don't cache" discipline as mastery/coverage.

## The two contract projections — the seam to Autopsy and Mastery

- `toAutopsyEvidence()` — observable evidence only, structurally cannot express confidence/motivation/emotion.
- `toMasteryContribution()` — per-attempt facts only, no mastery score computed here.

## The Prisma persistence layer — the first genuine multi-write transaction (D-046)

`PrismaAttemptRepository.save()` upserts the `attempts` row, deletes existing `attempt_events`, recreates them from `state.events` — wrapped in a `Serializable` interactive transaction (an addendum fix: the original plain-transaction version had a genuine TOCTOU race on the preflight ownership/finalization read). Events always persist in `@ipmat/attempt`'s own canonical order (`getEventTimeline()`), never the caller's raw array order. Ownership (`studentId`/`questionId`/`enrollmentId`/`retryOfAttemptId`) and finalization invariants are re-checked a **second** time at this boundary — the domain layer's own guarantees can't reach across a separate, earlier `save()` call.

## Retries

`retryOfAttemptId` — a new `Attempt` row, not a counter increment, so each retry carries its own real `startedAt`/`submittedAt`.

## Current, honest status

`PrismaAttemptRepository` has never executed against a live database. No student-facing UI is wired to it via a real database (the `apps/web` first slice, [63_DASHBOARD.md](63_DASHBOARD.md) onward, calls the real domain functions directly against in-memory, fixture-backed session state — never through this repository).

See also: [51_PRACTICE_SESSIONS.md](51_PRACTICE_SESSIONS.md), [52_PRACTICE_BLOCKS.md](52_PRACTICE_BLOCKS.md), [53_PERSISTENCE.md](53_PERSISTENCE.md).
