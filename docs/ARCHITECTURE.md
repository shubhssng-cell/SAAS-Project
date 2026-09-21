# Architecture

## 1. Repository state at time of writing

Greenfield. No prior code, framework, database, auth, API, UI, tests, or deployment exist. This document is the target architecture for Phase 1 (the vertical slice), not a description of what's implemented — implementation status is tracked in [MASTER_PLAN.md](MASTER_PLAN.md).

## 2. Style: modular monolith, not microservices

One deployable app, internally organized into domain modules with enforced boundaries (no cross-module reach into another module's internals — only through its public interface). Reasons:
- Team size is effectively one for the foreseeable future; microservices add operational cost with no matching benefit yet.
- The domains (concept graph, question engine, attempts, mastery, autopsy) are tightly coupled in the read path (a single practice screen touches all of them) — splitting them into services now would mean solving distributed-transaction problems for no reason.
- The AI-heavy, slow paths (generation, validation, autopsy hypothesis) are already isolated as **background jobs**, which is the actual scaling boundary that matters early. If a domain later needs independent scaling or a separate release cadence, it can be extracted because module boundaries already exist in code.

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One type system across UI, API, domain logic, and AI schema validation. Fewer serialization bugs between layers. |
| Frontend + BFF | Next.js (App Router) | Server components for data-heavy screens, API routes/server actions as the BFF, one deploy target. |
| Domain logic | Plain TypeScript packages, framework-agnostic | Concept graph, question engine, mastery, autopsy logic must not import Next.js or Prisma types directly — keeps them testable and portable if a module is ever extracted. |
| Database | PostgreSQL | Relational integrity for the concept graph and Question DNA foreign keys; JSONB columns for the parts of the schema that are expected to evolve quickly (difficulty-dimension breakdowns, trap taxonomy details) without becoming schemaless everywhere. |
| Cache / queues | Redis + BullMQ | Backs background jobs (generation, validation, autopsy hypothesis) and rate/idempotency keys for AI calls. |
| ORM | Prisma | Typed schema is the single source of truth for the domain model in [DATABASE.md](DATABASE.md); migrations are reviewable. |
| Validation | Zod | Every AI provider response is parsed through a Zod schema before it is trusted or persisted — see [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §2. Also used for API input validation. |
| Auth | Deferred — see [DECISIONS.md](DECISIONS.md) D-004 | Needs a decision on OTP-first (common for Indian student sign-up) vs. email/password vs. a managed provider. Not blocking for Phase 1 internal testing (can start with a single seeded test user). |
| Testing | Vitest (unit, domain logic), Playwright (e2e, added when there's a UI worth testing end-to-end) | Business logic (concept graph traversal, mastery computation, validation rules) is unit-tested; AI call sites are tested against recorded fixtures, not live calls. |
| Deployment | Vercel (app) + managed Postgres (Neon/Supabase) + managed Redis (Upstash) | Zero ops for a single-founder phase; all swappable later since nothing is Vercel-specific in the domain code. |

## 4. Repository layout (created incrementally — status noted per package)

```
/apps
  /web                 [not built] Next.js app: UI + API routes/server actions (the BFF)
/packages
  /domain              Framework-agnostic business logic, split by bounded context:
    /concept-graph        [built, Phase 1-2] Concept Universe: 8-type relationship graph, Concept Depth
    /examiner-lens        [built, Phase 2] Examiner Lens: WhatIsTested, TestingMode, error modes, combination derivation
    /question-engine      [built, Phase 2] Pattern families, taxonomy cells, coverage ladder, Question DNA validation
    /validation           [not built, Phase 3] Validation pipeline rules (math correctness, ambiguity, dedup)
    /attempts             [not built, Phase 4] Attempt recording, scoring
    /autopsy              [not built, Phase 5] Autopsy hypothesis orchestration, repair planning
    /mastery              [not built, Phase 5] Mastery computation (pure functions over attempt history)
    /prep-phase           [built, Phase 1] Calendar-aware phase + catch-up layer
  /ai                  [not built, Phase 3] Provider abstraction, prompt templates, Zod schemas for every AI call shape
  /db                  [built] Prisma schema (full domain model), migrations, seed data, generated client
  /jobs                [not built, Phase 3] BullMQ job definitions + workers (one worker per expensive AI task type)
/docs                  This directory
```

`/packages/domain/*` modules depend only on plain TS + other `/packages/domain/*` packages (e.g. `question-engine` depends on `concept-graph` and `examiner-lens`) + `/packages/ai` interfaces (never a concrete provider) — never on `/packages/db`'s Prisma client or types directly, to keep them testable without a live DB. `/packages/db`'s seed script is the one place that imports domain-package fixtures and writes them through Prisma; this is the correct dependency direction (infrastructure depends on domain, never the reverse). `/apps/web` (when built) is where concrete implementations get wired together for the UI.

## 5. Request/data flow (vertical slice)

**Authoring path (admin/offline, human-in-the-loop initially):**
`Concept Universe (curated + AI-assisted)` → `Examiner Lens analysis (AI, schema-validated, stored)` → `Question Universe taxonomy cells (derived from Lens output)` → `Question Generation job (AI, background)` → `Validation pipeline (automated checks + AI-judge + human review queue)` → published `Question` with complete `QuestionDNA`.

**Student path (live, must be fast):**
`Student requests practice` → app selects next question from already-validated bank (filtered by prep-phase + mastery gaps) → `Attempt` recorded (answer, time, hints, retries) → if wrong: `Autopsy` job enqueued (AI, background) → hypothesis returned to student for confirm/correct → confirmed diagnosis updates `MasteryState` and triggers `Targeted Repair` question selection.

The student path never blocks on a live AI call for question selection — only autopsy hypothesis generation is a background job the UI waits on (with a visible pending state), because it happens after the student has already submitted an answer and isn't blocking further practice.

## 6. Module boundaries that must hold from day one

- `question-engine` never talks to `/packages/ai` directly for anything student-facing at request time — generation is always a background job, never inline in a request handler.
- `mastery` is a pure function of `attempts` + `question DNA` + time. It must not read `prep-phase` state — phase and mastery are computed independently and only reconciled at the UI/recommendation layer (see [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §4.8).
- `prep-phase` is a pure function of `(examId, enrollmentDate, today)` plus a stored `PrepPhaseTemplate`/`CatchUpPlan`. It must not read `attempts` or `MasteryState` — the boundary runs both ways, not just from mastery's side. This is built and unit-tested in Phase 1, ahead of the practice UI, precisely because it's foundational rather than a later enhancement (see [DECISIONS.md](DECISIONS.md) D-009).
- `attempts` owns `AttemptEvent` as its append-only source of truth for timing and interaction history. `Attempt`'s own timestamp/count fields (`started_at`, `submitted_at`, `hints_used`, etc.) are denormalizations computed from the event log, never written independently of it — a new timing signal is a new `event_type`, not a new column.
- `autopsy` never writes a diagnosis as fact — its output type is always `hypothesis` until a student confirms it; only confirmed diagnoses are allowed to influence `mastery` or `repair`. Its `error_taxonomy_id` always references the `ErrorTaxonomy` table, never a free-form string.
- `examiner-lens` never stores a "combinations" list — it always recomputes combination candidates live from `concept-graph`'s `ConceptRelation` edges (`deriveCombinations()`). A stored, hand-maintained combinations column would be a second source of truth that could silently disagree with the graph.
- `question-engine`'s pattern-family coverage stage (`mapped`/`has_questions`/`validated`/`practice_ready`) is computed from `PatternTaxonomyCell` + `Question` rows on every read, never stored — same "derived, never input" discipline as `mastery`.
- Nothing outside `/packages/ai` constructs a prompt string or parses a raw LLM response. All call sites go through typed functions that return Zod-validated results or throw.

## 7. Environments

Single environment for Phase 1 (local + one deployed preview). No staged rollout infrastructure, no feature-flag system yet — not needed at this scale and would be premature per the project's own anti-over-engineering principle.
