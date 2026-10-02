# Product Phase 6 — Exam Intelligence + Content Depth

> **STATUS: IN PROGRESS — Prompts 1 and 2 of 5 complete (Exam Pack + Concept Universe; Historical Examiner Intelligence + Question DNA). Prompts 3–5 have NOT started.**

Phase 6 is deliberately consolidated into five large implementation prompts. Each is built, verified and committed on its own; none begins until the previous is closed.

| # | Prompt | Status |
|---|---|---|
| 1 | Exam Pack + Concept Universe | **Complete** (D-082) — see [../PHASE_6_PROMPT_1_REVIEW.md](../PHASE_6_PROMPT_1_REVIEW.md) |
| 2 | Historical Examiner Intelligence + Question DNA | **Complete** (D-083) — see [../PHASE_6_PROMPT_2_REVIEW.md](../PHASE_6_PROMPT_2_REVIEW.md) |
| 3 | Question Universe + Content Authoring/Validation | Not started |
| 4 | Content Intelligence Pipeline + Knowledge Graph | Not started |
| 5 | Exam Intelligence Integration + Calibration | Not started |

Overtraining (deferred from Phase 5) is NOT part of Phase 6 Prompt 1 and is still not implemented.

## Prompt 1 — Exam Pack + Concept Universe (complete)

**Goal.** A structured, machine-readable, exam-agnostic representation of an exam's KNOWLEDGE SPACE, with IPMAT Indore as the first pack — so later prompts (examiner intelligence, Question Universe, content pipeline) have a validated structure to attach to.

**Built.**
- `@ipmat/exam-pack` (pure domain package; depends only on `@ipmat/concept-graph`): `ExamPack` model (identity/version, ordered sections, syllabus hierarchy, concepts, eight typed relations, terminology, provenance on every artifact), `validateExamPack()` / `validateExamPackSet()`, deterministic traversal (ancestors/descendants/unlocks/neighbors/learning order/syllabus tree), `ExamPackService` over an `ExamPackRepository`, and the student-safe `toPublicExamPackView()`.
- The IPMAT Indore pack as DATA (`src/packs/ipmatIndore.ts`): Quant only, 15 chapters, 12 concepts, 16 relations — all `authored` + `unvalidated`.
- `PrismaExamPackRepository` in `@ipmat/db` (read-only, assembles a pack from the existing tables; **no migration**), and `seed.ts` now takes its chapter list from the pack.

**Not built (by design).** Any HTTP route or UI, historical examiner intelligence, full Question DNA intelligence, Question Universe, AI generation, RAG/embeddings, mastery coupling, mock exams, a second exam, billing.

**Honest limits.** The repository holds no official IPMAT syllabus, so the pack is not claimed canonical or reviewed; other IPMAT sections do not exist in it; terminology/skills/pattern references/importance are empty; only chapter-level hierarchy is persistable; cross-exam relation rows are detected on read but not prevented by the database. Full list in D-082.

**What later prompts may rely on.** Pack keys are stable (`slugKey`), relation semantics are explicit (`RELATION_TYPE_SEMANTICS`), an invalid pack is never queried (fail-closed), and provenance + review state are first-class — a future prompt that adds reviewed/canonical data raises the review state through real review records, never by relabelling.

## Prompt 2 — Historical Examiner Intelligence + Question DNA (complete)

**Critical principle: HISTORICAL EVIDENCE IS OBSERVED TESTING EVIDENCE, NOT A PREDICTION OF FUTURE EXAM CONTENT.**

**Built.** `@ipmat/examiner-intelligence` (exam-scoped classification records of historical questions with source/rights, `real_source` vs `fixture`, raw -> candidate -> reviewed annotation states, pack-aware Question DNA validation on the EXISTING vocabulary, deterministic observed-testing queries), migration 0013 (`historical_question_records`, additive, CHECK-enforced invariants) and `PrismaHistoricalRecordRepository`.

**Real data status.** None. The repository holds no authorized historical IPMAT material, so nothing was seeded and nothing was invented; every test record is a labelled fixture. **Not built:** coverage engine, import pipeline, admin UI/route, prediction of any kind, Question Universe, generation. Details and limits: D-083 and [../PHASE_6_PROMPT_2_REVIEW.md](../PHASE_6_PROMPT_2_REVIEW.md).
