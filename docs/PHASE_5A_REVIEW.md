# Phase 5A Review — Question Autopsy Foundation

**Scope:** the deterministic foundation that turns a finalized `Attempt` plus authoritative Question information into structured Autopsy evidence — OBSERVATION -> EVIDENCE only. No AI call, no hypothesis generation, no `Autopsy`/`RepairPlan` database writes, no Mastery Engine, no adaptive question selection, no student UI. See [DECISIONS.md](DECISIONS.md) D-036 and D-037 for the individual decision records this report summarizes.

**Headline result:** every signal, contract, and boundary named in the phase brief is implemented, deterministic, and tested — including all 4 explicit regression tests. 253 tests pass (up from 192; +61 new), typecheck/lint/build are clean across all 9 workspaces (a new one, `@ipmat/autopsy`, added this phase).

**Update (Phase 5B):** the HYPOTHESIS and CONFIRMED DIAGNOSIS layers this document describes as type-only/unimplemented (§9, §11, the `AutopsyHypothesis` type, `RepairPlan`) are now real — see [PHASE_5B_REVIEW.md](PHASE_5B_REVIEW.md) and docs/DECISIONS.md D-038 through D-042. The rest of this document is left exactly as originally written, as the historical record of what Phase 5A itself did — every claim below about what was and wasn't built is accurate as of the end of Phase 5A, not as of today.

---

## 1. Implementation summary

| Area | What was built |
|---|---|
| Domain package | New `packages/domain/autopsy` (`@ipmat/autopsy`) — pure, database-free, depends only on `@ipmat/attempt`, `@ipmat/examiner-lens`, `@ipmat/question-engine` (no cycle: nothing depends back on it) |
| Input contract | `AutopsyInput` = `AttemptAutopsyEvidence` (Phase 4A) + `AutopsyQuestionContext` (restated Question DNA) + `ErrorTaxonomyEntry[]` (existing taxonomy) + optional `HistoricalAttemptRecord[]` |
| Behavior signals | `deriveBehaviorSignals()` — 12 named booleans + `speedRatio`, all against centralized thresholds |
| Hint/solution evidence | `deriveHintSolutionEvidence()` — genuine event-order comparison |
| Historical signals | `deriveHistoricalSignals()` — 8 repetition counts + 1 sequencing fact, `null` (not zero) when absent |
| Candidate error evidence | `deriveCandidateErrorEvidence()` — deterministic trap-code pattern match against the existing `ErrorTaxonomy`, never confirmed |
| Output contract | `buildAutopsyOutput()` — the orchestrator, `AutopsyOutput` |
| Hypothesis boundary | `AutopsyHypothesis` — TYPE ONLY, no builder function anywhere |
| Repair context | `RepairContext` + `buildRepairContext()` — identifies a target, never selects/generates questions |
| Tests | 61 new tests across 7 files, including all 4 named regression tests |

---

## 2. Exact files and functions

