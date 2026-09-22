# Phase 5B Review — Hypothesis + Confirmation + Mastery + Targeted Repair

**Headline result:** the HYPOTHESIS and CONFIRMED DIAGNOSIS layers Phase 5A left as type-only contracts are now real, and a genuinely multidimensional Mastery Engine exists. 321 tests pass (up from 253; +68 new), typecheck/lint/build are clean across all 10 workspaces (a new one, `@ipmat/mastery`, added this phase). One additive schema migration was needed (`mastery_states.component_detail`); the `autopsies`/`repair_plans` tables needed none at all — a finding worth calling out on its own, since it means the Phase 1 schema was already well-shaped for this. See [DECISIONS.md](DECISIONS.md) D-038 through D-042 for the individual decision records this report summarizes.

---

## 1. Exact scope

**In scope, implemented this phase:**
- The HYPOTHESIS layer: a real AI call (`generateStructured("autopsy-hypothesis", ...)`) consuming Phase 5A's `AutopsyOutput`, producing a typed, untrusted `AutopsyHypothesis`.
- The CONFIRMED DIAGNOSIS layer: a deterministic student-confirmation state machine (`applyConfirmationResponse()` and its `confirm`/`reject`/`correct` wrappers).
- `RepairPlan`: turns a CONFIRMED (only) hypothesis into a target-identifying plan — still no question selection/generation.
- Persistence-ready mapping functions for `Autopsy`/`RepairPlan` — no adapter, no live database.
- A new, database-free `@ipmat/mastery` package: multidimensional `MasteryState` computation, aggregated by concept/pattern-family/taxonomy-cell, with a persistence-ready mapping function.
- One additive Prisma migration (`mastery_states.component_detail`), generated, **not applied**.

**Explicitly out of scope this phase (per the phase brief, honored throughout):** no `ANTHROPIC_API_KEY` added, no real AI provider call (`FixtureProvider` only, everywhere), no question-batch generation, no student-facing UI, no adaptive question selection, no mock infrastructure, nothing committed.

---

## 2. Exact files changed

**New package `packages/domain/autopsy/` additions** (extends Phase 5A, which already existed):
- `src/hypothesisPrompts.ts` — `buildHypothesisSystemPrompt()`, `buildHypothesisUserPrompt()`.
- `src/hypothesis.ts` — `generateHypothesis()`, `applyConfirmationResponse()`, `confirmHypothesis()`, `rejectHypothesis()`, `correctHypothesis()`.
- `src/repairPlan.ts` — `buildRepairPlan()`.
- `src/persistence.ts` — `toAutopsyPersistenceRecord()`, `toRepairPlanPersistenceRecord()`.
- `src/types.ts` (modified) — `AutopsyHypothesis` evolved from Phase 5A's type-only contract into the real, implemented shape; new `HypothesisConfirmationStatus`, `ConfirmationResponse`, `HypothesisError`/`HypothesisErrorCode`, `RepairPlan`, `AutopsyPersistenceRecord`, `RepairPlanPersistenceRecord`.
- `test/hypothesis.test.ts` (14), `test/repairPlan.test.ts` (9), `test/persistence.test.ts` (7) — all new.
- `package.json` — added `@ipmat/ai`, `@ipmat/concept-graph` dependencies.

**New package `packages/ai/` additions:**
- `src/schemas/autopsyHypothesis.ts` — `autopsyHypothesisAiSchema`, `AutopsyHypothesisAiOutput` (the 5th task schema).
- `src/index.ts` (modified) — exports the new schema.

**New package `packages/domain/mastery/`** (entirely new):
- `package.json`, `tsconfig.json`.
- `src/types.ts` — `MASTERY_CONSTANTS`, `MasteryAttemptRecord`, `SpeedStatistics`, `AccuracyStability`, `DifficultyBreakdown`, `NoveltyBreakdown`, `PressureBreakdown`, `ErrorRecurrence`, `CoverageDetail`, `MasteryComponentDetail`, `MasteryComponentMeasures`, `MasteryStateResult`, `MasteryStatePersistenceRecord`.
- `src/componentDetail.ts` — `buildComponentDetail()`, the one shared counting/statistics builder.
- `src/masteryState.ts` — `computeMasteryState()`, `computePatternFamilyMasteryDetail()`, `computeTaxonomyCellMasteryDetail()`.
- `src/persistence.ts` — `toMasteryStatePersistenceRecord()`.
- `src/index.ts`.
- `fixtures/attemptRecord.ts`.
- `test/componentDetail.test.ts` (13), `test/masteryState.test.ts` (21), `test/persistence.test.ts` (3), `test/crossPackageIntegration.test.ts` (1) — all new.

