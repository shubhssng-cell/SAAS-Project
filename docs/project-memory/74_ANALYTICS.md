# 74 — Analytics

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `CLAUDE.md`'s "no fake analytics" rule, `docs/PRODUCT_SPEC.md` §5. **Status: not built as a dedicated system** — but the underlying discipline that any future analytics must follow is already established and enforced elsewhere.

## The governing rule

"No fake analytics. Dashboards show real, derived-from-attempts numbers, or they show nothing." This is not a future feature to design from scratch — it's a constraint any future analytics work must satisfy, and the enforcement mechanism already exists in how mastery/coverage/recommendation data is computed (see [25_MASTERY.md](25_MASTERY.md), [42_QUESTION_UNIVERSE.md](42_QUESTION_UNIVERSE.md)): every number shown anywhere is either directly computed from real `Attempt` rows, or it is honestly absent (`null`, "insufficient evidence," a disabled button) — never fabricated to fill a gap.

## What exists today that resembles analytics

- `AiResultMetadata` (`@ipmat/ai`) — per-call cost/latency/token-usage metadata, retained on every AI call for reproducibility/debugging. This is the seam a future usage-logging job would persist to a database table, but no such job or table exists yet (`docs/AI_ARCHITECTURE.md` §2).
- `MasteryComponentDetail` — the rich, never-discarded breakdown behind every mastery measure. Not "analytics" in the dashboard sense, but the same "preserve everything, never fabricate" discipline a real analytics layer should inherit.

## What does not exist

No event-tracking pipeline, no funnel/retention dashboard, no admin analytics console, no aggregated cross-student reporting of any kind.

## What a future analytics feature must not do

Invent a metric that isn't a real aggregation of observed attempts. Show a percentage/score computed from fewer observations than the domain layer's own `MIN_OBSERVATIONS_FOR_COMPONENT`-style gates would consider sufficient. Blend multiple independent measures (accuracy, speed, coverage) into one composite "engagement score" — this would directly violate the same "never collapse independent measures into one number" rule mastery itself follows (see [25_MASTERY.md](25_MASTERY.md)).
