# Product Phase 5 — Student-facing Training Systems

## Phase objective

From the master roadmap: *Calculation Gym / Speed Lab / Trap Lab / Novelty Training / Pressure Training become things a student can see and enter, not just backend providers.* The engineering providers already exist (`@ipmat/calculation-gym`, `speed-lab`, `trap-lab`, `novelty-training`, `pressure-training`, behind `@ipmat/training-systems`). Phase 5 puts a deliberate, student-chosen training flow on top of them, one small unit at a time, without a second selection engine, a second attempt lifecycle, or a new score.

Numbering is **Phase-5-relative** (Unit 1 … Unit 7). It has no relation to the older global unit counts.

## Unit status

| Unit | Scope | Status |
|---|---|---|
| Unit 1 | Training System Foundation (common session framework + student entry point) | **COMPLETE** (below) |
| Unit 2 | Calculation Gym (student-facing) | **COMPLETE** (below; review: [../PHASE_5_UNIT_2_REVIEW.md](../PHASE_5_UNIT_2_REVIEW.md)) |
| Unit 3 | Speed Lab | not started (next) |
| Unit 4 | Trap + Novelty Training | not started |
| Unit 5 | Revision Engine | not started |
| Unit 6 | Pressure + Overtraining | not started |
| Unit 7 | Training-system integration + hardening | not started |

*(A working plan; later units may be adjusted when they start.)*

## Training vs adaptive practice

| | Adaptive Practice (Phase 3) | Training Systems (Phase 5) |
|---|---|---|
| Question it answers | "What should this student practice next?" | "What performance dimension are we deliberately training?" |
| Who chooses | The system | The student picks the dimension and the session length |
| Selector | `@ipmat/adaptive-selection` (and repair, via orchestration) | The chosen system's **own** `TrainingSystemProvider` |
| Shape | A stream of one-off recommendations | A bounded **session** with an explicit objective and completion rule |
| Considers repair plans? | Yes (repair tier first) | No — training ignores them |

They share the attempt lifecycle, evidence, mastery and history — and nothing else. They are deliberately **not** one selector.

## Unit 1 — Training System Foundation

> **Unit 1 builds the common framework only.** It does not implement, tune or change any system's selection algorithm. Each system's applicability and selection stay entirely inside its existing provider.

### What already existed (inspected, reused — not rebuilt)

- Five providers and the shared contract (`@ipmat/training-systems`: `evaluate()` = is this dimension worth training now; `select()` = which published question serves it; `runTrainingSystemProvider()` the one canonical entry point), registered once in `@ipmat/training-orchestration`.
- `Enrollment → PracticeSession → PracticeBlock → Attempt` persistence (D-060): pure lifecycles, repositories, block-membership on attempts with server-assigned sequence numbers and ownership re-verified inside the save transaction. No application code used it before this unit.
- The persisted-state composition in `@ipmat/training-recommendation` (ownership-verified, published-only), the attempt routes, evidence, mastery, history.

### Architecture

```
Student ──► /training (hub) ──► start (system + completion rule) ──► /training/:id
                                      │                                  │
                              TrainingApiService (@ipmat/practice-api)   │ next → question
                                      │                                  ▼
 @ipmat/training-session  ◄── catalog, config validation,         PracticeApiService.startAttempt(block)
 (pure domain)                 objective, progress, run           (the ONE attempt lifecycle)
                                      │
   TrainingRecommendationService.runTrainingSystems()  ──►  the system's own provider (existing registry)
                                      │
   TrainingSessionRepository ──► training_sessions row ──► practice_blocks ──► attempts
```

