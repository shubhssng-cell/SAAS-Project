# Phase 7 Unit 4 — Full Exam Simulation Engine

Decision record: [DECISIONS.md D-090](DECISIONS.md). Code: `packages/domain/exam-simulation` (`@ipmat/exam-simulation`, pure) and `packages/db/src/repositories/prismaSimulation.ts` (adapters). Migration: `0016_exam_simulation`.

## 1. Specification audit — what the repository DOES and DOES NOT specify

**Specified (and reused):**
- `PRODUCT_SPEC`: "Exam structure (sections, timing, marking scheme) … are data, not code" — a requirement, not data. No such data exists.
- The Exam Pack / `Section` table: section `name` and `order` only.
- Existing lifecycle conventions: server-derived time, append-only events, derive-don't-cache, terminal states (`@ipmat/attempt`, `PracticeBlock`).
- Provenance and publication rules for content (D-084): only `published` content with provenance; a content fingerprint identifies a content version.

**NOT specified anywhere in the repository (nothing below was invented):**
- Any IPMAT duration, section timing, section count, section order or question counts. The IPMAT pack holds the Quant section only ("other sections are absent because the repository holds no authoritative structure for them").
- Marking scheme, positive or negative marks, unanswered-question treatment, section totals, a score.
- Navigation rules (free vs forward-only vs section-locked), mark-for-review behaviour, pause/resume, time extensions.
- Historical paper structure: no real historical paper exists (`HistoricalQuestionRecord` holds classification only, no content).
- Rules for composing a paper automatically (which questions, what difficulty mix).
- What a simulation result means or feeds (readiness is Unit 5).
- Earlier docs say Mock Simulation was "undesigned"; this unit was explicitly requested by the owner and builds only the rule-free mechanics.

## 2. What was built: exam-rule-free mechanics, with every exam rule supplied as data

**No exam rule is encoded.** `SimulationConfig` (duration, sections, question counts, provenance) is DATA a supplier must provide and the engine validates; this package and the repository ship NO configuration, so **no IPMAT simulation can start today** (`no_simulation_configured`). Tests use labelled fixture configurations, never presented as exam rules.

- **Paper assembly** (`assemblePaper`): an editor's EXPLICIT selection of question ids per section, validated and deterministic (published, this exam, correct section, provenance present, exact per-section counts, no duplicates, no unknown section). It never chooses questions, and a paper is always `origin: "assembled"`, `isHistoricalPaper: false`. Each paper question records its content fingerprint (version) and provenance source kind.
- **State machine** (`engine.ts`, pure): `in_progress → submitted | expired`, both terminal; an append-only answer log; every decision (answer, submit, expiry) is a pure function returning a mutation, applied atomically by whoever persists the state.
- **Service** (`SimulationService`): ownership-verified use cases (start/recover, get, getQuestion, answer, submit, result) over ports; no dependency on any training, adaptive, revision, repair, mastery or attempt code.
- **Persistence** (Prisma adapters): row-locked transactions; at most one in-progress simulation per enrollment (partial unique index); a CHECK ties the finalization fields to the status; the result is written once.

## 3. Engine mechanics fixed here (PROVISIONAL — not exam rules)

A working state machine needs these defined; no document specifies them, so they are recorded as `SIMULATION_MECHANICS` and flagged provisional:
- **Time is server-authoritative.** Every operation takes the server clock's `now`; no client time is read or accepted anywhere (the answer input has only `position` and `answer`).
- **Deadline = start + configured duration, EXCLUSIVE.** At `now >= deadline` an operation is too late.
- **Expiry** finalizes the simulation as `expired` at the deadline (not at the moment it is noticed), on the next access of any kind (lazy, idempotent).
- **Submit vs expiry race:** decided only by the server time against the exclusive deadline — 1 ms before is `submitted`; at the deadline the submit is rejected as too late and the simulation is `expired`. Answers accepted before the deadline are kept; later ones are never recorded.
- **Idempotent finalization:** a repeated or concurrent submit changes nothing and reports how it ended; a finalized simulation rejects everything.
- **One in-progress simulation per enrollment**; a refresh, reconnect or double click recovers it instead of creating another. After expiry a new one may start.
- **No pause/resume, no review marking, no navigation enforcement or recording** (navigation is a client concern).
- **Concurrency safety:** all operations on one simulation are serialized by a row lock. Answer keys are loaded BEFORE the lock, only when finalization is certain to need them — an early version loaded them inside the lock on a second connection, which exhausted the connection pool under concurrent submits (found by the real-Postgres tests and fixed).

