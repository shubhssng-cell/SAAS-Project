# 11 — Package Architecture

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/ARCHITECTURE.md` §4, `docs/DECISIONS.md` (every D-number touching a package's dependency set, cross-checked against actual `package.json` files read directly during this session's own work).

## The three tiers

1. **Domain packages** (`packages/domain/*`) — pure TypeScript, zero I/O, zero framework dependency. Each is independently unit-testable against fixtures, never a live database or live AI call.
2. **Infrastructure packages** (`packages/ai`, `packages/db`) — the only places that touch a concrete AI SDK or Prisma.
3. **Application/orchestration packages** (`packages/practice-loop`, and the still-undesigned-in-detail future `training-recommendation` composition layer) — sit **outside** `packages/domain/*` specifically because they depend on persistence **ports**, not because they contain business rules of their own. See [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md).

Apps (`apps/training-playground`, `apps/web`) are consumers only — never a decision engine of their own.

## Every domain package, purpose and exact dependency set (verified, not assumed)

| Package | Purpose | Depends on | Never depends on |
|---|---|---|---|
| `@ipmat/concept-graph` | Concept Universe graph | (leaf) | anything |
| `@ipmat/examiner-lens` | Structured "what is tested" analysis | `@ipmat/concept-graph` | `@ipmat/ai` |
| `@ipmat/question-engine` | Pattern families, taxonomy, DNA, generation pipeline, publication/import decisions | `@ipmat/concept-graph`, `@ipmat/examiner-lens`, `@ipmat/ai` | `@ipmat/db` |
| `@ipmat/validation` | Independent computation verification, quality checks | `@ipmat/question-engine` (types) | `@ipmat/ai` directly for its own calls |
| `@ipmat/attempt` | Attempt lifecycle state machine | (leaf) | `@ipmat/db`, `@ipmat/autopsy` |
| `@ipmat/autopsy` | OBSERVATION→EVIDENCE→HYPOTHESIS→CONFIRMED DIAGNOSIS | `@ipmat/ai`, `@ipmat/attempt`, `@ipmat/concept-graph`, `@ipmat/examiner-lens`, `@ipmat/question-engine` | `@ipmat/db`, `@ipmat/mastery` |
| `@ipmat/mastery` | Multidimensional mastery computation | `@ipmat/autopsy` (for `AutopsyQuestionContext`), `@ipmat/question-engine` | `@ipmat/db`, `@ipmat/adaptive-selection` |
| `@ipmat/repair-selection` | Targeted repair question selection | `@ipmat/autopsy`, `@ipmat/examiner-lens`, `@ipmat/question-engine`, `@ipmat/ai`, `@ipmat/attempt` | `@ipmat/adaptive-selection`, `@ipmat/db` |
| `@ipmat/adaptive-selection` | Global "what next" ranking | `@ipmat/attempt` (transitively), `@ipmat/autopsy`, `@ipmat/mastery`, `@ipmat/prep-phase`, `@ipmat/question-engine` | `@ipmat/repair-selection`, `@ipmat/db` |
| `@ipmat/training-systems` | Shared `TrainingSystemProvider` contract | `@ipmat/autopsy`, `@ipmat/mastery`, `@ipmat/prep-phase`, `@ipmat/question-engine` | `@ipmat/training-orchestration`, `@ipmat/adaptive-selection`, `@ipmat/repair-selection` |
| `@ipmat/calculation-gym` | 1st concrete provider | `@ipmat/training-systems`, `@ipmat/mastery` | any sibling provider, orchestration |
| `@ipmat/speed-lab` | 2nd concrete provider | `@ipmat/training-systems`, `@ipmat/mastery`, `@ipmat/autopsy` | any sibling provider, `@ipmat/calculation-gym` |
| `@ipmat/trap-lab` | 3rd concrete provider | `@ipmat/training-systems`, `@ipmat/autopsy` | `@ipmat/mastery` (a deliberate first — see [33_TRAP_LAB.md](33_TRAP_LAB.md)), any sibling |
| `@ipmat/novelty-training` | 4th concrete provider | `@ipmat/training-systems`, `@ipmat/mastery` | any sibling, `context.candidates` inside `evaluate()` |
| `@ipmat/pressure-training` | 5th concrete provider | `@ipmat/training-systems`, `@ipmat/mastery` | `@ipmat/practice-block`, `@ipmat/practice-session` (block evidence arrives only as a restated primitive shape) |
| `@ipmat/training-orchestration` | Coordinates repair-selection, adaptive-selection, all 5 providers | `@ipmat/repair-selection`, `@ipmat/adaptive-selection`, `@ipmat/training-systems`, all 5 providers, `@ipmat/autopsy`, `@ipmat/mastery`, `@ipmat/prep-phase`, `@ipmat/question-engine` | `@ipmat/db`, `@prisma/client`, `@ipmat/attempt`, `@ipmat/practice-block`, `@ipmat/practice-session` |
| `@ipmat/practice-session` | Session lifecycle | (leaf, zero deps) | `@ipmat/practice-block`, `@ipmat/attempt` |
| `@ipmat/practice-block` | Block lifecycle + time derivation | (leaf, zero deps) | `@ipmat/practice-session`, `@ipmat/attempt` |
| `@ipmat/prep-phase` | Calendar-aware phase + catch-up | (leaf) | `@ipmat/attempt`, `@ipmat/mastery` (both directions) |

## Infrastructure packages

| Package | Purpose | Depends on |
|---|---|---|
| `@ipmat/ai` | Provider abstraction, `generateStructured()`, 5 task schemas | **zero** dependency on any domain package (D-017) |
| `@ipmat/db` | Prisma schema, migrations, seed, repository/adapter layer | `@ipmat/attempt`, `@ipmat/autopsy`, `@ipmat/concept-graph`, `@ipmat/examiner-lens`, `@ipmat/mastery`, `@ipmat/prep-phase`, `@ipmat/practice-block`, `@ipmat/practice-session`, `@ipmat/question-engine`, `@prisma/client` — **never** `@ipmat/training-orchestration`/`@ipmat/training-systems`/any provider/`@ipmat/repair-selection`/`@ipmat/adaptive-selection` (a real, verified, load-bearing boundary — see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) for why this matters for the next architectural unit) |

## Application/orchestration packages

| Package | Purpose | Depends on |
|---|---|---|
| `@ipmat/practice-loop` | Wires `@ipmat/attempt`'s lifecycle to `AttemptRepository`/`QuestionReader`/`PracticeBlockReader` | `@ipmat/attempt`, `@ipmat/db` — never `@ipmat/question-engine` directly (only `@ipmat/db`'s own restated `CanonicalQuestion`/`ValidationState`) |
| *(future)* Training Recommendation Composition | Assembles persisted state into `TrainingOrchestrationInput`, calls `orchestrateNextTrainingAction()` | Designed, not implemented — see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) for the full, implementation-ready design |

## Why the tiering is enforced this strictly

Every domain package's own `dependencyBoundary.test.ts` (or the shared, auto-discovering `packages/db/test/architecture/domainBoundary.test.ts`) scans both `package.json`'s declared dependencies and source-file import specifiers for forbidden targets. This turns the architecture doc's dependency-direction rule into something CI actually fails on, not a convention that could silently drift — verified directly across many packages during this session's own work (autopsy, training-orchestration, pressure-training all have this test, and it caught nothing wrong when checked).

See also: [12_DEPENDENCY_GRAPH.md](12_DEPENDENCY_GRAPH.md) for the visual/topological view, [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md) for the enforcement mechanism in more detail.
