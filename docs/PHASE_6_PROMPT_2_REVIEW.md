# Phase 6 Prompt 2 — Historical Examiner Intelligence + Question DNA (review)

Decision record: [DECISIONS.md D-083](DECISIONS.md). Roadmap: [product-roadmap/PHASE_6_EXAM_INTELLIGENCE.md](product-roadmap/PHASE_6_EXAM_INTELLIGENCE.md). Date: 2026-10-02. Prompt 1 untouched (no regression found). Prompts 3–5 NOT started.

> **HISTORICAL EVIDENCE IS OBSERVED TESTING EVIDENCE, NOT A PREDICTION OF FUTURE EXAM CONTENT.**

## Real vs fixture data — the honest status
**No real historical data exists.** The repository contains no authorized historical IPMAT (or any) exam material and none was added. Every record in every test is a labelled FIXTURE (`dataOrigin: "fixture"`, a `fixtureLabel`, source type `original`, a `fixture:` reference) and is created in tests only — nothing is seeded, `historical_question_records` is empty in every environment (verified: 0 rows after the Postgres runs). No "PYQ" was invented. The layer is a contract, a schema and queries, ready for authorized data.

## Existing structures reused (nothing duplicated)
`QuestionDnaData` (the DNA vocabulary), `DifficultyDimensions` (six dimensions, 0–1, provisional per D-021), `TestingMode` (the "transformations"), `NoveltyLevel` (four levels, unchanged), `ExamRelevance` (kept as an EDITORIAL label), `SourceType`/`Provenance` vocabulary, `ErrorTaxonomy` codes, `QuestionPatternFamilyData`, `@ipmat/exam-pack` (Prompt 1), the `Question`-table enums, the CHECK-constraint approach of migration 0001, the `Restrict` FK discipline (D-060), the `IPMAT_TEST_DATABASE_URL` integration convention.

## What was missing
A historical-record model; DNA validation against an Exam Pack; separation of a model's classification proposal from a reviewed one; exam-scoped deterministic queries over observed testing; a real/fixture distinction.

## What was added
- `packages/domain/examiner-intelligence` (`@ipmat/examiner-intelligence`): `types.ts`, `validate.ts` (`validateDnaClassification`, `validateHistoricalRecord`), `queries.ts`, `service.ts` (repository interface, in-memory repo, `proposeAnnotation`/`recordReview`, `ExaminerIntelligenceService`).
- `packages/db`: migration `0013_historical_question_records` (3 enums, 1 table, hand-written CHECKs), schema model, `PrismaHistoricalRecordRepository`.
- Docs: D-083, this review, roadmap, MASTER_PLAN, DATABASE, ARCHITECTURE, CLAUDE.md rule, project-memory (11, 43, 90, 92, 99).

