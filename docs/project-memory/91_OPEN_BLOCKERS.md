# 91 — Open Blockers, Deferred Work, and Technical Debt

> Part of the [project memory](00_MASTER_CONTEXT.md). Categorized per the explicit instruction: do not mix "not implemented yet" with "genuine architectural blocker." Source: `docs/MASTER_PLAN.md`, `docs/DECISIONS.md`, and this session's own Training Recommendation Composition design review (verified directly against source).

## A. Genuine architectural blockers (something is structurally missing, not merely unbuilt)

1. **`Exam.examDateRule` (Json) has no function anywhere that resolves it to a concrete date.** Blocks real PrepPhase assembly in any future composition layer — not a missing repository method, a missing piece of domain logic. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §16, [13_DATA_MODEL.md](13_DATA_MODEL.md).
2. **`CatchUpPlan` has no "active" semantics in the schema** — no status/expiry/supersededAt column. "The active catch-up plan for this enrollment" is currently undefined, not merely unread.
3. **`RepairPlan.targetConceptId` has no `@relation` in the Prisma schema** (unlike `targetErrorTaxonomyId`, which does) — the database itself cannot catch a bad reference; only application-layer `assertConceptResolved()` does. Pre-existing, unrelated to the D-039 addendum, not fixed by it.
4. **No `ANTHROPIC_API_KEY` has ever been configured in this environment**, across this project's entire history. Every AI-dependent code path has only ever been proven via `FixtureProvider`. This blocks: real AI-validated content, the go/no-go gate for chapter two ([03_MVP_SCOPE.md](03_MVP_SCOPE.md)), and any claim that the generation/autopsy pipelines work against a real model.
5. **No live database has ever been reachable in this environment.** Blocks: any real persistence verification, the Phase 4B-3+ practice UI/HTTP API, any real student completing the full loop.

## B. Deferred work (a deliberate, named decision to build later, not a gap)

- Auth (D-004, explicitly open, deferred until before any real external student use).
- The confirm/correct UI and its wiring into a real practice flow (Phase 5C-3's original full exit criterion).
- Payments, subscriptions, parent portal, multi-tenant orgs (see [03_MVP_SCOPE.md](03_MVP_SCOPE.md)).
- Mock Simulation, Revision (named, shapes deliberately kept provider-agnostic for them, not designed).
- `packages/jobs` (BullMQ) — the generation pipeline is a plain async function by design until a queue exists.
- The Training Recommendation Composition layer's own PrepPhase/CatchUp assembly (deliberately deferred pending blocker A.1/A.2 above being resolved separately).
- Whether to persist freshly-computed mastery as a side effect of a recommendation call — genuinely undecided, not urgent.

## C. Future enhancements (named as future, not currently blocking anything)

- Real embedding-based duplicate detection (D-019) — token-overlap is an honest interim measure.
- Real-data calibration of every "provisional" threshold across mastery/training-systems (`MIN_OBSERVATIONS_FOR_COMPONENT`, `SLOW_SPEED_RATIO`, `SHORT_RECOVERY_GAP_SECONDS`, etc.) — none has ever been validated against real student data.
- A finer calculation-skill taxonomy (fractions, ratios, decimals, estimation, shortcuts) for Calculation Gym — rejected as unrepresentable in current DNA, not merely unbuilt.
- Widening the arithmetic verifier's grammar (scientific notation, etc.) — deliberately narrow today, would need a documented, re-reviewed decision (D-018/D-028's own stated boundary).

## D. Productization requirements (needed before any real launch, not before the current vertical-slice phase)

- A reachable production database and deployment target.
- At least one real, `ANTHROPIC_API_KEY`-validated, human-published question (currently: **zero** published questions exist).
- The go/no-go gate itself ([03_MVP_SCOPE.md](03_MVP_SCOPE.md)) — none of its three conditions has been met.
- A real authentication flow.
- A real HTTP/API layer (`apps/web`'s current Vite SPA has no backend of its own).

## E. Known technical debt

- `apps/web` is a Vite + React SPA, diverging from `docs/ARCHITECTURE.md`'s originally planned Next.js target — a deliberate, disclosed divergence for speed to a visible first slice, not an oversight, but a future session should decide whether to migrate it or formally update the architecture doc's target.
- `RepairPlan.rationale`/`prerequisites` are not persisted at all (D-039 addendum scope decision) — reconstructed as `[]` on read, since nothing currently consumes them; would need new work if a future feature needs them.
- The `apps/web` first slice's session state is entirely in-memory (resets on reload) — acceptable for a fixture-backed demo, would need real persistence wiring (the Training Recommendation Composition layer, or an earlier stopgap) before this is a real product.
- `InMemoryRepairPlanRepository`'s `plansByAutopsyId` map silently overwrites on a second save for the same `autopsyId` (a pre-existing test-double simplification, not fixed by the D-039 addendum, not currently causing any known test failure).

See also: [90_ARCHITECTURAL_DECISIONS_INDEX.md](90_ARCHITECTURAL_DECISIONS_INDEX.md), [92_CURRENT_STATE.md](92_CURRENT_STATE.md).
