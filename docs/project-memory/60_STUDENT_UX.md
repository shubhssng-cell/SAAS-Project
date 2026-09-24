# 60 — Student UX (overview)

> Part of the [project memory](00_MASTER_CONTEXT.md). **Source: this file documents `apps/web`, built directly in this session and, as of this memory's creation, uncommitted working-tree state — not a historical decision recorded in `docs/DECISIONS.md`.** Verify against the actual working tree (`git status`) before assuming any of this is committed. See [92_CURRENT_STATE.md](92_CURRENT_STATE.md).

## The explicit intended experience

"The system has been paying attention to how I practice." Serious, high-performance, premium, focused, intelligent, student-centered. Explicitly avoiding: childish gamification, generic AI-chatbot appearance, meaningless dashboard percentages, developer/debug terminology, raw diagnostic JSON, provider IDs, candidate counts, internal diagnostics, fake confidence scores, fake predictions.

## The intended flow

```
Dashboard -> Recommendation -> Question -> Timer -> Submit -> Result -> Solution
  -> Autopsy -> Confirmation -> Repair / Next Recommendation -> Continue
```

Each step maps to a real, unmodified domain concept — never an invented UI-only decision:

| UX step | Backed by | Memory file |
|---|---|---|
| Dashboard + Recommendation | `orchestrateNextTrainingAction()`, translated to student language | [63_DASHBOARD.md](63_DASHBOARD.md) |
| Question + Timer + Submit | `startAttempt`/`recordAttemptEvent`/`submitAttempt` (`@ipmat/attempt`) | [64_QUESTION_PLAYER.md](64_QUESTION_PLAYER.md) |
| Result + Solution | The submitted `AttemptState`'s derived correctness/timing | [64_QUESTION_PLAYER.md](64_QUESTION_PLAYER.md) |
| Autopsy (observed + hypothesis) | `buildAutopsyOutput()` + `generateHypothesis()` | [65_AUTOPSY_UX.md](65_AUTOPSY_UX.md) |
| Confirmation | `applyConfirmationResponse()` | [65_AUTOPSY_UX.md](65_AUTOPSY_UX.md) |
| Repair / Next Recommendation | `buildRepairPlan()` + `orchestrateNextTrainingAction()` again | [66_TRAINING_MODE_UX.md](66_TRAINING_MODE_UX.md) |

## The critical architectural rule this UI follows

**No training algorithm inside React.** Every recommendation decision is made by real domain code, called from a plain-TypeScript adapter (`src/adapter/service.ts`), never by a component. Components are purely presentational, driven by view-model props the adapter constructs. See [62_STUDENT_FLOWS.md](62_STUDENT_FLOWS.md) for the exact separation.

## Internal Training Playground ≠ production student experience

`apps/training-playground` (port 5183) is an internal, developer-facing tool for inspecting real domain-package behavior against 10 fixed scenarios — deliberately debug-flavored, shows provider IDs and diagnostics directly. `apps/web` (port 5184) is the actual student-facing product attempt — deliberately never imports the playground's UI code or duplicates its decision-dispatch logic, even though both ultimately call the same real domain functions. See [83_CLAUDE_CODE_WORKFLOW.md](83_CLAUDE_CODE_WORKFLOW.md) for why this separation was maintained strictly during implementation (an explicit instruction: "the playground must remain unchanged").

## Data flow, current vs. eventual

```
Current (apps/web first slice):
  UI -> src/adapter/service.ts (thin, real domain calls, in-memory fixture-backed session state)

Eventual:
  UI -> application adapter -> Training Recommendation Composition -> Training Orchestration -> real persisted student state
```

The adapter's own public interface (`TrainingRecommendationAdapter`) is designed to be the seam — swapping `createFixtureTrainingAdapter()` for a real, persistence-backed implementation of the same interface is meant to be the **only** change needed once the Training Recommendation Composition layer exists (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md)); no component should need to change.
