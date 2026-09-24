# 62 — Student Flows (the adapter architecture)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `apps/web/src/adapter/*`, `apps/web/src/App.tsx`, built directly in this session. Uncommitted.

## The application-facing interface (the seam)

```ts
interface TrainingRecommendationAdapter {
  getDashboard(): Promise<DashboardViewModel>;
  loadQuestion(questionId: string): Promise<QuestionViewModel>;
  submitAnswer(input: {questionId, chosenAnswer, timeTakenSeconds}): Promise<AttemptResultViewModel>;
  getAutopsy(attemptId: string): Promise<AutopsyViewModel>;
  respondToAutopsy(input: {attemptId, response: "confirmed"|"rejected"}): Promise<RecommendationViewModel>;
  getNextRecommendation(): Promise<RecommendationViewModel>;
}
```

No view-model type carries a provider id, a training-system internal action type, raw diagnostics, or any answer-bearing field. Every field is either a plain student-facing string the adapter authored, or a plain observable fact (an id, a number, a boolean).

## `createFixtureTrainingAdapter()` — the current, fixture-backed implementation

Wraps a small in-memory session (attempts, confirmed repair plans, pending autopsy state) and calls the **real** domain functions on every method: `startAttempt`/`recordAttemptEvent`/`submitAttempt` (`@ipmat/attempt`), `toAutopsyEvidence`/`buildAutopsyOutput`/`generateHypothesis`/`confirmHypothesis`/`rejectHypothesis`/`buildRepairPlan` (`@ipmat/autopsy`), `computeMasteryState` (`@ipmat/mastery`), `orchestrateNextTrainingAction` (`@ipmat/training-orchestration`). The AI hypothesis call uses `FixtureProvider` with a canned-but-question-specific response — a **real** `generateStructured()` call path, schema-validated, never a hand-written stub bypassing that path.

## App.tsx — the one state machine

```ts
type Screen =
  | {kind: "loading"} | {kind: "dashboard", dashboard}
  | {kind: "question", question} | {kind: "result", result}
  | {kind: "autopsy", result, autopsy} | {kind: "next", recommendation};
```

`App.tsx` is the **only** file that sequences calls to the adapter — no component below it calls the adapter directly, and no component inspects a `TrainingOrchestrationResult`'s internal shape (`actionType`/`providerId`) — that translation happens once, inside `presentation.ts`.

## `presentation.ts` — the one place internal vocabulary is translated

`toRecommendationViewModel(result: TrainingOrchestrationResult): RecommendationViewModel` maps `actionType`/`providerId` to student-facing copy (see [66_TRAINING_MODE_UX.md](66_TRAINING_MODE_UX.md) for the exact mapping table). **Critically, this does NOT reuse the domain's own internal `explanation` strings verbatim** — those strings reference internal ids/codes (e.g. "Matches the exact diagnosed taxonomy cell (cell-repair-1)...") and are explicitly not student-safe. The adapter authors its own copy, using only structured facts (action type, provider id, an error-taxonomy `label` when available) — the *decision* remains 100% the domain's; only the *wording* is authored here.

## A deliberate, disclosed product-scoping decision (not a domain limitation)

The autopsy/confirmation loop only runs for questions with a designed trap code (`dna.trapErrorTaxonomyCode !== null`) — chosen because `buildRepairPlan()` cannot target a `null` error category, and this scoping keeps every autopsy shown leading to a meaningful confirm→repair loop rather than a confusing dead end. An incorrect answer on a non-trap question still counts as real evidence (feeds attempt history/mastery) but surfaces no hypothesis. This is recorded here explicitly so a future session doesn't mistake it for a domain-layer constraint — it's a first-slice UI decision only.

## Why this design is genuinely replaceable

Because the adapter's return types never leak a domain-package-specific shape, and because `App.tsx`/every component depends only on `TrainingRecommendationAdapter`, swapping in a real implementation backed by the future Training Recommendation Composition layer (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md)) requires changing exactly one line in `App.tsx` (`useMemo(() => createFixtureTrainingAdapter(), [])`) and nothing else.
