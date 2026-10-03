# Phase 7 Unit 3 — Mastery-Driven Adaptive Curriculum

Decision record: [DECISIONS.md D-089](DECISIONS.md). Code: `packages/domain/adaptive-curriculum` (`@ipmat/adaptive-curriculum`, pure) and `packages/training-recommendation/src/adaptiveCurriculum.ts` (read-only composer).

## 1. Specification audit

**A. Existing specified rules** (reused verbatim):
- **Phase 5D orchestration (D-062):** one next action — a confirmed repair plan first, then the five training systems in the fixed order `trap-lab, calculation-gym, speed-lab, pressure-training, novelty-training`, then adaptive practice as the fallback; a repair `no_match` or an exhausted provider tier falls through; nothing is fabricated when no tier selects (`no_action`).
- **Revision (D-081):** student-chosen, registered but deliberately NOT in the adaptive priority order.
- **Phase 3 adaptive selection**, **Phase 4/5 repair**, every provider's own applicability and selection, **Unit 1 evidence**, **Unit 2 revision intelligence**, **Phase 6 content availability** (`ExamIntelligenceQueries.availability`).

**B. Safe deterministic composition** (implemented): run the existing orchestrator once and carry its result verbatim; list every tier of its fixed order with that tier's own outcome; attach per-concept evidence, signals, active repair target facts and published availability; preserve conflicts.

**C. Not specified anywhere (not invented):** what a "curriculum" is beyond the above; which concept comes next across concepts; any multi-step sequence or ordering beyond the orchestrator's consideration order; where Revision sits relative to repair and adaptive practice; what "done"/"mastered" means; whether revision should wait for repair; any weighting between tiers.

## 2. What it is — and is not

Curriculum **orchestration**, not a mastery model. It selects, filters and ranks nothing: the next action is `orchestrateNextTrainingAction`'s own result (the same as `recommendNextTrainingAction`), re-verified against the exam's published pool (fail closed). No score, verdict, confidence, ability, ranking, prediction or psychological inference exists anywhere in the output (tested). No table, migration, route or UI.

## 3. The output (`AdaptiveCurriculum`)

- `nextAction`: the orchestrator's action verbatim (type, provider, question trace — DNA-level facts only, explanation), plus a fixed `whyThisTier` text naming the D-062 rule, the chain position, fallback flags and, for adaptive practice, the adaptive engine's own reason code. Or `no_action` with the orchestrator's reason.
- `chain`: all seven tiers in the existing order with each tier's own raw outcome, whether the orchestrator actually reached it (it stops at the first selection), and the question that tier selected.
- `steps`: the selected question per tier in the existing order; exactly the orchestrator's pick is flagged `isOrchestratorNextAction`. Revision appears as a step with `chainOrder: null` and `outsideAdaptiveChain: true` — no position is defined for it.
- `concepts` (alphabetical, presentation only): Unit 1's evidence verbatim, the concept's Unit 2 signal ids, unserved signals with reasons, active confirmed repair plans as target facts only (pattern family and priority — no diagnosis detail), which systems serve it, whether the next action targets it, published questions in the pool, and optional Phase 6 availability by tier. Never one number.
- `crossConceptSignalIds` (trap recurrence), `unservedNeeds`, `conflicts`, and Unit 2's `revision` result embedded verbatim for the trace.
- `sequencing: { definedBeyondExistingChain: false }` with an explanatory note.

## 4. Conflicts

Each is preserved with either a **named existing rule** or an explicit **`unresolved_product_decision`**; no hidden score resolves anything.

| Conflict | Resolution |
|---|---|
| `repair_precedes_training_systems` (repair selected while systems also selected) | existing rule: D-062 |
| `revision_available_outside_adaptive_chain` | existing rule: D-081 |
| `no_action_available` | existing rule: D-062 |
| `repair_plan_with_revision_signal` (repair active while a concept is dormant) | unresolved |
| `competing_revision_types`, `recurring_trap_with_correct_attempts` (carried from Unit 2) | unresolved |
| `need_without_provider` (no existing system serves a signal) | unresolved |

## 5. Scoping, persistence, determinism

One ownership-verified, exam-scoped read (the RepairPlan status writer is switched off); the Unit 1/Unit 2 composition was extracted behaviourally unchanged (`composeRevisionFromInput`) so everything derives from the same single read. Nothing is stored. Same evidence, pool and state give the same output in any input order; `evaluatedAt` is the service clock (dormancy is the only rule that needs time, D-081).

## 6. Unresolved product decisions

1. Which concept comes next across concepts (no cross-concept order).
2. Any multi-step curriculum sequence beyond the orchestrator's consideration order.
3. Where Revision sits relative to repair and adaptive practice; whether revision waits for repair.
4. What "completed"/"mastered" means for a concept, and what it would unlock.
5. Whether prep-phase/exam date should shape the curriculum (the composition still passes `prepPhase: null`, V1).
6. Pattern- or mode-level training needs (no system serves them; carried from Unit 2).

## 7. Known limitations

Inherits scoping limits (attempts on no-longer-published questions drop out; concept universe = concepts with published questions; all-time history; Pressure Training stays `insufficient_evidence` because no real caller supplies practice-block evidence into this composition). Phase 6 availability is attached only when an Exam Intelligence source is supplied (not wired into the API); a concept the exam pack does not know has none. No route or UI: a future one must expose only intentionally public fields and repeat the leakage checks (the internal result carries the student's own id and internal ids).

## 8. Tests

Pure layer: 332 tests (real orchestrator/providers/Unit 1/Unit 2 in every scenario: all four next-action outcomes, chain and steps, concept view, conflicts, fail-closed, scope, candidate invariance, determinism, trace integrity, unchanged Phase 3/5D, 60-seed property suites, boundary). Composer over persisted in-memory attempts: 9 tests. Real Postgres: 7 tests (real orchestrator, real Phase 6 source, reproducibility and no writes, student/enrollment/exam isolation, no leakage, no new migration).
