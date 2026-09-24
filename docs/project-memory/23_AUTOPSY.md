# 23 — Autopsy (`@ipmat/autopsy`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-036–D-039 (read in full, including the D-039 addendum implemented this session), `docs/DATABASE.md` §Question Autopsy, `docs/AI_ARCHITECTURE.md` §10/§10a.

## Package identity

Database-free, pure TypeScript. Depends on `@ipmat/ai`, `@ipmat/attempt`, `@ipmat/concept-graph`, `@ipmat/examiner-lens`, `@ipmat/question-engine`. Never depends on `@ipmat/db`/`@prisma/client` (verified by its own `dependencyBoundary.test.ts`, added this session as part of the D-039 addendum work).

## The type chain, exactly

```
AttemptAutopsyEvidence (from @ipmat/attempt, OBSERVATION)
  -> AutopsyOutput (EVIDENCE): attemptFacts, questionFacts, behaviorSignals,
     hintSolutionEvidence, historicalSignals | null, candidateErrorEvidence | null,
     availableEvidence[], missingEvidence[]
  -> AutopsyHypothesis (HYPOTHESIS): attemptId, proposedErrorCategory | null,
     proposedExplanation, supportingEvidence[], contradictoryEvidence[], missingEvidence[],
     modelConfidence | null, confirmationRequired: true, confirmationStatus,
     studentCorrectionText | null, respondedAt | null, generationMetadata
  -> RepairPlan (CONFIRMED DIAGNOSIS -> repair target): see 24_REPAIR.md
```

## `AutopsyQuestionContext` — the restated Question DNA shape

Deliberately restates Question DNA fields (exam/section/chapter/concept/pattern family/taxonomy cell/difficulty tier & dimensions/novelty level/exam relevance/testing modes/trap code/combined concepts) rather than importing `@ipmat/question-engine`'s full type — and deliberately **omits** `expectedTimeSeconds`, since that field already lives on `AttemptAutopsyEvidence` and repeating it would be exactly the duplication the phase brief warned against (D-036).

## `BehaviorSignals` — deterministic, centrally-thresholded

`correctFast`/`correctSlow`/`incorrectFast`/`incorrectSlow`/`answerChanged`/`multipleAnswerChanges`/`hintUsed`/`solutionOpened`/`skipped`/`noAnswer`/`timeAboveExpected`/`timeBelowExpected`, plus `speedRatio` (computed only when both times are present, finite, and `expectedTime > 0` — never manufactured). All thresholds live in one place: `AUTOPSY_THRESHOLDS = {FAST_SPEED_RATIO: 0.7, SLOW_SPEED_RATIO: 1.3, MULTIPLE_ANSWER_CHANGES: 2, REPEATED_EVIDENCE_MIN_COUNT: 2}`.

## `HistoricalSignals` — repetition, not a diagnosis

`totalPriorAttempts`, plus `RepetitionCount | null` (`{count, attemptIds[]}`) for repeated concept/pattern-family/taxonomy-cell failure, repeated slow performance, repeated hint use, repeated solution opening, repeated novelty/pressure difficulty, and whether the solution was opened after a prior incorrect attempt on the same question. `null` (not zero) when no prior attempts were supplied; a count stays `null` below `REPEATED_EVIDENCE_MIN_COUNT` (2) — a single occurrence is never "repeated."

## `CandidateErrorEvidence` — deterministic, never confirmed

`deriveCandidateErrorEvidence()` returns `null` only when the attempt was correct/skipped/abandoned/in-progress. For any incorrect, submitted attempt it **always** returns an object (never null) — with `proposedErrorCategory: null` when the question has no designated trap code, or when the trap code doesn't resolve against the supplied `ErrorTaxonomy`. Every result carries a mandatory `qualification` string stating plainly it is a candidate, not a confirmed diagnosis. This type structurally has no `confirmed` field, anywhere.

## The Hypothesis layer — the 5th `@ipmat/ai` task (D-038)

`generateHypothesis(provider, {autopsyOutput})`:
- Refuses to call the provider at all (`no_evidence_to_diagnose`) when `candidateErrorEvidence === null`.
- Goes through `generateStructured()` like every other AI call — schema-validated (`autopsyHypothesisAiSchema`), never trusted raw.
- **Always** returns `confirmationStatus: "awaiting_confirmation"` — no parameter anywhere lets a caller construct a pre-confirmed one.
- `modelConfidence` is explicitly the model's own confidence, documented as such in both schema and system prompt — never the student's.

## The confirmation state machine (D-038)

`applyConfirmationResponse(hypothesis, response, {now})` is the single shared transition every convenience wrapper (`confirmHypothesis`/`rejectHypothesis`/`correctHypothesis`) funnels through — mirroring `@ipmat/attempt`'s `applyFinalization()` pattern. Refuses (`already_decided`) if called on an already-decided hypothesis. Four terminal-ish states: `awaiting_confirmation` (initial) → `confirmed` | `rejected` | `corrected`. `respondedAt` is set for **all three** response types, not just confirmation — this is the field the D-039 persistence-fidelity design review had to reason about carefully (see [24_REPAIR.md](24_REPAIR.md)/[92_CURRENT_STATE.md](92_CURRENT_STATE.md)), since a rejected hypothesis still has a real, non-null `respondedAt`.

## Persistence — the D-039 story in full, including the addendum fixed this session

**Original D-039 (Phase 5B):** inspecting the existing `autopsies`/`repair_plans` schema found NO migration was needed for the confirmation-status mapping itself — `confirmed: Boolean?` + `student_correction_text: String?` already jointly encode all 4 states:

| confirmationStatus | confirmed | studentCorrectionText |
|---|---|---|
| awaiting_confirmation | null | null |
| confirmed | true | null |
| rejected | false | null |
| corrected | false | the correction text |

`toAutopsyPersistenceRecord()`/`toRepairPlanPersistenceRecord()` were pure mapping functions only — nothing called `prisma.autopsy.create()`/`prisma.repairPlan.create()` anywhere.

**The D-039 addendum (this session, migration `0007_repair_plan_persistence_fidelity`):** implementing the actual repositories (for the future Training Recommendation Composition layer) surfaced a genuine, previously-undiscovered gap — `toRepairPlanPersistenceRecord()` was **silently dropping** six fields the domain `RepairPlan` always carries: `targetConceptName`, `targetPatternFamilyName`, `targetTaxonomyCellId`, `targetErrorCategory`, `recommendedTrainingMode`, `priority`. And `AutopsyPersistenceRecord` had no column at all for `hypothesis.respondedAt` — the exact instant confirmation happened, distinct from `confirmed` itself (WHETHER vs. WHEN). Fixed by:
- 6 new nullable columns on `RepairPlan` (snapshot fields, reusing the existing `ErrorCategory` enum and two new enums `RepairPriority`/`RecommendedTrainingMode`).
- 1 new nullable column, `Autopsy.confirmedAt`, set from `hypothesis.respondedAt` verbatim.
- A new `fromRepairPlanPersistenceRecord()` reverse-mapping function that returns `null` — never a partially-fabricated `RepairPlan` — when any of the 7 fields is missing (the honest signal that a stored row predates this fix).

See [24_REPAIR.md](24_REPAIR.md) for the full read/write contract this produced, and [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for its exact verified status (1100→1106 tests, migration verified, no live DB used).

## What remains true, unchanged, since Phase 5B

No `Autopsy`/`RepairPlan` row has ever been written to a real database — every test in this chain runs against `InMemoryAutopsyRepository`/`InMemoryRepairPlanRepository` or a fake `PrismaClient`. No live AI provider call has ever produced a real hypothesis.