**Schema/migration:**
- `packages/db/prisma/schema.prisma` (modified) — `MasteryState.componentDetail: Json` added; `Autopsy`/`RepairPlan`/every other model unchanged.
- `packages/db/prisma/migrations/0004_mastery_component_detail/migration.sql` — new, generated via schema-datamodel diff (same no-live-database approach as 0002/0003), **not applied**.

**Docs:** this file (new), [MASTER_PLAN.md](MASTER_PLAN.md), [DECISIONS.md](DECISIONS.md), [DATABASE.md](DATABASE.md), [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md), [CLAUDE.md](../CLAUDE.md).

---

## 3. Important functions/classes

| Function/class | Package | Role |
|---|---|---|
| `autopsyHypothesisAiSchema` | `@ipmat/ai` | The untrusted-output schema every hypothesis is validated against |
| `generateHypothesis()` | `@ipmat/autopsy` | The only place the AI call happens; always returns `"awaiting_confirmation"` |
| `applyConfirmationResponse()` | `@ipmat/autopsy` | The single shared HYPOTHESIS -> CONFIRMED/REJECTED/CORRECTED transition |
| `confirmHypothesis()`/`rejectHypothesis()`/`correctHypothesis()` | `@ipmat/autopsy` | Convenience wrappers over `applyConfirmationResponse()` |
| `buildRepairPlan()` | `@ipmat/autopsy` | Requires `confirmationStatus === "confirmed"`; builds the target-identifying plan |
| `HypothesisError` | `@ipmat/autopsy` | Typed, fail-closed error for every invalid transition in this layer |
| `toAutopsyPersistenceRecord()`/`toRepairPlanPersistenceRecord()` | `@ipmat/autopsy` | Pure mappings onto the EXISTING Prisma shapes — no adapter |
| `buildComponentDetail()` | `@ipmat/mastery` | The one shared counting/statistics builder every aggregation grain uses |
| `computeMasteryState()` | `@ipmat/mastery` | Concept-level aggregation — the real `MasteryState` table's grain |
| `computePatternFamilyMasteryDetail()`/`computeTaxonomyCellMasteryDetail()` | `@ipmat/mastery` | Narrower aggregation grains, reusing the same builder |
| `toMasteryStatePersistenceRecord()` | `@ipmat/mastery` | Returns `null` (writes nothing) on insufficient data — never a misleading default |

---

## 4. Hypothesis contract

**AI-facing (untrusted) schema** (`packages/ai/src/schemas/autopsyHypothesis.ts`):
```ts
export const autopsyHypothesisAiSchema = z.object({
  proposedErrorCategory: errorCategorySchema.nullable(),
  proposedExplanation: z.string().min(10),
  supportingEvidence: z.array(z.string()).min(1),
  contradictoryEvidence: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  modelConfidence: z.number().min(0).max(1).nullable()
});
```

**Domain record** (`packages/domain/autopsy/src/types.ts`):
```ts
export interface AutopsyHypothesis {
  attemptId: string;
  proposedErrorCategory: ErrorCategory | null;
  proposedExplanation: string;
  supportingEvidence: string[];
  contradictoryEvidence: string[];
  missingEvidence: string[];
  modelConfidence: number | null;         // the MODEL's confidence, never the student's
  confirmationRequired: true;             // literal — structurally cannot be skipped
  confirmationStatus: HypothesisConfirmationStatus;
  studentCorrectionText: string | null;
  respondedAt: string | null;
  generationMetadata: AiResultMetadata;   // the "hypothesis-generation metadata" the phase brief asked for
}
```

