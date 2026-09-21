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

## 4. Repository layout (target, created incrementally — do not scaffold all of it at once)

```
/apps
  /web                 Next.js app: UI + API routes/server actions (the BFF)
/packages
  /domain              Framework-agnostic business logic, split by bounded context:
    /concept-graph        Concept Universe: nodes, edges, traversal
    /examiner-lens        Examiner Lens analysis: schema + orchestration
    /question-engine      Question Universe taxonomy, Question DNA, generation orchestration
    /validation           Validation pipeline rules (math correctness, ambiguity, dedup)
    /attempts             Attempt recording, scoring
    /autopsy               Autopsy hypothesis orchestration, repair planning
    /mastery              Mastery computation (pure functions over attempt history)
    /prep-phase           Calendar-aware phase + catch-up layer
  /ai                  Provider abstraction, prompt templates, Zod schemas for every AI call shape
  /db                  Prisma schema, migrations, generated client
  /jobs                BullMQ job definitions + workers (one worker per expensive AI task type)
/docs                  This directory
```

`/packages/domain/*` modules depend only on plain TS + `/packages/ai` interfaces (never a concrete provider) + `/packages/db` types (not the Prisma client directly, to keep them testable without a live DB). `/apps/web` is the only place that wires concrete implementations together.

## 5. Request/data flow (vertical slice)

**Authoring path (admin/offline, human-in-the-loop initially):**
`Concept Universe (curated + AI-assisted)` → `Examiner Lens analysis (AI, schema-validated, stored)` → `Question Universe taxonomy cells (derived from Lens output)` → `Question Generation job (AI, background)` → `Validation pipeline (automated checks + AI-judge + human review queue)` → published `Question` with complete `QuestionDNA`.

**Student path (live, must be fast):**
`Student requests practice` → app selects next question from already-validated bank (filtered by prep-phase + mastery gaps) → `Attempt` recorded (answer, time, hints, retries) → if wrong: `Autopsy` job enqueued (AI, background) → hypothesis returned to student for confirm/correct → confirmed diagnosis updates `MasteryState` and triggers `Targeted Repair` question selection.

The student path never blocks on a live AI call for question selection — only autopsy hypothesis generation is a background job the UI waits on (with a visible pending state), because it happens after the student has already submitted an answer and isn't blocking further practice.

## 6. Module boundaries that must hold from day one

- `question-engine` never talks to `/packages/ai` directly for anything student-facing at request time — generation is always a background job, never inline in a request handler.
- `mastery` is a pure function of `attempts` + `question DNA` + time. It must not read `prep-phase` state — phase and mastery are computed independently and only reconciled at the UI/recommendation layer (see [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §4.8).
- `autopsy` never writes a diagnosis as fact — its output type is always `hypothesis` until a student confirms it; only confirmed diagnoses are allowed to influence `mastery` or `repair`.
- Nothing outside `/packages/ai` constructs a prompt string or parses a raw LLM response. All call sites go through typed functions that return Zod-validated results or throw.

## 7. Environments

Single environment for Phase 1 (local + one deployed preview). No staged rollout infrastructure, no feature-flag system yet — not needed at this scale and would be premature per the project's own anti-over-engineering principle.
