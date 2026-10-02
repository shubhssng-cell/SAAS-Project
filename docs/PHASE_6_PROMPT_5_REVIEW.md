# Phase 6 Prompt 5 — Exam Intelligence Integration + Calibration

Final prompt of Product Phase 6. Decision record: [DECISIONS.md D-086](DECISIONS.md). Package: `packages/domain/exam-intelligence` (`@ipmat/exam-intelligence`), DB adapters in `@ipmat/db` (`prismaExamIntelligenceSource.ts`).

## 1. What this is (and is not)

A set of deterministic, auditable services that connect the pieces built in Prompts 1–4 — Exam Pack, Concept Universe, Historical Examiner Intelligence, Question DNA, Question Universe, Content Intelligence — into coverage, queries, calibration status and a selection bridge. It is **not** an AI brain, a score, a predictor, a mastery model or a student-facing surface. Five layers stay separate: exam model, content model, historical evidence, student evidence (never read here), intelligence/selection.

## 2. Coverage

`computeCoverage(snapshot)` returns, per basis (available / validated / published content, and historical), one metric per facet: concept, pattern, combination, transformation, difficulty tier, difficulty dimension (six dimensions × three bands), novelty, trap, time demand. Each metric carries the written definition (universe, observed, denominator, numerator), `denominator`, `numerator`, `ratio`, `itemCount`, per-member counts with distinct structures, `unmapped`, `emptyMembers`, `underrepresentedMembers`, `topMember`/`topMemberShare` and `concentrated`.

- Universe = what is MAPPED (pack concepts, mapped pattern families, combinable concept pairs from the graph, declared testing modes and trap codes, fixed vocabularies). "Mapped" is never "complete".
- `ratio` is `null` for `no_universe` and `insufficient_data`; an empty content pool is a real measured 0.
- No overall percentage exists. 100 questions of one pattern reads 1 of 4 patterns, concentrated.
- Provisional thresholds are the existing `UNIVERSE_THRESHOLDS` / `TIME_DEMAND_BANDS`.

## 3. Data quality

Disposition order per question: cross-exam → fixture → rejected → invalid metadata (existing `validateDnaClassification`) → duplicate (content fingerprint; first by id wins). Historical records: cross-exam, fixture, not reviewed, invalid classification. Everything excluded is counted (`accounting`) and listed with reasons (`dispositions`), so every number traces to its questions.

## 4. Calibration

`provisional` is the default. `observed` requires ≥ `MIN_DISTINCT_STUDENTS_FOR_OBSERVATION` students and `MIN_ATTEMPTS_FOR_OBSERVATION` graded attempts and exposes only aggregates (accuracy, time min/median/mean/max), never a student key. `calibrated` requires an explicit `CalibrationRecord` (field, method, sample sizes ≥ the calibration minimums, calibrator, timestamp) plus sufficient measurements for outcome-measurable fields (expected time, tier, dimensions). Novelty/trap/pattern/relevance have no outcome measurement, so they are provisional until a record asserts otherwise. All minimums are PROVISIONAL. Expected-vs-observed time is descriptive only.

## 5. Selection bridge

`selectQuestions(snapshot, constraints)` → ordered candidates (DNA-level facts only), a per-filter trace (before/after counts), qualifying count and excluded-by-quality counts. Constraints intersect; unknown names throw `invalid_constraint`. `restrictCandidates(providerCandidates, result)` narrows a provider's own pool preserving its order. No provider was changed; a test runs the real Revision provider over restricted candidates.

## 6. Student safety

No route or UI was added, so no student surface can reach this data. Candidates and snapshots' question views carry no body, options, answer, solution, reviewer notes, provenance references or fingerprints; the Prisma source selects only what it needs and uses the body solely to compute the fingerprint. Outcomes use a one-way, exam-scoped student key. Tests: JSON-level checks of snapshot questions, coverage, selection and calibration output for sentinel strings against real Postgres. Raw HTTP / rendered-HTML checks are not applicable because no route exists (a future route must repeat them).

## 7. Real data status

None. No historical papers, no calibrated difficulty, no population statistics. All test data is labelled fixtures; the seeded exam's three project-authored questions are real product content but not historical evidence. Historical coverage over the real database is `insufficient_data`; calibration reports nothing calibrated.

## 8. Limitations

`CalibrationRecord`s have no persistence/workflow. Duplicate detection is exact-content. Fixture detection on DB rows is by marker. Selection constraints cover exam space only (no student state by design). Observed minimums are placeholders pending real data.

## 9. Tests

Domain: 626 tests (quality, coverage, queries, calibration, selection incl. real-provider bridge, service, boundary, 60-seed property suites for coverage invariants, denominator stability, accounting, ordering, exam isolation, selection monotonicity, sparse/empty data). Real Postgres: 15 integration tests (snapshot assembly, tiers, duplicates/fixtures, historical separation, outcomes, selection, exam isolation, no-migration check).
