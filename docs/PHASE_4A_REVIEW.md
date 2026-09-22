# Phase 4A Review — Student Attempt Intelligence

**Scope:** make the platform correctly capture and finalize a student's question attempt. A new, database-free domain package (`@ipmat/attempt`), an `Attempt`/`AttemptEvent` schema update (migration `0003_attempt_lifecycle`), and contract-only projections for the Autopsy and Mastery systems Phase 5 will build. No live database (none has ever been reachable in this environment), no real AI provider call, no question-batch generation, no student-facing UI. See [DECISIONS.md](DECISIONS.md) D-034 and D-035 for the individual decision records this report summarizes.

**Headline result:** the full attempt lifecycle state machine is implemented, structurally resistant to client-forged correctness/timing, and tested against every scenario the phase brief named. 192 tests pass (up from 146; +46 new), typecheck/lint/build are clean across all 8 workspaces (a new one, `@ipmat/attempt`, added this phase). The migration is generated and validated the same way Phase 2's was — via a schema-datamodel diff, needing no live or shadow database — but, like every prior migration in this repository, has not been applied to a real database, because none has ever been reachable.

---

## 1. Implementation summary

| Area | What was built |
|---|---|
| Schema | `AttemptStatus` enum + `attempts.status`/`attempts.finalized_at`; `AttemptEventType` renamed to a canonical vocabulary + new `question_skipped` value; migration `0003_attempt_lifecycle` |
| Domain package | New `packages/domain/attempt` (`@ipmat/attempt`) — pure, database-free, mirrors the `prep-phase`/`validation` package conventions |
| Lifecycle | `startAttempt()`, `recordAttemptEvent()`, `submitAttempt()`, `skipAttempt()`, `finalizeAttempt()` — a single shared internal finalization funnel (`applyFinalization()`) underneath all three terminal transitions |
| Answer-change tracking | `deriveAnswerChangeHistory()` — a derived view, not a stored column |
| Event reconstruction | `getEventTimeline()` |
| Autopsy contract | `AttemptAutopsyEvidence` + `toAutopsyEvidence()` |
| Mastery contract | `AttemptMasteryContribution` + `toMasteryContribution()` |
| Tests | 46 new tests across 5 files, covering every scenario named in the phase brief plus additional invariant coverage found while implementing |

---

## 2. Exact files and functions