**New package:** `packages/domain/autopsy/` (`package.json`, `tsconfig.json` mirror `@ipmat/attempt`'s exactly; `dependencies`: `@ipmat/attempt`, `@ipmat/examiner-lens`, `@ipmat/question-engine`).

- **`src/types.ts`** — `AUTOPSY_THRESHOLDS`, `AutopsyQuestionContext`, `ErrorTaxonomyEntry`, `HistoricalAttemptRecord`, `AutopsyInput`, `BehaviorSignals`, `HintSolutionEvidence`, `RepetitionCount`, `HistoricalSignals`, `CandidateErrorEvidence`, `AutopsyOutput`, `AutopsyHypothesis`, `RepairPriority`, `RecommendedTrainingMode`, `RepairContext`.
- **`src/behaviorSignals.ts`** — `deriveBehaviorSignals()`, `deriveHintSolutionEvidence()`, plus internal (unexported) `computeSpeedRatio()` and `occurredBeforeTerminalEvent()`.
- **`src/historicalSignals.ts`** — `deriveHistoricalSignals()`, plus internal `toRepetitionCount()`.
- **`src/errorEvidence.ts`** — `deriveCandidateErrorEvidence()`, plus an internal `QUALIFICATION` constant string.
- **`src/autopsyOutput.ts`** — `buildAutopsyOutput()`, the single orchestrator.
- **`src/repairContext.ts`** — `buildRepairContext()`.
- **`src/index.ts`** — barrel export.
- **`fixtures/questionContext.ts`** — `percentagesQuestionContext`, `percentagesHardNovelPressureQuestionContext`, `percentagesNoTrapQuestionContext`, `percentagesUnknownTrapQuestionContext`, `ratioQuestionContext`.
- **`fixtures/errorTaxonomy.ts`** — `errorTaxonomyFixture` (the same 6 entries as `packages/db/seed-data/errorTaxonomy.ts`, restated — this package cannot depend on `@ipmat/db`).
- **`fixtures/evidence.ts`** — `buildEvidence()`, a directly-constructed `AttemptAutopsyEvidence` builder for fast isolated tests, plus `nextAttemptId()`.

**Test files (all new):** `test/behaviorSignals.test.ts` (16), `test/hintSolutionEvidence.test.ts` (4), `test/historicalSignals.test.ts` (13), `test/errorEvidence.test.ts` (7), `test/autopsyOutput.test.ts` (11, includes the 4 named regressions), `test/repairContext.test.ts` (7), `test/integration.test.ts` (3, against a REAL `@ipmat/attempt` lifecycle, not just hand-built fixtures).

**No schema, migration, or existing-package changes this phase** — `@ipmat/autopsy` is entirely additive and database-independent, per the phase brief's "keep the implementation database-independent where possible."

---

## 3. Autopsy input/output contracts

**Input** (`AutopsyInput`):
```ts
export interface AutopsyInput {
  evidence: AttemptAutopsyEvidence;        // OBSERVATION, from @ipmat/attempt (Phase 4A) — reused, not re-derived
  question: AutopsyQuestionContext;        // authoritative Question DNA, restated (not Prisma-imported)
  errorTaxonomy: ErrorTaxonomyEntry[];     // the EXISTING taxonomy, caller-supplied
  priorAttempts?: HistoricalAttemptRecord[]; // optional — omit or [] for no historical evidence
}
```

`AutopsyQuestionContext` deliberately excludes `expectedTimeSeconds` — that field already exists on `AttemptAutopsyEvidence`, and repeating it here would be exactly the kind of unnecessary duplication the phase brief warned against (§1: "Do not duplicate Phase 4A evidence unnecessarily").

**Output** (`AutopsyOutput`):
```ts
export interface AutopsyOutput {
  attemptFacts: AttemptAutopsyEvidence;    // reused directly from @ipmat/attempt, not copied under new field names
  questionFacts: AutopsyQuestionContext;
  behaviorSignals: BehaviorSignals;
  hintSolutionEvidence: HintSolutionEvidence;
  historicalSignals: HistoricalSignals | null;      // null, not zero-filled, when no history supplied
  candidateErrorEvidence: CandidateErrorEvidence | null; // null when there's no wrong answer to categorize
  availableEvidence: string[];
  missingEvidence: string[];
}
```

`buildAutopsyOutput(input: AutopsyInput): AutopsyOutput` is the single entry point — pure, synchronous, no AI call, no database access.

---

## 4. Signal definitions and thresholds

All thresholds live in one place, `AUTOPSY_THRESHOLDS` (`src/types.ts`):
```ts
export const AUTOPSY_THRESHOLDS = {
  FAST_SPEED_RATIO: 0.7,
  SLOW_SPEED_RATIO: 1.3,
  MULTIPLE_ANSWER_CHANGES: 2,
  REPEATED_EVIDENCE_MIN_COUNT: 2
} as const;
```

**`speedRatio`** (`behaviorSignals.ts`):
```ts
function computeSpeedRatio(evidence: AttemptAutopsyEvidence): number | null {
  const { timeTakenSeconds, expectedTimeSeconds } = evidence;
  if (timeTakenSeconds === null || expectedTimeSeconds === null) return null;
  if (!Number.isFinite(timeTakenSeconds) || !Number.isFinite(expectedTimeSeconds)) return null;
  if (expectedTimeSeconds <= 0) return null;
  return timeTakenSeconds / expectedTimeSeconds;
}
```
Exactly `timeTaken / expectedTime`, computed ONLY when both are present, finite, and `expectedTime > 0` — a zero or negative expected time is treated as invalid, not as "instant." When invalid, `speedRatio` is `null` and every signal that depends on it (`*Fast`, `*Slow`, `timeAboveExpected`, `timeBelowExpected`) is `false`, never fabricated.

**The 12 behavior signals**, each a plain boolean (or `speedRatio`, the one number):
| Signal | Definition |
|---|---|
| `correctFast` | `isCorrect === true` AND `speedRatio <= 0.7` |
| `correctSlow` | `isCorrect === true` AND `speedRatio >= 1.3` |
| `incorrectFast` | `isCorrect === false` AND `speedRatio <= 0.7` |
| `incorrectSlow` | `isCorrect === false` AND `speedRatio >= 1.3` |
| `answerChanged` | `answerChangeHistory.changeCount >= 1` |
| `multipleAnswerChanges` | `answerChangeHistory.changeCount >= 2` |
| `hintUsed` | `hintsUsed > 0` |
| `solutionOpened` | `solutionOpenedAt !== null` |
| `skipped` | `evidence.skipped` (from Phase 4A's `status === "skipped"`) |
| `noAnswer` | `finalAnswer === null` (covers both skip AND an abandoned attempt with nothing selected) |
| `timeAboveExpected` | `speedRatio > 1` — a COARSER signal than `*Slow`; the two are independent and both fire together for a genuinely slow attempt (see §7 regression 4) |
| `timeBelowExpected` | `speedRatio < 1` |

**Hint/solution temporal evidence** (`HintSolutionEvidence`) uses a real event-order comparison, not an assumption:
```ts
function occurredBeforeTerminalEvent(evidence: AttemptAutopsyEvidence, eventType: string): boolean | null {
  const eventIndex = evidence.eventTimeline.findIndex((event) => event.type === eventType);
  if (eventIndex === -1) return null;
  const terminalIndex = evidence.eventTimeline.findIndex((event) => TERMINAL_EVENT_TYPES.has(event.type));
  if (terminalIndex === -1) return null;
  return eventIndex < terminalIndex;
}
```
**Honest limitation, stated plainly rather than hidden:** because `@ipmat/attempt` structurally forbids any event after finalization (D-034's `already_finalized` guard), `hintBeforeFinalization`/`solutionBeforeFinalization` are CURRENTLY always `true` whenever both a hint/solution event and a terminal event (`answer_submitted`/`question_skipped`) exist in the same timeline. The comparison is computed for real (not hardcoded `true`) specifically so it stays correct if that guarantee is ever relaxed — this is a deliberate defensive-computation choice, documented rather than quietly simplified away. It is `null` — not `false` — when no hint/solution was used at all, or when the attempt is `abandoned` (which never appends a terminal event to its own timeline).

---

## 5. ErrorTaxonomy integration

`deriveCandidateErrorEvidence(evidence, question, errorTaxonomy)` (`errorEvidence.ts`) integrates the SAME `ErrorTaxonomy` vocabulary already seeded in Phase 1/2 (`packages/db/seed-data/errorTaxonomy.ts`) — no second taxonomy is created. Because `@ipmat/autopsy` cannot depend on `@ipmat/db` (which pulls in Prisma — domain packages must stay Prisma-agnostic, docs/ARCHITECTURE.md §6), the entries are restated as `fixtures/errorTaxonomy.ts` for tests, exactly matching the real seed data's codes/labels/descriptions/categories; a real caller would load the actual `error_taxonomies` table rows into the same `ErrorTaxonomyEntry[]` shape.

The matching logic:
1. If `evidence.isCorrect !== false` (correct, skipped, abandoned, or in_progress) → return `null`. There is no wrong answer to categorize.
2. If incorrect and the question has no `trapErrorTaxonomyCode` → return evidence with `proposedErrorCategory: null`, noting the absence in `missingEvidence`.
3. If incorrect and the trap code isn't found in the supplied `errorTaxonomy` array → return evidence with `proposedErrorTaxonomyCode` surfaced but `proposedErrorCategory: null`, noting the taxonomy lookup failure.
4. If incorrect and the trap code resolves → propose that entry's `category`/`code`, with `supportingEvidence` citing the specific trap description and `missingEvidence` explicitly noting this is a pattern match against the question's DESIGN, not verified against the student's actual reasoning.

Every branch returns a mandatory `qualification` string:
> "This is a CANDIDATE error category derived from question design metadata and observable behavior only — it is NOT a confirmed diagnosis and must not be treated as one until the student confirms or corrects it (docs/DECISIONS.md D-006). It is a deterministic pattern match, not an AI judgment and not a measurement of the student's actual reasoning process."

`CandidateErrorEvidence` has NO `confirmed` field anywhere — tested directly (`errorEvidence.test.ts`: "never includes a 'confirmed' field or any confirmation claim").

---

## 6. The observation/evidence boundary, and what is intentionally NOT inferred

**OBSERVATION** (Phase 4A, `@ipmat/attempt`): raw, per-attempt facts — final answer, event timeline, timing, hint/solution use. Reused directly as `AutopsyOutput.attemptFacts`, never re-derived under new field names.

**EVIDENCE** (this phase, `@ipmat/autopsy`): deterministic, named signals derived from OBSERVATION plus the authoritative Question DNA context — `behaviorSignals`, `hintSolutionEvidence`, `historicalSignals`, `candidateErrorEvidence`. Every one of these is a fact about what was observed or a rule-based pattern match, never a judgment about why.

**HYPOTHESIS and CONFIRMED DIAGNOSIS are NOT implemented.** `AutopsyHypothesis` is a type only:
```ts
export interface AutopsyHypothesis {
  proposedErrorCategory: ErrorCategory | null;
  proposedExplanation: string;
  supportingEvidence: string[];
  contradictoryEvidence: string[];
  missingEvidence: string[];
  confirmationRequired: true;
  confirmed: boolean | null;
}
```
No function in this package returns this type. Nothing calls an AI provider anywhere in `@ipmat/autopsy`.

**Never inferred, anywhere in this package, by design** — there is no field, in any type in `src/types.ts`, for: confidence, motivation, emotion, intelligence, anxiety, laziness, carelessness (as a personality trait), or intent. This is enforced both structurally (no such field exists to populate) and tested directly (`autopsyOutput.test.ts`: a full `AutopsyOutput` is JSON-serialized and checked, case-insensitively, for all 8 forbidden terms). The one apparent exception — `careless_arithmetic` as an EXISTING `ErrorTaxonomy` *code name* from Phase 1/2 seed data — is not actually an exception: it names a category of CALCULATION ERROR (a `calculation_mistake`), and this package never asserts "the student IS careless," only ever "this attempt's evidence pattern-matches the calculation_mistake category coded careless_arithmetic," as an unconfirmed candidate like every other candidate error category.

---

## 7. Tests

**Old test count:** 192 (end of Phase 4A).
**New test count:** 253 (+61).

| File | Tests | Covers |
|---|---|---|
| `test/behaviorSignals.test.ts` | 16 | All 12 signals, missing/invalid/negative/zero expected time, missing time-taken, the `timeAboveExpected` vs `*Slow` distinction |
| `test/hintSolutionEvidence.test.ts` | 4 | Before-finalization for hint and solution, null on no-usage, null on abandoned (no terminal event) |
| `test/historicalSignals.test.ts` | 13 | Every repeated-X signal, cell-vs-concept scoping, the single-failure-doesn't-count threshold, cross-concept non-contamination, the pressure-context-absent null case |
| `test/errorEvidence.test.ts` | 7 | Matched/unmatched/absent trap code, correct/skipped/abandoned all return `null`, no `confirmed` field |
| `test/autopsyOutput.test.ts` | 11 | Full assembly, `availableEvidence`/`missingEvidence` accuracy, immutability of inputs, no-psychological-inference structural check, no-`confirmed`-key structural check, plus all 4 named regressions |
| `test/repairContext.test.ts` | 7 | Priority/training-mode derivation, no `followUpQuestionIds` field, target fields reused directly |
| `test/integration.test.ts` | 3 | The SAME behavior proven against a REAL `@ipmat/attempt` lifecycle (`startAttempt`→`recordAttemptEvent`→`submitAttempt`/`skipAttempt`→`toAutopsyEvidence`→`buildAutopsyOutput`), not just hand-built fixtures |

**What the tests prove, mapped to the phase brief's required scenarios (§13):** correct+fast/slow and incorrect+fast/slow (`behaviorSignals.test.ts`); one vs. multiple answer changes (`behaviorSignals.test.ts`, and end-to-end in `integration.test.ts`); hint and solution usage, including temporal ordering (`hintSolutionEvidence.test.ts`); skipped vs. unanswered/abandoned, kept distinct (`behaviorSignals.test.ts`, `integration.test.ts`); missing and invalid (zero/negative) expected time (`behaviorSignals.test.ts`); repeated concept/pattern-family/taxonomy-cell failure (`historicalSignals.test.ts`); novelty- and difficulty-aware interpretation (question context preserved alongside signals rather than folded into them — `historicalSignals.test.ts`'s novelty tests, `autopsyOutput.test.ts` regression 1); preservation of raw evidence (`autopsyOutput.test.ts`: `attemptFacts` is the exact object reference passed in, and the source `evidence`/`priorAttempts` are never mutated); no psychological inference and no confidence score (`autopsyOutput.test.ts`, structural JSON-content check); candidate error ≠ confirmed error (`errorEvidence.test.ts`, `autopsyOutput.test.ts` regression 2).

**The 4 named regression tests** (`autopsyOutput.test.ts`, `describe("Phase 5A §13 regression tests")`):
1. **98% accuracy on basic questions does not become a universal diagnosis:** 20 correct/fast prior attempts on a concept, then ONE failure on a harder, different taxonomy cell — asserts `repeatedConceptFailure`/`repeatedTaxonomyCellFailure` stay `null` (a single failure among many successes never crosses the repeated threshold), and asserts the full serialized output contains no `"mastery"`, `"understanding"`, or `"overallassessment"` substring anywhere.
2. **One hard-question failure does not become a confirmed error:** a single incorrect attempt with NO prior history — `historicalSignals` is `null` entirely (nothing "repeated" can be claimed from one data point), `candidateErrorEvidence` is a CANDIDATE with its mandatory qualification, and no `"confirmed"` key exists anywhere in the serialized candidate-error object.
3. **A→B→C→D is preserved exactly:** a 4-point answer-change sequence survives through `buildAutopsyOutput()` unchanged — `attemptFacts.answerChangeHistory.sequence` maps to exactly `["420","480","450","500"]`, `changeCount` is `3`, and `multipleAnswerChanges` is `true`.
4. **Correct but 3x expected time remains both correct AND slow:** `attemptFacts.isCorrect === true` and `behaviorSignals.correctSlow === true` simultaneously — not mutually exclusive, and `candidateErrorEvidence` stays `null` since the attempt was correct regardless of how slow it was.

**Failures fixed:** none — this was greenfield implementation. Every new test passed on the first full run against the implementation as written; no existing test (192 from before this phase) was touched or broke.

**Deliberately untestable behavior:** whether these signals and thresholds are actually the RIGHT ones for real students (e.g., is 1.3x truly "slow," is 2 repeats truly "a pattern worth flagging") cannot be tested without real attempt data, which doesn't exist yet (no live database has ever been reachable, and Phase 4B — the practice loop — hasn't run). This is stated plainly as a limitation (§8), not something the tests can or do prove.

---

## 8. Remaining limitations

- **Thresholds are chosen, not calibrated.** `FAST_SPEED_RATIO` (0.7), `SLOW_SPEED_RATIO` (1.3), `MULTIPLE_ANSWER_CHANGES` (2), and `REPEATED_EVIDENCE_MIN_COUNT` (2) are reasonable starting values, not measured against real student behavior — the same honest caveat Phase 3.1's `difficultyCalibrationStatus: "provisional"` (D-021) makes for difficulty dimensions. No attempt was made to invent a more "scientific-looking" justification for these specific numbers.
- **`AutopsyQuestionContext.patternTaxonomyCellId` is an opaque, caller-supplied string.** This package has no way to verify it actually corresponds to a real `PatternTaxonomyCell` row — that's a persistence/integration-layer concern for whoever eventually wires this to a real database (Phase 4B/5B), the same trust-boundary limitation `@ipmat/attempt`'s `AttemptQuestionContext` already has for `Question` data (D-034).
- **`RecommendedTrainingMode`'s vocabulary (4 values) is a v1 heuristic**, not a finalized taxonomy — explicitly documented as provisional in its own doc comment (D-037), expected to grow deliberately.
- **`solutionOpenedAfterPriorIncorrectAttempt` only looks at attempts on the SAME `questionId`**, not a broader "any prior attempt on a related question in this cell/pattern-family." This was a deliberate scope decision (the more literal, unambiguous interpretation of "a prior incorrect attempt" for a single question) — broadening it to pattern-family/cell scope is a reasonable future extension, not built here.
- **No real attempt data exists to validate any of this against.** Every test in this phase uses either a hand-built fixture or a real `@ipmat/attempt` lifecycle run against SYNTHETIC data — nothing here has been run against a real student's actual behavior, because Phase 4B (persistence + practice loop) hasn't happened yet.
- **`errorTaxonomyFixture` is a hand-maintained copy of `packages/db/seed-data/errorTaxonomy.ts`'s entries, not a shared import.** If the real seed data changes, this fixture must be updated by hand to stay in sync — an acceptable, documented consequence of the Prisma-independence boundary (§5), not an oversight.

---

## 9. Exact next phase

**Phase 5B** (not started, per this phase's explicit instructions): the actual HYPOTHESIS-generating AI call — consuming `AutopsyOutput` (this phase's output, not raw `Attempt`/`AttemptEvent` rows) through `@ipmat/ai`'s `generateStructured()`, producing a real, populated `AutopsyHypothesis`; the confirm/correct UI; `RepairPlan` generation (building on this phase's `RepairContext`, but actually selecting/generating follow-up questions, which `RepairContext` explicitly does not do); and `Autopsy`/`RepairPlan` database persistence. Also still pending, unrelated to this phase: the real Anthropic smoke test (never run, any phase), Phase 3.5 (scaling question generation), and Phase 4B (the persistence adapter + practice loop `@ipmat/attempt` needs before real attempt data can exist at all).

Nothing above was started as part of this phase. No AI provider was called, no Mastery Engine was built, no adaptive question selection was built, no student UI was built. Stopping here — not proceeding to Phase 5B automatically.
