# Phase 7 Unit 2 — Advanced Revision Intelligence

Decision record: [DECISIONS.md D-088](DECISIONS.md). Code: `packages/domain/revision-intelligence` (`@ipmat/revision-intelligence`, pure) and `packages/training-recommendation/src/revisionIntelligence.ts` (read-only composer).

## 1. What this is — and is not

**Evidence → revision signals → the EXISTING providers' own decisions → a traced recommendation.** It explains what could be revised, why, with which exposure type and which question, from observable evidence only.

It is NOT a mastery verdict, score, ranking, readiness or prediction, and it infers nothing about confidence, ability, motivation or emotion. It adds no table, migration, route or UI, selects no question itself, and does not modify any provider or Unit 1.

## 2. What the repository already defined (reused, not redesigned)

- **Revision (D-081):** a concept is eligible with ≥ 3 graded attempts and a most recent graded attempt ≥ 14 days old (both provisional constants); correctness irrelevant; skips never count. The signal reuses `deriveConceptDormancies`, `REVISION_CONSTANTS`, `DORMANCY_MS` — it never re-implements the rule, and unlike the provider (which targets one concept) it reports every eligible concept.
- **Trap Lab (D-078):** recurrence = at least `AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT` DISTINCT failing questions sharing a designed trap code, across concepts. Reused via `computeTrapAssociatedFailureRecurrence`.
- **Every existing provider** (Calculation, Speed, Trap, Novelty, Pressure, Revision) keeps its own applicability and selection; this layer only runs them (through the product's catalog-aware `runTrainingSystem`) and records their raw outcomes.
- **Unit 1 evidence view** is consumed unchanged.

## 3. New, threshold-free evidence signals

Six closed kinds, each with a fixed definition text, exact facts, contributing attempt ids and an explanation: `dormant_concept`, `recurring_trap_failure` (both reuse existing rules); `attempts_exceed_distinct_questions` (some question attempted more than once); `pattern_family_without_graded_evidence`, `novelty_level_without_graded_evidence`, `testing_mode_without_graded_evidence` (the PUBLISHED pool offers the value for a concept the student has graded evidence on, but the student has no graded attempt on it — absence of evidence, not a finding). A skipped-only encounter is still "without graded evidence"; the skip count is shown in the facts.

## 4. Recommendations, trace and conflicts

- A recommendation exists only where an existing provider returned `selected`. It carries the provider's explanation verbatim, the exposure-type label of that system (`concept_re_exposure`, `trap_recurrence_practice`, `novelty_exposure`, `calculation_practice`, `pace_practice`, `timed_run_practice` — names of what each provider already does, no new semantics), the linked signals, evidence dimensions, contributing attempts, and the selected question, which is re-checked against the exam's published pool (a non-published or other-exam selection is refused, fail closed).
- Where a provider's evidence is its own (Calculation, Speed, Pressure, and Novelty's exposure rule) no signal is linked and the trace says so; the layer does not guess.
- **Unserved signals** are listed with a reason, including "no existing training system provides pattern-family- or testing-mode-level revision" and "none serves repeated-question exposure".
- **Conflicts are preserved, never resolved:** `competing_revision_types` (two or more systems selected) and `recurring_trap_with_correct_attempts` (both counts shown). `no_eligible_question` is reported separately from `not_applicable`.
- The output states `priority: { defined: false }`; recommendations are listed alphabetically by system id, which carries no meaning.

## 5. Scoping and persistence

Same ownership-verified, exam-scoped composition as every recommendation (its one possible write, the RepairPlan status sync, is switched off). The context given to the providers is scoped to one student and one exam by `scopeContextToExam`. Nothing is stored; no route reads it. An exam with no published pool yields `null`.

## 6. Unresolved product decisions (not invented)

1. Which revision need comes first (no priority among revision needs exists; the D-062 order excludes Revision).
2. Any revision type at pattern-family or testing-mode level (no existing training system provides it).
3. A "revision backlog", over-concentration shares, "novel-question weakness" and any strength/weakness notion (all need a verdict or a new threshold).
4. Whether a recurring trap with correct attempts on the same trap should rank differently.
5. What repeated-question exposure should trigger.
6. Whether gap signals should apply to concepts without graded evidence (currently they do not).
7. Calibrating the two provisional constants (3 graded attempts, 14 days) and the trap recurrence minimum.

## 7. Known limitations

- `evaluatedAt` comes from the service's clock; given the same `now` the result is identical (tested).
- Inherits the existing scoping: attempts on a question no longer published drop out; the concept universe is concepts with published questions; history is all-time.
- The existing Revision provider does not filter candidates by exam itself — the composer's exam-scoped pool and `scopeContextToExam` guarantee isolation, and an unscoped foreign pick is refused.
- A future route must expose only intentionally public fields and repeat the leakage checks (the result carries the student's own id and internal signal ids).

## 8. Tests

Pure layer: 351 tests (signal kinds and boundaries, real Revision and Trap Lab providers, scripted outcomes for the other systems, conflicts, no-eligible-candidate, candidate invariance, trace integrity, unchanged Unit 1, 60-seed property suites, boundary checks). Composer over persisted in-memory attempts: 10 tests. Real Postgres: 7 tests (dormancy and the real provider's selection, skips, reproducibility and no writes, student/enrollment/exam isolation, no leakage, no new migration).
