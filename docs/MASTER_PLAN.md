# Master Plan

## Current state (2026-09-22)

Phase 1, 2, 3, 3.1, 3.1.1, 4A, and 5A implemented. Phase 1: full Prisma schema, initial migration, concept graph + error taxonomy + prep-phase seed data, `prep-phase` domain package. Phase 2: the concept graph deepened to 12 concepts / 16 richly-typed relationships across 8 chapters, `ConceptDepth`, `@ipmat/examiner-lens`, `@ipmat/question-engine` (pattern families, taxonomy cells, coverage ladder, finalized Question DNA). Phase 3: `@ipmat/ai` (provider-agnostic AI abstraction, 4 task schemas, cost/metadata tracking), `@ipmat/validation` (independent computation verification, quality validators), and a full single-blueprint generation pipeline with lifecycle management. Phase 3.1 (AI pipeline hardening): fixed an answer-leakage structural gap in the independent verifiers, expanded blueprint-compliance checking to every field a candidate could drift on, fixed a type-blind bug in the Lens comparison, made answer parsing fail closed, marked difficulty calibration explicitly provisional, added validated generation limits with a runtime budget circuit breaker, and fixed a real type-signature bug in `@ipmat/ai` found while building the real-provider smoke test — see [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md). Phase 3.1.1 (final hardening from code review): fixed every issue [PHASE_3_1_CODE_REVIEW.md](PHASE_3_1_CODE_REVIEW.md) found — the budget breaker now fails closed on unpriced models, the arithmetic verifier's grammar is narrower with explicit bounds, a deterministic stem-leakage guard exists, Examiner Lens concept-name matching is normalized, and the AnthropicProvider/budget cost coupling is explicit and tested — see [PHASE_3_1_1_REVIEW.md](PHASE_3_1_1_REVIEW.md). Phase 4A (Student Attempt Intelligence): implemented the `Attempt` lifecycle state machine (`in_progress → submitted/skipped/abandoned`), the canonical `AttemptEvent` vocabulary, and a new, database-free `@ipmat/attempt` domain package (`startAttempt`/`recordAttemptEvent`/`submitAttempt`/`skipAttempt`/`finalizeAttempt`) where correctness and time-taken are structurally forgery-immune — see [PHASE_4A_REVIEW.md](PHASE_4A_REVIEW.md). Phase 5A (Question Autopsy Foundation): implemented the OBSERVATION -> EVIDENCE half of Autopsy (never HYPOTHESIS or CONFIRMED DIAGNOSIS) in a new, database-free `@ipmat/autopsy` domain package — deterministic behavior signals (correct/incorrect × fast/slow, answer changes, hints, solution use, skip), historical/repeated-evidence counts across prior attempts, and candidate (never confirmed) error-category evidence integrating the existing `ErrorTaxonomy`, plus type-only contracts (`AutopsyHypothesis`, `RepairContext`) for the phases after this one — see [PHASE_5A_REVIEW.md](PHASE_5A_REVIEW.md). 253 unit tests passing, typecheck/lint/build clean across all 9 workspaces. **The AI pipeline is still proven only via `FixtureProvider`** — a real `ANTHROPIC_API_KEY` has not been available in this environment through Phase 5A; the smoke-test script is written and ready (`npm run smoke:anthropic --workspace @ipmat/question-engine`) but has not been run. Not yet done: applying any migration or running the seed script against a live Postgres instance (no database has ever been reachable across all phases); any live AI provider call; filling the remaining 7 `uncovered` Percentages taxonomy cells (Phase 3.5, not started); a Prisma-backed persistence adapter for `Attempt`/`AttemptEvent` (Phase 4A's domain logic is pure and database-free by design — see D-034); the actual HYPOTHESIS-generating AI call and `Autopsy`/`RepairPlan` persistence (Phase 5B); any student-facing UI; the Mastery Engine; adaptive question selection.

## Build phases

### Phase 0 — Audit + Architecture (this pass)
Repository audit (trivial — nothing existed), product spec, architecture, database, AI architecture, question engine design, this plan, decisions log, CLAUDE.md. No application code.

