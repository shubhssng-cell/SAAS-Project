# 65 — Autopsy UX

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `apps/web/src/components/AutopsyCard.tsx`, `ConfirmationPrompt.tsx`, `apps/web/src/adapter/presentation.ts`. Uncommitted.

## The core product principle, enforced visually, not just logically

The screen keeps three things visually and textually separate:

1. **What was observed** — a plain bullet list (`describeObservations()`), e.g. "You changed your answer once before submitting," "You've made this exact type of mistake 2 times before."
2. **What the system thinks may have happened** — the AI's `proposedExplanation`, inside a visually distinct `.hypothesis-box` (dashed border, warm background), headed "Our best guess — not confirmed yet."
3. **What the student confirms** — a direct Yes/No question ("Does that match what actually happened?"), never buried under the hypothesis text.

This is a direct, literal UI translation of [22_OBSERVATION_EVIDENCE_HYPOTHESIS.md](22_OBSERVATION_EVIDENCE_HYPOTHESIS.md)'s chain — the visual separation exists specifically so a student can never mistake layer 2 for a settled fact.

## `describeObservations()` — translation, not invention

Reads `BehaviorSignals`/`HistoricalSignals` (real, deterministic `@ipmat/autopsy` output) and turns each true flag into a plain sentence — e.g. `answerChanged` → "You changed your answer once before submitting," `repeatedTaxonomyCellFailure` → "You've made this exact type of mistake N times before." This is presentation logic (wording), never new decision logic — every fact it renders was already computed by the real domain function; nothing here inspects raw attempt data itself.

## Error-taxonomy labels, reused rather than duplicated

Student-facing personalization (e.g. "Reference-base confusion — you confirmed this is what happened last time") uses the **existing** `ErrorTaxonomyEntry.label`/`.description` fields directly — never a second, parallel translation table. This matches the explicit instruction to translate internal codes (`base_confusion`) into student language (`"Reference-base confusion"`) without inventing new domain concepts.

## `ConfirmationPrompt` — deliberately just Yes/No for the first slice

`onRespond("confirmed" | "rejected")` maps directly to `applyConfirmationResponse()`. A "corrected" (free-text) response path exists in the domain layer (see [22_OBSERVATION_EVIDENCE_HYPOTHESIS.md](22_OBSERVATION_EVIDENCE_HYPOTHESIS.md)) but was not built into this first UI slice — a disclosed simplification, not a domain gap.

## What happens after each response

- **Confirmed** → `buildRepairPlan()` is called for real (if `proposedErrorCategory !== null`), added to the session's confirmed-plans list, then `getNextRecommendation()` is recomputed — which will now genuinely find this plan via `orchestrateNextTrainingAction()`.
- **Rejected** → `rejectHypothesis()` is called; no RepairPlan is created; the next recommendation falls through to the adaptive/training-system tiers exactly as the real orchestration logic dictates.

Both paths were verified directly against real domain code in this session's adapter test suite, not simulated.