## 4. Result and scoring

The result is RAW: per-question outcome (answered, chosen answer, correct/incorrect/not-graded, number of answer changes, first/last answered time), per-section counts, totals, timing evidence (start, deadline, finalization, allowed and elapsed seconds, finalized by) and `scoring: { defined: false }`, `interpretation: "none"`. **No score is computed** because no marking scheme exists; there are no positive or negative marks. Correctness is trimmed-string equality, mirroring the existing attempt rule. A question whose content changed (fingerprint) after the paper was fixed is never graded against a different version: it is `question_content_changed` and counted not-graded. The result is an auditable materialization written once at finalization, because correctness as of finalization cannot be re-derived if a question is later edited.

## 5. Isolation, security, leakage

- **Student/enrollment/exam isolation:** enrollment ownership is verified first; another student's, enrollment's or exam's simulation is `simulation_not_found`, identical to a missing one, for every operation. Candidate and content reads are exam-scoped.
- **No answer leakage:** the student view carries status and the student's own answers only; question content comes from a read that never selects `correct_answer` or solution steps; answer keys are read only to finalize. Tests check JSON outputs and a sentinel solution text, and that keys are not read before submit. Post-finalization correct answers are NOT exposed (a review mode is unspecified).
- **Existing-system isolation:** an active or finalized simulation writes no attempt, practice session/block, training session, repair, mastery or autopsy row, and the same persisted attempts give byte-identical Unit 1, 2, 3 reads and the orchestrator's recommendation before, during and after (real Postgres).
- **No HTTP route and no UI were built** (neither is specified); service-level JSON is what was tested. A future route must expose only the student view, repeat the raw-HTTP and rendered-HTML leakage checks, and never accept a client time.

## 6. Downstream contract (for Unit 5)

`toFinalizedSimulationEvidence(state)` is the ONLY shape in which simulation data may later feed other intelligence, and only for a finalized simulation (it refuses an in-progress one). It carries raw outcomes, timing and counts — no score, readiness, mastery, confidence, ability, prediction, chosen answer or answer key. Nothing calls it today.

## 7. Unresolved exam/product decisions (reported, not invented)

1. The real IPMAT structure: duration, sections, order, question counts, any sectional timing.
2. The marking scheme: marks per correct answer, negative marking, unanswered treatment, section totals, a score.
3. Navigation rules and mark-for-review.
4. Pause/resume, time extension, accommodations.
5. Historical paper reproduction (needs real, licensed historical content) and whether generated papers are allowed and how they are composed.
6. What a student may see after finalization (review of answers, solutions).
7. Whether and how simulation evidence feeds readiness (Unit 5), revision or curriculum.
8. How many simulations a student may take and when.
9. Whether the exclusive deadline boundary and the expiry-at-deadline rule match the real exam's conventions.

## 8. Limitations

No configuration, so nothing can start in production; no route or UI; scoring absent by design; expiry is lazy (a simulation past its deadline is finalized on its next access, not by a background job, so an abandoned one stays `in_progress` in storage until touched — it can never accept an answer); paper selection is manual; post-finalization review is unavailable.

## 9. Tests

Pure package: 319 tests (config, paper assembly, engine boundaries to the millisecond, answer log, finalization and idempotency, result, view, downstream contract, service with ownership/recovery/restart/concurrency/race, 60-seed property suites over random operation sequences, boundary checks for no exam rule, no scoring, no other system, no client time, no clock). Real Postgres: 16 tests (persistence, recovery, concurrent starts/submits/answers, database constraints, deadline to the millisecond, races, isolation, leakage, content-version detection, expiry recovery, migration) plus 3 cross-system isolation tests against Units 1–3 and the orchestrator.
