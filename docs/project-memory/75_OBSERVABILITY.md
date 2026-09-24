# 75 — Observability

> Part of the [project memory](00_MASTER_CONTEXT.md). **Status: not built as a dedicated system.** This file documents what currently substitutes for observability and what a future system must respect.

## What exists today

- `AiResultMetadata` — every AI call, success or failure, carries `{provider, model, promptVersion, task, timestamp, latencyMs, tokenUsage, estimatedCostUsd, success, validationOutcome, attempts}`. This is the closest thing to structured logging anywhere in the codebase, and it's per-call metadata, not a persisted log stream.
- `TrainingOrchestrationDiagnostics` — present on every `TrainingOrchestrationResult` regardless of final status, preserving exactly what was tried (repair, each training-system provider, adaptive) and why. This is diagnostic-rich by design, but it's a return value inspected in tests/the playground, not something shipped to a monitoring system.
- Rejection reporting in the generation pipeline — every rejection carries a specific `RejectionCode` + field + message, never a silent discard. Again, a rich in-process result, not a log/metrics pipeline.

## What does not exist

No logging framework, no metrics/tracing integration (no OpenTelemetry, no Sentry, no equivalent), no alerting, no dashboard of system health. No environment in this project's history has ever had a live process running long enough to need one.

## The internal Training Playground is the closest thing to an observability tool that exists

`apps/training-playground` lets a developer see real, unmodified domain-package output against fixed scenarios — useful for understanding *what the system decided and why* during development, but explicitly not a production observability surface (no live data, no real student, no persistence).

## What a future observability layer must respect

The same "never fabricate" discipline as everywhere else: a monitoring dashboard showing "average student mastery" would need to honestly represent the `null`-heavy reality of `MasteryState` (many students will have `null` measures below the observation-count gate) rather than silently treating `null` as `0` in an aggregate — the exact mistake D-042/D-043 already prevented at the persistence layer (see [25_MASTERY.md](25_MASTERY.md)).