`generateHypothesis()`:
```ts
export async function generateHypothesis(
  provider: AiProvider,
  input: HypothesisGenerationInput,
  options?: AiCallOptions
): Promise<AutopsyHypothesis> {
  if (input.autopsyOutput.candidateErrorEvidence === null) {
    throw new HypothesisError("no_evidence_to_diagnose", /* ... */);
  }
  const result = await generateStructured(provider, {
    task: "autopsy-hypothesis", promptVersion: "autopsy-hypothesis-v1",
    systemPrompt: buildHypothesisSystemPrompt(),
    userPrompt: buildHypothesisUserPrompt(input),
    schema: autopsyHypothesisAiSchema, options
  });
  return { /* ...wraps result.data..., confirmationStatus: "awaiting_confirmation", respondedAt: null, ... */ };
}
```
Fails closed BEFORE spending anything if there's no candidate error evidence to diagnose (a correct/skipped/abandoned/in-progress attempt) — the same "check before you spend" discipline `runGenerationPipeline()`'s unknown-model guard already established (D-027).

---

## 5. Confirmation state machine

```
                    generateHypothesis()
                            |
                            v
                  awaiting_confirmation
                    /       |        \
        confirmed()   rejected()   corrected(text)
              |            |             |
              v            v             v
          confirmed    rejected      corrected
```

All three terminal states are reached ONLY through `applyConfirmationResponse()` (or its wrappers), and are equally final — a second response throws `already_decided`. `"corrected"` is distinct from `"rejected"`: the student's own text is preserved in `studentCorrectionText`, and `proposedExplanation` (the model's original claim) is NEVER overwritten — both are visible on the same record afterward, tested directly.

```ts
export function applyConfirmationResponse(
  hypothesis: AutopsyHypothesis | null | undefined,
  response: ConfirmationResponse,
  input: { now: string }
): AutopsyHypothesis {
  assertExists(hypothesis);
  if (hypothesis.confirmationStatus !== "awaiting_confirmation") {
    throw new HypothesisError("already_decided", /* ... */);
  }
  switch (response.type) {
    case "confirmed": return { ...hypothesis, confirmationStatus: "confirmed", respondedAt: input.now, studentCorrectionText: null };
    case "rejected":  return { ...hypothesis, confirmationStatus: "rejected", respondedAt: input.now, studentCorrectionText: null };
    case "corrected": /* validates non-empty text, then sets confirmationStatus: "corrected" */
  }
}
```

This mirrors `@ipmat/attempt`'s `applyFinalization()` pattern (D-034) deliberately — one shared transition function, immutable (spread, never mutate), fail-closed on an invalid transition.

---

## 6. RepairPlan architecture

```
AutopsyHypothesis (confirmationStatus === "confirmed")
  + AutopsyOutput (same attemptId)
  + ConceptGraph (optional)
        |
        v
  buildRepairPlan()
        |
        v
  RepairPlan {
    targetConceptName, targetPatternFamilyName, targetTaxonomyCellId,   <- from buildRepairContext(output) [Phase 5A, reused]
    targetErrorCategory,                                                <- from the CONFIRMED hypothesis
    targetErrorTaxonomyCode,                                            <- from the deterministic candidateErrorEvidence [Phase 5A]
    recommendedTrainingMode, priority,                                  <- from buildRepairContext(output) [Phase 5A, reused]
    rationale,                                                          <- supportingEvidence + confirmation timestamp
    prerequisites,                                                      <- getPrerequisites(graph, concept) [@ipmat/concept-graph, reused] or []
    confirmationSource: { attemptId, hypothesisConfirmedAt }
  }
```

Three fail-closed guards, each with its own `HypothesisError` code: `not_confirmed` (anything but `confirmationStatus === "confirmed"`, including `"corrected"` — deliberately not accepted, see §8), `mismatched_attempt` (hypothesis and output disagree on which attempt), `no_error_category` (a confirmed hypothesis that somehow proposed no category). No `followUpQuestionIds` field exists — tested directly.

**A documented tension, not hidden:** `targetErrorCategory` (from the confirmed, human-validated hypothesis) and `targetErrorTaxonomyCode` (from the separate, deterministic, unconfirmed `candidateErrorEvidence` match) come from two different mechanisms and can, in principle, disagree — e.g., a code resolves to a different category than what the model proposed and the student confirmed. This phase does not reconcile that disagreement; it is surfaced as a known limitation (§13), not silently resolved by picking one arbitrarily.

---

## 7. Mastery computation architecture

