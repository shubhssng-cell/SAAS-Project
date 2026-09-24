# 37 — Training Recommendation Composition Layer (the next architectural unit)

> Part of the [project memory](00_MASTER_CONTEXT.md). **Source: this file is NOT reconstructed from committed docs** — sections 1–22 record the approved design produced through two full design-review passes plus a supporting persistence-fidelity fix (D-039 addendum). **This layer is now IMPLEMENTED (uncommitted as of 2026-09-24)** — see [§23 "As implemented"](#23-as-implemented-2026-09-24) at the end of this file for exactly what was built and every place the implementation deliberately deviates from §1–22. Where §23 and an earlier section disagree, §23 (and the actual source) wins.

## What this is, in one sentence

The application/domain composition boundary that will eventually assemble `TrainingOrchestrationInput`/`TrainingSystemContext` from real persisted student state and invoke `orchestrateNextTrainingAction()` — an **orchestrator/composer**, not another decision engine.

## Why it doesn't exist yet — the honest history

1. A first design-review pass (read-only, inspecting `@ipmat/training-orchestration`, `@ipmat/practice-loop`, `@ipmat/attempt`, `@ipmat/mastery`, `@ipmat/repair-selection`, `@ipmat/adaptive-selection`, `@ipmat/training-systems`, `@ipmat/practice-session`, `@ipmat/practice-block`, `@ipmat/db`, Prisma schema, and every relevant doc) found that **essentially every bulk-query repository method this layer needs was missing** from `@ipmat/db` — every existing repository is a narrow, single-entity, look-up-by-known-id method. Verdict: **IMPLEMENTATION READY: NO**.
2. A second, micro-specification pass named the exact missing method signatures, ordering guarantees, ownership rules, and history-bound policy — and, critically, discovered that `RepairPlan` persistence was **lossy**: `toRepairPlanPersistenceRecord()` silently dropped six fields the domain object always carries, and `Autopsy` had no column for the confirmation timestamp. Verdict: **IMPLEMENTATION READY: NO** — this specific gap was the blocker.
3. That gap was fixed directly (migration `0007_repair_plan_persistence_fidelity`, the D-039 addendum) — see [23_AUTOPSY.md](23_AUTOPSY.md)/[24_REPAIR.md](24_REPAIR.md). Committed as `db9c764a3ed61c844d16156b78f32765f5e637ee`.
4. A third design pass, after that fix, produced the implementation-ready design recorded in this file. **Verdict: IMPLEMENTATION READY: YES** (with two named, deliberately out-of-scope items — see §16).

## 1. Package location and name (proposed, not final)

New, top-level package — `@ipmat/training-recommendation` (name is a suggestion, not locked) — **not** under `packages/domain/*`, for the same reason `@ipmat/practice-loop` isn't: it depends on persistence ports.

## 2. Exact dependency graph

```
@ipmat/training-recommendation
  -> @ipmat/db
  -> @ipmat/training-orchestration
  -> @ipmat/mastery                 (called DIRECTLY — training-orchestration never re-exports computeMasteryState())
  -> @ipmat/attempt                 (for toMasteryContribution() — a pure mapping function)
  -> @ipmat/practice-session        (types only)
  -> @ipmat/practice-block          (pure derive functions)
  -> @ipmat/question-engine         (ValidationState/DifficultyTier/TestingMode/NoveltyLevel/ExamRelevance/DifficultyDimensions types)
```

**Never** `@prisma/client` directly (only through `@ipmat/db`'s ports), never `@ipmat/repair-selection`/`@ipmat/adaptive-selection`/`@ipmat/training-systems`/any provider directly (all reached transitively, correctly, only through `@ipmat/training-orchestration`). `@ipmat/prep-phase` is **deliberately not** a dependency for V1 — see §16.

**Why `@ipmat/db` can't just return `@ipmat/training-orchestration`'s own `TrainingCandidateQuestion` type:** verified directly that `@ipmat/db` has never depended on `@ipmat/training-orchestration` and must not start now (see [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md)). The new question read-model type lives in `@ipmat/db` itself, structurally identical to `TrainingCandidateQuestion` but independently declared — the composition layer needs no field-by-field mapping, only a type-level reassurance.

## 3–4. Public API and function signature

```ts
export async function recommendNextTrainingAction(input: {
  studentId: string;
  enrollmentId: string;
}): Promise<TrainingOrchestrationResult>
```

Returns `TrainingOrchestrationResult` **verbatim** — no second recommendation-result model. Read-only: **no database writes anywhere in this function.**

## 5. Exact composition flow

```
1.  enrollment = EnrollmentReader.findById(enrollmentId)          <- fail closed if null or enrollment.studentId !== studentId
2.  attempts = AttemptRepository.findFinalizedByStudentId(studentId)
3.  confirmedRepairPlans = RepairPlanRepository.findConfirmedActiveByStudentId(studentId)
4.  questionRecords = TrainingQuestionReader.findPublishedByExamId(enrollment.examId)
5.  conceptRecords = ConceptReader.findPublishedByChapterId(chapterId)
6.  attemptRecords = attempts.map(a => toMasteryContribution(a, questionContextFor(a)))
7.  for each concept in 5: computeMasteryState(attemptRecords, {studentId, conceptId, conceptName, now})
8.  activeSession = PracticeSessionRepository.findActiveByEnrollmentId(enrollmentId)
9.  IF activeSession: blocks = PracticeBlockRepository.findBySessionId(activeSession.id)
10. IF blocks non-empty: blockAttempts = AttemptRepository.findByPracticeBlockId(block.id) per block
11. practiceBlocks = derive TrainingPracticeBlockContext[] via @ipmat/practice-block's pure functions
12. candidates = questionRecords mapped to TrainingCandidateQuestion[] (structurally identical, no transform code needed)
13. activeRepairPlans = confirmedRepairPlans.map(fromRepairPlanPersistenceRecord).filter(p => p !== null)
14. input = TrainingOrchestrationInput {studentId, activeRepairPlans, masteryByConcept, attemptRecords, candidates, practiceBlocks, prepPhase: null}
15. return orchestrateNextTrainingAction(input)
```

Steps 2, 3, 4, 5, 8 are mutually independent (all depend only on step 1's verified `enrollment`); V1 issues them sequentially, not concurrently, per the explicit instruction not to introduce parallelism for its own sake.

## 6. Exact new repository methods required

| Method | Ownership scope | Ordering | Empty/null | Bound | Transaction |
|---|---|---|---|---|---|
| `EnrollmentReader.findById(enrollmentId)` | none (this IS the ownership source) | n/a | `null` valid | n/a | No |
| `AttemptRepository.findFinalizedByStudentId(studentId)` | `studentId` (indexed) | `finalizedAt ASC` | `[]` valid | **all-time, unbounded** (see §9) | No |
| `AttemptRepository.findByPracticeBlockId(blockId)` | `practiceBlockId` (indexed) | `blockSequenceNumber ASC`, never timestamp | `[]` valid | bounded by block size | No |
| `TrainingQuestionReader.findPublishedByExamId(examId)` *(new interface)* | none | none required | `[]` → `no_action` | all published for exam | No |
| `ConceptReader.findPublishedByChapterId(chapterId)` *(new interface)* | none | none required | `[]` valid | one chapter | No |
| `PracticeSessionRepository.findActiveByEnrollmentId(enrollmentId)` | `enrollmentId` (indexed) + `status='active'` | n/a (≤1 active) | `null` valid | n/a | No |

`RepairPlanRepository.findConfirmedActiveByStudentId` and `PracticeBlockRepository.findBySessionId` **already exist** — no new work.

## 7. Exact `TrainingSystemContext`/`TrainingOrchestrationInput` field construction

See flow above; `errorTaxonomy` is **omitted** in V1 (optional, non-gating, no consumer needs it yet); `prepPhase` is **always `null`** in V1 (see §16).

## 8. Exact question read-model shape

```ts
// New type in packages/db/src/repositories/types.ts — NOT imported from @ipmat/training-orchestration
export interface TrainingQuestionRecord {
  question: AutopsyQuestionContext;   // from @ipmat/autopsy — ALREADY an approved @ipmat/db dependency
  expectedTimeSeconds: number;
  validationState: ValidationState;
}
```

Resolved per question row via a join chain: `Question → Exam.code, Section.name, Chapter.name, Concept.name, PatternTaxonomyCell → QuestionPatternFamily.name, ErrorTaxonomy.code (trap), Concept.name[] (combinesWithConceptIds resolution)`. **Never** `correctAnswer`/`options` — structurally excluded by `AutopsyQuestionContext` itself (D-020).

## 9. Exact mastery input pipeline, and the history-bound decision

`attempts (AttemptRepository) + question context (TrainingQuestionReader) -> toMasteryContribution() (pure) -> MasteryAttemptRecord[] -> computeMasteryState() (called once per published concept) -> MasteryStateResult[]`. `MasteryStateRepository` is **never read** — only optionally `save()`-able as an unrelated future side effect (deliberately undecided, see §16).

**History bound: all-time, unbounded — a decided, evidence-based V1 policy, not a deferral.** Traced directly against `computeMasteryState()`, `computeExposureCounts()`, `deriveHistoricalSignals()` — none has ever been designed with a bounded-history assumption; `REPEATED_EVIDENCE_MIN_COUNT`-style repeated-failure detection genuinely needs the full history (an attempt outside an arbitrary window could make a real repeated-failure signal silently disappear). Introducing a window now would be inventing a new semantic these functions were never tested against.

## 10. Ownership/security checks

Exactly one authoritative check, first, before any other read: `enrollment.studentId === studentId`. Every subsequent read is scoped by `studentId` directly or by an id derived from the already-verified `enrollment` — never a caller-supplied id taken on faith beyond this one check. See [54_SECURITY_AND_OWNERSHIP.md](54_SECURITY_AND_OWNERSHIP.md).

## 11. Transaction decision

**No transaction.** A pure read composing a recommendation snapshot — never a write, never an observably-half-applied multi-statement invariant. A concurrent write elsewhere can only make the snapshot slightly stale, never unsafe — the next real write (starting the recommended attempt) already independently re-verifies ownership/publication state at that later point (D-048/D-060 precedent).

## 12–13. Failure and empty/null semantics

| Condition | Behavior |
|---|---|
| Enrollment missing or belongs to another student | Fail closed — typed error, never proceed |
| No attempts / no RepairPlans / no active session / no blocks | Valid, empty state — proceeds gracefully |
| No published questions | `candidates: []` → orchestration's own existing `no_action: no_candidates_supplied` |
| A RepairPlan predates D-039 (incomplete) | `fromRepairPlanPersistenceRecord()` returns `null` for that row — silently **excluded** from the array, never included as a partial object |
| A question's DNA is malformed | Excluded from `candidates` for that one question only, never coerced |
| Genuine repository/query failure | Propagate as an exception — **never** silently coerced into an empty array/null |

## 14. How incomplete pre-D-039 RepairPlans are handled

`confirmedRepairPlans.map(fromRepairPlanPersistenceRecord).filter(p => p !== null)` — exactly the mechanism built and tested in the D-039 addendum. See [23_AUTOPSY.md](23_AUTOPSY.md)/[24_REPAIR.md](24_REPAIR.md).

## 15. How active PracticeSession/PracticeBlock context is assembled

`findActiveByEnrollmentId → findBySessionId (existing) → findByPracticeBlockId per block, ordered by blockSequenceNumber` → `@ipmat/practice-block`'s existing pure functions (`deriveBlockWallClockDurationSeconds`, `deriveBlockActiveSolvingTimeSeconds`, `deriveInterAttemptGapsSeconds`) compute the three time measures. This transformation belongs in **this composition package only** — confirmed by both `@ipmat/pressure-training`'s and `@ipmat/training-orchestration`'s own `dependencyBoundary.test.ts` files asserting zero dependency on `@ipmat/practice-block`/`@ipmat/practice-session`.

## 16. How PrepPhase/CatchUp context is assembled — deliberately NOT in V1

`prepPhase` is passed as `null` unconditionally. This is a response to **two real, verified schema gaps**, not a shortcut:
1. `Exam.examDateRule` (Json) has no function anywhere that resolves it to a concrete date.
2. `CatchUpPlan` has no "active" semantics in the schema at all (no status/expiry column).

Since `prepPhase` is optional and non-gating everywhere in `orchestrateNextTrainingAction()`/`selectNextQuestion()`, omitting it degrades gracefully. Building this properly is named as future, separate work — not something this design invents a stopgap "active" definition for. See [91_OPEN_BLOCKERS.md](91_OPEN_BLOCKERS.md).

## 17. Diagnostics preservation

None of this layer's own logic touches `TrainingOrchestrationDiagnostics` — returned untouched inside whatever `TrainingOrchestrationResult` variant orchestration produces. The composition layer adds **no diagnostics of its own**.

## 18. Dependency-boundary rules

A `dependencyBoundary.test.ts` for the new package, mirroring every existing one, asserting its exact approved dependency set and scanning for forbidden imports (`@prisma/client`, any API/UI path). `@ipmat/db` must never gain a dependency on `@ipmat/training-orchestration`/`@ipmat/training-systems`/any provider.

## 19. Required tests

Unit tests for assembly functions against `InMemoryXRepository` doubles; ownership tests (mismatched ids fail closed); a golden-path integration test proving assembled input produces the exact result a hand-built input would; a regression test proving a pre-D-039-shaped RepairPlan is silently excluded; the dependency-boundary test; new `@ipmat/db` repository tests for each of the 6 new methods.

## 20. Explicit out-of-scope list

Every algorithm named in [30](30_TRAINING_SYSTEMS.md)–[36](36_TRAINING_ORCHESTRATION.md) (never reimplemented), PrepPhase/CatchUp assembly (§16), `errorTaxonomy` assembly, persisting freshly-computed `MasteryState`, any HTTP/API handler, any UI, starting/finalizing an Attempt, Mock/Simulation, Revision, multi-exam/chapter branching.

## 21. Files the implementation pass may touch

New: `packages/training-recommendation/**`. Modified: `packages/db/src/repositories/types.ts` (new interfaces/methods), corresponding `prismaXRepository.ts` files, `packages/db/test/fixtures/inMemoryRepositories.ts`, and their tests. **Must not touch**: `packages/domain/repair-selection`, `training-orchestration`, `attempt`, `practice-loop`, `practice-session`, `practice-block`, any of the 5 providers, `training-systems`, API, UI.

## 22. Architectural blockers discovered from the actual repository (still open — see [91_OPEN_BLOCKERS.md](91_OPEN_BLOCKERS.md))

1. No `Exam.examDateRule → concrete date` resolution function exists anywhere.
2. `CatchUpPlan` has no "active" semantics in the schema.
3. `RepairPlan.targetConceptId` has no `@relation` in the Prisma schema (pre-existing, unrelated to D-039, not fixed by it).

None of these three blocks the **core** recommendation flow — they block only the `prepPhase` field, already scoped out of V1.

## Final verdict, as of this design

**IMPLEMENTATION READY: YES.** Smallest safe scope: the 6 new repository methods (§6) plus the new package implementing exactly the flow in §5, with `prepPhase` hardcoded `null` and `errorTaxonomy` omitted — both named, bounded, reversible in a later pass.

## 23. As implemented (2026-09-24)

Implemented on top of commit `1039d5c`, **uncommitted** at the time of writing. Verified: 1189/1189 tests (128 files), full-repo typecheck/lint/build clean. No live database, no AI call — every check ran against `@ipmat/db`'s in-memory doubles or a fake `PrismaClient`.

### Public entry point

`new TrainingRecommendationService(deps).recommendNextTrainingAction({ studentId, enrollmentId }): Promise<TrainingOrchestrationResult>` (`packages/training-recommendation/src/service.ts`) — returns `orchestrateNextTrainingAction()`'s result verbatim. Dependencies are injected `@ipmat/db` ports (the `PracticeLoopService` construction precedent); repository ports are narrowed with `Pick<…>` to their one read method, so the layer structurally cannot write. `composeTrainingOrchestrationInput(deps, request)` (`src/compose.ts`) is exported separately so input assembly is testable on its own. An optional `now: () => string` dependency feeds `computeMasteryState()`'s `now`.

### New `@ipmat/db` read methods (Prisma + in-memory implementations for each)

| Method | Notes |
|---|---|
| `EnrollmentReader.findById` | new interface; `select`s only `id/studentId/examId` |
| `AttemptHistoryReader.findFinalizedByStudentId` | `status != in_progress AND finalizedAt != null`, `finalizedAt ASC, id ASC` |
| `AttemptHistoryReader.findByPracticeBlockId` | `blockSequenceNumber ASC` |
| `PracticeSessionRepository.findActiveByEnrollmentId` | throws `PersistenceError("invalid_record")` if >1 active session |
| `TrainingQuestionReader.findPublishedByExamId` | `select` (never `include`) — answer/solution columns are never loaded; pure `toTrainingQuestionRecord()` excludes malformed DNA |
| `ConceptReader.findWithPublishedQuestionsByExamId` | concepts via `Question -> Concept` relation |

### Deliberate deviations from §1–22 (each for a reason found in the actual source)

1. **`AttemptHistoryReader` is a separate interface**, implemented by both `PrismaAttemptRepository` and `InMemoryAttemptRepository`, rather than new methods on `AttemptRepository` itself — `@ipmat/practice-loop`'s tests implement `AttemptRepository` as object literals, and §21 forbids touching practice-loop.
2. **`ConceptReader.findWithPublishedQuestionsByExamId(examId)` replaces `findPublishedByChapterId(chapterId)`.** (a) The enrollment carries only `examId`; no reader exposes chapter ids. (b) Every seeded `Concept` has `status: "curated"`, none `"published"` — a `Concept.status` filter would have silently produced zero mastery. Concepts are now resolved through the persisted `Question.conceptId` relation for this exam's published questions.
3. **`@ipmat/autopsy` is an additional direct dependency** — `fromRepairPlanPersistenceRecord()` (§5 step 13) lives there and nothing re-exports it.
4. **Mastery input needs the D-048 `QuestionReader`.** `toMasteryContribution()` requires a full `AttemptQuestionContext` (including `correctAnswer`/`options`). The composition layer loads the canonical question once per distinct attempted question id via the existing `QuestionReader.findById`, uses it only for that mapping, and never forwards it (tests assert the answer key appears nowhere in the composed input or the result). Cost: one query per distinct attempted question (N+1) — acceptable for V1, a candidate for a batched reader later.
5. **Attempts without a resolvable question context are excluded from `attemptRecords`** (question not in this exam's published, DNA-complete pool — including another exam's questions; no canonical row; canonical `conceptId` not matching the DNA's concept name). Never given invented context.
6. **PracticeBlock contexts are omitted, not trimmed,** when a block has zero attempts or any attempt missing from `attemptRecords` (typically an `in_progress` attempt): `TrainingSystemContext.practiceBlocks` requires every listed id to appear in `attemptRecords`, and dropping individual attempts would misstate sequence/gap evidence. Only the ACTIVE session's blocks are read (per §15).
7. **Ownership re-verification beyond the one enrollment check:** every row a reader returns is re-checked against the verified chain (attempt `studentId`; RepairPlan `studentId`; session `enrollmentId`; block `practiceSessionId`; block attempt `studentId` + `enrollmentId` + `blockMembership.practiceBlockId`). A mismatch throws `TrainingRecommendationError("ownership_inconsistency")` — never silently filtered. A "finalized" attempt that is not finalized throws `repository_contract_violation`.

### Unchanged from design

`prepPhase: null` always; `errorTaxonomy` omitted; `behaviorSignals`/`targetDifficultyTier` omitted from `ActiveRepairPlanContext` (not persisted); no transaction; sequential reads; no writes; no persistence of computed mastery; no API/UI/auth/AI.
