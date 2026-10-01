# Phase 5 Unit 3 — Speed Lab: review

Decision record: [D-077](DECISIONS.md). Roadmap: [product-roadmap/PHASE_5_TRAINING_SYSTEMS.md](product-roadmap/PHASE_5_TRAINING_SYSTEMS.md). Provider design: [D-055](DECISIONS.md), [project-memory/32_SPEED_LAB.md](project-memory/32_SPEED_LAB.md).

## What this unit is

Speed Lab is the second training system made genuinely student-facing inside the Unit 1/2 session framework. **No new Speed Lab algorithm was written** and **no Calculation Gym business logic was copied**: the existing `@ipmat/speed-lab` provider still decides whether Speed Lab applies, which stage the student is at, and which published question serves it. The only code change outside tests and data is one small, targeted correction to the provider's stage/selection alignment (below).

## What was reused (unchanged)

The whole Unit 1/2 framework: session creation / configuration / lifecycle / persistence / ownership / concurrency; the generic `requirement.stage` reader (`stageKeyOfRun`); the stage-change derivation ("re-run the system as of before the session's last finalized attempt"); the observable session summary; the one attempt lifecycle (server-authoritative timing, events, result, evidence); the Training Hub, session, result and error screens. `@ipmat/practice-api`, `apps/api` and `apps/web` contain **no Speed Lab code**; they gained nothing for this unit.

## What was added

- **Catalog data** (`@ipmat/training-session`): Speed Lab's ordered stages with authored copy, session title "Speed Lab", goal sentence, and its not-applicable note. A parity test asserts the stage keys equal `SPEED_LAB_STAGES` (the package cannot import a provider).
- **Provider correction** (below) with a regression/property test.
- Tests: provider preservation + alignment (14), catalog/stage tests, 22 session-level Speed Lab tests over the real provider, and 6 real-Postgres tests; browser QA.
- Docs and decision D-077.

## The existing Speed Lab behavior (as inspected; preserved)

- **Applicability.** For each concept in the pool, the *eligible* population is: submitted, graded, validly timed, hint-free, non-time-pressured, conceptualLoad < 0.5 attempts — **regardless of correctness** (the denominator is immutable). `slowFraction = correctSlow / eligible`, `null` below 3 eligible attempts. Slow = `speedRatio >= AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO` (1.3, reused — no second boundary). Applicable when `slowFraction >= 0.5` (provisional); the target is the concept with the largest fraction. Incorrect-and-slow is tracked as diagnostic text only and never triggers anything. It never reads `computationalLoad`, never imports `@ipmat/calculation-gym` (tested), and has no composite score, `priorityScore` or `targetSpeedRatio` (type-level guards exist).
- **Progression** is **count-based** over **disjoint** slices (a rate-based gate would be the near-complement of the applicability trigger over the same population, so applicability and a later stage could never hold together — D-055). Evidence base = correct, valid-timed, hint-free, **non-time-pressured** attempts; "good pace" = `speedRatio <= 1.0`:
  - `steady_pace` (default): until 3 good-pace attempts with conceptualLoad < 0.5.
  - `mixed_pace`: steady gate cleared; until 3 good-pace attempts with conceptualLoad >= 0.5 (its OWN slice).
  - `time_constrained`: both gates cleared.
- **Selection**: published + structurally valid + concept + stage constraints, then least prior exposure → lowest `expectedTimeSeconds` (a preference for a tighter budget, never claimed to be "harder") → question id. No score, no randomness.
- **`time_constrained` means only** "the question carries the time-pressured testing mode". It is **not** Pressure Training and the two are not merged.

## The defect found and fixed

Reconciling documentation against source: progression counts only **non-time-pressured** attempts, and the mixed gate only counts conceptualLoad >= 0.5. Selection did not mirror this:

| Stage | What it served before | What its gate counts | Mismatch |
|---|---|---|---|
| `steady_pace` | load < 0.5 (timed light questions allowed) | load < 0.5, **not timed** | a timed light question could be served; it never counts |
| `mixed_pace` | any non-ceilinged question (light and timed allowed) | load >= 0.5, **not timed** | a light or timed question could be served; neither feeds the mixed gate |
| `time_constrained` | timed questions | (final stage) | none |

