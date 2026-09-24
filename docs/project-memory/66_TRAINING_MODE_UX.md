# 66 — Training Mode UX (translating internal vocabulary to student language)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `apps/web/src/adapter/presentation.ts`. Uncommitted. See [66](66_TRAINING_MODE_UX.md) companion: [30_TRAINING_SYSTEMS.md](30_TRAINING_SYSTEMS.md) for what each provider actually detects.

## The exact translation table used

| Internal (`actionType`/`providerId`) | Student-facing `modeLabel` | Student-facing `headline` |
|---|---|---|
| `targeted_repair` | "Confirmed pattern" | "Fix a confirmed mistake pattern" |
| `training_system_practice`, `providerId: "trap-lab"` | "Recurring mistake" | "Practice a recurring mistake" |
| `training_system_practice`, `providerId: "calculation-gym"` | "Calculation accuracy" | "Sharpen your calculations" |
| `training_system_practice`, `providerId: "speed-lab"` | "Solving speed" | "Build solving speed" |
| `training_system_practice`, `providerId: "pressure-training"` | "Under pressure" | "Train under time pressure" |
| `training_system_practice`, `providerId: "novelty-training"` | "New angle" | "Practice a new variation" |
| `adaptive_practice` | "Coverage" | "Keep building your coverage" |
| `no_action` | "Up to date" | "You're all caught up" |

## Worked examples of internal → student-facing translation (from the original product instruction)

| Internal | Student-facing |
|---|---|
| Trap Lab | "Practice a recurring mistake" |
| `base_confusion` | "Reference-base confusion" |
| Speed weakness | "You're solving this type correctly, but slower than expected." |

The last row is realized directly: Speed Lab's `headline`/`explanation` pair is "Build solving speed" / "You're solving this type correctly, but slower than expected. Same difficulty — the focus this time is pace." — matching the instruction's example almost verbatim.

## Why the domain's own `explanation` strings are never shown directly

`RepairSelectionResult.explanation` (e.g. "Matches the exact diagnosed taxonomy cell (cell-repair-1) and the confirmed error category...") references internal ids and codes — never student-safe. `presentation.ts` authors its own explanation text using only structured facts (`actionType`, `providerId`, an `ErrorTaxonomyEntry.label` when available) — this is the one and only place this translation happens, so a future 6th provider or a new action type only requires adding one new entry to this table, never touching a component.

## What never appears in the UI, by construction

Provider ids, candidate counts, `matchTier` names, raw `TrainingOrchestrationDiagnostics`, JSON of any kind, or any wording implying the system is certain about something it only hypothesized.

See also: [62_STUDENT_FLOWS.md](62_STUDENT_FLOWS.md) for where this table lives in the actual code architecture.