### Phase 1 — Scaffold + data foundation + calendar-awareness core
- Repo scaffold per [ARCHITECTURE.md](ARCHITECTURE.md) §4 (`/apps/web`, `/packages/*`) — created incrementally, only what's needed for the slice.
- Prisma schema for **all** tables in [DATABASE.md](DATABASE.md) — the full domain model (including `Attempt`, `AttemptEvent`, `ErrorTaxonomy`, `Autopsy`, `RepairPlan`, `MasteryState`) is written and migrated now so Phase 4–5 never need a redesign. Writing the schema now is not the same as using it: no application code reads or writes `Attempt`/`Autopsy`/`MasteryState` until Phase 4–5 — those tables simply exist, empty, with correct constraints.
- **Calendar-awareness core (moved up from Phase 6 — see [DECISIONS.md](DECISIONS.md) D-009):**
  - `Student`, `Enrollment`, `PrepPhaseTemplate`, `CatchUpPlan` tables.
  - `/packages/domain/prep-phase` with `computePrepPhase(examId, enrollmentDate, today)` and `applyCatchUp(phase, catchUpPlan)` as pure, framework-agnostic functions.
  - Seed one deliberately simple `PrepPhaseTemplate` curve for IPMAT.
  - This is domain logic and data only — no phase UI. The UI is still Phase 6.
- AI provider abstraction (`/packages/ai`) with the Zod schema for exactly one task type first (`examiner-lens-analysis`), proven end-to-end, before adding the rest.
- Seed: IPMAT exam, Quant section, Percentages chapter, a small human-curated concept graph (Percentages + its immediate neighbors).
- Minimal auth: a single seeded internal user is acceptable to unblock Phase 2–3 development; the real auth decision ([DECISIONS.md](DECISIONS.md) D-004) is made before any external student touches the product, not before.

**Exit criteria:**
1. A unit test loads the seeded Percentages concept graph and asserts a known prerequisite/combination edge exists.
2. A unit test proves `computePrepPhase` returns different expected-coverage curves for two students with different `enrolled_at` dates against the same `PrepPhaseTemplate`.
3. A unit test proves `applyCatchUp` never mutates the underlying `PrepPhaseTemplate` row — it returns an adjusted curve, the template's `phase_curve` is byte-for-byte unchanged in the database before and after.
4. A unit test (or explicit code-boundary check) proves `computePrepPhase`/`applyCatchUp` never read `MasteryState` — calendar phase and mastery are computed from disjoint inputs.

### Phase 2 — Concept Intelligence + Examiner Lens ✅ done (this pass)
- Deepened the Percentages concept graph from 7 to 12 concepts and from a 3-type to an 8-type relationship model (`prerequisite`, `foundational`, `directly_related`, `commonly_combined`, `application`, `dependent`, `advanced_extension`, `related_but_distinct`), each edge carrying rationale, shared knowledge, a requirement level, and an honest certainty marker.
- Added `ConceptDepth` (definition, intuition, formulas, methods, shortcuts, misconceptions, traps, application areas, difficulty progression) — full for Percentages, light for Ratio.
- Built `@ipmat/examiner-lens`: normalized `WhatIsTested`, the 10-value `TestingMode` vocabulary, graph-derived combinations (never hand-authored), error modes sharing `ErrorTaxonomy`'s 5-category vocabulary, dimensional difficulty, and structural validation (including a guard against false-completeness claims in free text).
- Built `@ipmat/question-engine`: `QuestionPatternFamily` (the structure of a question) vs. `PatternTaxonomyCell` (one concrete slice of it), the `mapped → has_questions → validated → practice_ready` coverage ladder (computed, never stored), and `validateQuestionDna()`.
- Finalized Question DNA on the `Question` table itself: `combinesWithConceptIds`, `noveltyLevel`, `examRelevance`, `testingModes[]`, and `trapErrorTaxonomyId` (FK) replacing the earlier free-text `transformation`/`trap_type` placeholders.
- One hand-authored demonstration question (Reverse Percentage, `published`, full provenance) proves the DNA schema against a real example — not a question bank.
- A deterministic demonstration script (`npm run demo:percentages --workspace @ipmat/question-engine`) shows Percentages as a graph node with real prerequisites, connections, pattern families, traps, difficulty dimensions, and one worked Question DNA example.

**Exit criteria:** ✅ a human-authored, structurally-validated `ExaminerLensAnalysis` exists for Percentages; ✅ the pattern-family/taxonomy-cell tables exist with a coverage number that is true (1 of 8 cells `covered`, honestly); ✅ 44 unit tests prove relationship typing, directionality, combination derivation, coverage computation, and DNA validation; ✅ typecheck/lint/build clean. Not applied to a live database (see Phase 2 report).

