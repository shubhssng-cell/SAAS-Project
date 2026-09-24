# 63 — Dashboard

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `apps/web/src/components/Dashboard.tsx`, `RecommendationCard.tsx`. Uncommitted.

## What it shows

A welcome headline, a short contextual line (different copy depending on whether the student has practiced 0 questions yet or some number), and one `RecommendationCard` — the single, real, domain-computed "what to do next" suggestion.

## `RecommendationCard` — reused across Dashboard and the post-autopsy "next" screen

```ts
interface RecommendationViewModel {
  questionId: string | null;   // null only for the genuine "nothing to recommend" state
  headline: string;
  explanation: string;
  modeLabel: string;           // a short, plain-language tag -- never a provider id
}
```

If `questionId` is `null`, the action button is disabled and reads "Nothing to start yet" — this is the honest `no_action` state from `orchestrateNextTrainingAction()`, never hidden or faked into looking like there's always something to do.

## What the dashboard deliberately does NOT show

Raw accuracy percentages, a "mastery score," candidate counts, provider ids, diagnostics, or any confidence/prediction claim — per the explicit UX direction (see [61_DESIGN_SYSTEM.md](61_DESIGN_SYSTEM.md)). `questionsPracticedSoFar` (a plain count) is the only numeric fact shown at all on this screen.

## Where the recommendation actually comes from

`adapter.getDashboard()` calls `computeRecommendation()` internally, which builds a fresh `TrainingOrchestrationInput` from the current in-memory session (all attempts so far, all confirmed repair plans, the full fixture question pool) and calls the real `orchestrateNextTrainingAction()` — even on a first visit with zero attempts. See [62_STUDENT_FLOWS.md](62_STUDENT_FLOWS.md).

## Verified behavior on a cold start

With zero attempt history, `orchestrateNextTrainingAction()` still returns a real `selected` action (via the adaptive-selection tier, since all training-system providers correctly report `insufficient_evidence` with no history) — proven directly by an adapter test in this session ("dashboard has a recommendation before any attempts exist"). This was not assumed; it was verified against the real domain code.
