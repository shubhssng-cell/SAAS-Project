# Product Phase 7 — Mastery + Revision + Full Exam Simulation

Phase 7 is consolidated into five units, each built, verified and committed on its own; none begins until the previous is closed. (This is Product Phase 7 and is unrelated to the older "Phase 7 — Vertical slice hardening" item in `MASTER_PLAN`.)

1. Mastery Model — **Unit 1 complete as the evidence-only foundation**
2. Advanced Revision Intelligence — not started
3. Mastery-Driven Adaptive Curriculum — not started
4. Full Exam Simulation Engine — not started
5. Exam Simulation Intelligence + Readiness — not started

## Unit 1 — Mastery Evidence Foundation (complete)

**Scope decision.** The repository defines no mastery verdict, so Unit 1 was approved as evidence-only: no label, category, threshold, unlock rule or hidden score; no migration, table or `mastery_states` write; no route or UI.

**Built.** `buildMasteryEvidenceView()` in `@ipmat/mastery` and `composeMasteryEvidenceView()` / `TrainingRecommendationService.readMasteryEvidence()` in `@ipmat/training-recommendation`: attempt counts alongside distinct-question counts, skips separate from graded attempts, evidence indexed by pattern family / novelty level / testing mode, paired observed/expected time, and an audit list of contributing attempts, scoped to the verified student and the exam's published pool. Derived from persisted attempts on every call. See D-087 and [../PHASE_7_UNIT_1_REVIEW.md](../PHASE_7_UNIT_1_REVIEW.md).

**Not built (needs product decisions before any mastery judgment).** What "mastered" means, evidence sufficiency, aggregation, recency, prerequisite handling, novelty/transfer and speed interpretation, repair/revision interaction, conflict handling, thresholds, what mastery unlocks. These belong to a future specification, not to guesswork.
