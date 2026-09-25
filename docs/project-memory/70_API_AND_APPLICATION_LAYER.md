# 70 — API and Application Layer

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/ARCHITECTURE.md` §3–§5, `docs/MASTER_PLAN.md` Phase 4B-3+/5I, `docs/DECISIONS.md` D-064. **Status: a first HTTP/API boundary now exists (2026-09-25) — not production (no live database, no auth, `apps/web` not yet switched to it).** This file documents the planned target shape and what actually exists today; where they differ, this section wins.

## The planned shape (target architecture, not implemented)

Next.js (App Router) — server components for data-heavy screens, API routes/server actions as the BFF (backend-for-frontend), one deploy target. This is the target recorded in `docs/ARCHITECTURE.md` §3. **Not what was built** — see below.

## What actually exists, as of the current checkpoint (D-064)

**A real HTTP route now exists.** `apps/api` (`@ipmat/api`) is a minimal `node:http` server — no Express/Fastify/Next.js, none existed anywhere in this repository before this unit and none was needed for a contract this small — exposing `POST/GET /v1/...` routes that delegate entirely to `packages/practice-api`'s `PracticeApiService` (a framework-agnostic application service coordinating `@ipmat/training-recommendation`/`@ipmat/practice-loop`, never reimplementing either one's decision logic). See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) for the composition layer this boundary calls, and `docs/DECISIONS.md` D-064 for the full record.

**This is still not a production API.** The runtime entry point (`apps/api/src/index.ts`) wires ONLY in-memory dependencies — no live database has ever been reachable in this environment, and a structurally complete Prisma-backed wiring exists but is never invoked. There is no authentication (D-004 remains open) — `studentId`/`enrollmentId` are accepted as explicit request fields, never derived from a real session. `apps/web` has NOT been switched to consume this boundary — its fixture-backed adapter is unchanged.

Every OTHER "call" into the domain layer still happens either from a test file, from `apps/training-playground`'s `runScenario.ts` (in-process, no network hop), or from `apps/web`'s `src/adapter/service.ts` (in-process, no network hop, no real persistence) — those three paths are unchanged by this unit.

`apps/web`, as actually built, is a **Vite + React SPA**, not the planned Next.js app. This is a deliberate divergence for the first vertical-slice UI, not a silent architecture change — see [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for the explicit reasoning (speed to a visible product, fixture-backed, no backend dependency). `apps/api` is a SEPARATE app, not `apps/web` acquiring a server — consistent with `apps/web` staying a pure client that can only reach a backend over HTTP.

## What the future API layer must do, per existing rules

- Never accept an answer key, a publication state, or a training-decision result directly from a client — every such value is server-resolved (D-048's `QuestionReader` pattern, extended).
- Never call `orchestrateNextTrainingAction()` directly with client-assembled input — the future Training Recommendation Composition layer is the one legitimate assembly point (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §20: "UI never calls deterministic packages directly, HTTP handlers don't duplicate assembly logic").
- Resolve the authenticated student's identity server-side and pass only `studentId`/`enrollmentId` (or equivalent identifiers) into the composition layer — never trust a client-supplied ownership claim (see [54_SECURITY_AND_OWNERSHIP.md](54_SECURITY_AND_OWNERSHIP.md)).

## Background jobs — also not built

`packages/jobs` (BullMQ job definitions + workers) does not exist. The generation pipeline and autopsy hypothesis generation are today plain async functions invoked directly (by tests, by `apps/web`'s adapter) — designed so a future queue wraps them without changing their signature, since each already takes an injected `AiProvider` and returns a complete, serializable result.

See also: [71_AUTHENTICATION.md](71_AUTHENTICATION.md), [72_DATABASE_AND_INFRASTRUCTURE.md](72_DATABASE_AND_INFRASTRUCTURE.md).
