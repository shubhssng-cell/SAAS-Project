# Phase 6 Prompt 1 — Exam Pack + Concept Universe (review)

Decision record: [DECISIONS.md D-082](DECISIONS.md). Roadmap: [product-roadmap/PHASE_6_EXAM_INTELLIGENCE.md](product-roadmap/PHASE_6_EXAM_INTELLIGENCE.md). Date: 2026-10-02. Prompts 2–5 are NOT started.

## What already existed (reused, not duplicated)
`Exam/Section/Chapter/Concept/ConceptRelation` tables; the eight typed relations and their metadata (`@ipmat/concept-graph`); `normalizeConceptNameKey` (D-030); the Percentages-only curated graph (12 concepts, 16 relations); the Quant chapter list (inline in `seed.ts`); the content-rights/provenance rules; the `IPMAT_TEST_DATABASE_URL` opt-in real-Postgres test convention.

## What was missing
A generic exam-agnostic pack; any graph validation (duplicates, dangling refs, self-loops, cycles, cross-exam rows); traversal beyond direct lookups; provenance/review state for exam structure; a hierarchy deeper than chapter; a read path that assembles a whole exam.

## What was added
- `packages/domain/exam-pack` (`@ipmat/exam-pack`): `types.ts`, `semantics.ts` (per-relation-type structural rules), `validate.ts`, `traversal.ts`, `service.ts` (repository interface, in-memory repo, `ExamPackService`, provenance summary, `toPublicExamPackView`), `packs/ipmatIndore.ts` (IPMAT as data).
- `packages/db/src/repositories/prismaExamPackRepository.ts` (read-only), and `seed.ts` consuming `IPMAT_QUANT_CHAPTERS`.
- Tests: 6 files in `exam-pack` (validation, traversal, service/public view, IPMAT integrity, property tests, boundary), a fake-Prisma test and a real-Postgres integration test in `@ipmat/db`.
- Docs: D-082, this review, the Phase 6 roadmap file, CLAUDE.md rule + link, MASTER_PLAN, ARCHITECTURE, project-memory (11, 40, 90, 92, 99).

## Architecture
**Exam Pack.** Identity (`examCode`, `packVersion`, `name`) + ordered sections + `SyllabusNode`s (`parentKey` nesting, sibling order) + concepts (key = `slugKey(name)`, located at a node; skills/pattern refs/importance optional and empty unless sourced) + typed relations + terminology, each with `PackProvenance` (`kind` x `reviewState`). Generic modules never contain `IPMAT`; the package imports only `@ipmat/concept-graph` (both tested).
**Concept Universe.** Reuses the eight types. Ordering relations (`prerequisite`, `foundational`, `advanced_extension`) must be acyclic — per type, then on the union; symmetric types reject reversed duplicates; `application`/`dependent` may be cyclic. "Unlocks" = inverse of `prerequisite`. Traversal is deterministic (explicit sort), terminates on cycles, and an unknown key is a typed error. The service fails closed on an invalid pack.
**Student-state boundary.** No mastery/confidence/attempt/student field anywhere (tested on types, IPMAT data and the public view).
**Provenance.** IPMAT is entirely `authored` + `unvalidated` (no official syllabus exists in the repo); nothing is claimed canonical or reviewed; the structure's `sourceRef` says it is unverified; terminology/skills/patterns/importance are empty. Database-assembled packs are `unvalidated` (the DB stores no provenance).

## DB / API
No migration, no schema change (verified: `prisma migrate status` — 12 migrations applied, schema up to date; `schema.prisma` untouched). No HTTP route, no UI; no app imports `@ipmat/exam-pack` (grep-verified), so no student-facing response can expose pack data. `toPublicExamPackView()` is the vetted projection for later.

## Verification (exact)
| Check | Result |
|---|---|
| Focused: `@ipmat/exam-pack` | 6 files, 451 tests pass |
| `@ipmat/db` pack tests (fake Prisma) | 6 pass; architecture boundary test 47 pass (new package covered) |
| Real Postgres 16 (disposable, `127.0.0.1:55432`, db `ipmat_test`; 5432 untouched), migrations 0001–0012 deployed, seed run | pack integration test 5/5 pass (seeded pack validates; DB-assembled structure equals in-code pack; no provenance upgrade; unknown exam = null; second exam isolated + injected cross-exam relation row detected, service fails closed for both exams, restored after delete; rows cleaned up, 0 left) |
| Full suite WITH Postgres (`IPMAT_TEST_DATABASE_URL`) | 240 files, 3074 tests, all pass |
| Full suite WITHOUT Postgres | 231 files pass, 9 skipped (DB-gated); 2951 pass, 123 skipped, 0 fail |
| `npm run typecheck` / `lint` / `build` | clean (all workspaces; web builds) |
| `git diff --check` | clean |
| Browser QA (headless Edge driven over CDP against real API on Prisma + Vite web) | landing, signup, onboarding, enrollment, dashboard, practice-next, question render, option select, submit -> "Correct." result, training hub (cards render; evidence-gated systems correctly "Not available" for a brand-new student) — no console errors. Starting a training session was not exercised in the browser (a new student has no evidence); training session behavior is covered by the unchanged Phase 5 integration suites, which pass on real Postgres |
| Phase 1–5 regression | the full prior suite (incl. the real-Postgres training/practice integration tests) passes unchanged |
| Cleanup | container removed, no leftover process on 55432/4001/5184, temp password deleted |

## Defects found and fixed during the unit
- Test-authoring defects caught by the first run (not product bugs): a boundary test matched `@ipmat/` imports as "naming IPMAT"; an advanced_extension cycle test used undeclared concepts; a "cycle only across types" fixture accidentally also contained a per-type cycle. All fixed by correcting the tests; no source change was needed.
- A generic-module comment mentioning the exam by name was reworded (the boundary test caught the principle, not an actual leak).

## Known limitations / provisional
Only chapter-level hierarchy persistable; IPMAT limited to Quant and the Percentages neighborhood; no terminology/skills/pattern/importance data; DB cannot prevent cross-exam relation rows (detected on read); `packVersion` is a free string; no `fast-check` (seeded-PRNG properties instead); browser QA used a scripted headless browser, not a manual session; no real-student validation; no live AI involved.