- **`TrainingSystem` abstraction = a catalog entry + a provider.** `TRAINING_SYSTEM_CATALOG` (fixed order): Calculation, Speed, Traps, Novelty, Pressure, Revision, Overtraining. Each entry: stable `systemId`, `dimension`, student-facing `label`/`trains`, and `providerId` (equal to the existing provider's id) or `null`. **Revision and Overtraining have no engine and are honestly "not built"**; they can never start a session. The extension point for a future system is: add a catalog entry and register its provider — the session machinery, API and UI do not change.
- **Selection policy extension point.** `runTrainingSystem(systemId, context)` routes to the provider in the orchestration registry and returns its outcome unmodified (`selected | no_eligible_question | not_applicable | error`). There is no ranking, filtering or tie-break in `@ipmat/training-session` (tested: no `.sort(`, no engine imports).
- **Session model.** `training_sessions` is a thin row on the existing `PracticeBlock` (one-to-one). The block owns lifecycle, completion rule and attempts; the row adds only `system_id`, `objective` (JSON) and `config` (JSON). Status, progress, enrollment and student are **derived on every read** (`deriveTrainingSessionProgress()`; ownership through `block → practice session → enrollment`), never stored — so a restart (or a second API instance) reconstructs the identical session.
- **Objective model.** `{ systemId, dimension, statement, targetConceptName | null }`, snapshotted at start from the catalog's authored sentence plus the target the provider's own requirement names (e.g. the concept). Observable facts only: no confidence, emotion, motivation or inferred state exists on it (tested).
- **Configuration.** Exactly one completion rule: `fixed_question_count` (1–20) or `fixed_duration` (60–3600 s). Strict validation of untrusted input (integer bounds, unknown keys rejected, nothing coerced). The bounds are PROVISIONAL authored limits. The rule is stored in the block's `targetQuestionCount` / `blockTimeBudgetSeconds`.
- **Lifecycle.** `active` → `completed` (or reserved `abandoned`); both final, never reopened. Reaching the rule sets `completionReached` (derived); completion is always an explicit transition. `next` resumes an open question first (never dropped, even after time is up), then completes if the rule is met, otherwise asks the system for a question. The student may end early (`finish`), refused while a question is open (the attempt is answered or skipped first; nothing mutates an open attempt). Fixed duration uses the **server** clock; no client time is ever read.
- **One active session per student.** Starting the same system again resumes (a double click is harmless); a different system is refused (409).
- **Start gate.** A session can start only when the system's own provider reports it applicable *and* able to serve a published question right now (`selected`). Otherwise nothing is created.
- **Within a session, no repeats.** The server narrows the published candidate pool by the questions already attempted in that session (`excludeQuestionIds`); an exhausted pool is reported honestly (`no_question`, student can end) — never a repeated or invented question.
- **Attempts, evidence, mastery, history.** A training question is started through the ordinary `PracticeApiService.startAttempt()` with the session's block id (an internal parameter no HTTP route reads — a client cannot place an attempt in a block; the persistence layer re-verifies ownership). Submit/skip/result/evidence use the existing `/v1/attempts/*` routes, so `chosenAnswer`/`isCorrect`/`timeSpentSeconds` stay server-derived (D-034), and training attempts are indistinguishable from ordinary ones to evidence, mastery, history and the recommendation. Training writes **no** autopsy, repair or mastery row (verified on real Postgres).
- **Published-only, no leakage.** Candidates come from the published, DNA-complete pool; the canonical-question reader re-checks publication when the attempt starts. No view carries an answer key, provider id, requirement, diagnostics or any score; the answer key appears only after submission through the existing result view.
- **Student-facing availability.** Per system: `available | not_applicable | no_eligible_question | unavailable | not_built`, with hand-authored notes (never a provider's own explanation text). A student with no evidence sees nothing startable — the intended, truthful state.

### API (all cookie-authenticated; identity/enrollment/clock/block are never read from the request)

| Route | Purpose |
|---|---|
| `GET /v1/training/systems` | Hub: every system + its availability + the active session |
| `POST /v1/training/sessions` `{ systemId, config }` | Start (or resume the same system's active session) |
| `GET /v1/training/sessions/:id` | The session, progress derived now |
| `POST /v1/training/sessions/:id/next` | Open question / next question / completed / no_question |
| `POST /v1/training/sessions/:id/finish` | Explicit end (409 while a question is open) |

Status convention: 401 no session, 403 someone else's session, 404 unknown, 409 wrong state, 400 malformed.

### Persistence (migration `0012_training_sessions`)

- `training_sessions` (`practice_block_id` UNIQUE, Restrict FK).
- A hand-written partial unique index `practice_sessions_one_active_per_enrollment` (≤ one `active` practice session per enrollment). `findActiveByEnrollmentId()` already failed closed on several active sessions and training creates the practice session on demand; without the index two racing first-starts could leave an enrollment's recommendations broken.
- `PrismaTrainingSessionRepository.create()` is one `Serializable` transaction (no orphan block). Verified with `prisma migrate deploy` from scratch and `prisma migrate diff` (no drift) on a disposable Postgres.

### Student UI

Dashboard → **Choose training** → `/training` (hub: seven cards, honest availability, a session-length choice on startable cards, a Resume card when a session is active) → `/training/:id` (objective + progress + the ordinary question player) → `/training/:id/result/:questionId` (the ordinary result/evidence screen; Continue returns to the session) → completion summary (observable counts only). The Training hub explains the difference from Practice.

### What Unit 1 intentionally does NOT implement

Calculation Gym / Speed Lab / Trap / Novelty / Pressure / Overtraining / Revision **algorithms** (the existing providers' algorithms are untouched); per-system presentation, rationale or progression; objective-specific completion rules beyond fixed count/duration; a session abandon/timeout trigger; new scores; ML; embeddings; RAG; confidence/psychology.

### Validation

See the Unit 1 validation record at the end of this file (test counts, real PostgreSQL, browser, concurrency, security/leakage).

### Known limitations (honest)

- **Availability depends on evidence.** Every provider's thresholds are PROVISIONAL and uncalibrated; none was run against real students. With the seed content a fresh student cannot start any system, and the dev content set is too small to make a system applicable — the real-DB and browser checks use QA-only published questions inserted into a disposable test database (never created by the seed or any application code path).
- **Pressure** still needs block-grouped evidence; training sessions are the first real producer of blocks, but whether a given student's blocks satisfy its applicability is untested on real data.
- A session cannot be abandoned by the system (no timeout trigger); an unfinished session simply stays `active` until the student resumes or ends it.
- The in-memory API wiring (development) does not enforce the one-open-attempt index unless asked; the real database does.
- A question with an open attempt *outside* the session (ordinary practice) that a training selection happens to pick yields a clear 409 rather than adopting that attempt.

### Unit 2 scope

Delivered in Unit 2 below (it was the planned scope here: Calculation Gym, student-facing, on this framework, with no new engine).

## Unit 1 validation record

**Tests.** Baseline before the unit: 2224 tests with Postgres (2155 passed + 69 skipped without). After: **2323 tests -- 2323/2323 with Postgres** (the last full run had one failure, `fetch failed: bad port`, an existing random-port flake in `prismaPersistence.integration.test.ts` where the test server bound a port `fetch` refuses; that file passes on rerun, together with the new training suite, 76/76) and **2247 passed + 76 skipped without Postgres**. +99 tests: domain `@ipmat/training-session` (28), repository contract (7), `TrainingApiService` over in-memory repositories (28), HTTP routes (8), web adapter/helpers/routes (about 20), and 7 real-Postgres tests. Typecheck, lint, `npm run build` and `git diff --check` are clean.

**Real PostgreSQL** (`postgres:16-alpine` on `127.0.0.1:55432`, throwaway password never written to the repo, the unrelated Postgres on 5432 untouched). `prisma migrate deploy` from scratch applies `0012`; `prisma migrate diff` reports no drift. Through the real HTTP server on the real Prisma repositories, with two independent instances: create -> a second instance reconstructs the identical session and resumes the SAME open question -> the attempt is answered through the ordinary route and persists as a normal finalized attempt in the block with sequence 1, 2 -> evidence and the global recommendation still work with an active training block -> completion; ownership (403 on every route for another student, 404 unknown); **12 parallel starts across two instances create exactly one training session, one block and one active practice session**, and the database itself rejects a second active practice session; **10 parallel `next` calls across two instances converge on one open question and one persisted attempt**; finish is refused (409) while a question is open and final afterwards; training writes no autopsy / repair plan / mastery row. This suite builds its own throwaway database (migrate + seed) so it never publishes anything into the shared test database that the other integration suites assume.

**Browser** (real `apps/web` on Vite + real `apps/api` in Prisma mode + the disposable Postgres, headless Edge over raw CDP; no fixture adapter): **42/42 checks.** Unauthenticated `/training` redirects to login; login -> dashboard (Training entry beside Practice) -> hub (seven cards; only Novelty startable; Revision/Overtraining "Not built yet."; unavailable cards give a reason, no score) -> choose a length and start -> session shows the objective and "0 of 3 questions done" -> a reload resumes the SAME question with no second attempt row -> **a full API process restart** resumes the same session and question -> submit through the ordinary flow to a real result (URL carries the attempt; a refresh re-reads it from the server) -> Continue returns to the session with a different question and progress 1 of 3 -> skip is reported as a skip -> third question -> "Session complete." with observable counts only, DB block `completed` with attempts 1..3, no autopsy/repair/mastery row written -> a finished session stays finished after a reload -> leaving mid-session shows a Resume card and no other training can start -> **another student opening the session URL is refused** and sees no question or session -> no unexpected console errors. The QA content was QA-only published clones of the seeded demonstration question inserted into the disposable database (and unpublished afterwards); it is a test fixture, not content.

**Security / leakage.** No view carries an answer key, provider id, requirement, diagnostics or a score (asserted on JSON and on rendered HTML); identity, enrollment, clock and block are never read from a request (smuggled fields change nothing; naming a block on `POST /v1/attempts` places nothing in it); the answer key appears only after submission through the existing result view; no confidence/emotion/motivation vocabulary in any view, helper or objective (asserted).

**Not claimed.** Outcome calibration; behavior of any provider's provisional thresholds on real students; live-model quality (no training path calls a model); Revision/Overtraining (no engine exists).

## Unit 2 — Calculation Gym

> **Unit 2 makes the EXISTING Calculation provider student-facing inside the Unit 1 session framework. It adds no Calculation algorithm, no score and no second state machine.** Full detail, the exact provider behavior and the limitations: [../PHASE_5_UNIT_2_REVIEW.md](../PHASE_5_UNIT_2_REVIEW.md); decision: D-076.

- **Defect fixed.** The provider's selection did not serve what its progression counts as stage evidence (foundational could serve an unseen heavy/multi-step question; mixed a timed one), so progression could stall. Three optional requirement fields restating progression's own stage shapes (`maxComputationalLoad`, `excludeMultiStep`, `excludeTimePressured`) fix it; no threshold, applicability rule, progression rule or tie-break changed.
- **Stages** (`foundational` / `mixed` / `time_pressured`, shown as "Stage 1 · Foundations", "Stage 2 · Heavier arithmetic", "Stage 3 · Under time pressure") are declared with authored, threshold-free copy in the catalog, read generically from the provider's requirement, and **derived from history on every read — never stored**.
- **Stage change** is derived by re-running the system as of before the session's last finalized attempt; shown once as "Next stage" / "Stage changed" with authored copy; identical after a restart / on a second instance.
- **Observable summary** on every session view (answered / skipped / correct / incorrect counts, time vs expected) and a completion screen that states it is a record of the session, not lasting progress. No percentage, rating or score anywhere.
- **UI:** a "Calculation Gym" session screen (stage, objective, "Question N of M", timer), a training context line above the ordinary result, a stage-transition notice, and an honest hub card (own explanation when not applicable; "No published question fits…" when applicable but short of content).

### Unit 2 validation record

**Tests.** After Unit 1: 2323. After Unit 2: **2375 tests -- 2375/2375 with Postgres** (216 files) and **2292 passed + 83 skipped without Postgres**. Typecheck, lint, `npm run build` and `git diff --check` clean. New/changed coverage: stage-shape alignment incl. a 300-pool x 3-stage property test (in-shape, order-independent, repeatable; no `Math.random`/clock in the provider), catalog/stage/parity tests, 22 Calculation session tests over the real provider, web adapter/helper tests, and 7 real-Postgres tests.

**Real PostgreSQL** (`postgres:16-alpine` on `127.0.0.1:55432`; the unrelated Postgres on 5432 untouched). The suite builds its OWN throwaway database (migrate + seed) and publishes a labelled synthetic TEST DATA pool (`[TEST DATA phase-5-unit-2] ...`, 19 questions) only there, then drops it: it asserts the real seeded published set is what the seed made and that the shared test database holds no synthetic row. Through the real HTTP server on the real Prisma repositories with two independent instances: no evidence => Calculation unavailable with its own explanation and a start is 409; stage-2 session => stage-2 question only (never light, multi-step or timed) => correct answer => next question is a stage-3 (timed) question with a forward "mixed -> time_pressured" transition => the other instance resumes the same open question and reconstructs the identical transition => completion summary (counts, expected time 180 s, stage 3); the persisted session row holds NO stage; stage-1 session serves only light single-step questions without repeats; 12 parallel starts => one session; 10 parallel `next` across two instances => one open attempt; ownership 403; training writes no autopsy/repair/mastery row and evidence for a training attempt is the ordinary evidence; when the catalogue leaves no qualifying question the card says `no_eligible_question` and a start is 409 (nothing substituted). Answer-key / provider-internal / psychological-wording scans clean.

**Browser** (real web on Vite + real API in Prisma mode + a second throwaway Postgres database with the synthetic pool, headless Edge over raw CDP): **43/43** on the main flow and **7/7** on error/loading states. Main flow: a fresh student sees Calculation disabled with its explanation; with evidence it is the one startable card (Revision/Overtraining "Not built yet."); session shows "Calculation Gym", "Stage 2 · Heavier arithmetic", the objective, "Question 1 of 3" and a timer; a reload and a full API process restart resume the same question and stage with no second attempt row; the correct answer shows the ordinary result with the Calculation context line; Continue shows the "Next stage" notice (Stage 3, authored note, no threshold/score/reason) and a timed question; a reload keeps it; a skip is a skip; no repeat inside the session; an incorrect answer is reported as such; completion shows completed/answered/skipped, "answered correctly 1 of 2", time vs expected, current stage, "Completed normally" and the record-of-this-session note with no mastery/improvement claim; DB: block completed, attempts 1..3, no stage persisted, no autopsy/repair/mastery rows; a finished session stays finished; with the catalogue short of content the card says "No published question fits this training right now." and nothing else is startable; another student opening the session URL is refused; the real seeded published set is unchanged; no console errors. States: with the API stopped the hub and the session each show a student-safe error with Try again / a way back, and Try again recovers (resuming the same open question). (One check was initially too broad -- it scanned the whole page, whose objective sentence legitimately contains the word "accuracy" -- and was narrowed to the notice card itself; no product change.)

**Not claimed.** Outcome calibration; real-student validation; behavior of the provisional thresholds on real content; live-model quality (none is involved).
