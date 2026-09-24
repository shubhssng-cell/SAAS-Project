# 10 — System Architecture

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/ARCHITECTURE.md` (read in full).

## Style: modular monolith, not microservices (D-001)

One deployable app, internal module boundaries enforced in code. Reasoning: the domains (concept graph, question engine, attempts, mastery, autopsy) are read together on nearly every student-facing screen; team size is effectively one; splitting into services now would mean solving distributed-transaction problems for no benefit. The AI-heavy, slow paths (generation, validation, autopsy hypothesis) are meant to be isolated as background jobs — the real scaling boundary that matters early — but this job/queue layer is **not built yet** (see [70_API_AND_APPLICATION_LAYER.md](70_API_AND_APPLICATION_LAYER.md)). If a domain later needs independent scaling, extraction is possible because boundaries already exist in code.

## Stack (D-002)

| Layer | Choice | Status |
|---|---|---|
| Language | TypeScript everywhere | Built |
| Frontend + BFF | Next.js (App Router) — planned for `apps/web` | Not the current `apps/web` implementation (see below) |
| Domain logic | Plain TypeScript packages, framework-agnostic | Built, extensively |
| Database | PostgreSQL via Prisma | Schema built; **never applied to a live database in this environment** |
| Cache / queues | Redis + BullMQ | Not built |
| ORM | Prisma | Built |
| Validation | Zod | Built, used for every AI schema |
| Auth | Deferred (D-004, open) | Not built |
| Testing | Vitest (unit), Playwright (e2e, not yet needed) | Vitest extensively used; no Playwright |
| Deployment | Vercel + managed Postgres/Redis (planned) | Not built |

**Correction to plan, observed in the actual repository:** the architecture doc's target for `apps/web` was a Next.js App Router app. The `apps/web` that actually exists in the working tree as of this checkpoint is a **Vite + React SPA**, not Next.js — built as a fast, fixture-backed first vertical slice, explicitly not the final production app shape. See [92_CURRENT_STATE.md](92_CURRENT_STATE.md) and [63_DASHBOARD.md](63_DASHBOARD.md).

## Repository layout (verified against actual `packages/`/`apps/` structure)

```
/apps
  /web                    [built, uncommitted] Vite + React SPA — first vertical-slice student UI, fixture-backed
  /training-playground    [built, D-057] Vite + React — INTERNAL dev/debug tool only
/packages
  /domain
    /concept-graph            [built, Phase 1-2]
    /examiner-lens            [built, Phase 2]
    /question-engine          [built, Phase 2-3]
    /validation               [built, Phase 3]
    /attempt                  [built, Phase 4A]
    /autopsy                  [built, Phase 5A-5B; persistence fidelity fixed post-5G]
    /mastery                  [built, Phase 5B]
    /repair-selection         [built, Phase 5C-2]
    /adaptive-selection       [built, Phase 5C-3 core]
    /training-orchestration   [built, Phase 5D core + 5G wiring]
    /training-systems         [built, Phase 5E-1 + 5G additive field]
    /calculation-gym          [built, Phase 5E-2]
    /speed-lab                [built, Phase 5E-3]
    /trap-lab                 [built, Phase 5E-4]
    /novelty-training         [built, Phase 5E-5]
    /pressure-training        [built, Phase 5G/D-061]
    /practice-session         [built, Phase 5F]
    /practice-block           [built, Phase 5F]
    /prep-phase               [built, Phase 1]
  /ai                     [built, Phase 3]
  /db                     [built — schema+seed+repositories, no live DB ever reachable]
  /practice-loop          [built, Phase 4B-2 — foundation only, no caller]
  /jobs                   [not built]
```

`/packages/domain/*` depend only on plain TS + other domain packages + `@ipmat/ai` interfaces — **never** `@ipmat/db`'s Prisma client or types. `@ipmat/db`'s seed script is the one place domain fixtures get written through Prisma — infrastructure depends on domain, never the reverse. See [12_DEPENDENCY_GRAPH.md](12_DEPENDENCY_GRAPH.md) and [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md).

## Request/data flow (as designed — much of the student path is not yet wired end to end)

**Authoring path** (admin/offline, human-in-the-loop initially): Concept Universe (curated + AI-assisted) → Examiner Lens analysis (AI, schema-validated, stored) → Question Universe taxonomy cells (derived from Lens output) → Question Generation job (AI, background) → Validation pipeline → published `Question` with complete DNA.

**Student path** (live, must be fast, **not yet wired end to end against a real database**): Student requests practice → app selects next question (filtered by prep-phase + mastery gaps) → `Attempt` recorded → if wrong: Autopsy job enqueued → hypothesis returned to student for confirm/correct → confirmed diagnosis updates `MasteryState` and triggers targeted repair.

The student path never blocks on a live AI call for question selection — only autopsy hypothesis generation is a background job the UI waits on. This background-job design is aspirational for the practice UI; the current `apps/web` first slice uses direct, synchronous, in-process calls to the real domain functions against fixture data, since no queue infrastructure exists.

## Module boundaries that must hold from day one (verbatim list, still true)

- `question-engine` never talks to `@ipmat/ai` directly for anything student-facing at request time — generation is always meant to be a background job, never inline in a request handler (though no queue exists yet, so today it *is* a plain async function invoked directly, which is accepted as a Phase-appropriate simplification, not a violation).
- `mastery` is a pure function of `attempts` + `question DNA` + time. It must not read `prep-phase` state.
- `prep-phase` is a pure function of `(examId, enrollmentDate, today)` plus a stored template. It must not read `attempts` or `MasteryState`.
- `attempts` owns `AttemptEvent` as its append-only source of truth for timing.
- `autopsy` never writes a diagnosis as fact — always a hypothesis until confirmed.
- `examiner-lens` never stores a "combinations" list — always recomputed live from the concept graph.
- `question-engine`'s coverage ladder is computed on every read, never stored.
- Nothing outside `@ipmat/ai` constructs a prompt string or parses a raw LLM response.

## Environments

Single environment for the current phase (local + one deployed preview, conceptually — no deployment has actually occurred). No staged rollout infrastructure, no feature-flag system.

See also: [11_PACKAGE_ARCHITECTURE.md](11_PACKAGE_ARCHITECTURE.md), [12_DEPENDENCY_GRAPH.md](12_DEPENDENCY_GRAPH.md), [13_DATA_MODEL.md](13_DATA_MODEL.md), [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md).
