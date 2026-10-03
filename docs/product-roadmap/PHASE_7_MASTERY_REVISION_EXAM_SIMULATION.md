# Product Phase 7 — Mastery + Revision + Full Exam Simulation

Phase 7 is consolidated into five units, each built, verified and committed on its own; none begins until the previous is closed. (This is Product Phase 7 and is unrelated to the older "Phase 7 — Vertical slice hardening" item in `MASTER_PLAN`.)

1. Mastery Model — **Unit 1 complete as the evidence-only foundation**
2. Advanced Revision Intelligence — **complete (evidence-derived signals over the existing providers; no priority/verdict)**
3. Mastery-Driven Adaptive Curriculum — **complete (composition of the existing orchestration; no new ordering/verdict)**
4. Full Exam Simulation Engine — **complete as exam-rule-free mechanics (no exam configuration exists, so nothing can start yet)**
5. Exam Simulation Intelligence + Readiness — **complete as readiness EVIDENCE (five separate facts; no score, category or verdict)**

## Unit 1 — Mastery Evidence Foundation (complete)

**Scope decision.** The repository defines no mastery verdict, so Unit 1 was approved as evidence-only: no label, category, threshold, unlock rule or hidden score; no migration, table or `mastery_states` write; no route or UI.

**Built.** `buildMasteryEvidenceView()` in `@ipmat/mastery` and `composeMasteryEvidenceView()` / `TrainingRecommendationService.readMasteryEvidence()` in `@ipmat/training-recommendation`: attempt counts alongside distinct-question counts, skips separate from graded attempts, evidence indexed by pattern family / novelty level / testing mode, paired observed/expected time, and an audit list of contributing attempts, scoped to the verified student and the exam's published pool. Derived from persisted attempts on every call. See D-087 and [../PHASE_7_UNIT_1_REVIEW.md](../PHASE_7_UNIT_1_REVIEW.md).

**Not built (needs product decisions before any mastery judgment).** What "mastered" means, evidence sufficiency, aggregation, recency, prerequisite handling, novelty/transfer and speed interpretation, repair/revision interaction, conflict handling, thresholds, what mastery unlocks. These belong to a future specification, not to guesswork.

## Unit 2 — Advanced Revision Intelligence (complete)

**Scope decision.** The repository defines Revision (D-081) and each provider's own rules but no revision priority, no pattern- or mode-level revision type, no backlog notion and no strength/weakness verdict, so Unit 2 implements only the evidence-derived, deterministic foundation and reports the rest.

**Built.** `@ipmat/revision-intelligence` (pure) and `composeRevisionIntelligence()` / `readRevisionIntelligence()` in `@ipmat/training-recommendation`: six threshold-free signal kinds (two reuse Revision's and Trap Lab's own rules), the existing providers' raw outcomes, traced recommendations only where a provider selected a published question, unserved signals with reasons, preserved conflicts, and an explicit `priority: { defined: false }`. Derived from persisted attempts; no migration, table, route or UI. See D-088 and [../PHASE_7_UNIT_2_REVIEW.md](../PHASE_7_UNIT_2_REVIEW.md).

**Not built (needs product decisions).** Priority among revision needs, pattern/mode-level revision, backlog, over-concentration, novel-question weakness, strength/weakness, calibration of the provisional constants.

## Unit 3 — Mastery-Driven Adaptive Curriculum (complete)

**Scope decision.** The repository specifies the orchestrator's single next action and its fixed tier order (D-062) and keeps Revision outside it (D-081), but defines no curriculum, cross-concept order, multi-step sequence or completion/mastery state, so Unit 3 only composes what exists and reports the rest.

**Built.** `@ipmat/adaptive-curriculum` (pure) and `composeAdaptiveCurriculum()` / `readAdaptiveCurriculum()` in `@ipmat/training-recommendation`: the orchestrator's own next action (verified against the published pool), the chain of every tier with its own outcome, steps in the existing order with Revision outside it, a per-concept view (Unit 1 evidence, Unit 2 signals, repair target facts, optional Phase 6 availability), and preserved conflicts. Derived from persisted attempts; no migration, table, route or UI. See D-089 and [../PHASE_7_UNIT_3_REVIEW.md](../PHASE_7_UNIT_3_REVIEW.md).

**Not built (needs product decisions).** Cross-concept order, a multi-step sequence, Revision's position relative to repair/adaptive, completion/mastery semantics, prep-phase influence.

## Unit 4 — Full Exam Simulation Engine (complete as rule-free mechanics)

**Scope decision.** The repository specifies no IPMAT duration, section structure, question counts, marking/negative marking, navigation or review rule, pause/resume or historical paper, so Unit 4 builds only the mechanics and takes every exam rule as data it does not ship.

**Built.** `@ipmat/exam-simulation` (pure) + Prisma adapters + migration `0016_exam_simulation` (three tables): validated configuration and explicit paper assembly, a server-authoritative state machine (exclusive deadline, deterministic expiry, idempotent finalization, race-safe, recoverable), a raw result with no score, and the explicit finalized-evidence contract for Unit 5. No route, no UI, no score. See D-090 and [../PHASE_7_UNIT_4_REVIEW.md](../PHASE_7_UNIT_4_REVIEW.md).

**Not built (needs exam/product decisions).** The real IPMAT structure, marking scheme, navigation/review rules, pause/accommodations, historical or generated papers, post-finalization review, evidence integration.

## Unit 5 — Exam Simulation Intelligence + Readiness evidence (complete; Phase 7 complete)

**Scope decision.** The repository defines readiness only as five separate observable distinctions, never one number (PRODUCT_SPEC section 3), and no threshold, category, score, probability or simulation-to-practice feed, so Unit 5 builds the evidence report organised around those five distinctions and reports the rest as unresolved.

**Built.** `@ipmat/simulation-intelligence` (pure), `composeExamPerformanceIntelligence()` / `readExamPerformanceIntelligence()` and `PrismaFinalizedSimulationReader`: finalized-only simulation evidence, per-dimension aggregation, comparison only between identical-paper and configuration simulations, traceable observations, read-only bridges to Units 1-3, optional Phase 6 content evidence, and an explicit `readiness: { defined: false }`. No migration, table, route or UI. See D-091 and [../PHASE_7_UNIT_5_REVIEW.md](../PHASE_7_UNIT_5_REVIEW.md).

**Not built (needs product decisions).** Any readiness threshold, category or score; the "above exam difficulty" mapping; pressure classification of a timed simulation; simulation-to-practice feeds; cross-paper comparison; a student-facing surface.