**Fix (D-077, minimal):** two OPTIONAL requirement fields restating progression's shapes — `minConceptualLoad` (inclusive floor) and `excludeTimePressured` — set per stage by `buildRequirement()` and honored by `qualifies()`. Absent fields behave exactly as before (tested). No threshold, applicability rule, evidence definition or tie-break was touched; nothing was lowered. A 300-pool x 3-stage property test (in-shape, order-independent, repeatable; provider has no `Math.random`/clock) and an end-to-end alignment test (the student moves steady → mixed → time_constrained using only questions the stages serve) cover it. **The defect is fixed.**

## Stage behavior in the student's session

| Stage | Student-facing label | What the session serves |
|---|---|---|
| `steady_pace` | Stage 1 · Steady pace — "Straightforward questions, to be solved within the expected time." | conceptualLoad < 0.5, not time-pressured |
| `mixed_pace` | Stage 2 · Mixed pace — "Questions with more conceptual weight, still within the expected time." | conceptualLoad >= 0.5, not time-pressured |
| `time_constrained` | Stage 3 · Time-constrained — "Questions built to be answered under a time limit." | questions carrying the time-pressured testing mode |

**Reconstruction.** The stage is never stored (no stage column, no `stage_state`; asserted on the real `training_sessions` row). Every read re-runs the provider over persisted history. A stage change is derived by re-running it "as of before the last finalized attempt in the session" and comparing, then shown once as "Next stage" with an authored note — identical after a restart or on a second instance (tested in-memory, on real Postgres across two instances, and in the browser across an API restart and reloads).

**Student-facing language.** Goal: "Improve solving speed: working within the expected time on concepts you already answer correctly." (a training aim, not a claim about the student). Not applicable: "Needs several recorded answers on straightforward questions of the same concept first." Stage notice note: "Your recorded answers at the previous stage met this training's requirement for moving on." No ratio, threshold, count, slow fraction or evidence internals appear anywhere; no "slow solver / lack of speed / poor processing" wording; no confidence/motivation/ability language (scanned in unit tests, HTTP bodies and the rendered page — scoped to the right regions, e.g. the notice card, so a legitimate word elsewhere is not mistaken for a leak).

## Behavior worth knowing (provider semantics, unchanged)

- Good-pace answers dilute the slow fraction (the denominator is correctness-independent), so a session can reach "No further question fits right now" once the evidence no longer shows slow-correct dominance. Heavier-question attempts are outside the applicability population, so stage-2 progress does not change applicability.
- `no_eligible_question` / `not_applicable` are preserved as such: the hub card says so honestly, a start is refused (409), and nothing else (adaptive, another stage, a random question) is ever substituted.
- Wrong-and-slow, fast, or too-few attempts never activate Speed Lab; a single slow attempt never does.

## Verification (see the roadmap file for exact counts)

Unit/application tests over the real provider and in-memory repositories; real Postgres through the real HTTP server and Prisma repositories with two instances (not-applicable variants, stage 1/2/3 with transitions, reconstruction, ownership, 12-way start and 10-way next concurrency, ordinary evidence, no autopsy/repair/mastery rows, no stage persisted, insufficient content); real browser against a second throwaway database. **Synthetic data:** a labelled pool ("[TEST DATA phase-5-unit-3] …": clones of the seeded demonstration question with different `conceptualLoad`/`testingModes`, each with the seeded provenance row) published only in throwaway databases, which were dropped; "slow" history is created by setting the server-recorded `time_spent_seconds` of history attempts in the throwaway database (waiting is impractical) — the same stored column the evidence reads. The seeded real questions are withheld from the pool inside those throwaway databases only and verified restored/unchanged; the shared test database is never touched.

## What remains unverified / not claimed

- Calibration: all Speed Lab thresholds (`SLOW_FRACTION_THRESHOLD`, `GOOD_PACE_SPEED_RATIO`, the 3-attempt gates, the 0.5 conceptual-load split, the 1.3 slow boundary reused from autopsy) are PROVISIONAL; nothing shows Speed Lab makes anyone faster. A session is evidence, not proof.
- No real student has used it; the seeded content cannot activate it, and stages 2–3 depend on authored, uncalibrated DNA.
- The stage-change reconstruction assumes no ordinary practice between two training questions.
- No live model is involved anywhere in Speed Lab.

## Unit 4

Trap Lab + Novelty Training (student-facing) on the same framework — **not started.**
