# 20 — The Computational Learner Model

> Part of the [project memory](00_MASTER_CONTEXT.md). Synthesized from `docs/PRODUCT_SPEC.md`, `docs/DATABASE.md`, `docs/DECISIONS.md` D-005/D-006/D-009/D-034/D-035/D-040/D-041, and the direct architecture-review work this session did for the Training Recommendation Composition layer. This is the most synthesized file in this memory system — cross-check specific claims against [23_AUTOPSY.md](23_AUTOPSY.md)/[25_MASTERY.md](25_MASTERY.md) for verbatim sourcing.

## What the system knows about a student (persistent identity, minimal)

`Student { id, authRef, createdAt }` and `Enrollment { id, studentId, examId, enrolledAt }` — Phase 1 foundation tables. `authRef` is nullable/placeholder until real auth exists (D-004, still open). This is deliberately minimal: no profile, no self-reported data, no preferences.

## What the system observes (raw, per-attempt facts)

Every `AttemptEvent` — `question_opened`, `answer_selected`, `answer_changed`, `hint_opened`, `solution_opened`, `question_skipped`, `answer_submitted`, plus reserved `working_input_changed`/`reasoning_submitted` — is a real, timestamped, observable action. `@ipmat/attempt`'s `toAutopsyEvidence()` projects a finalized attempt into `AttemptAutopsyEvidence`: final answer, correctness, time taken, hint count, solution-opened timing, the full answer-change sequence. **None of this is inferred — every field is either a stored value or a direct computation from the event log** (e.g. `timeSpentSeconds = finalizedAt - startedAt`, never a client-supplied duration).

## What the system measures (derived, deterministic, from observation)

`@ipmat/autopsy`'s `deriveBehaviorSignals()` turns raw observation into named booleans: `correctFast`/`correctSlow`/`incorrectFast`/`incorrectSlow` (against centralized `AUTOPSY_THRESHOLDS`), `answerChanged`/`multipleAnswerChanges`, `hintUsed`, `solutionOpened`, `timeAboveExpected`/`timeBelowExpected`. `deriveHistoricalSignals()` measures repetition — has this exact taxonomy cell, pattern family, or concept failed before, how many times, on which attempt ids. `@ipmat/mastery`'s `computeMasteryState()` measures accuracy, speed ratio, novelty-handling, pressure-performance, pattern-coverage — each independently, never blended (see [25_MASTERY.md](25_MASTERY.md)).

## What the system infers (candidate-level, never confirmed)

`deriveCandidateErrorEvidence()` pattern-matches an incorrect answer against the question's own designed trap code — a **candidate** error category, explicitly and structurally distinct from a confirmed one (`CandidateErrorEvidence` has no `confirmed` field anywhere, and always carries a mandatory `qualification` string stating it is not a confirmed diagnosis). This is still deterministic, not an AI call.

## What the system hypothesizes (the one place an AI model's own judgment enters)

`generateHypothesis()` — the 5th `@ipmat/ai` task — proposes ONE natural-language explanation for why a submitted answer was incorrect, from the deterministic `AutopsyOutput` above (never raw `Attempt`/`AttemptEvent` rows directly). It is schema-validated, untrusted, and **always** created with `confirmationStatus: "awaiting_confirmation"`. See [23_AUTOPSY.md](23_AUTOPSY.md).

## What the student confirms (the only path to "confirmed diagnosis")

`applyConfirmationResponse()` — confirmed / rejected / corrected. Only "confirmed" can produce a `RepairPlan` (`buildRepairPlan()` refuses on anything else, including "corrected" — a free-text correction has no structured category to target without another, unbuilt diagnosis pass). This is the **one and only** mechanism by which a hypothesis becomes something the system is willing to act on.

## What remains permanently unknown (by design, not by gap)