### Phase 3 — AI provider + question generation + validation (proof of concept) ✅ done (this pass)
Deliberately scoped as a proof-of-concept, not a content factory (explicit instruction this phase): prove the pipeline is reliable for ONE blueprint before scaling it to fill the taxonomy.

- `@ipmat/ai`: provider-agnostic `generateStructured()` (retries with validation-error feedback, exponential backoff, timeout, per-call metadata including estimated cost), `FixtureProvider` (deterministic, used everywhere in this repo) and `AnthropicProvider` (real, implemented, unexercised — no API key configured in this environment). Zod schemas for 4 task types: `examiner-lens-analysis`, `question-generation`, `answer-reverification`, `validation-judge`. Has zero dependency on any domain package (docs/DECISIONS.md D-017).
- Examiner Lens regeneration + comparison: `buildLensComparisonReport()` diffs an AI-regenerated Lens against the Phase 2 human baseline (never overwritten), surfacing agreement, invented (`unsupportedByGraph`) and missed (`missedByAi`) relationships, and completeness-claim detection.
- `@ipmat/validation`: independent computation verification (`mathjs`, with an untrusted-input allowlist guard — docs/DECISIONS.md D-018), independent re-derivation comparison, structural quality validators (blueprint compliance, syllabus compatibility, single-correct-answer, no-completeness-claim, provenance), and a token-overlap duplicate-risk check (interim, docs/DECISIONS.md D-019).
- `@ipmat/question-engine` additions: `QuestionBlueprint` (deterministic, built from one real `PatternTaxonomyCell`, no AI involved), `runGenerationPipeline()` (the full blueprint → AI generation → independent verification → quality validation → candidate chain), and the question lifecycle (`draft → generated → validated/review_required → approved → published/rejected → deprecated`).
- Three runnable demonstrations: a valid generation run, a deliberately invalid candidate being rejected with a readable report, and the human-vs-AI Lens comparison.
- 9 deterministic fixtures covering every rejection path named in the phase brief (malformed, ambiguous, multiple-correct-answer, wrong-answer, blueprint-violation, out-of-syllabus, duplicate, unsupported-completeness-claim, plus the valid path).

**Exit criteria:** ✅ one AI-generated candidate passes the full pipeline end-to-end (via `FixtureProvider`) and reaches `validated`; ✅ one deliberately invalid candidate is rejected with specific, itemized reasons; ✅ the Lens comparison report runs against real fixture data and correctly flags an invented relationship and missed ones; ✅ 92 unit tests (up from 44) covering every rejection path; ✅ typecheck/lint/build clean across all 7 workspaces. **Explicitly NOT done** (by design, not oversight): filling the 7 remaining `uncovered` Percentages taxonomy cells, any live AI provider call, any background job/queue, any automated publishing.

### Phase 3.1 — AI Pipeline Hardening ✅ done (this pass)
Fixed the weaknesses [PHASE_REVIEW.md](PHASE_REVIEW.md) identified in Phases 1-3, before trusting real AI-generated content to anything. See [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md) for the full report.

- Independent verifiers (reverification, judge) now receive a structurally narrow `PresentedQuestionView`/`JudgeView` — never the full candidate — making answer leakage a type error, not a prompt-authoring discipline (docs/DECISIONS.md D-020).
- Examiner Lens comparison now distinguishes 4 combination categories instead of 2, fixing a type-blind bug that counted a `related_but_distinct` edge as "supported" just because an edge existed (D-023).
- `correctAnswer` parsing fails closed (`unverifiable_answer`) instead of silently skipping the cross-check on an unparseable value — and no longer treats an empty string as `0` (D-024).
- Difficulty dimensions on a blueprint are explicitly marked `difficultyCalibrationStatus: "provisional"` — no attempt was made to invent a more convincing-looking formula (D-021).
- Blueprint-compliance checking expanded from 3 fields (id, concept, pattern family) to cover difficulty tier, every required testing mode, the specified trap, and the exact combination-concept set (D-022).
- `GenerationLimits` (blueprint count, candidates per blueprint, retries, total attempts, budget) are validated before any AI call, and the pipeline now tracks running estimated cost and skips remaining calls once a run's budget is exceeded (D-025).
- Found and fixed a real type-signature bug in `@ipmat/ai`'s `generateStructured` (`ZodSchema<T>` → `ZodType<T, any, any>`) while building the real-provider smoke-test script — the Examiner Lens regeneration task specifically would have failed to typecheck the moment anyone called it with an explicit type parameter (D-026).
- Wrote (but has not run) a real Anthropic smoke-test script that never falls back to `FixtureProvider` on failure.