```
Many AttemptMasteryContribution [@ipmat/attempt, Phase 4A]
  paired with AutopsyQuestionContext [@ipmat/autopsy, Phase 5A, REUSED not re-derived]
        |
        v
  MasteryAttemptRecord[]
        |
        v
  buildComponentDetail()  <- the ONE shared counting/statistics builder
        |
        v
  MasteryComponentDetail {
    totalAttempts, submittedAttempts, skippedAttempts, abandonedAttempts, correctCount, incorrectCount,
    speedStatistics { observationCount, mean/min/max/stdDevSpeedRatio },
    accuracyStability { sequence, meanAccuracy, stdDevAccuracy },       <- distinguishes STABLE from UNSTABLE at equal mean
    difficultyBreakdown { byTier },                                     <- only tiers actually attempted appear
    noveltyBreakdown { byNoveltyLevel },
    pressureBreakdown { pressure/ordinary attempts+correct },           <- from testingModes, never from timing
    errorRecurrence { incorrectCount, longestIncorrectStreak },
    coverage { patternFamiliesEncountered, taxonomyCellsEncountered, contentCoverage },  <- content vs student-exposure, both preserved
    contributingAttemptIds, earliestAttemptAt, latestAttemptAt          <- recency-ready, no decay applied
  }
        |
        v (gated on MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT)
  MasteryComponentMeasures { accuracy, speedRatio, noveltyHandling, pressurePerformance, patternCoverage }
  — each independently nullable ("insufficient data"), never a composite score
```

`computeMasteryState()` is the concept-level grain (matching the real table's `@@unique([studentId, conceptId])`); `computePatternFamilyMasteryDetail()`/`computeTaxonomyCellMasteryDetail()` reuse the exact same `buildComponentDetail()` on a pre-filtered slice — no duplicated counting logic across grains.

---

## 8. All provisional assumptions

Everything below is explicitly labeled `PROVISIONAL` in its own doc comment, none calibrated against real student data:

- `AUTOPSY_THRESHOLDS` (Phase 5A, unchanged this phase): `FAST_SPEED_RATIO` (0.7), `SLOW_SPEED_RATIO` (1.3), `MULTIPLE_ANSWER_CHANGES` (2), `REPEATED_EVIDENCE_MIN_COUNT` (2).
- `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` (3, new this phase) — the ONE centralized threshold gating every headline mastery measure. Chosen as a low, defensible placeholder specifically so the test matrix (§17 of the phase brief) could exercise both "insufficient" and "sufficient" states cleanly — not derived from any reliability analysis.
- `RecommendedTrainingMode`'s 4-value vocabulary (Phase 5A) and the simple priority-derivation rules in `buildRepairContext()`/`buildRepairPlan()` — v1 heuristics, expected to grow/change.
- `difficultyCalibrationStatus`/`difficultyDimensions` (Phase 3.1, D-021) remain provisional and were NOT used as a mastery axis this phase — only the coarse `difficultyTier` enum is bucketed in `difficultyBreakdown`, deliberately avoiding compounding an already-acknowledged calibration gap onto a new mastery dimension.
- The known tension between AI-confirmed `targetErrorCategory` and deterministically-matched `targetErrorTaxonomyCode` on `RepairPlan` (§6) is unresolved by design this phase, not accidentally.

---

## 9. Trust boundaries

1. **The hypothesis AI call is untrusted output, schema-validated, never assumed correct** — same discipline as every other `@ipmat/ai` task. See docs/AI_ARCHITECTURE.md §10a for the full account, including the explicit test proving a fixture response that DOES make a forbidden psychological claim is still schema-valid and still gets wrapped into an ordinary `awaiting_confirmation` hypothesis — the prompt cannot structurally prevent a bad model output, only confirmation can stop it from being trusted.
2. **Confirmation, not model behavior, is the actual enforcement mechanism.** `generateHypothesis()` cannot produce anything but `"awaiting_confirmation"`; `buildRepairPlan()` refuses anything but `"confirmed"`. No code path anywhere skips this.
3. **`RepairPlan` trusts the CONFIRMED category, but the deterministic code is a separate, still-unconfirmed match** (§6, §8) — a real trust-boundary nuance, documented rather than papered over.
4. **`@ipmat/mastery` has zero AI dependency in its own source** — mastery computation is entirely deterministic; only its cross-package integration TEST uses `@ipmat/ai`'s `FixtureProvider`, to build a realistic end-to-end fixture chain, never to compute mastery itself.
5. **Persistence functions are pure mappings, not adapters** — `toAutopsyPersistenceRecord()`/`toRepairPlanPersistenceRecord()`/`toMasteryStatePersistenceRecord()` never touch a database; nothing in this codebase calls `prisma.autopsy.create()`, `prisma.repairPlan.create()`, or `prisma.masteryState.upsert()` anywhere.

---

## 10. Tests

**Old test count:** 253 (end of Phase 5A).
**New test count:** 321 (+68).

| File | Tests |
|---|---|
| `packages/domain/autopsy/test/hypothesis.test.ts` | 14 |
| `packages/domain/autopsy/test/repairPlan.test.ts` | 9 |
| `packages/domain/autopsy/test/persistence.test.ts` | 7 |
| `packages/domain/mastery/test/componentDetail.test.ts` | 13 |
| `packages/domain/mastery/test/masteryState.test.ts` | 21 |
| `packages/domain/mastery/test/persistence.test.ts` | 3 |
| `packages/domain/mastery/test/crossPackageIntegration.test.ts` | 1 |

**Mapping to the phase brief's §16 (hypothesis flow) scenarios:** valid hypothesis, malformed AI response (non-JSON, retries then throws), hypothesis missing required evidence (schema validation failure, retries then throws), a hypothesis that invents an unsupported psychological claim (still schema-valid — the point of the test is proving confirmation, not the prompt, is what's trusted), hypothesis requiring confirmation (`confirmationRequired` always `true`), student confirms/rejects/corrects, invalid confirmation transition (`already_decided`), original evidence remains unchanged (JSON-snapshot equality before/after) — all in `hypothesis.test.ts`.