- **How the student feels** — confidence, anxiety, motivation, intent. No field anywhere represents this (D-005), except `modelConfidence`, which is explicitly the AI model's own confidence in one hypothesis, never the student's.
- **Whether an unconfirmed candidate error is actually what happened** — until confirmed, it stays a candidate, forever, if the student never responds.
- **A single blended "mastery score."** The system deliberately does not compute one — see [25_MASTERY.md](25_MASTERY.md).

## The distinction between persistent memory, current state, historical facts, derived evidence, diagnosis, and recommendation

| Layer | Example | Stored, or computed fresh? |
|---|---|---|
| Persistent identity | `Student`, `Enrollment` | Stored |
| Historical facts | `Attempt`, `AttemptEvent` rows | Stored, append-only, immutable once finalized |
| Derived evidence | `BehaviorSignals`, `HistoricalSignals`, mastery measures | **Computed fresh on every read**, never cached (D-015 discipline, extended repeatedly) |
| Confirmed diagnosis | `RepairPlan` (post-confirmation) | Stored as a historical **snapshot** of what was diagnosed at that moment (D-039 addendum — the target concept/pattern-family/taxonomy-cell/error-category/mode/priority are frozen at confirmation time, never re-derived from current Concept/PatternFamily names later) |
| Recommendation | `TrainingOrchestrationResult` | **Computed fresh, per call** — never stored, never a queued/scheduled recommendation |

## Worked example — the full chain for one wrong answer

1. Student answers `q-reverse-1` (a reverse-percentage question with trap code `base_confusion`) with the trap answer.
2. **Observed:** `finalAnswer="₹480"`, `isCorrect=false`, `timeTakenSeconds=60`.
3. **Measured:** `speedRatio = 60/75 = 0.8` → neither fast nor slow by the centralized thresholds. `historicalSignals` — first occurrence, no repetition yet.
4. **Candidate:** `deriveCandidateErrorEvidence()` matches the question's trap code, proposes `category: "trap", code: "base_confusion"` — a candidate, not yet a diagnosis.
5. **Hypothesis:** `generateHypothesis()` proposes: "The two percentage changes were likely treated as canceling out..." — `confirmationStatus: "awaiting_confirmation"`.
6. **Confirmation:** student answers "Yes, that's it" → `confirmHypothesis()` → `confirmationStatus: "confirmed"`.
7. **RepairPlan:** `buildRepairPlan()` produces a plan targeting the exact taxonomy cell + trap code, snapshotted at this moment.
8. **Recommendation:** the next call to `orchestrateNextTrainingAction()` finds this confirmed, active RepairPlan and (subject to tie-breaking — see [24_REPAIR.md](24_REPAIR.md)) recommends `targeted_repair` toward a matching follow-up question.

This exact chain was proven, against real (not hand-simulated) domain code, in this session's own `apps/web` adapter test suite. See [64_QUESTION_PLAYER.md](64_QUESTION_PLAYER.md) and [65_AUTOPSY_UX.md](65_AUTOPSY_UX.md).

## Prep Phase — a deliberately independent axis (D-009)

`computePrepPhase(examId, enrollmentDate, today)` reads a stored `PrepPhaseTemplate.phaseCurve` and returns expected-coverage-by-days-to-exam, entirely independent of `Attempt`/`MasteryState` (a unit test explicitly proves this boundary holds both ways — `docs/MASTER_PLAN.md` Phase 1 exit criterion 4). `applyCatchUp(phase, catchUpPlan)` layers a late-joiner's `CatchUpPlan.overlay` on top, never mutating the underlying template. **This axis is currently disconnected from the recommendation pipeline** — `TrainingOrchestrationInput.prepPhase` is accepted but not consumed by any ranking logic yet (D-051's own consequences note this explicitly), and the Training Recommendation Composition design deliberately defers assembling it from real persisted data — see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §16.

See also: [21_STUDENT_MEMORY.md](21_STUDENT_MEMORY.md), [22_OBSERVATION_EVIDENCE_HYPOTHESIS.md](22_OBSERVATION_EVIDENCE_HYPOTHESIS.md).
