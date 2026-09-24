# 54 — Security and Ownership

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-048, D-060 (full addendum), and the D-039 addendum's own security/trust section (this session).

## The one rule, restated at every layer

**Ownership is always re-derived from the authoritative chain, never trusted from a caller's claim, and never a redundant stored ownership column.** Every security fix in this project's history is an instance of this same rule being applied one level deeper than it was before.

## The authoritative ownership chain

```
Attempt -> PracticeBlock -> PracticeSession -> Enrollment -> Student
```

No entity in this chain stores a shortcut/redundant ownership field pointing further up the chain than its immediate parent — `PracticeBlock` has no `studentId` column, `PracticeSession` has no `studentId` column, `Attempt` has no `practiceSessionId` column (only `practiceBlockId`, from which the session is derivable via one more hop). This was an explicit, considered design choice (D-060), not an oversight.

## Genuine security findings in this project's actual history (not hypothetical)

### 1. `QuestionReader` (D-048) — the practice-loop authority gap

The original `PracticeLoopService.startAttempt()`/`submitAttempt()` accepted a caller-supplied `PracticeQuestion` object carrying `correctAnswer`, `options`, `expectedTimeSeconds`, and `validationState` directly. An untrusted HTTP/UI caller could have: graded its own answer correct, claimed any question was published, or substituted a different question's answer data at submit time (since `submitAttempt()`'s identity check only compared the `questionId` string). Fixed by injecting a `QuestionReader` port that resolves the canonical question server-side, by id — the client-facing input shrank to `questionId: string` on start, and no question-related parameter at all on submit (resolved via the already-persisted `questionId` on the attempt row being submitted against).

### 2. `PracticeBlock` ownership (D-060 addendum) — the block-allocation authority gap

`AttemptRepository.save()`'s block-allocation path originally verified a block's existence, active status, and retry inheritance — but not that it actually belongs to the same student/enrollment as the attempt being created. Fixed by re-deriving the full chain from scratch, inside the same transaction, on **every** allocation, regardless of whether a faster, non-authoritative pre-check already ran.

### 3. RepairPlan confirmation truth (D-039 addendum, this session) — the "timestamp presence ≠ confirmation" trap

While designing the read contract for confirmed, active RepairPlans, this session's own analysis found that `isConfirmedForOrchestration()` (in `@ipmat/training-orchestration`) gates eligibility on `Boolean(context.plan.confirmationSource?.hypothesisConfirmedAt)` — truthiness of a timestamp, not a dedicated confirmation boolean. Crucially, `hypothesis.respondedAt` is set for **rejected and corrected** responses too, not only confirmed ones — meaning a naive read-side reconstruction that populated `confirmedAt` from any non-null `respondedAt` (regardless of the actual `confirmed` boolean) could make a *rejected* hypothesis's RepairPlan look eligible. The read contract was specified, and tested, to require `Autopsy.confirmed === true` **as the join condition itself**, never inferred from timestamp presence alone — see [24_REPAIR.md](24_REPAIR.md) and the explicit test case ("confirmedAt presence alone never makes a plan eligible without confirmed also being true") in this session's own implementation.

## The general "never trust a value merely typed as X" discipline

Repeated explicitly across many decisions (D-043, D-044, D-046): TypeScript's structural typing cannot stop a caller from constructing a `RepairPlan`-shaped or `AttemptState`-shaped object some other way, bypassing whatever gate the real constructor function enforces. Every persistence boundary re-verifies the same invariant a second time (e.g. `assertRepairPlanConfirmed()` exists **both** inside `@ipmat/repair-selection` and inside `@ipmat/db`'s own validation layer) — defense-in-depth, not a claim that the domain layer's own guarantee is insufficient.

## The Training Recommendation Composition layer's own ownership rule (designed, not yet implemented)

Exactly one authoritative check, first, before any other read: `enrollment.studentId === callerStudentId`. Every subsequent read is scoped by `studentId` directly or by an id derived from the already-verified `enrollment` — never a caller-supplied id taken on faith beyond that one check. No transaction is needed for this (a single read has no multi-statement race to protect against) — see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §10–11 for the full reasoning.

## What must never happen, going forward

A cross-student RepairPlan, Attempt, Block, or Session must never enter a composed context. A confirmation-adjacent fact (a timestamp, a workflow status) must never substitute for the one actual confirmation boolean. A fast, non-authoritative pre-check must never be treated as sufficient on its own — the authoritative check always runs again, inside the same transaction as the write (or, for a read-only composition, as the very first read).
