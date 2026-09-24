# 70 — API and Application Layer

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/ARCHITECTURE.md` §3–§5, `docs/MASTER_PLAN.md` Phase 4B-3+. **Status: not built.** This file documents the planned shape and exactly what stands in for it today.

## The planned shape (target architecture, not implemented)

Next.js (App Router) — server components for data-heavy screens, API routes/server actions as the BFF (backend-for-frontend), one deploy target. This is the target recorded in `docs/ARCHITECTURE.md` §3.

## What actually exists instead, as of the current checkpoint

**No HTTP/API route of any kind exists anywhere in this repository.** Every "call" into the domain layer happens either:
1. From a test file (the overwhelming majority of this project's verification).
2. From `apps/training-playground`'s `runScenario.ts` — a pure input-shape adapter dispatching directly to real domain entry points, in-process, no network hop.
3. From `apps/web`'s `src/adapter/service.ts` — the same pattern, also in-process, also no network hop, also no real persistence.

`apps/web`, as actually built, is a **Vite + React SPA**, not the planned Next.js app. This is a deliberate divergence for the first vertical-slice UI, not a silent architecture change — see [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for the explicit reasoning (speed to a visible product, fixture-backed, no backend dependency).

## What the future API layer must do, per existing rules

- Never accept an answer key, a publication state, or a training-decision result directly from a client — every such value is server-resolved (D-048's `QuestionReader` pattern, extended).
- Never call `orchestrateNextTrainingAction()` directly with client-assembled input — the future Training Recommendation Composition layer is the one legitimate assembly point (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §20: "UI never calls deterministic packages directly, HTTP handlers don't duplicate assembly logic").
- Resolve the authenticated student's identity server-side and pass only `studentId`/`enrollmentId` (or equivalent identifiers) into the composition layer — never trust a client-supplied ownership claim (see [54_SECURITY_AND_OWNERSHIP.md](54_SECURITY_AND_OWNERSHIP.md)).

## Background jobs — also not built

`packages/jobs` (BullMQ job definitions + workers) does not exist. The generation pipeline and autopsy hypothesis generation are today plain async functions invoked directly (by tests, by `apps/web`'s adapter) — designed so a future queue wraps them without changing their signature, since each already takes an injected `AiProvider` and returns a complete, serializable result.

See also: [71_AUTHENTICATION.md](71_AUTHENTICATION.md), [72_DATABASE_AND_INFRASTRUCTURE.md](72_DATABASE_AND_INFRASTRUCTURE.md).
