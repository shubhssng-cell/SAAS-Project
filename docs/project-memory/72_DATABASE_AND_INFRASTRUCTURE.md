# 72 — Database and Infrastructure

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/ARCHITECTURE.md` §3, §7 (read in full).

## The planned stack

PostgreSQL (relational integrity for the concept graph and Question DNA FKs, JSONB for fast-evolving parts), Prisma ORM, Redis + BullMQ (background jobs, rate/idempotency keys), deployment on Vercel + managed Postgres (Neon/Supabase) + managed Redis (Upstash) — zero-ops for a single-founder phase, all swappable since nothing is Vercel-specific in the domain code.

## What actually exists

The Prisma **schema** — full domain model, 7 migrations (see [13_DATA_MODEL.md](13_DATA_MODEL.md)). **No live database has ever been reachable in this environment, across every phase of this project's history, without exception.** No migration has ever been applied. No seed script has ever run against a real database.

## Redis/BullMQ — not built at all

`packages/jobs` does not exist. See [70_API_AND_APPLICATION_LAYER.md](70_API_AND_APPLICATION_LAYER.md).

## Environments

Single environment conceptually (local + one deployed preview) — no staged rollout infrastructure, no feature-flag system, matching the project's explicit anti-over-engineering principle for its current scale.

## What this means for every "tested" claim in this project

Every single test in this entire codebase — 1106 as of the current checkpoint — runs against either pure in-memory domain logic, `InMemoryXRepository` test doubles, or hand-rolled fake `PrismaClient` objects (`vi.fn()`-based). **Nothing has ever been verified against a real, running Postgres instance.** Claims like "a `Serializable` transaction prevents this race" are correct by construction against documented Postgres/Prisma semantics, never empirically verified in this project. See [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for why this matters for any future session's confidence calibration.

## What must happen before this changes

A reachable Postgres instance (local Docker, or a managed provider) and running `npm run db:migrate:dev`/`npm run db:seed` for the first time. This is named as a real, currently-unmet prerequisite for the Phase 4B-3+ practice UI/HTTP API and for any live AI-validated content — see [91_OPEN_BLOCKERS.md](91_OPEN_BLOCKERS.md).
