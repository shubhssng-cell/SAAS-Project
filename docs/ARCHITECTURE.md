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
  /web                 [not built] Next.js app: UI + API routes/server actions (the BFF) -- the PRODUCTION student experience
  /training-playground [built, Phase 5E-PLAYGROUND] Vite + React INTERNAL development/debug tool only -- never the production student app. Dispatches deterministic fixture scenarios directly to the real public domain entry points (runTrainingSystemProvider()/orchestrateNextTrainingAction()) and displays their real, unmodified output; the ONLY domain-calling file (src/domain/runScenario.ts) is a pure input-shape adapter with zero decision logic of its own. No Prisma, no live DB, no Anthropic/AI call, no auth. See docs/DECISIONS.md D-057 and apps/training-playground/README.md
/packages
  /domain              Framework-agnostic business logic, split by bounded context:
    /concept-graph        [built, Phase 1-2] Concept Universe: 8-type relationship graph, Concept Depth
    /examiner-lens        [built, Phase 2] Examiner Lens: WhatIsTested, TestingMode, error modes, combination derivation
    /question-engine      [built, Phase 2-3] Pattern families, taxonomy cells, coverage ladder, Question DNA validation, generation pipeline
    /validation           [built, Phase 3] Validation pipeline rules (math correctness, ambiguity, dedup)
    /attempt              [built, Phase 4A] Attempt lifecycle state machine, canonical AttemptEvent vocabulary
    /autopsy              [built, Phase 5A-5B] OBSERVATION -> EVIDENCE -> HYPOTHESIS -> CONFIRMED DIAGNOSIS, RepairPlan
    /mastery              [built, Phase 5B] Multidimensional mastery computation (pure functions over attempt history)
    /repair-selection     [built, Phase 5C-2] Deterministic TARGETED repair question selection from a confirmed RepairPlan (NOT the global adaptive engine — that's Phase 5C-3)
    /adaptive-selection   [built, Phase 5C-3 -- deterministic core only, no UI/wiring] Global adaptive question selection: named, ordered training-need reason codes ranked over MasteryState/RepairPlan/exposure signals, never a numeric score, never a delegation to repair-selection
    /training-orchestration [built, Phase 5D -- deterministic core only, no labs/API/UI] Coordinates repair-selection (5C-2) and adaptive-selection (5C-3) through their public contracts only -- chooses targeted_repair vs adaptive_practice vs no_action by named policy, never reimplements either engine's matching/ranking logic
    /training-systems    [built, Phase 5E-1 -- shared contract only, no concrete providers] The common TrainingSystemProvider contract every future training mode (Calculation Gym/Speed Lab/Trap Lab/Novelty/Pressure/Revision/Mock -- none implemented) will conform to. Ships only types plus a diagnostics-default constructor and an evaluate-then-select runner -- no ranking/filtering utility of any kind, so a provider cannot recreate adaptive-selection/repair-selection semantics from the shared contract itself
    /calculation-gym     [built, Phase 5E-2 -- first concrete TrainingSystemProvider, no orchestration wiring] Narrow calculation/mechanical-friction training mode: compares accuracy conditioned on Question DNA's provisional computationalLoad metadata (never presented as measured "calculation ability"), keeping conceptual/calculation/speed weakness structurally distinct; independently-gated foundational->mixed->time_pressured progression; provider-local selection limited to exposure/load-proximity/questionId tie-breaks only, never a composite score
    /speed-lab           [built, Phase 5E-3 -- second concrete TrainingSystemProvider, no orchestration wiring] Narrow general time-efficiency training mode: an immutable, correctness-independent denominator over correct-and-slow evidence (conditioned on low conceptualLoad, hint-free, non-time-pressured), never reading computationalLoad; disjoint, count-based steady_pace->mixed_pace->time_constrained progression (never rate-based, to avoid mathematically contradicting its own applicability trigger); time_constrained deliberately scoped narrower than a future Pressure Training system; provider-local selection limited to exposure/expected-time/questionId tie-breaks only, never a composite score
    /trap-lab            [built, Phase 5E-4 -- third concrete TrainingSystemProvider, no orchestration wiring] Narrow "trap-associated failure recurrence" training mode: candidate-level (never confirmed) recurrence of a SINGLE error-taxonomy CODE across distinct failing questions, evaluated cross-concept (concept is optional selection-time scope, never part of a code's identity) and cumulative with no recency/decay; no progression vocabulary (no evidenced graduated dimension exists to gate one); optional ErrorTaxonomy enrichment never changes the applicability decision, only diagnostic wording; provider-local selection prefers unvisited taxonomy cells then least exposure then questionId; every explanation/diagnostic string is regression-tested against confirmation-implying language ("confirmed"/"proven"/"diagnosed"/"student's reasoning")
    /novelty-training    [built, Phase 5E-5 -- fourth concrete TrainingSystemProvider, no orchestration wiring] Narrow, EXPOSURE-first (not weakness-first) deliberate-novelty-exposure training mode over Question DNA's existing noveltyLevel vocabulary (novel_representation/novel_combination/novel_context); applicability is computed ENTIRELY from attempt history -- evaluate() never reads context.candidates, candidate composition has zero effect on the decision (source-level regression-tested); concept-specific standard-exposure baseline invariant (another concept's exposure never satisfies this concept's baseline); no progression (the three levels are peers, not a ladder); provider-local selection prefers an unseen taxonomy cell at the target level then least exposure then questionId; zero new provisional constants introduced
    (Pressure Training, Phase 5E-6: explicitly DEFERRED, no package -- the current schema has no persisted session/sequence/block identity to build a genuinely distinct provider on; the one safely-available pressure-adjacent signal, testingModes' time_pressured, is already /speed-lab's time_constrained stage. See docs/DECISIONS.md D-059 for the full reasoning and the documented minimum future prerequisite, a general Practice Session/Block abstraction.)
    /prep-phase           [built, Phase 1] Calendar-aware phase + catch-up layer
  /ai                  [built, Phase 3] Provider abstraction, prompt templates, Zod schemas for every AI call shape
  /db                  [built, schema+seed; persistence adapters built Phase 5C-1 (Autopsy/RepairPlan/MasteryState), Phase 4B-1 (Attempt), Phase 4B-2 security fix (read-only QuestionReader over Question), Phase 3.5 publication workflow (QuestionPublicationRepository -- the ONLY write path to Question.validationState, action-only, never a raw target state), and Phase 3.5 candidate import (QuestionImportRepository -- the ONLY write path from a validated generation-pipeline candidate to a persisted Question row, natural-key FK resolution, never creates a PatternTaxonomyCell)] Prisma schema (full domain model), migrations, seed data, generated client, repository/adapter layer
  /practice-loop       [built, Phase 4B-2 — foundation only, no UI/HTTP layer calls it yet] Application-facing orchestration wiring @ipmat/attempt's lifecycle functions to AttemptRepository (load -> domain transform -> persist); not a domain package (depends on the AttemptRepository and QuestionReader persistence ports), not a second persistence implementation. Client-facing input is limited to identifiers/student actions — a QuestionReader resolves the canonical answer key/publication state server-side, never accepted from the caller (docs/DECISIONS.md D-048)
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