**Exit criteria:** ✅ 118 unit tests (up from 92), including dedicated leakage-proof and fail-closed tests; ✅ typecheck/lint/build clean across all 7 workspaces. **Not done:** the real Anthropic smoke test itself — no `ANTHROPIC_API_KEY` was available in this environment during Phase 3.1 (the user was asked and chose to defer it). All of the above fixes are proven only against `FixtureProvider` and deterministic fixtures.

### Phase 3.5 (recommended, not started) — Scale generation for Percentages
Depends on the real Anthropic smoke test actually running first (Phase 3.1 left this pending) — no sense scaling a pipeline that hasn't been proven against a real model even once. Once that's done: run the Phase 3/3.1 pipeline (unmodified) against the remaining 7 taxonomy cells, with a real API key, producing a small but real Percentages question bank. This is infrastructure-light (no new packages needed) but needs: an `ANTHROPIC_API_KEY`, a decision on the human-review-gate staffing for the `hard`/`extreme` cells that will hit `review_required`, and basic run logging (which cells were attempted, cost per run, now straightforward given Phase 3.1's `GenerationLimits`/budget tracking). Not a new domain package — just actually running what Phase 3/3.1 built, repeatedly, with real credentials.

### Phase 4A — Student Attempt Intelligence ✅ done (this pass)
Pulled forward, ahead of Phase 3.5/4B, because it does not depend on there being many published questions — it can be, and was, fully built and tested against fixtures. See [PHASE_4A_REVIEW.md](PHASE_4A_REVIEW.md) for the full report.

- `AttemptStatus` enum (`in_progress | submitted | skipped | abandoned`) and `attempts.status`/`attempts.finalized_at` columns added (migration `0003_attempt_lifecycle`); `AttemptEventType` renamed to a canonical vocabulary (`question_opened`, `answer_selected`, `answer_changed`, `hint_opened`, `solution_opened`, `question_skipped`, `answer_submitted`, plus Phase 5's reserved `working_input_changed`/`reasoning_submitted`) — docs/DECISIONS.md D-034.
- New, database-free `packages/domain/attempt`: `startAttempt()`, `recordAttemptEvent()`, `submitAttempt()`, `skipAttempt()`, `finalizeAttempt()` — a pure state machine operating on an in-memory `AttemptState`, never mutating its input.
- `chosenAnswer`, `isCorrect`, and `timeSpentSeconds` are structurally forgery-immune: derived from the recorded event log and the authoritative question record, never accepted as parameters a caller could set directly (docs/DECISIONS.md D-034).
- Answer-change history (initial/final answer, change count, full sequence) is a derived view over the event log, never a stored column (`deriveAnswerChangeHistory()`), matching the "derive, don't cache" discipline already used for `MasteryState`/coverage (D-015).
- Contract-only projections for the next two phases: `toAutopsyEvidence()` (observable evidence only — structurally cannot express confidence/motivation/emotion, D-005/D-006) and `toMasteryContribution()` (per-attempt facts only — no mastery score computed).
- 46 new unit tests covering the full state machine, every rejection path, forged-client-correctness/timing resistance, and both contract projections.

**Exit criteria:** ✅ the state machine enforces every invariant named in the phase brief (no double-finalization, no events after finalization, no client-forgeable correctness/timing, skip distinguishable from incorrect/abandoned/submitted); ✅ 46 new tests (192 total, up from 146); ✅ typecheck/lint/build clean across all 8 workspaces. **Explicitly NOT done** (by design): no Prisma-backed persistence adapter (no live database has ever been reachable), no student-facing UI, no AI provider call, no question-batch generation.

### Phase 4B — Student practice loop (UI + persistence wiring)
Depends on Phase 3.5 having produced more than one published question — with only the single Phase 2 demonstration question, a "practice loop" would have nothing to practice — AND on a Prisma-backed persistence adapter around Phase 4A's `@ipmat/attempt` domain package (the "cannot submit a nonexistent attempt" guard is currently only a null-check at the pure-domain layer; a real "attempt not found in the database" case needs that adapter).
- `Student`/`Enrollment` already exist from Phase 1; `Attempt`/`AttemptEvent` tables and the lifecycle logic to write them already exist from Phase 4A — this phase is the first to actually persist rows and serve a live loop.
- Bare practice UI: serve a question from the published bank (filtered by concept, not yet by mastery gaps — that needs Phase 5's mastery computation), call into `@ipmat/attempt`'s lifecycle functions, persist the resulting `AttemptState` via the new adapter.
- No mastery, no autopsy yet — just correct/incorrect feedback and the correct solution shown (Phase 4A's `toAutopsyEvidence()`/`toMasteryContribution()` contracts exist and are tested, but nothing consumes them until Phase 5).

**Exit criterion:** a real student (internal tester) can do 20 Percentages questions end-to-end and the attempts are recorded correctly in a live database.

### Phase 5A — Question Autopsy Foundation ✅ done (this pass)
Implements only the first two layers of OBSERVATION -> EVIDENCE -> HYPOTHESIS -> CONFIRMED DIAGNOSIS. See [PHASE_5A_REVIEW.md](PHASE_5A_REVIEW.md) for the full report.

- New, database-free `packages/domain/autopsy`: `AutopsyQuestionContext` (restated Question DNA, without duplicating `expectedTimeSeconds` which `@ipmat/attempt`'s evidence already carries), `deriveBehaviorSignals()` (correct/incorrect × fast/slow, answer-change, hint, solution, skip, no-answer, time-above/below-expected — all against centralized `AUTOPSY_THRESHOLDS`), `deriveHintSolutionEvidence()` (genuine event-order comparison, not assumed), `deriveHistoricalSignals()` (repeated-failure/repeated-behavior counts across supplied prior attempts, `null` — not zero — when no history exists or a pattern hasn't reached the repeated threshold), `deriveCandidateErrorEvidence()` (a deterministic, non-AI pattern match against the question's designated trap and the EXISTING `ErrorTaxonomy` — never a second taxonomy, never auto-confirmed), and `buildAutopsyOutput()` (the orchestrator).
- Two type-only, unimplemented contracts for later phases: `AutopsyHypothesis` (HYPOTHESIS layer — no function constructs one; that's Phase 5B's AI call) and `RepairContext` (which DOES get a simple deterministic builder, `buildRepairContext()`, since identifying a target/priority/training-mode from already-computed evidence is not the same as generating or selecting actual follow-up questions, which remains out of scope).
- 61 new tests, including explicit regression tests proving a large success history doesn't manufacture a universal diagnosis, a single failure never becomes "repeated" or "confirmed," a 4-point answer-change sequence survives unchanged through the whole pipeline, and a correct-but-3x-slow attempt is reported as both simultaneously — plus structural tests proving no field anywhere represents confidence/motivation/emotion/intelligence/anxiety/laziness/carelessness/intent.

**Exit criteria:** ✅ every deterministic signal named in the phase brief is implemented and centrally-thresholded; ✅ candidate error evidence is structurally distinct from confirmed diagnosis (no `confirmed` field exists on it anywhere); ✅ 61 new tests (253 total, up from 192); ✅ typecheck/lint/build clean across all 9 workspaces. **Explicitly NOT done** (by design): no AI call, no hypothesis generation, no `Autopsy`/`RepairPlan` database writes, no Mastery Engine, no adaptive question selection, no student UI.

### Phase 5B — Hypothesis generation + confirmation loop + Mastery Engine + Targeted Repair
- `MasteryState` computation job (pure function aggregating many `@ipmat/attempt` `toMasteryContribution()` records per student/concept, per Question DNA) — table already exists from Phase 1, the per-attempt input contract already exists from Phase 4A.
- The actual HYPOTHESIS-generating AI call: consumes `@ipmat/autopsy`'s `AutopsyOutput` (Phase 5A) — not raw `Attempt`/`AttemptEvent` rows — to produce a real `AutopsyHypothesis` (the type Phase 5A defined but never populated), plus `reasoning_text` where present (reserved since Phase 1, still unread). Confirm/correct UI, `RepairPlan` generation and delivery (consuming Phase 5A's `RepairContext` as its starting point, then actually selecting/generating follow-up questions — the one thing Phase 5A explicitly left undone). `error_taxonomy_id` references the same `ErrorTaxonomy` table Phase 5A already integrates (seeded in Phase 1, extended in Phase 2, grown further as real error patterns are observed).
- Practice question selection starts using `MasteryState` + `PatternTaxonomyCell` coverage instead of a flat queue.

**Exit criterion:** a wrong answer produces a hypothesis, the student can confirm or correct it, and a confirmed diagnosis visibly changes what question the student sees next.

### Phase 6 — Calendar-aware prep phase UI
The domain model and core calculation (`computePrepPhase`, `applyCatchUp`, `PrepPhaseTemplate`, `CatchUpPlan`) were already built and unit-tested in Phase 1. This phase is UI-only:
- Surface the student's current phase and any catch-up overlay in the practice experience.
- Refine `PrepPhaseTemplate.phase_curve` for IPMAT using real cohort data from Phases 4–5, now that actual attempt history exists.

**Exit criterion:** two real (not just seeded-test) students with different enrollment dates visibly get different recommended next-actions in the UI, and mastery data is unaffected by which phase they're in (verified by the Phase 1 boundary test still passing).

### Phase 7 — Vertical slice hardening
Dogfood internally, fix correctness issues found in generated content, tighten validation thresholds based on real rejection-rate data, write down what broke in [DECISIONS.md](DECISIONS.md). Only after this phase is genuinely solid does chapter two (or any breadth work) start.

## What should be implemented FIRST

Phase 1 → 2 → 3 → 3.1 → 3.1.1 → 4A → 5A are done. Next, in order: (1) actually run the real-Anthropic smoke test (`npm run smoke:anthropic --workspace @ipmat/question-engine`) — nothing about the pipeline's behavior against a real model is verified until this happens at least once; (2) Phase 3.5 (run the pipeline against the remaining 7 Percentages taxonomy cells with a real API key) before Phase 4B's practice loop, since Phase 4B needs more than one published question to be a meaningful loop; (3) Phase 4B also needs a Prisma-backed persistence adapter around Phase 4A's `@ipmat/attempt` package, not built yet since no live database has ever been reachable in this environment; (4) Phase 5B (the actual hypothesis-generating AI call, built on Phase 5A's `AutopsyOutput`) depends on the same real-provider smoke test as (1), plus real attempt data from Phase 4B, so it naturally sequences after both.

## What should explicitly NOT be built yet

- Payments, subscriptions, or any pricing logic
- Parent portal or any secondary-account model
- Full question-bank buildout (pattern families, taxonomy cells, generated content) for any exam other than IPMAT, any section other than Quant, or any chapter other than Percentages. This does NOT mean the concept graph must pretend other chapters don't exist — Phase 2 deliberately reaches into Ratio, Averages, Profit and Loss, Data Interpretation, Algebra, and others as *neighbors in Percentages' graph*, each with a real chapter row and a real relationship. The restriction is on building those chapters out as first-class content targets themselves, not on acknowledging they exist.
- Massive/automated question-generation batches, thousands of questions, or automated publishing (Phase 3 explicitly proved the pipeline on one blueprint at a time; scaling it up is Phase 3.5's job, still bounded to Percentages)
- A full BullMQ job queue/worker system for AI generation (Phase 3's pipeline is a plain async function today — see docs/AI_ARCHITECTURE.md §8)
- Social features (leaderboards, sharing, cohorts)
- SEO/marketing site
- Mock-test assembly engine or a large pre-built mock library
- Calculation Gym, Vocabulary Gym
- Surprise Mode, Trap Lab, Speed Lab, Pressure Lab as named features (their underlying data — `trap_error_taxonomy_id`, `testing_modes`, `expected_time_seconds` — already exists in the schema so they aren't blocked later, but no UI or job targets them now)
- Multi-tenant / coaching-org accounts
- Automated fine-tuning of any AI prompt from autopsy correction data (manual review only, for now)
- A polished admin UI — internal tooling for Phase 1–3 can be CLI scripts or bare pages
- A full coaching-material ingestion pipeline or general-purpose AI chatbot

## Explicit go/no-go gate before starting chapter two

Do not start a second chapter until: the Percentages taxonomy has real coverage above a self-chosen threshold, the validation pipeline's rejection rate is low enough that it isn't a full-time babysitting job, and at least one real student has completed the full loop (practice → wrong answer → autopsy → repair → improved subsequent attempt) at least once. If any of those isn't true, the fix is to fix the slice, not to add breadth.
