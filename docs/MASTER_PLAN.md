# Master Plan

## Current state (2026-09-22)

Phase 1 and Phase 2 foundations implemented. Phase 1: full Prisma schema, initial migration, concept graph + error taxonomy + prep-phase seed data, `prep-phase` domain package. Phase 2: the concept graph deepened to 12 concepts / 16 richly-typed relationships across 8 chapters, `ConceptDepth` structure (full for Percentages, light for Ratio), `@ipmat/examiner-lens` (Examiner Lens domain model + combination derivation + structural validation), `@ipmat/question-engine` (4 pattern families, 8 taxonomy cells, the coverage readiness ladder, finalized Question DNA + validator, and a runnable deterministic demonstration). 44 unit tests passing, typecheck/lint/build clean across all 6 workspaces. Not yet done: applying either migration or running the seed script against a live Postgres instance — no database has been reachable in the implementing environment through either phase (see the Phase 1 and Phase 2 implementation reports). No student-facing UI, no AI provider integration, no real question generation yet — that's Phase 3+.

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

### Phase 3 — AI provider abstraction + question generation + validation pipeline
- AI provider abstraction (`/packages/ai`) with the Zod schema for exactly one task type first (`examiner-lens-analysis` — regenerating Percentages' Lens via AI, checked against the Phase 2 human-authored version), proven end-to-end, before adding the rest.
- Generation job targeting the 7 currently-`uncovered` Percentages taxonomy cells: independent re-derivation check, AI-judge pass, dedup check, human review gate for `hard`/`extreme`/`novel` tiers.
- Fill taxonomy cells for Percentages until each has a minimum viable question count across at least Standard/Advanced/Hard.

**Exit criterion:** a queryable, published question bank for Percentages exists where every row satisfies the Question DNA invariant (no nulls, provenance required), and the Phase 2 coverage ladder shows real families reaching `practice_ready` from actual generated (not hand-authored) content.

### Phase 4 — Student practice loop
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

Phase 1 → 2 are done (this pass and the previous one). Phase 3 next: the `/packages/ai` provider abstraction proven against exactly one task type (`examiner-lens-analysis`) before anything else touches AI, since every later generation/validation/autopsy task depends on that abstraction existing and being trustworthy.

## What should explicitly NOT be built yet

- Payments, subscriptions, or any pricing logic
- Parent portal or any secondary-account model
- Full question-bank buildout (pattern families, taxonomy cells, generated content) for any exam other than IPMAT, any section other than Quant, or any chapter other than Percentages. This does NOT mean the concept graph must pretend other chapters don't exist — Phase 2 deliberately reaches into Ratio, Averages, Profit and Loss, Data Interpretation, Algebra, and others as *neighbors in Percentages' graph*, each with a real chapter row and a real relationship. The restriction is on building those chapters out as first-class content targets themselves, not on acknowledging they exist.
- Social features (leaderboards, sharing, cohorts)
- SEO/marketing site
- Mock-test assembly engine or a large pre-built mock library
- Calculation Gym, Vocabulary Gym
- Surprise Mode, Trap Lab, Speed Lab, Pressure Lab as named features (their underlying data — `trap_error_taxonomy_id`, `testing_modes`, `expected_time_seconds` — already exists in the schema so they aren't blocked later, but no UI or job targets them now)
- Multi-tenant / coaching-org accounts
- Automated fine-tuning of any AI prompt from autopsy correction data (manual review only, for now)
- A polished admin UI — internal tooling for Phase 1–3 can be CLI scripts or bare pages

## Explicit go/no-go gate before starting chapter two

Do not start a second chapter until: the Percentages taxonomy has real coverage above a self-chosen threshold, the validation pipeline's rejection rate is low enough that it isn't a full-time babysitting job, and at least one real student has completed the full loop (practice → wrong answer → autopsy → repair → improved subsequent attempt) at least once. If any of those isn't true, the fix is to fix the slice, not to add breadth.