## Question DNA schema
`HistoricalDnaClassification = Omit<QuestionDnaData, "provenanceSourceType" | "validationState" | "examRelevance">`: exam, section, chapter, concept, subconcepts, prerequisites, combinesWithConcepts, pattern family (named, structure), skill, difficulty tier + six dimensions, novelty level, expected time, testing modes, trap code. No field was invented (tested against the existing example's key set); an invented difficulty dimension is rejected.

## Historical intelligence architecture
Four things stay apart: exam knowledge space (pack) / observed historical testing space (`HistoricalQuestionRecord`) / question representation (DNA) / student evidence (not referenced at all). A record = locator + source/rights + origin + annotation state + optional classification + optional editorial relevance. **No question content** (no body/options/answer/solution) in the type or the table. Queries (all require an exam code, all sorted, defaults = reviewed + real-source only): patterns for a concept, combinations with evidence, transformations / novelty / traps / tiers observed, observed range per difficulty dimension and expected time (separate, flagged provisional, no composite), records for a pattern, source support for a record, and a full `summarizeObservedTesting` facet summary for a later coverage engine (the engine itself is not built).

## Provenance / validation model
Source: existing `sourceType` vocabulary, mandatory `sourceRef`, `licenseRef` unless public domain, `original` forbidden for real sources. Origin: `real_source` vs `fixture` (never ambiguous; enforced in domain and by a DB CHECK). States: `raw_imported` (no classification) → `candidate_annotation` (human/ai_assisted proposal, names its proposer, NO review) → `reviewed_validated` (named reviewer + ISO date). An AI proposal never counts without a review record. Editorial relevance is an annotation with rationale, never evidence or prediction; no prediction field exists.

## API / repository changes
Migration 0013 (additive: no existing table altered; reversal = drop table + 3 types). `PrismaHistoricalRecordRepository` resolves names → ids inside the record's own exam, filters every read by exam code, refuses to move an id between exams. **No HTTP route, no UI**; no app imports the package (grep-verified), so no provenance notes, review metadata, classification reasoning, answer keys or source references can reach a student endpoint.

## Verification (exact)
| Check | Result |
|---|---|
| Focused `@ipmat/examiner-intelligence` | 6 files, **330 tests** pass (DNA 32, record, queries, service, 50-seed properties, boundary). Includes a regression that every existing Phase 3.5 DNA fixture passes the new validation |
| `@ipmat/db` new tests | fake-client 3 + real-Postgres integration 15 (round trips, service over real rows, 8 CHECK-constraint groups each rejected with an `hqr_` error, no-content-columns, cross-exam isolation) |
| Real Postgres 16 (disposable, `127.0.0.1:55432`, `ipmat_test`; 5432 untouched) | migrations 0001–0013 deploy cleanly; `migrate status` up to date; `prisma validate` OK; `migrate diff` vs a shadow DB: **No difference detected** (no drift); seed run; integration 15/15 |
| Full suite WITH Postgres | **248 files, 3424 tests, all pass** |
| Full suite WITHOUT Postgres | 238 files pass, 10 skipped; **3286 pass, 138 skipped** (DB-gated), 0 fail |
| Re-run after the lint fix (test-helper-only change) | exam-pack + examiner-intelligence + db pack/historical + architecture: 11 files, 529 tests pass |
| typecheck / lint / build | clean (lint initially reported 6 unused-variable errors in two test helpers; fixed, re-verified) |
| `git diff --check` | clean |
| Architecture boundary | `domainBoundary.test.ts` (iterates every domain package, now including the new one) passes; the package's own boundary test pins its imports to exam-pack/concept-graph/examiner-lens/question-engine |
| Security/leakage | no app/api/web/practice-api import of the new package; the table has no content columns; types carry no prediction/student-state fields (scanned) |
| Browser QA (scripted headless Edge over CDP, real API on Prisma + Vite) | signup → onboarding → enroll → dashboard → practice-next → question → select → submit ("Correct.") → training hub; no console errors. (One earlier attempt hit a cold-start race before servers were ready; the rerun passed.) No student-visible feature was added or manufactured |
| Phase 1–5 regression | the full prior suite incl. real-Postgres training/practice integration passes unchanged |
| Prompt 1 regression | exam-pack tests (451) and the pack Postgres integration tests pass; `PrismaExamPackRepository` unaffected |
| Cleanup | container removed, no process left on 55432/4001/5184, temp password deleted |

## Defects found and fixed
- Lint: unused destructured variables in two test helpers → replaced with key deletion.
- A test expected facet keys in the wrong sort order (test error, not product).
- Design-time: a draft contradiction rule ("combination concepts imply the `combined` mode") was checked against existing fixtures, found to contradict real data, and dropped.
- `prisma format` realigned existing schema models (cosmetic diff noise in `schema.prisma`; no semantic change, confirmed by the no-drift check). `migrate dev` also rewrote a comment in `migration_lock.toml`; reverted.

## Known limitations
No real historical data (everything real-data is untested against real material); "concept belongs to this exam" is enforced in the adapter, not by a DB constraint; pattern-family lists for validation are supplied by the caller (only Percentages families exist); no review UI/admin boundary/import pipeline/coverage engine; difficulty dimensions on historical records are annotations, not calibrated; no real-student or live-AI involvement.
