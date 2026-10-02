# Phase 7 Unit 1 — Mastery Evidence Foundation

Decision record: [DECISIONS.md D-087](DECISIONS.md). Code: `packages/domain/mastery/src/evidenceView.ts`, `packages/training-recommendation/src/masteryEvidence.ts`.

## 1. What this unit is — and is not

Unit 1 was scoped to the **evidence-only** foundation. The repository has no specification of what "mastered" means (no verdict, category, threshold, unlock rule, recency, prerequisite, repair, revision or speed-to-mastery policy), and the brief forbids inventing one. So this unit builds a **mastery-ready evidence representation** and nothing that judges.

It is NOT: a mastery verdict, label, category, threshold, unlock rule, numeric score, hidden score, confidence/ability/motivation inference, prediction, or a student-facing surface. There is no route, no UI, no table, no migration and no `mastery_states` write. The existing five-measure `computeMasteryState()` (D-040–D-043) is unchanged.

## 2. What mastery-related structures existed (unchanged)

`@ipmat/mastery`: `computeMasteryState()` (five independently nullable measures, `MIN_OBSERVATIONS_FOR_COMPONENT` = 3 provisional), `MasteryComponentDetail`, `MasteryStateRepository` (never called by a real flow). Revision (D-081), adaptive selection and Autopsy/Repair are separate systems and were not touched.

## 3. The evidence view

`buildMasteryEvidenceView(records, { studentId, examCode, conceptNames? })` is pure and deterministic. Per concept it returns:

- `overall` bucket and indexes by **pattern family**, **novelty level** and **testing mode**.
- Every bucket carries **attempt counts alongside distinct-question counts** (never substituted for each other): `attempts`, `gradedAttempts`, `correctGradedAttempts`, `incorrectGradedAttempts`, `skippedAttempts`, `abandonedAttempts`, `ungradedAttempts`, `distinctQuestions`, `distinctGradedQuestions`, `distinctSkippedQuestions`.
- **Skips, abandons and submitted-without-correctness are separate** from graded counts; attempts always partition into graded + skipped + abandoned + ungraded.
- **Time evidence**: per graded attempt, observed seconds paired with expected seconds and correctness. No ratio, no fast/slow label.
- **Audit**: every bucket lists its `contributingAttemptIds` (chronological, id tiebreak); `questions` lists per-question exposure (repeats stay visible).
- `status: "evidence_only"`, plus `excluded` accounting (other student, other exam, outside concept universe, duplicate attempt record).

Dimension semantics: each attempt is in exactly one pattern-family and one novelty bucket, and in every testing-mode bucket its question lists (modes overlap). A value never encountered has no key — absence of evidence, not zero.

## 4. Scoping and persistence

- **Student/enrollment**: `composeMasteryEvidenceView` reuses the existing composition, which verifies enrollment ownership first and reads only that student's finalized attempts.
- **Exam**: an attempt contributes only if its question is in the enrollment's exam's published, DNA-complete pool and resolves to the same concept. The concept universe is the exam's concepts with published questions. A different exam yields a separate view; an exam with no pool yields `null`.
- **Persistence**: none. The view is derived on every call from persisted attempts (canonical evidence = the `attempts` rows); nothing is cached or materialized, and the underlying composition's one possible write (RepairPlan status sync) is disabled for this read.

## 5. Explicitly NOT implemented (needs a product decision)

Any verdict/category/threshold/unlock; evidence-sufficiency gating beyond the existing provisional 3; recency/decay; prerequisite propagation; novelty/transfer interpretation; speed interpretation; repair/diagnosis weighting; Revision interaction; conflict resolution; repeated-question weighting in the existing measures (they still count attempts — the new distinct counts sit beside them); a route or UI.

## 6. Known limitations

- An attempt on a question that is no longer published drops out of the view (existing composition scoping).
- The concept universe is concepts with published questions, not the full Exam Pack.
- Mode buckets overlap by design, so they do not sum to the overall bucket.
- Evidence is all-time and unbounded (V1 policy of the existing history reader).
- No route yet: a future one must return only intentionally public fields and repeat the HTTP/HTML leakage checks.

## 7. Tests

Pure builder: 31 example tests plus 60-seed property suites (partition/accounting invariants, order independence, non-mutation, student/exam isolation, duplicates/skips never change graded counts) and a boundary test (no clock, vendor, verdict/score/inference/prediction/prerequisite/repair/revision/speed vocabulary). Composition over persisted in-memory attempts: 10 tests. Real Postgres: 6 tests (counts, reproducibility and no writes, student isolation, enrollment ownership, exam isolation, no leakage, no new migration).
