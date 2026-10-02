# Phase 5 Unit 7 — Revision: review

Decision record: [D-081](DECISIONS.md). Roadmap: [product-roadmap/PHASE_5_TRAINING_SYSTEMS.md](product-roadmap/PHASE_5_TRAINING_SYSTEMS.md). Project memory: [project-memory/38_REVISION_TRAINING.md](project-memory/38_REVISION_TRAINING.md).

## What this unit is

Revision is the sixth training system and the first built from an owner-supplied specification rather than a pre-existing provider: before this unit the repository had no Revision design at all (project-memory: "undesigned"). Unit 7 added a NEW provider, `@ipmat/revision-training`, and made it student-facing inside the Unit 1–6 session framework.

## The definition (authoritative, as implemented)

- **Concept-level re-exposure.** A concept is eligible when the student has ≥ 3 graded attempts on it AND its most recent graded attempt is ≥ 14 days old. The 14 days is a **provisional, deterministic product constant** (`REVISION_CONSTANTS.DORMANCY_DAYS`), not a learned decay model, not a forgetting curve, not a spaced-repetition interval, uncalibrated and intended for later empirical calibration. A day is exactly 24 h of elapsed time (no timezone/DST arithmetic).
- **Graded attempt:** `submitted` with recorded correctness, and a usable persisted `finalizedAt`. Skipped/abandoned never count; correctness never matters; attempts (not distinct questions) are counted; another student's attempts never count.
- **Target:** the eligible concept whose latest graded attempt is OLDEST; ties break on concept name ascending. No hidden score.
- **Question selection:** published + structurally valid + exact target concept; unseen taxonomy cell first, then least prior exposure, then question id. Never switches concept: an empty target pool is the explicit `no_eligible_question`.
- **No stages.** The rule is an applicability condition only. **No stored state:** nothing records a due flag, date, score or state; everything is derived from attempt history on every call.
- **Time is supplied, never read.** `TrainingSystemContext.now?: string` (additive, optional, like `practiceBlocks`) is assembled by composition; the provider never reads a clock, and a missing/unparseable `now` fails closed.

## How Revision differs from the others

Calculation Gym = computational fluency; Speed Lab = time efficiency; Trap Lab = recurring error-taxonomy failures; Novelty = exposure to novel styles; Pressure = performance under pressure via block evidence; Overtraining = not built. Revision reads only attempt counts, last graded time and question/cell exposure — never trap codes, novelty levels, practice blocks, mastery or the taxonomy (tested by poisoning each) — so it cannot be a repair engine, a pressure system or generic adaptive practice. It is deliberately **not** in the adaptive provider priority chain: registered in the registry (so the student can choose it) but absent from `TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER`, so adaptive orchestration is unchanged.

## What was reused (unchanged)

The generic session framework (creation, configuration, lifecycle, persistence, ownership, concurrency); the one attempt lifecycle; the observable session summary; the Training Hub / session / result / error screens; composition (which already computes `now`); the `noLongerApplicableNote` and `conceptNotInObjective` catalog hooks; `runTrainingSystem()` and the orchestration registry. **No web or API code changed** — the hub, session and result screens are data-driven.

## What was added

- **`@ipmat/revision-training`**: constants, applicability, exposure, selection, provider (+ tests).
- **Contract:** `TrainingSystemContext.now?` and `TrainingOrchestrationInput.now?` (forwarded by `toTrainingSystemContext`, set by composition); provider registered in the orchestration registry (not in the priority order).
- **Catalog:** Revision's entry (`systemId: "revision"`, `providerId: "revision-training"`, no `stages`, `conceptNotInObjective`, authored copy).
- Tests, `TrainingWorld.nowSeconds` (a controllable recommendation clock for the in-memory world; default unchanged), docs, D-081.

## Student-facing behavior

- **Hub:** "Revision" — "Revisit a concept you have practiced before but not attempted for a while." Not startable: "Needs a concept you have practiced several times before and have not attempted for a while."; applicable but no published question: "No published question is available for that concept right now." All session lengths are offered.
- **Session:** titled "Revision"; objective names no concept; "Question N of M" and the per-question timer; no stage, no day count, no timestamp.
- **One question per dormant concept.** Because a revised concept's latest graded attempt becomes recent, a session serves one question per dormant concept, longest-dormant first; when none remain the session says "That concept has now been revisited, and no other concept is waiting for a revisit right now. You can end the session." and offers to end. A skipped question is not a graded attempt, so that concept stays dormant and the session keeps serving it.
- **Completion:** observable counts, correctness, time vs expected, "Completed normally", the record-of-this-session note — no retention or improvement claim.
- **Never shown:** the dormancy rule, day count, thresholds, timestamps, graded-attempt counts, provider ids, taxonomy-cell ids, diagnostics; never forgetting/memory/ability/emotion/trait wording; no score, rank, priority, due date or interval field.

## Defects found and fixed

1. `typeof NaN === "number"` lets a candidate with a NaN expected time pass the sibling providers' "structurally valid" check; Revision uses `Number.isFinite` (a provider test caught it; sibling providers untouched, as they are completed units).
2. Placeholder tests asserting Revision was "not built" (catalog, hub, run-system, orchestration dependency set) were updated with the reason stated.
3. Test-authoring slips caught during verification: a substring match of "ability" inside the field name `availability`, and "revision" matching the session's own `systemId` — both narrowed (word boundary / explicit terms), neither a product defect.

## Verification (exact counts are in the roadmap file)

Provider tests (applicability, boundary at exactly 14 days, targeting, tie-break, selection preference order, no-concept-switch, candidate-pool invariance, history, poisoning of other systems' evidence, no stage/score/clock/randomness in source, dependency boundary, epistemic language, 200-history and 100-pool seeded property tests); 22 session-level tests over the real provider; 8 real-Postgres tests through the real HTTP server and Prisma repositories with two instances; 31 browser checks (including phone-width layout, API restart, API-down error, loading and recovery). **Synthetic data:** labelled "[TEST DATA phase-5-unit-7]" clones of the seeded demonstration question (trap tag removed) across two seeded concepts and seeded cells, with history backdated in the table, published only in throwaway databases that were dropped; seeded real questions withheld inside those databases only and verified restored; the shared test database and port 5432 untouched.

## What remains unverified / not claimed

- Whether revisiting a concept improves retention or exam performance — nothing here measures it; 14 days is an uncalibrated product constant.
- `no_eligible_question` end to end (applicable concept whose published pool is empty): it cannot be reached through the real composition because the evidence questions themselves must be published to enter the attempt records and are therefore candidates of that concept. It IS covered at the provider level, has authored hub copy, and a catalog test covers the copy; there is no HTTP/browser test of that state.
- No real student has used it; the seed content cannot activate it without two weeks of history.
- No live model is involved anywhere in Revision.

## Next

Unit 8 — **not started.**
