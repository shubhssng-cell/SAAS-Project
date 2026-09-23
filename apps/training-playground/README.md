# Training Lab Playground (internal)

**This is an internal development/debug tool. It is NOT the production student experience.** The production app lives at `/apps/web` (not built yet) — this app is a separate, deliberately lightweight surface for inspecting how the deterministic training-system domain packages actually behave, kept structurally apart from anything student-facing.

See [docs/DECISIONS.md](../../docs/DECISIONS.md) D-057 for the full architectural decision record.

## Purpose

`@ipmat/calculation-gym`, `@ipmat/speed-lab`, `@ipmat/trap-lab`, and `@ipmat/training-orchestration` are real, tested, deterministic domain packages — but until this app, the only way to see how they actually behave was to read test files. This playground feeds predefined, deterministic fixture scenarios into those real packages and displays their real, unmodified output.

It does **not** implement a second decision engine. `src/domain/runScenario.ts` is the only file that calls into the domain layer, and it contains zero decision logic — only two input-shape adapters and a one-branch dispatcher to `runTrainingSystemProvider()` (for the three specialized providers) or `orchestrateNextTrainingAction()` (for orchestration).

## Dependency direction

`apps/training-playground` depends on the domain packages (`@ipmat/training-systems`, `@ipmat/calculation-gym`, `@ipmat/speed-lab`, `@ipmat/trap-lab`, `@ipmat/training-orchestration`, plus `@ipmat/autopsy`/`@ipmat/mastery` for types) — never the reverse. It imports only their public exports; it has never imported an internal, non-exported function from any of them.

No Prisma, no `@ipmat/db`, no live database, no Anthropic/OpenAI SDK, no real AI call, no authentication. Everything runs from in-memory, hand-built fixtures.

## Running locally

From the repository root:

```
npm install
npm run dev --workspace @ipmat/training-playground
```

This starts a Vite dev server (default port `5183`, configurable in `vite.config.ts`). No environment variables, API keys, or database are required.

To type-check, build, or run this app's tests alone:

```
npm run typecheck --workspace @ipmat/training-playground
npm run build --workspace @ipmat/training-playground
npx vitest run apps/training-playground
```

The root `npm test`/`npm run typecheck`/`npm run lint`/`npm run build` commands already include this app.

## Fixture architecture

- `src/domain/types.ts` — `TrainingPlaygroundFixture` (the shared input building blocks: `attemptRecords`, `candidates`, optional `errorTaxonomy`/`masteryByConcept`/`activeRepairPlans`/`prepPhase`), `TrainingPlaygroundScenario` (id, display copy, evidence summary, which systems to run, the fixture, and `expectedOutcomes` — **for tests only**, the UI never reads it), and `TrainingPlaygroundRunResult`/`TrainingPlaygroundSystemResult` (what a run actually produces).
- `src/domain/builders.ts` — small, deterministic constructors (`makeQuestion`, `makeCandidate`, `makeAttemptRecord`, `makeConfirmedRepairPlan`) shared by every scenario. All data is clearly synthetic (a fixed `playground-student` id, a fixed 2026 timestamp) — never implying a real student's history.
- `src/domain/scenarios.ts` — the centralized scenario catalog (`TRAINING_PLAYGROUND_SCENARIOS`). Ten scenarios ship today: calculation friction, speed inefficiency, trap recurrence, repair first, repair fallback, adaptive coverage gap, insufficient evidence, candidate filtering, no eligible question, mixed evidence.
- `src/domain/runScenario.ts` — the only file that calls the real domain packages. `toTrainingSystemContext()`/`toTrainingOrchestrationInput()` are pure shape adapters; `runTrainingPlaygroundScenario()` dispatches to each system a scenario declares and returns every outcome unmodified.

## Adding a new scenario

1. Add a new entry to the `TRAINING_PLAYGROUND_SCENARIOS` array in `src/domain/scenarios.ts`, using the builders in `src/domain/builders.ts` (or add a new builder if you need a genuinely new fixture shape — keep it in `builders.ts`, not inline).
2. Give it a stable `id` (never reuse or repurpose an existing one), a plain-language `description`/`evidenceSummary` (observable fixture facts only — never phrased as the student's private reasoning or a confirmed diagnosis unless it genuinely is one, e.g. a real `RepairPlan`), the `systemsToRun` you want to exercise, and `expectedOutcomes` (one entry per system, in the same order) for the test suite.
3. Add it to the assertions in `test/scenarios.test.ts` if it needs anything beyond the generic catalog-structure checks, and to `test/integration.test.ts` if you want a dedicated full-chain assertion beyond the generic `expectedOutcomes` loop.
4. Run `npx vitest run apps/training-playground` — the generic integration test will already exercise the real domain contracts against your new fixture; make sure it passes before assuming your fixture data is correct (hand-calculating expected thresholds is error-prone — let the real code decide).
5. No changes to `src/domain/runScenario.ts` or any UI component should ever be needed just to add a scenario — if you find yourself editing either, you're probably duplicating domain logic instead of describing a fixture.

## What this is not

- Not the production student practice UI.
- Not a second adaptive/ranking engine — every decision shown here was made by the real `@ipmat/*` package, not by this app.
- Not connected to a live database, a real AI provider, or any authentication system.
- Not calibrated or validated against real student data — every threshold the underlying domain packages use remains explicitly provisional (see each package's own `docs/DECISIONS.md` entry).
