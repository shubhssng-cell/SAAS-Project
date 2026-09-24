# 81 — Testing Strategy

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `CLAUDE.md`, `docs/ARCHITECTURE.md` §3, and this session's own direct testing work (D-039 addendum, `apps/web`).

## The rule

Unit-test business logic (concept graph traversal, mastery computation, validation rules, phase-curve logic) with Vitest. AI call sites are tested against recorded fixtures (`FixtureProvider`), never live calls — the test suite makes **zero** paid API calls.

## Test doubles mirror the real interface exactly, on purpose

Every `InMemoryXRepository` implements the identical interface `PrismaXRepository` does, and both call the **same** shared validation functions (`packages/db/src/repositories/validation.ts`) — this is what makes an in-memory test a genuine test of the contract's semantics, not a mocked-out illusion. Verified directly this session while extending both implementations for the D-039 addendum.

## Fake-`PrismaClient` tests — for verifying exact query shape

Where the *shape* of a Prisma call itself matters (a `where` clause, an `include`, a transaction isolation level) and an in-memory double can't prove it, a hand-rolled fake `PrismaClient` (`vi.fn()`-based) is used instead — proving, deterministically and without a live database, that e.g. `decide()` actually requests `Serializable` isolation, or that `findConfirmedActiveByStudentId()` sends the exact `where`/`include` clause the design specifies. This pattern was reused directly in this session's own `prismaRepairPlanRepository.test.ts`/`prismaAutopsyRepository.test.ts`.

## Dependency-boundary tests — architecture as a testable fact

Every domain package either relies on the shared, auto-discovering `packages/db/test/architecture/domainBoundary.test.ts` or carries its own `dependencyBoundary.test.ts` scanning `package.json` and source imports for forbidden targets. This turns "never import X" from a convention into something CI fails on. See [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md).

## Compile-time regression guards (`@ts-expect-error` tests)

Several packages (adaptive-selection, training-systems, calculation-gym, speed-lab, trap-lab, novelty-training) prove a forbidden field (a composite score, a confidence field) **cannot** be added to a given type without a compile error — a structural guarantee, not just a runtime check.

## Epistemic-language regression tests

Trap Lab and Pressure Training both scan their own generated `explanation`/`notes` strings for confirmation-implying or psychological-claim language, failing the test if a forbidden word appears. A real, self-inflicted bug (Pressure Training's own disclaimer tripping its own `/psycholog/i` filter) was found and fixed via exactly this mechanism.

## The "regression guard for the original bug" pattern

When a real bug is found and fixed (e.g. the D-039 addendum's silently-dropped RepairPlan fields), a dedicated test asserts the exact key-set a mapping function produces (`Object.keys(record).sort()` equality against a literal list) — so a future field silently dropped again fails this test immediately, rather than only being caught by chance.

## Verification checklist run before every commit in this project's history

Typecheck, lint, full test suite, build — across **every** workspace, not just the one touched. Verified directly, repeatedly, this session: 1106/1106 tests, typecheck clean across 23+ workspaces, lint clean, build clean, before every commit.

See also: [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for the exact current test count and verification status.
