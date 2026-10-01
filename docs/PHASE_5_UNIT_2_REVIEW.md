# Phase 5 Unit 2 — Calculation Gym: review

Decision record: [D-076](DECISIONS.md). Roadmap: [product-roadmap/PHASE_5_TRAINING_SYSTEMS.md](product-roadmap/PHASE_5_TRAINING_SYSTEMS.md).

## What this unit is

Calculation Gym is the first training system made genuinely student-facing inside the Unit 1 Training Session framework. **No new Calculation algorithm was written.** The existing `@ipmat/calculation-gym` provider still decides whether Calculation applies, which stage the student is at, and which published question serves it; `@ipmat/training-session` stays the session/lifecycle boundary and contains no Calculation policy.

## The existing provider, exactly (as inspected before any change)

**Applicability** (`applicability.ts`, `frictionEvidence.ts`). For each concept in the candidate pool, the student's *graded* attempts (status `submitted`, verdict known) are split by Question DNA `difficultyDimensions.computationalLoad` into a high-load slice (`≥ 0.5`) and a low-load slice (`< 0.5`). A slice's accuracy is `null` below `MIN_OBSERVATIONS_FOR_COMPONENT` (3). Friction is detected only when BOTH slices have ≥ 3 graded attempts AND `lowLoad.accuracy − highLoad.accuracy ≥ 0.2`. The target is the concept with the largest gap (concept name breaks ties). Two honest not-applicable reasons: `insufficient_evidence`, `no_calculation_friction_detected`. `computationalLoad` is an authored, **provisional** DNA proxy (D-021), never a measured "calculation ability". All thresholds are provisional and uncalibrated.

**The three stages** (`types.ts`, `progression.ts`), derived from persisted history on every call (nothing stored):

| Stage | Student-facing label | Gate to be AT this stage |
|---|---|---|
| `foundational` | Stage 1 · Foundations | default (no evidence, or foundational slice not cleared) |
| `mixed` | Stage 2 · Heavier arithmetic | foundational slice (load < 0.5, not multi-step) ≥ 3 graded and ≥ 0.75 accuracy |
| `time_pressured` | Stage 3 · Under time pressure | AND mixed slice (load ≥ 0.5, not time-pressured) ≥ 3 graded and ≥ 0.75 accuracy |

Each gate uses its OWN slice; clearing an earlier stage is never enough to unlock a later one.

**Candidate data needed:** concept name, `computationalLoad`, `testingModes`, expected time, `published` state. **Returns:** `selected | no_eligible_question | not_applicable | error`, with a requirement `{ targetConceptName, stage, minComputationalLoad, requireMultiStep, requireTimePressured }`. **Selection** (`selection.ts`): published + structurally valid + concept + the stage's constraints, then exactly three tie-breaks — least prior exposure, load nearest the floor, lexicographic question id. No score, no randomness.

## The defect found and fixed

Selection did not serve what progression counts. Foundational applied only a load floor of 0 and the first tie-break is least-exposure, so an unseen heavy or multi-step question could be served at stage 1; mixed could serve a time-pressured one. Neither counts as evidence for the stage it was served at, so progression could stall.

**Fix (D-076, minimal, meaning-preserving):** three OPTIONAL requirement fields — `maxComputationalLoad` (exclusive), `excludeMultiStep`, `excludeTimePressured` — restating progression's own shape definitions, set per stage and honored by selection. Absent fields behave exactly as before (tested). **The stage-alignment defect is fixed.** No threshold, applicability rule, progression rule or tie-break order changed.

## Objective construction

Unchanged from Unit 1 (`buildTrainingObjective`): the catalog's authored sentence plus the concept the provider's own requirement names. For Calculation: *"Deliberate calculation practice: accuracy on questions that need heavier arithmetic. Focus: Percentages."* The session screen is titled "Calculation Gym". Nothing about the student is claimed.

## Stage presentation and progression in a session

