# 38 — Revision (`@ipmat/revision-training`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-081 (the owner-supplied specification, implemented as written). Sixth concrete `TrainingSystemProvider`; Phase 5 Unit 7. Review: [../PHASE_5_UNIT_7_REVIEW.md](../PHASE_5_UNIT_7_REVIEW.md).

## Definition

Deliberate **concept-level re-exposure**: a concept is eligible only when the student has **≥ 3 graded attempts** on it AND its **most recent graded attempt is ≥ 14 days old**. The 14 days (`REVISION_CONSTANTS.DORMANCY_DAYS`) is a fixed, **PROVISIONAL**, deterministic product constant — not a decay model, forgetting curve or spaced-repetition interval; uncalibrated; for later empirical calibration. A day = exactly 24 h elapsed; exactly 14 days is eligible.

## Rules

- Graded = `submitted` with recorded correctness + a usable `finalizedAt`; skipped/abandoned never count; correctness irrelevant; attempts (not distinct questions) counted.
- Target = the eligible concept dormant the longest; ties by concept name ascending. No score.
- Selection: published + structurally valid (finite expected time) + exact target concept; unseen taxonomy cell, then least exposure, then question id. Never switches concept; empty pool = `no_eligible_question`.
- **No stages. No stored state** (no due flag/date/score/state column). Derived from attempt history on every call.
- Time comes from `TrainingSystemContext.now` (additive, optional); the provider never reads a clock; no `now` = not applicable.
- Reads ONLY `studentId`, `attemptRecords`, `now` in `evaluate()` — never candidates, trap codes, novelty levels, blocks, mastery or taxonomy.

## Integration

Registered in the orchestration registry but **NOT** in `TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER` — student-chosen, never part of the adaptive chain. Catalog: `systemId: "revision"`, `providerId: "revision-training"`. A session is a thin row on a `PracticeBlock`; its attempts are ordinary, so a revised concept stops qualifying at once and a session serves one question per dormant concept (longest-dormant first), then says nothing more is waiting and offers to end. A skipped question leaves the concept dormant.

## Not Revision

Not Trap Lab (error recurrence), Novelty (style exposure), Pressure (block evidence), Calculation/Speed, adaptive practice, mistake repair or Overtraining.

## Limits

Retention/performance benefit unmeasured; 14 days uncalibrated; `no_eligible_question` not testable end to end through real composition (provider-level only); no real student has used it.
