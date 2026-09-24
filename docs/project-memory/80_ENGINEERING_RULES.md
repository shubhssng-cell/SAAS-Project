# 80 — Engineering Rules

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `CLAUDE.md` (full), cross-checked against this session's own adherence to it throughout the D-039 addendum and `apps/web` work.

## No premature abstraction

This codebase intentionally supports only IPMAT/Quant/Percentages right now — no multi-exam branching, no plugin systems, no config layers for exams/chapters that don't exist yet just because the long-term vision has them. The schema is already shaped to generalize; the code stays simple until a second chapter is actually being built.

## Modular monolith boundaries are real, not aspirational

`packages/domain/*` must never import Next.js, Prisma client, or a concrete AI provider directly. If a change needs to violate this, that's a sign the boundary needs a design conversation, not a quick import. See [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md).

## All AI calls go through `@ipmat/ai`'s `generateStructured()`, with a Zod schema

No raw prompt strings or unvalidated `JSON.parse` on a model response anywhere else in the codebase. See [82_AI_USAGE_RULES.md](82_AI_USAGE_RULES.md).

## Expensive/slow AI work is meant to be a background job, but the queue layer isn't built yet

`runGenerationPipeline()` is a plain async function today, invoked directly. When a queue exists, it should wrap that function without changing its signature — don't design a job system that requires reshaping the pipeline.

## Coordinate, never reimplement

The single most repeated rule across the training-systems layer: `@ipmat/training-orchestration` coordinates `@ipmat/repair-selection`/`@ipmat/adaptive-selection`/five providers through their public contracts only. A sibling provider never imports another provider's internals. Verified by source-scanning tests, not just convention.

## Every new decision that matters gets logged

`docs/DECISIONS.md` — Status/Context/Decision/Consequences format, newest appended, never editing history. If a decision is reversed, a **new** entry supersedes the old one; the old one is never silently rewritten. A real gap in this discipline was found and fixed during this session's own documentation-sync pass: D-062 had been fully implemented and committed but never logged — closed as part of that pass, treated as required by this rule itself, not as new scope.

## Derive, never store, what can be computed

Repeated at nearly every layer: mastery, coverage stage, Examiner Lens combinations, answer-change history. The one deliberate exception: a `RepairPlan`'s target fields are a historical **snapshot**, not something to re-derive — see [21_STUDENT_MEMORY.md](21_STUDENT_MEMORY.md) for exactly why snapshotting and deriving are both correct, for different kinds of fact.

## Fail closed, never fabricate

An unparseable answer, an unpriced AI model, a pre-migration RepairPlan row, an unresolved ownership chain — every one of these rejects/excludes/errors rather than guessing or defaulting to a misleading value.

## Never trust a value merely typed as X

TypeScript's structural typing cannot stop a caller from constructing a domain-object-shaped value some other way, bypassing the real constructor's gate. Every persistence/selection boundary re-verifies the same invariant a second time, independently.

## No comments explaining WHAT; comments only for non-obvious WHY

Default to no comments. Only add one when the WHY is non-obvious — a hidden constraint, a subtle invariant, a workaround for a specific bug. This project's own source is dense with exactly this kind of comment (e.g. `OVERUSE_MIN_ATTEMPT_COUNT`'s doc comment explaining *why* 2, not what the constant does).

See also: [81_TESTING_STRATEGY.md](81_TESTING_STRATEGY.md), [84_CHANGE_CONTROL.md](84_CHANGE_CONTROL.md).
