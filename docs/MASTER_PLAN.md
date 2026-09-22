# Master Plan

## Current state (2026-09-22)

Phase 1, 2, and 3 implemented. Phase 1: full Prisma schema, initial migration, concept graph + error taxonomy + prep-phase seed data, `prep-phase` domain package. Phase 2: the concept graph deepened to 12 concepts / 16 richly-typed relationships across 8 chapters, `ConceptDepth`, `@ipmat/examiner-lens`, `@ipmat/question-engine` (pattern families, taxonomy cells, coverage ladder, finalized Question DNA). Phase 3: `@ipmat/ai` (provider-agnostic AI abstraction, 4 task schemas, cost/metadata tracking), `@ipmat/validation` (independent computation verification, quality validators), and a full single-blueprint generation pipeline with lifecycle management — proven via `FixtureProvider` (no live AI provider reachable in this environment; see the Phase 3 report). 92 unit tests passing, typecheck/lint/build clean across all 7 workspaces. Not yet done: applying any migration or running the seed script against a live Postgres instance (no database has ever been reachable across all three phases); any live AI provider call; filling the remaining 7 `uncovered` Percentages taxonomy cells (Phase 3.5, not started); any student-facing UI.

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

### Phase 3.5 (recommended, not started) — Scale generation for Percentages
The natural next step before Phase 4 has enough real content to be useful: run the Phase 3 pipeline (unmodified) against the remaining 7 taxonomy cells, with a real API key, producing a small but real Percentages question bank. This is infrastructure-light (no new packages needed) but needs: an `ANTHROPIC_API_KEY`, a decision on Phase 3's human-review-gate staffing for the `hard`/`extreme` cells that will hit `review_required`, and basic run logging (which cells were attempted, cost per run). Not a new domain package — just actually running what Phase 3 built, repeatedly, with real credentials.

### Phase 4 — Student practice loop
Depends on Phase 3.5 having produced more than one published question — with only the single Phase 2 demonstration question, a "practice loop" would have nothing to practice.
- `Student`/`Enrollment` already exist from Phase 1; `Attempt`/`AttemptEvent` tables already exist from Phase 1 — this phase is the first to actually write rows into them.
- Bare practice UI: serve a question from the published bank (filtered by concept, not yet by mastery gaps — that needs Phase 5's mastery computation), record the attempt (including `AttemptEvent` rows for at least `question_opened` and `answer_submitted` — richer event capture can be added incrementally without a schema change).
- No mastery, no autopsy yet — just correct/incorrect feedback and the correct solution shown.

**Exit criterion:** a real student (internal tester) can do 20 Percentages questions end-to-end and the attempts are recorded correctly.

### Phase 5 — Mastery + Question Autopsy + Targeted Repair
- `MasteryState` computation job (pure function over `Attempt`/`AttemptEvent` history) — table already exists from Phase 1.
- `Autopsy` pipeline: evidence assembly now draws on the full `AttemptEvent` log plus `reasoning_text`/`solution_opened_at` where present; hypothesis generation, confirm/correct UI, `RepairPlan` generation and delivery. `error_taxonomy_id` references the `ErrorTaxonomy` table seeded in Phase 1 and extended with `category` + real Percentages-specific codes in Phase 2 (grown further as real error patterns are observed).
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

Phase 1 → 2 → 3 are done. Next: Phase 3.5 (run the existing, unmodified Phase 3 pipeline against the remaining 7 Percentages taxonomy cells with a real API key) before Phase 4's practice loop, since Phase 4 needs more than one published question to be a meaningful loop.

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
