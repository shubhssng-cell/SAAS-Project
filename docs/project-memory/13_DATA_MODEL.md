# 13 — Data Model

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DATABASE.md` (read in full), cross-checked against `packages/db/prisma/schema.prisma` directly during this session's own D-039 work. **No live database has ever been reachable in this environment across every phase of this project — every fact below describes the schema/migrations as written, never as verified against a running Postgres instance.**

## Design rules (verbatim, still true)

- Exam structure is data (`Exam`/`Section`/`Chapter` are rows, not enums).
- The concept graph is a real graph with 8 distinct edge types, never flattened.
- Examiner Lens combinations are always derived, never stored.
- A pattern family describes structure; a taxonomy cell is one concrete slice of it.
- Error taxonomy is one shared vocabulary (`ErrorTaxonomy.category`), not two.
- Question DNA is enforced structurally, not conventionally.
- Coverage is a computed ladder, never a stored status.
- Mastery is derived, never input.
- Autopsy output is a hypothesis until `confirmed = true`.
- `AttemptEvent` is the source of truth for timing; `Attempt`'s own fields are denormalized convenience.
- Prep phase and mastery are separate tables with no FK dependency on each other's state.
- Calendar-awareness is a Phase 1 entity, not a Phase 6 one.

## Core entity groups

| Group | Tables | Memory file |
|---|---|---|
| Exam catalog | `Exam`, `Section`, `Chapter` | [40_CONCEPT_UNIVERSE.md](40_CONCEPT_UNIVERSE.md) |
| Concept Universe | `Concept`, `ConceptRelation`, `ConceptDepth` | [40_CONCEPT_UNIVERSE.md](40_CONCEPT_UNIVERSE.md) |
| Examiner Lens | `ExaminerLensAnalysis` | [41_EXAMINER_LENS.md](41_EXAMINER_LENS.md) |
| Question Universe | `QuestionPatternFamily`, `PatternTaxonomyCell` | [42_QUESTION_UNIVERSE.md](42_QUESTION_UNIVERSE.md) |
| Question + DNA | `Question`, `Provenance` | [43_QUESTION_DNA.md](43_QUESTION_DNA.md) |
| Student & Enrollment | `Student`, `Enrollment` | [20_STUDENT_MODEL.md](20_STUDENT_MODEL.md) |
| Attempt | `Attempt`, `AttemptEvent` | [50_ATTEMPTS.md](50_ATTEMPTS.md) |
| Error Taxonomy | `ErrorTaxonomy` | [23_AUTOPSY.md](23_AUTOPSY.md) |
| Question Autopsy | `Autopsy`, `RepairPlan` | [23_AUTOPSY.md](23_AUTOPSY.md), [24_REPAIR.md](24_REPAIR.md) |
| Mastery | `MasteryState` | [25_MASTERY.md](25_MASTERY.md) |
| Calendar-aware prep | `PrepPhaseTemplate`, `CatchUpPlan` | [20_STUDENT_MODEL.md](20_STUDENT_MODEL.md) |
| Practice grouping | `PracticeSession`, `PracticeBlock` | [51_PRACTICE_SESSIONS.md](51_PRACTICE_SESSIONS.md), [52_PRACTICE_BLOCKS.md](52_PRACTICE_BLOCKS.md) |

## Migrations, in order (verified directly against `packages/db/prisma/migrations/`)

| # | Name | What it added |
|---|---|---|
| 0001 | `init` | Full initial schema, incl. the `questions_published_requires_provenance` CHECK constraint |
| 0002 | `concept_intelligence_and_examiner_lens` | Concept relationship expansion, Examiner Lens tables |
| 0003 | `attempt_lifecycle` | `AttemptStatus`, `attempts.status`/`finalized_at`, canonical `AttemptEventType` |
| 0004 | `mastery_component_detail` | `mastery_states.component_detail: Json` |
| 0005 | `mastery_state_nullable_measures` | Widened the 5 `MasteryState` scalar columns to nullable `Float?` |
| 0006 | `practice_session_block` | `PracticeSession`/`PracticeBlock` tables, `Attempt.practiceBlockId`/`blockSequenceNumber`, 2 enums, 3 `Restrict` FKs, 1 hand-written CHECK |
| 0007 | `repair_plan_persistence_fidelity` | 6 nullable `RepairPlan` snapshot columns, `Autopsy.confirmedAt`, 2 new enums — the D-039 addendum, built this session |

**No migration has ever been applied against a live database.** Every migration file was generated the same "diff against schema" way and hand-verified column-by-column, never run.

## What's intentionally not modeled yet

Payments, subscriptions, pricing, parent/guardian accounts, coaching-org multi-tenancy, mock-test assemblies, calculation-gym/vocabulary-gym item banks (the training-system *providers* of these names are built as pure domain logic — see [30_TRAINING_SYSTEMS.md](30_TRAINING_SYSTEMS.md) — but no dedicated persisted "item bank" table exists for them), trap/pressure/surprise mode configuration tables. These will be additive tables when their phase starts — nothing in the current schema needs to change shape to accommodate them.

## Genuine, currently-unresolved schema gaps (do not silently fix these — see [91_OPEN_BLOCKERS.md](91_OPEN_BLOCKERS.md))

1. **`Exam.examDateRule` (Json) has no resolution function to a concrete date.** `PrepPhaseTemplateData.examDate`'s own doc comment states this was never built — "a concrete date is enough for a single-cycle vertical slice," but the resolution function itself does not exist.
2. **`CatchUpPlan` has no "active" semantics** — no status/expiry/supersededAt column. "The active catch-up plan for this enrollment" is currently undefined at the schema level, not merely unread.
3. **`RepairPlan.targetConceptId` has no `@relation` in the Prisma schema** (unlike `targetErrorTaxonomyId`, which does) — the database itself cannot catch a bad reference here; only application-layer `assertConceptResolved()` does. Pre-existing, not introduced by the D-039 fix, not fixed by it either (out of that fix's scope).

See also: [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md) for how domain packages relate to this schema without importing it directly.
