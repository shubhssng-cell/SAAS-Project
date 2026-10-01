# Phase 5 Unit 6 — Pressure Training: review

Decision record: [D-080](DECISIONS.md). Roadmap: [product-roadmap/PHASE_5_TRAINING_SYSTEMS.md](product-roadmap/PHASE_5_TRAINING_SYSTEMS.md). Provider design: [D-059](DECISIONS.md)–[D-062](DECISIONS.md), [project-memory/35_PRESSURE_TRAINING.md](project-memory/35_PRESSURE_TRAINING.md).

## What this unit is

Pressure Training is the fifth training system made student-facing inside the Unit 1–5 session framework and the first whose evidence is **sustained sequences (practice blocks)** rather than single-question facts. **`@ipmat/pressure-training` was not changed** — its evidence, applicability and selection are authoritative exactly as designed in D-061. It has no stages and no score.

## What "pressure" means in this codebase (read from the source, not inferred from the name)

- **Evidence is block-level only.** `context.practiceBlocks` (one entry per finished `PracticeBlock` whose attempts are all finalized) plus the matching attempt records. A block counts only if it has ≥ 3 attempts, passes Block Evidence Validation (non-empty, no duplicate attempt ids, every attempt present, finalization times non-decreasing, finite non-negative gaps / solving time / wall-clock) and one concept holds a strict majority of its attempts. A concept needs ≥ 3 such blocks.
- **Three observable block facts, fixed precedence:** within-block degradation (second-half accuracy ≥ 0.40 below first-half; skipped/abandoned never count; hints do), reduced recovery (median inter-attempt gap < 5 s), budget consumption (active solving time ≥ the block's configured time budget). The best tier per concept wins; the target concept is the lowest tier, then name.
- **Why this is not Speed Lab.** Speed Lab's `time_constrained` stage is about ONE question against ONE clock. `evaluate()` here reads only block evidence and returns `not_applicable: insufficient_evidence` whenever there are no blocks, however slow or error-prone the single-question history is (tested both ways against the real provider). Speed Lab fires on slow single attempts; Pressure cannot.
- **Selection** (`select()`, after applicability only): published, well-formed, exact target concept; prefer a taxonomy cell not yet attempted at that concept; then least prior exposure; then question id. Deterministic, order-independent (25 seeded permutations), no randomness.
- **No stages, no score, no state.** Nothing is stored about pressure; the only thing that changes is the history the provider reads.

## What was reused (unchanged)

The generic session framework (creation, configuration, lifecycle, persistence, ownership, concurrency); the one attempt lifecycle (server-authoritative timing, events, result, evidence); the observable session summary; the Training Hub, session, result and error screens; the composition layer that assembles `practiceBlocks` from persisted rows; orchestration; the provider.

## What was added

- **Catalog data** (`@ipmat/training-session`): Pressure's title, goal and focus sentences, per-reason copy, no `stages`, `conceptNotInObjective`, `noLongerApplicableNote`, and one new optional field `completionKinds` (`["fixed_duration"]`, only for Pressure).
- **Service/API:** the server rejects a completion kind a system does not allow (400); the hub card carries `completionKinds` so the UI offers only what is allowed.
- **Web:** the hub offers only the allowed session lengths (`presetsFor`); a live "Time left" line during a timed session (`describeTimeLeft`, seeded from the server's remaining seconds, display only).
- **One defect fix (generic):** `PrismaTrainingSessionRepository.create()` mapped no unique-violation to the conflict the service resumes from, so two concurrent starts for a student who already had an active practice session could 500 (see D-080 §6).
- Tests, docs, D-080.

## Student-facing behavior and language

- **Hub:** "Pressure" — "Practice a sustained, timed run of questions: keep working steadily across a whole sequence, not just one question." Not startable with a reason-specific note: *"Needs several earlier training sessions of at least three questions each on the same concept first."* or, with enough blocks and nothing observed, *"Your recorded training sessions don't call for this right now."*; applicable-but-no-content has its own sentence. Session length: 5 or 10 minutes only.
- **Session:** titled "Pressure Training"; objective names no concept; "N questions done · M:SS left"; a live "Time left" line; **no stage, no dimension, no count**. When time is up the line says so and that no new question will start; the open question is kept; answering it completes the session.
- **When the concept's published pool runs out** the session says nothing more fits and offers to end — nothing from another concept is substituted.
- **Completion:** observable counts, correctness, time vs expected, "Completed normally", the record-of-this-session note — no pressure score, no improvement claim.
- **Never shown:** dimension names, thresholds, gaps, half-accuracies, block ids, taxonomy-cell ids, evidence counts, provider diagnostics; never stress / fatigue / confidence / resilience / "you crack" wording.

## Behavior worth knowing

- A finished Pressure Training run is itself a new qualifying block (4th, 5th…), so evidence accrues from the student's own training; hence applicability can change after a session.
- The three evidence questions of a block must be published to reach the attempt records (existing composition behavior), so a "no published candidate" state is not reachable end to end in a fixture whose evidence questions are themselves candidates (disclosed in D-080 §7).
- Block timestamps in fixtures are set explicitly (real-time test runs are too fast to produce honest gaps).

## Verification (see the roadmap file for exact counts)

Unit/application tests over the real provider; real Postgres through the real HTTP server and Prisma repositories with two instances (block evidence built from real HTTP attempts re-grouped into completed blocks with exact timestamps; each applicability state; timed-only enforcement; concept-scoped, surface-varying selection; pool exhaustion; the server clock; repeated sessions; ownership; second-instance parity; 12-way start / 10-way next concurrency; ordinary evidence and no autopsy/repair/mastery rows); real browser against a throwaway database (34 checks incl. API restart, reload, live countdown, time-is-up, no stage, error and loading states). **Synthetic data:** labelled "[TEST DATA phase-5-unit-6]" clones of the seeded demonstration question (trap tag removed) with seeded cells and two seeded concepts, published only in throwaway databases that were dropped; seeded real questions withheld inside those databases only and verified restored/unchanged; the shared test database and port 5432 untouched.

## What remains unverified / not claimed

- That timed runs help anyone under real exam pressure; no pressure mastery is claimed.
- The 5 s gap and 0.40 accuracy-drop thresholds are PROVISIONAL and uncalibrated; no real student has used it and the seed content cannot activate it (it needs ≥ 3 earlier training blocks).
- No live model is involved anywhere in Pressure Training.

## Next

Unit 7 — **not started.**
