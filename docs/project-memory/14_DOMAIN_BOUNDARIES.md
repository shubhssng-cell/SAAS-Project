# 14 — Domain Boundaries

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/ARCHITECTURE.md` §6, `docs/DECISIONS.md` D-043 (the `domainBoundary.test.ts` origin), and this session's own direct verification of several `dependencyBoundary.test.ts` files.

## The rule

`packages/domain/*` modules depend only on plain TypeScript + other `packages/domain/*` packages + `@ipmat/ai` interfaces (never a concrete provider) — **never** on `@ipmat/db`'s Prisma client or types directly. This is what keeps domain packages testable without a live database and portable if a module is ever extracted into its own service.

## How it's enforced — not a convention, a test

`packages/db/test/architecture/domainBoundary.test.ts` (introduced in D-043) automatically scans **every** `packages/domain/*` package's `package.json` and source files for a `@prisma/client`/`@ipmat/db` import, using `it.each(packages)` — meaning it auto-discovers new domain packages with zero changes to the test file itself. This was directly observed to auto-discover `@ipmat/adaptive-selection` and `@ipmat/training-orchestration` when they were added (D-052/D-053's own consequences sections note "2 auto-discovered").

In addition, several individual packages carry their own narrower `dependencyBoundary.test.ts`, scanning for package-specific forbidden imports (e.g. a sibling provider, or `@ipmat/mastery` for Trap Lab specifically). Verified directly this session for `@ipmat/autopsy`, `@ipmat/training-orchestration`, and `@ipmat/pressure-training`.

## Two distinct kinds of boundary, not to be confused

1. **The domain/infrastructure boundary** — `packages/domain/*` never imports `@ipmat/db`/`@prisma/client`. This is the one `domainBoundary.test.ts` checks universally.
2. **Per-package "must not duplicate a sibling's logic" boundaries** — e.g. `@ipmat/calculation-gym` must never import `@ipmat/speed-lab`, `@ipmat/training-systems` must never import `@ipmat/training-orchestration`, `@ipmat/db` must never import `@ipmat/training-orchestration`/`@ipmat/training-systems`/any provider/`@ipmat/repair-selection`/`@ipmat/adaptive-selection`. These are checked by each package's own, individually-authored test.

## The `@ipmat/db` boundary is the one most load-bearing for future work

Confirmed directly (package.json read in full, `dependencyBoundary.test.ts` read in full) during this session's design work for the Training Recommendation Composition layer: `@ipmat/db` has **never** depended on the training-decision stack. This means:

- A new question read-model needed by a future composition layer **cannot** be `@ipmat/training-orchestration`'s own `TrainingCandidateQuestion` type — it must be independently declared inside `@ipmat/db` (as `TrainingQuestionRecord` or similar), structurally identical but not imported across the forbidden edge.
- The composition layer itself, which legitimately needs both `@ipmat/db` and `@ipmat/training-orchestration`, is the **only** place allowed to bridge the two — this mirrors how `trainingSystemProviders.ts` inside `@ipmat/training-orchestration` already bridges `TrainingOrchestrationInput` to `TrainingSystemContext` one level down.

See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) for the full consequence of this.

## "Restate, don't import across a forbidden boundary" — the recurring pattern

This exact pattern (a package needing a shape from a package it must not depend on, so it restates the shape as its own, structurally-matching type rather than importing it) appears repeatedly:

- `@ipmat/ai`'s schemas restate `TestingMode`/`ErrorCategory`/`DifficultyTier`/`DifficultyDimensions` rather than importing domain types (D-017).
- `@ipmat/autopsy`'s `AutopsyQuestionContext` restates Question DNA fields rather than importing `@ipmat/question-engine`'s full `QuestionDnaData`.
- `@ipmat/training-systems`' `TrainingCandidateQuestion` is structurally identical to `@ipmat/repair-selection`'s `RepairCandidateQuestion` and `@ipmat/adaptive-selection`'s `AdaptiveCandidateQuestion` — deliberately, so the same array can be passed to all three engines unchanged, with zero conversion function (D-052).
- `@ipmat/pressure-training`'s block evidence arrives only via `@ipmat/training-systems`' own restated `TrainingPracticeBlockContext`, never by importing `@ipmat/practice-block`/`@ipmat/practice-session` directly (D-061).

A future `@ipmat/db`-declared `TrainingQuestionRecord` would be the newest instance of this exact pattern.

## What this buys the project

A trust boundary or a dependency boundary that lives only in a doc comment can silently rot the moment someone finds it inconvenient. Every boundary named in this file has a real, automated, currently-passing test behind it — verified directly, not merely asserted, at multiple points during this project's history (every phase since D-043 has added its own boundary test alongside its own new package).
