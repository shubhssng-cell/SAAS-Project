# Master Plan

## Current state (2026-09-22)

Greenfield repository. No code written yet. This planning/docs pass is Phase 0.

## Build phases

### Phase 0 — Audit + Architecture (this pass)
Repository audit (trivial — nothing existed), product spec, architecture, database, AI architecture, question engine design, this plan, decisions log, CLAUDE.md. No application code.

### Phase 1 — Scaffold + data foundation
- Repo scaffold per [ARCHITECTURE.md](ARCHITECTURE.md) §4 (`/apps/web`, `/packages/*`) — created incrementally, only what's needed for the slice.
- Prisma schema for the tables in [DATABASE.md](DATABASE.md) that Phase 1–2 actually touch: `Exam`, `Section`, `Chapter`, `Concept`, `ConceptRelation`, `ExaminerLensAnalysis`, `PatternTaxonomyCell`, `Question`, `Provenance`. (Student/Attempt/Autopsy/Mastery tables come in Phase 4–5, not before — no speculative migrations.)
- AI provider abstraction (`/packages/ai`) with the Zod schema for exactly one task type first (`examiner-lens-analysis`), proven end-to-end, before adding the rest.
- Seed: IPMAT exam, Quant section, Percentages chapter, a small human-curated concept graph (Percentages + its immediate neighbors).
- Minimal auth: a single seeded internal user is acceptable to unblock Phase 2–3 development; the real auth decision ([DECISIONS.md](DECISIONS.md) D-004) is made before any external student touches the product, not before.

**Exit criterion:** `pnpm test` runs a unit test that loads the seeded Percentages concept graph and asserts a known prerequisite/combination edge exists.

### Phase 2 — Examiner Lens + Question Universe for Percentages
- Run Examiner Lens generation against the seeded Percentages graph; human review and approve/edit the stored analysis.
- Derive `PatternTaxonomyCell` rows from the approved analysis.
- Build the smallest possible internal view (CLI output or a bare admin page — not a polished UI) to inspect coverage.

**Exit criterion:** a real, human-reviewed `ExaminerLensAnalysis` exists for Percentages, and the taxonomy table has a coverage number that is true (not stubbed).

### Phase 3 — Question generation + validation pipeline
- Generation job, independent re-derivation check, AI-judge pass, dedup check, human review gate for extreme/novel tiers.
- Fill taxonomy cells for Percentages until each has a minimum viable question count across at least Standard/Advanced/Hard.

**Exit criterion:** a queryable, published question bank for Percentages exists where every row satisfies the Question DNA invariant (no nulls, provenance required).

### Phase 4 — Student practice loop
- `Student`, `Enrollment`, `Attempt` tables.
- Bare practice UI: serve a question from the published bank (filtered by concept, not yet by mastery gaps — that needs Phase 5's mastery computation), record the attempt.
- No mastery, no autopsy yet — just correct/incorrect feedback and the correct solution shown.

**Exit criterion:** a real student (internal tester) can do 20 Percentages questions end-to-end and the attempts are recorded correctly.

### Phase 5 — Mastery + Question Autopsy + Targeted Repair
- `MasteryState` computation job (pure function over `Attempt` history).
- `Autopsy` pipeline: hypothesis generation, confirm/correct UI, `RepairPlan` generation and delivery.
- Practice question selection starts using `MasteryState` + `PatternTaxonomyCell` coverage instead of a flat queue.

**Exit criterion:** a wrong answer produces a hypothesis, the student can confirm or correct it, and a confirmed diagnosis visibly changes what question the student sees next.

### Phase 6 — Calendar-aware prep phase
- `PrepPhaseTemplate` for IPMAT (a first, deliberately simple curve — refine later with real cohort data).
- `CatchUpPlan` overlay logic.
- Since only one chapter exists at this point, this phase is mostly plumbing and unit tests on the phase-curve function, not a lot of visible UI change.

**Exit criterion:** two seeded test students with different enrollment dates get different recommended next-actions, and a unit test proves the phase template itself didn't change between them.

### Phase 7 — Vertical slice hardening
Dogfood internally, fix correctness issues found in generated content, tighten validation thresholds based on real rejection-rate data, write down what broke in [DECISIONS.md](DECISIONS.md). Only after this phase is genuinely solid does chapter two (or any breadth work) start.

## What should be implemented FIRST

Phase 1 → 2, in the order listed above. Concretely, the very first code artifact should be the Prisma schema plus the seed script for the Percentages concept graph — everything else (AI calls, UI) depends on that data existing and being correct.

## What should explicitly NOT be built yet

- Payments, subscriptions, or any pricing logic
- Parent portal or any secondary-account model
- Any exam other than IPMAT, any section other than Quant, any chapter other than Percentages
- Social features (leaderboards, sharing, cohorts)
- SEO/marketing site
- Mock-test assembly engine or a large pre-built mock library
- Calculation Gym, Vocabulary Gym
- Surprise Mode, Trap Lab, Speed Lab, Pressure Lab as named features (their underlying data — `trap_type`, `expected_time_seconds` — already exists in the schema so they aren't blocked later, but no UI or job targets them now)
- Multi-tenant / coaching-org accounts
- Automated fine-tuning of any AI prompt from autopsy correction data (manual review only, for now)
- A polished admin UI — internal tooling for Phase 1–3 can be CLI scripts or bare pages

## Explicit go/no-go gate before starting chapter two

Do not start a second chapter until: the Percentages taxonomy has real coverage above a self-chosen threshold, the validation pipeline's rejection rate is low enough that it isn't a full-time babysitting job, and at least one real student has completed the full loop (practice → wrong answer → autopsy → repair → improved subsequent attempt) at least once. If any of those isn't true, the fix is to fix the slice, not to add breadth.
