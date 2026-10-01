# Phase 5 Unit 5 — Novelty Training: review

Decision record: [D-079](DECISIONS.md). Roadmap: [product-roadmap/PHASE_5_TRAINING_SYSTEMS.md](product-roadmap/PHASE_5_TRAINING_SYSTEMS.md). Provider design: [D-058](DECISIONS.md), [project-memory/34_NOVELTY_TRAINING.md](project-memory/34_NOVELTY_TRAINING.md).

## What this unit is

Novelty Training is the fourth training system made genuinely student-facing inside the Unit 1–4 session framework, and the first **exposure-first** one. **`@ipmat/novelty-training` was not changed** — its evidence, applicability, target pair and selection are authoritative exactly as designed in D-058. No other provider's code was copied, and **Novelty Training has no stages**.

## What was reused (unchanged)

The generic framework: session creation / configuration / lifecycle / persistence / ownership / concurrency; the one attempt lifecycle (server-authoritative timing, events, result, evidence); the observable session summary; the Training Hub, session, result and error screens. `apps/api` and `apps/web` gained nothing for this unit.

## What was added

- **Catalog data** (`@ipmat/training-session`): Novelty's session title, goal and focus sentences, per-reason copy and no `stages`; two small optional hooks — `conceptNotInObjective` (the objective omits a concept that can rotate) and `noLongerApplicableNote` (authored words when the system's own evidence says nothing more is needed mid-session).
- A two-line use of `noLongerApplicableNote` in `TrainingApiService`'s `no_question` branch (other systems keep the generic sentence).
- Tests: 9 provider preservation tests (no provider source change), catalog tests, 20 session-level Novelty tests over the real provider, 7 real-Postgres tests; browser QA.
- Docs and D-079.

## Reconciling the brief against the source

The source is authoritative and matches the brief except for one wording point:

- **Evidence.** For each concept the student has graded attempts on, the provider computes `standardExposureCount` and, for each of the three non-standard levels, `distinctQuestionIds` (always all three, zero included). Only submitted, graded attempts count; skipped and abandoned never do; correctness never matters. **The baseline counts DISTINCT standard questions** (a set), not raw attempts — a question retried four times is one.
- **Applicability.** Gate 1: ≥ `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` (3) distinct standard questions of THAT concept (another concept's activity never counts). Gate 2: some non-standard level of that concept has < 3 distinct questions. `insufficient_evidence` when no concept clears gate 1; `sufficient_novelty_exposure` when baselines are cleared but every dimension has ≥ 3; otherwise applicable with `{ targetConceptName, targetNoveltyLevel }`.
- **Candidate-invariance.** `evaluate()` reads only `studentId` and `attemptRecords`, never `candidates`: applicability can never depend on available content (provider test over 25 pools; plus a source-level regression).
- **Target.** The globally lowest distinct-exposure (concept, level) pair; ties by concept name, then level name. A directly observed integer — no score.
- **Selection** (provider-local): published + structurally valid (question id, concept, level, taxonomy cell, numeric expected time) + exact match on concept AND `noveltyLevel`; prefer a cell NOT yet attempted at the target level (a boolean partition); if every surface is seen, the whole matching pool is used; then least exposure, then question id. It never uses `testingModes` or `representationNovelty` as a substitute for the categorical level.
- **No stages / no decay:** the three styles are peers; exposure is cumulative.

## The one contradiction found and its minimal correction

The session objective is a snapshot taken at start (Unit 1) and named the provider's target concept. Novelty Training re-targets the globally least-exposed pair after every attempt, so "Focus: <concept>" could be wrong two questions later. **Fix:** an optional catalog flag `conceptNotInObjective` (set only for Novelty) so its objective omits the concept (the question itself still shows chapter and concept); Calculation and Speed, whose target does not rotate, still name theirs (tested). Two Unit 1 tests that used Novelty as the sample system were updated, with the reason stated in the test.

## Student-facing behavior and language

- **Hub:** "Novelty" — "Practice unfamiliar question styles: build exposure to different ways the exam can present a concept." Not startable with a reason-specific note: *"Needs several recorded answers on standard questions of one concept first."* or, once every style has enough recorded practice, *"Your recorded practice already includes several questions in each unfamiliar style, so there is nothing to add right now."*; applicable but no published content: *"No published question in an unfamiliar style is available right now."* — three honest, distinct states.
- **Session:** titled "Novelty Training"; objective "…This session is expanding the kinds of questions you've encountered."; "Question N of M", the timer; **no stage, no style name, no count**.
- **Rotation:** the target moves through the three peer styles as exposure is recorded, so a student sees varied styles in a session; the surface-variation rule means a style's questions on a new presentation come before ones on an already-seen presentation.
- **When enough exposure exists:** the session says "No further question fits right now… there is nothing more to add right now. You can end the session." in the system's own words, then a completion screen with observable counts, time vs expected and the record-of-this-session note — no stage row.
- **Never shown:** style names, `noveltyLevel`, taxonomy-cell ids, exposure or baseline counts, thresholds, `representationNovelty`, provider diagnostics, any score; never "you struggle", "weak at", "lack", "not good at", "adaptability", or a claim about the student.

## Behavior worth knowing (provider semantics, unchanged)

- Target selection precedes content: if the lowest-exposure pair has no published question the result is `no_eligible_question` even when another style has content — nothing is substituted (and that state is distinct from `not_applicable`; evaluation never inspects the pool).
- Because exposure is cumulative and the target is the lowest pair, a session rotates and ends once every style has enough distinct questions; the evidence, not a fixed ladder, decides. After that the hub says so and does not offer to start (no decay).

## Verification (see the roadmap file for exact counts)

Unit/application tests over the real provider; real Postgres through the real HTTP server and Prisma repositories with two instances (not-applicable variants incl. a baseline split across two concepts and a retried question; the full rotation comb→ctx→rep ×3 with alternating right/wrong answers; surface order nr1, nr3, nr4; the uncleared concept never served; sufficient-exposure message; applicable + zero published candidates = `no_eligible_question`; unpublished exclusion; all-seen fallback; ownership; second-instance parity; 12-way start / 10-way next concurrency; ordinary evidence and no autopsy/repair/mastery rows; no stage persisted); real browser against a throwaway database (31 checks incl. API restart, reload, no stage, rotation, the honest end state, the no-content state, API-down error and loading states). **Synthetic data:** labelled "[TEST DATA phase-5-unit-5]" clones of the seeded demonstration question carrying different `novelty_level` values, seeded taxonomy cells and two seeded concepts (plus the seeded provenance row), published only in throwaway databases that were dropped; seeded real questions withheld inside those databases only and verified restored/unchanged; the shared test database and port 5432 untouched.

## What remains unverified / not claimed

- Exposure is not comprehension: nothing shows Novelty Training makes anyone better with unfamiliar styles, and no novelty mastery is claimed. The 3-question baseline and sufficiency are the shared PROVISIONAL mastery constant.
- No real student has used it; the seed content cannot activate it; it depends on authored `noveltyLevel` DNA.
- No live model is involved anywhere in Novelty Training.
- (QA note) In the browser run, the student's wrong answers on questions inheriting the seeded demonstration trap tag legitimately activated Trap Lab afterwards — separate providers reading the same ordinary evidence; the Novelty card itself was verified not startable.

## Next

Pressure Training — **not started.**