**Mapping to §17 (mastery) scenarios:** zero/one/insufficient/sufficient attempts, mixed correct/incorrect, fast/slow, easy/hard, familiar/novel, pressure/ordinary, repeated errors, stable-vs-unstable at equal mean accuracy, multiple concepts/pattern-families/taxonomy-cells, insufficient-data vs. missing-data (two DIFFERENT reasons a measure can be null, both tested distinctly) — across `componentDetail.test.ts`/`masteryState.test.ts`. The 3 named regressions (98% basic accuracy ≠ universal mastery; many familiar questions ≠ novelty handling; a single hard-question failure doesn't dominate the stats or get over-penalized) are in `masteryState.test.ts`'s dedicated `describe("Phase 5B §17 regression tests")` block.

**§18 (cross-package integration):** `crossPackageIntegration.test.ts` runs the FULL real chain — `startAttempt`/`recordAttemptEvent`/`submitAttempt` (`@ipmat/attempt`) -> `toAutopsyEvidence`/`buildAutopsyOutput` (`@ipmat/autopsy`) -> `generateHypothesis` (FixtureProvider) -> `confirmHypothesis` -> `buildRepairPlan` -> `toMasteryContribution`/`computeMasteryState` — through real functions, not hand-typed fixtures standing in for each stage.

**Failures fixed:** none — this was greenfield implementation on top of already-committed, already-tested Phase 4A/5A code. Every new test passed on its first full run; no existing test (253 from before this phase) was touched or broke, confirmed by re-running the full suite after the `AutopsyHypothesis` type change (Phase 5A never constructed one, since it was contract-only, so nothing could regress).

---

## 11. What tests prove

- That a hypothesis structurally cannot become confirmed without `applyConfirmationResponse()` being called with `{type: "confirmed"}` — proven by construction (no other code path sets that value) and by the "invalid transition" test.
- That `RepairPlan` genuinely refuses to build from an unconfirmed, rejected, or corrected hypothesis — three separate tests, three separate `HypothesisError` codes.
- That a `"corrected"` response preserves BOTH the original `proposedExplanation` AND the new `studentCorrectionText`, never collapsing one into the other.
- That `MasteryComponentDetail` genuinely distinguishes a stable 50%-accuracy sequence from an unstable one at the SAME mean, via a real computed `stdDevAccuracy` and the raw ordered `sequence`/`longestIncorrectStreak` — not merely a documentation claim.
- That `patternCoverage`/`noveltyHandling`/`pressurePerformance` genuinely stay `null` when their respective context/observation requirements aren't met, rather than silently defaulting to 0 or an extrapolated guess.
- That the entire Phase 4A -> 5A -> 5B -> Mastery chain works through real functions end to end, not just compatible types.

---

## 12. What tests do NOT prove

- That `MIN_OBSERVATIONS_FOR_COMPONENT = 3`, or any of `AUTOPSY_THRESHOLDS`, is the RIGHT number for real students — these are provisional constants; the tests prove the GATING MECHANISM works correctly at the chosen threshold, not that the threshold itself is well-calibrated.
- That a real AI model, given the hypothesis prompt, will actually behave as instructed (phrase things as a hypothesis, avoid psychological claims, cite real supporting evidence) — no real provider call has been made in this phase; every hypothesis test uses `FixtureProvider` with hand-authored responses.
- That the `targetErrorCategory`/`targetErrorTaxonomyCode` tension on `RepairPlan` (§6, §8) doesn't matter in practice — no test exercises a case where they genuinely disagree in a way that would mislead a downstream consumer; this is a documented, not a tested-and-dismissed, limitation.
- That the persistence-mapping functions actually round-trip correctly against a real Postgres database, since no adapter or live database has ever been used anywhere in this repository.
- That `@ipmat/mastery`'s `patternCoverage` calculation behaves sensibly at real-world scale (hundreds of cells, thousands of attempts) — only small, hand-constructed fixture sets were exercised.

---

## 13. Remaining limitations

- **The `targetErrorCategory` vs. `targetErrorTaxonomyCode` tension on `RepairPlan`** (§6/§8/§12) is real and unresolved — a future phase may need a reconciliation step (e.g., re-deriving the code from the confirmed category, or flagging the disagreement explicitly to a human reviewer) rather than silently picking the deterministic code as authoritative.
- **No persistence adapter exists anywhere in this repository** — `Attempt`/`AttemptEvent` (Phase 4A), `Autopsy`/`RepairPlan` (this phase), and `MasteryState` (this phase) are all pure, in-memory domain computations. Every "persistence-ready" mapping function is exactly that: ready, not connected.
- **`retry_of_attempt_id`-chain evidence and cross-question historical Autopsy context are not wired into `HistoricalAttemptRecord[]`** — the machinery exists and is tested (Phase 5A §7), but nothing populates it from a real retry chain yet; that's a persistence-adapter/query concern for Phase 5C.
- **`MIN_OBSERVATIONS_FOR_COMPONENT` is one flat threshold for every component measure** — a real system might reasonably want different thresholds for, say, accuracy (where more data exists faster) versus `pressurePerformance` (which needs a rarer question type) — not built, to avoid inventing more provisional numbers than the phase brief actually required.
- **No confirm/correct UI, no actual follow-up-question selection, no adaptive question selection** — all explicitly out of scope this phase, all still pending (Phase 5C).
- **The Mastery Engine has never been run against real student data** — every test uses small, synthetic, hand-constructed attempt sequences; nothing here has been validated at realistic scale or against real behavioral patterns.

---

## 14. Exact next phase

**Phase 5C** (not started, per this phase's explicit instructions): Prisma-backed persistence adapters for `Autopsy`/`RepairPlan`/`MasteryState` (mirroring whatever adapter pattern Phase 4B builds for `Attempt`/`AttemptEvent` first), the confirm/correct UI that collects a real `ConfirmationResponse` and calls `applyConfirmationResponse()`, actual follow-up-question selection/generation from a `RepairPlan` (the one thing it explicitly stops short of), and adaptive practice-question selection using `MasteryState` + `PatternTaxonomyCell` coverage. Also still pending, unrelated to this phase: the real Anthropic smoke test (never run, any phase — now covering 5 task types), Phase 3.5 (scaling question generation), and Phase 4B (the `@ipmat/attempt` persistence adapter + practice loop, which Phase 5C's own adapters would follow the same pattern as).

Nothing above was started as part of this phase. No AI provider was called, no UI was built, no adaptive selection was built, no question batches were generated, nothing was committed. Stopping here — not proceeding to Phase 5C automatically.