**New package:** `packages/domain/attempt/` (`package.json`, `tsconfig.json` mirror `@ipmat/prep-phase`'s exactly).

- **`src/types.ts`** — `AttemptStatus`, `AttemptEventType` (the full, stored vocabulary), `RecordableAttemptEventInput` (the narrower type `recordAttemptEvent()` accepts — excludes `question_skipped`/`answer_submitted`/`working_input_changed`/`reasoning_submitted`), `AttemptEventRecord`, `AttemptState`, `AttemptQuestionContext`, `AttemptLifecycleError` (+ its `AttemptLifecycleErrorCode` union).
- **`src/lifecycle.ts`** — `startAttempt()`, `recordAttemptEvent()`, `submitAttempt()`, `skipAttempt()`, `finalizeAttempt()`, plus internal (unexported) helpers: `parseTimestampMs()`, `assertTimestampIsCoherent()`, `assertOwnership()`, `assertExists()`, `assertInProgress()`, `validateEventPayload()`, `applyFinalization()`, `appendInternalEvent()`. Also exports `deriveFinalAnswerFromEvents()` (used internally by `submitAttempt()` and reused by `answerHistory.ts`).
- **`src/answerHistory.ts`** — `AnswerChangePoint`, `AnswerChangeHistory`, `deriveAnswerChangeHistory()`.
- **`src/timeline.ts`** — `getEventTimeline()`.
- **`src/autopsyContract.ts`** — `AttemptAutopsyEvidence`, `toAutopsyEvidence()`.
- **`src/masteryContract.ts`** — `AttemptMasteryContribution`, `toMasteryContribution()`.
- **`src/index.ts`** — barrel export.
- **`fixtures/questionContext.ts`** — deterministic `AttemptQuestionContext` fixtures (`mcqQuestionContext`, `numericEntryQuestionContext`, `otherQuestionContext`) and shared IDs.

**Modified:** `packages/db/prisma/schema.prisma` (`AttemptStatus` enum; `Attempt.status`/`Attempt.finalizedAt`; `AttemptEventType` renamed/extended); new `packages/db/prisma/migrations/0003_attempt_lifecycle/migration.sql`.

**Test files (all new):** `test/lifecycle.test.ts` (29 tests — the bulk of the required scenarios), `test/answerHistory.test.ts` (4), `test/autopsyContract.test.ts` (7), `test/masteryContract.test.ts` (4), `test/timeline.test.ts` (2).

---

## 3. The state machine

```
                 startAttempt()
                       |
                       v
                 in_progress  <───── recordAttemptEvent() (loops back to itself)
                  /    |    \
   submitAttempt()  skipAttempt()  finalizeAttempt(outcome: "abandoned")
        |               |               |
        v               v               v
    submitted        skipped        abandoned
```

**`in_progress` is the only non-terminal state.** All three terminal states (`submitted`, `skipped`, `abandoned`) are reached exactly once and are equally final — nothing in this package transitions a finalized attempt back to `in_progress`, or from one terminal state to another (docs/DECISIONS.md D-034). This is enforced by one shared internal function, `applyFinalization()`, which every public terminal transition funnels through and which throws `already_finalized` if `attempt.status !== "in_progress"` — there is exactly one place in the codebase this check lives, not three copies that could drift.

**Skip is deliberately modeled as fully terminal** (docs/DECISIONS.md D-035) — the phase brief explicitly left "is submit-after-skip allowed?" open ("submit after skip if allowed by the model"), and this model does not allow it: `submitAttempt()` on an already-skipped attempt throws `already_finalized`, tested directly (§8, test 7). This was the simplest, safest choice consistent with "prevent invalid transitions," with no stated product requirement pulling the other way.

**`finalizeAttempt()` is deliberately narrower than `submitAttempt()`/`skipAttempt()`**, not a third way to reach the same two outcomes: its exported signature only accepts `outcome: "abandoned"`, and — since an abandoned attempt has no answer to grade by construction — there is no parameter on it through which a caller could supply `chosenAnswer`/`isCorrect` either. `submitAttempt()`/`skipAttempt()` call the shared `applyFinalization()` directly, not `finalizeAttempt()` — so there is no public path that reaches `status: "submitted"` while bypassing `submitAttempt()`'s answer-derivation and validation logic. `finalizeAttempt()` exists as its own top-level function specifically to give a future session/timeout job a way to close out a stalled `in_progress` attempt (that trigger is not built this phase — this phase defines the state and the function that sets it).

---

## 4. The event model

**Canonical vocabulary** (docs/DECISIONS.md D-034), stored on `AttemptEvent.event_type`:

| Event | Meaning | Caller-recordable via `recordAttemptEvent()`? |
|---|---|---|
| `question_opened` | The student opened/viewed the question | Yes |
| `answer_selected` | The student picked an answer (first pick) | Yes — requires a non-empty `selectedAnswer` |
| `answer_changed` | The student changed a previously-picked answer | Yes — requires a non-empty `selectedAnswer` |
| `hint_opened` | The student opened a hint | Yes — optional `hintIndex` |
| `solution_opened` | The student viewed the solution | Yes |
| `question_skipped` | The student skipped the question | **No** — only `skipAttempt()` appends this |
| `answer_submitted` | The final answer was submitted | **No** — only `submitAttempt()` appends this |
| `working_input_changed` | Reserved for Phase 5 (scratch input) | No — out of scope this phase |
| `reasoning_submitted` | Reserved for Phase 5 (student's stated reasoning) | No — out of scope this phase |

**Why two of these are excluded from caller input, structurally, not by convention:** `RecordableAttemptEventInput` is a distinct, narrower type than `AttemptEventType` — `question_skipped` and `answer_submitted` are not members of the union `recordAttemptEvent()` accepts. This means a caller cannot fire a "submit" or "skip" event through the generic event-recording path while bypassing the actual state transition (and its validation — deriving/checking the final answer, computing time-taken) that's supposed to accompany it. It's the same "make it a type error, not a discipline" pattern this codebase already uses for the AI pipeline's leakage boundary (`PresentedQuestionView`/`JudgeView`, docs/DECISIONS.md D-020).

**Every event type names an observable action, never an inferred state.** There is no event type, and no payload field on any event type, anywhere in this vocabulary that represents confidence, motivation, engagement, or any other mental/emotional state (Phase 4A §2, docs/DECISIONS.md D-005).

**Reconstructing a timeline:** events are appended in call order and are timestamp-monotonic by construction (`recordAttemptEvent()`/the finalization functions reject any event or finalization whose timestamp precedes the previous one). `getEventTimeline()` provides an explicit, defensively-sorted accessor rather than relying on callers to trust array order directly.

---

## 5. Important invariants

Quoting the actual enforcement, not just describing it:

**Cannot append events to a finalized attempt** (`lifecycle.ts`):
```ts
function assertInProgress(attempt: AttemptState, action: string): void {
  if (attempt.status !== "in_progress") {
    throw new AttemptLifecycleError(
      "already_finalized",
      `Cannot ${action}: attempt is already "${attempt.status}", not "in_progress"`
    );
  }
}
```
Called at the top of `recordAttemptEvent()`, `submitAttempt()`, `skipAttempt()`, and (via `applyFinalization()`) `finalizeAttempt()`.

**Timestamps must be coherent** — a new timestamp can never precede `startedAt` or the most recently recorded event:
```ts
function assertTimestampIsCoherent(attempt: AttemptState, candidate: string, whatFor: string): number {
  const candidateMs = parseTimestampMs(candidate, whatFor);
  const startedMs = parseTimestampMs(attempt.startedAt, "attempt.startedAt");
  if (candidateMs < startedMs) { throw new AttemptLifecycleError("impossible_timestamp", /* ... */); }
  const lastMs = lastEventTimestampMs(attempt);
  if (lastMs !== null && candidateMs < lastMs) { throw new AttemptLifecycleError("impossible_timestamp", /* ... */); }
  return candidateMs;
}
```
This is also where an entirely unparseable timestamp string is caught (`parseTimestampMs` throws if `Date.parse` returns `NaN`).

**Correctness is never client-supplied** — `submitAttempt()`'s signature:
```ts
export function submitAttempt(
  attempt: AttemptState | null | undefined,
  claim: AttemptOwnershipClaim,
  question: AttemptQuestionContext,
  input: { now: string }
): AttemptState
```
There is no `isCorrect` or `chosenAnswer` parameter anywhere in that signature. Inside, `chosenAnswer` is derived by `deriveFinalAnswerFromEvents(attempt)` (reading the LAST `answer_selected`/`answer_changed` event already on the attempt) and `isCorrect` is computed as `finalAnswer.trim() === question.correctAnswer.trim()` — both values a caller could only influence by recording real, timestamp-coherent events beforehand or by supplying a different (but still authoritative-shaped) `question` argument, never by asserting a result directly.

**Time-taken is never client-supplied** — no function anywhere in this package accepts a duration parameter. `timeSpentSeconds` is computed once, inside `applyFinalization()`, as `Math.round((finalizedMs - startedMs) / 1000)`, from `attempt.startedAt` (set once, at `startAttempt()`) and the finalization's own validated `now`.

**Fail closed on a malformed event payload:**
```ts
case "answer_selected":
case "answer_changed": {
  if (typeof event.selectedAnswer !== "string" || event.selectedAnswer.trim().length === 0) {
    throw new AttemptLifecycleError("malformed_event_payload", /* ... */);
  }
  return { selectedAnswer: event.selectedAnswer };
}
```

**Ownership is checked on every operation**, not just at attempt-creation time:
```ts
function assertOwnership(attempt: AttemptState, claim: AttemptOwnershipClaim): void {
  if (attempt.studentId !== claim.studentId || attempt.questionId !== claim.questionId) {
    throw new AttemptLifecycleError("ownership_mismatch", /* ... */);
  }
}
```
`submitAttempt()` additionally checks that the supplied `AttemptQuestionContext.questionId` matches the attempt's own `questionId` — a caller cannot grade against the wrong question's answer key even if the ownership claim itself is correct.

---

## 6. Tests

**Old test count:** 146 (end of Phase 3.1.1).
**New test count:** 192 (+46).

| File | Tests | Covers |
|---|---|---|
| `test/lifecycle.test.ts` | 29 | Scenarios 1–15 from the phase brief, plus malformed-payload and nonexistent-attempt guards |
| `test/answerHistory.test.ts` | 4 | A→C→B→D reconstruction, single-selection, never-selected, submission not counted as an extra change |
| `test/autopsyContract.test.ts` | 7 | Full evidence assembly, skip distinctness, solution-before-finalization (both true and null cases), in-progress refusal, question-mismatch refusal, and a structural check that no confidence/motivation/emotion key exists on the evidence object |
| `test/masteryContract.test.ts` | 4 | Per-attempt facts, skip distinctness (`isCorrect: null`, not `false`), in-progress refusal, and a structural check that no mastery-score field (`accuracy`, `speedRatio`, etc.) exists on the contribution object |
| `test/timeline.test.ts` | 2 | Chronological reconstruction, non-mutation of the source array |

**Mapping to the 15 required scenarios** (§8 of the phase brief): all 15 have a direct test in `lifecycle.test.ts`, explicitly labeled by number in the `describe` blocks — normal correct attempt (1), normal incorrect attempt (2), multi-change answer A→C→B→D (3), hint opened (4), solution opened, first-wins on repeat (5), skipped question distinguishable from submit/abandon (6), submit-after-skip rejected (7 — this model's chosen answer to "if allowed"), duplicate submission on the returned finalized state (8), event after finalization for both submitted and skipped attempts (9), four distinct invalid-timestamp cases (10), forged-correctness resistance proven both by signature and by a legitimate-vs-illegitimate comparison (11), forged-timeTaken resistance for both submit and skip (12), invalid MCQ option rejected / numeric-entry has no option check (13), cross-student and cross-question ownership mismatches (14), full chronological event-ordering reconstruction (15).

**Failures fixed:** none — this was greenfield implementation, not a bug-fix pass. No existing test was touched or broken; the pre-existing 146 tests are unchanged and still pass.

**Deliberately untestable behavior:** "cannot submit a nonexistent attempt" is tested here only as a null/undefined guard at the pure-domain layer (`submitAttempt(null, ...)` throws `attempt_not_found`) — a real "this attempt ID does not exist in the database" case cannot be tested without a persistence adapter and a live/mocked database, neither of which exists this phase (see §7). This is stated plainly rather than padded with a test that would only prove the guard clause exists, not that it correctly represents a real not-found condition.

---

## 7. Remaining limitations

- **No persistence adapter.** `@ipmat/attempt` is pure and database-free by design (docs/DECISIONS.md D-034) — a future Prisma-backed layer must load an `AttemptState` from `attempts`/`attempt_events` rows before calling into this package, and persist the returned state afterward. That layer is Phase 4B's job, not built here. Consequently, "cannot submit a nonexistent attempt" is only a null-check today, not a real database lookup (see §6).
- **No live database.** Like every prior phase, migration `0003_attempt_lifecycle` has been generated and validated (via schema-datamodel diff, no shadow database needed — see the migration's own header) but never applied to a live Postgres instance, because none has ever been reachable in this environment.
- **The event-payload validation is intentionally shallow.** `answer_selected`/`answer_changed` require a non-empty string — there's no format validation against the actual question's answer shape (that happens later, in `submitAttempt()`'s options-membership check for `multiple_choice`, and not at all for `numeric_entry` beyond "is a non-empty string"). This mirrors Phase 3.1.1's own deliberate restraint about not over-engineering answer-format validation.
- **`finalizeAttempt("abandoned")` has no trigger.** This phase defines the state and the function that sets it; nothing calls it yet. A real abandonment policy (how long is "too long" before an `in_progress` attempt is considered abandoned) is a product/ops decision for whichever phase builds the trigger — likely Phase 4B or later, once there's a live session to time out.
- **No concurrency/idempotency handling beyond immutability.** Because every function is pure and returns a new object, "duplicate submission" protection depends on the caller correctly using the returned, updated state for the next call (documented in D-034/§6's test note) — a real persistence adapter with row-level locking or optimistic concurrency control is what would make this airtight against a genuine race (e.g. two simultaneous submit requests for the same attempt), and that's explicitly Phase 4B's concern, not addressed here.
- **`AttemptQuestionContext` is entirely caller-supplied and unverified by this package.** This package trusts whatever question data it's given — it has no way to independently confirm the `correctAnswer`/`options` it's handed are actually the real, current values for that question (that's the persistence adapter's job, reading from the `questions` table). This is analogous to, but a different trust boundary from, the AI-generation pipeline's independent verification (Phase 3/3.1) — there, the concern is an untrusted LLM's claim; here, the concern would be a caller passing stale or wrong question data, which is a integration-correctness question for Phase 4B, not something this domain layer can self-defend against.

---

## 8. What Phase 4B should build next

1. **A Prisma-backed persistence adapter** around `@ipmat/attempt` — load `AttemptState` from `attempts`/`attempt_events`, persist the result of each lifecycle call, and turn "attempt not found" into a real database-backed check.
2. **The bare practice UI** (serve a question, call `startAttempt`/`recordAttemptEvent`/`submitAttempt`/`skipAttempt` through the new adapter, show correct/incorrect + the solution) — no mastery, no autopsy yet, per docs/MASTER_PLAN.md Phase 4B.
3. **A real session/timeout trigger for `finalizeAttempt("abandoned")`**, once there's an actual live session to observe timing out.
4. **Concurrency handling** in the persistence adapter (optimistic concurrency or row locking) so "duplicate submission" is airtight against genuine races, not just against a caller correctly using the returned state.
5. Continue to depend on Phase 3.5 (real published questions) before this is a meaningful loop — Phase 4A did not change that dependency, only added a sibling piece of work that didn't need to wait for it.

Nothing above was started as part of this phase. No question batch was generated, no student-facing UI was built, no real AI provider was called. Stopping here — not proceeding to Phase 4B automatically.