- The catalog declares Calculation's ordered stages and authored, threshold-free copy; a test asserts its keys equal `CALCULATION_TRAINING_STAGES` (the package cannot import the provider).
- `stageKeyOfRun()` reads the generic `requirement.stage` the provider returns — for `selected` and `no_eligible_question`; unknown when the system is not applicable.
- The session view carries the CURRENT `stage` (derived on every read). **A stage change** is derived by re-running the same system "as of before the session's last finalized attempt" (`runTrainingSystems(..., { excludeAttemptIds })`) and comparing — no stored state, identical after a restart or on a second instance. It is shown once above the question as "Next stage" / "Stage changed" with an authored note ("Your recorded answers at the previous stage met this training's requirement for moving on."), never a threshold, score, reason code or improvement claim.
- Progression within a session is simply the real provider seeing the session's own finalized attempts (ordinary attempts) on the next call.

## Session integration, selection, attempts

Reused unchanged: session creation/config/lifecycle/ownership/concurrency (Unit 1); the one attempt lifecycle (start in the block, submit, skip, finalize, result, evidence, timing); mastery/history (training attempts are ordinary attempts). Selection is the provider's, narrowed only by "not a question already used in this session". Published-only is enforced by the composition and re-checked when the attempt starts. A malformed candidate is excluded by the provider.

## Result and completion

After each question the ordinary result screen shows first, preceded by a small context line (Calculation Gym · current stage · "N of M questions done"). On completion the student sees: questions completed, answered, skipped, "answered correctly: x of y" (a count — no percentage), time on answered questions against their expected time, the current stage, "completed normally", and the standing note that the session is a record of this session only, not a measure of lasting progress.

## Failure and short-content behavior

- Not applicable → the hub card is disabled with Calculation's own explanation (what the student needs first); a start is refused (409).
- Applicable but nothing qualifies for the stage → hub says "No published question fits this training right now."; start refused; nothing from another stage is ever substituted.
- Pool exhausted mid-session → `no_question`, the student can end the session; no repeat, no fallback.
- API unavailable → the hub and session screens show a student-safe error with Try again / a way back; retrying resumes the same open question.

## Content limitation (important)

The seeded content is three real questions; Calculation cannot activate on it, and **no threshold was weakened** to make it appear. Verification uses a labelled **synthetic TEST DATA pool** ("[TEST DATA phase-5-unit-2] …": clones of the seeded demonstration question with different `computationalLoad`/`testingModes`, each with the seeded provenance row) published only inside a THROWAWAY database (the Postgres integration suite builds and drops its own; the browser QA used a second throwaway database). The shared test database is never touched; the suite asserts the real seeded published set is exactly what the seed made, and the browser run asserts it is unchanged afterwards.

## What was tested

See the validation record in the roadmap file for exact counts. Coverage: catalog/parity/stage copy; stage-shape alignment incl. 300-pool property test (in-shape, order-independent, repeatable, no randomness/clock); real provider through the real composition for stages 1/2/3, mid-session stage change, restart reconstruction, no stage persisted; correct/incorrect/skip via the ordinary lifecycle with server-derived timing and evidence; history/finalized-attempt visibility; completion and summary; no repeats; malformed/unpublished candidates; short-content behavior; ownership; concurrent next (one instance and two); leakage and psychological-wording scans; "no new score" scan of every view key; real Postgres (restart, second instance, ownership, 12-way start, 10-way next, no autopsy/repair/mastery rows, no stage persisted); real browser (43 + 7 checks).

## What remains unverified / not claimed

- Outcome calibration: nothing shows Calculation Gym improves anyone's calculation. A session is evidence, not proof.
- Real-student behavior: no real student has used it; thresholds are provisional.
- Real content: stages 2–3 depend on authored, uncalibrated DNA (`computationalLoad`, `time_pressured`) that real questions may not carry in volume.
- The stage-change reconstruction assumes no ordinary practice was done between two training questions (otherwise the derived "previous stage" can differ slightly).
- The "loading message" browser check accepts an instantaneous load; the loading UI itself is the shared `LoadingState`.
- No live model is involved anywhere in Calculation Gym.

## Unit 3

Speed Lab (student-facing) on the same framework — **not started.**
