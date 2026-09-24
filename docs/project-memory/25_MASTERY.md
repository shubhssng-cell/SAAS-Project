# 25 — Mastery (`@ipmat/mastery`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-040–D-043 (read in full), `docs/DATABASE.md` §Mastery.

## The core rule: multidimensional by construction, never a composite score

`computeMasteryState()` returns 5 **independently-nullable** component measures — never blended into one number:

| Measure | What it observes |
|---|---|
| `accuracy` | Correct / graded attempts for this concept |
| `speedRatio` | Observed time / expected time, aggregated |
| `noveltyHandling` | Accuracy specifically on non-standard `noveltyLevel` questions |
| `pressurePerformance` | Accuracy/speed under `testingModes.includes("time_pressured")` conditions |
| `patternCoverage` | Fraction of this concept's taxonomy cells the student has attempted (their own exposure, distinct from content-readiness coverage — see [42_QUESTION_UNIVERSE.md](42_QUESTION_UNIVERSE.md)) |

Plus a full `MasteryComponentDetail` — counts, speed statistics, **accuracy stability (stddev, not just mean)**, difficulty/novelty/pressure breakdowns, error-recurrence streaks, coverage detail — none of it discarded, all of it preserved regardless of what the headline measures decide.

## Why accuracy stability matters (a concrete, worked distinction)

Two students can share the identical mean accuracy (say, 67%) with very different reliability: one scoring `100/40/100/30` (highly unstable, alternating between mastery and total failure) versus one scoring `67/67/67/67` (stable, consistently mediocre). `stdDevAccuracy` distinguishes these — a real, deliberate design point from Phase 5B, not an incidental extra field.

## `null` means insufficient data, never zero (D-041, D-042, D-043)

`MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` (currently 3) is the ONLY centralized gate — each headline measure reports `null` below this many relevant observations, explicitly marked `PROVISIONAL`, not dressed up as calibrated. A real `0.0` means the dimension WAS measured and is genuinely zero; `null` means "we don't know yet." These are never confused, at either the TypeScript or (since D-043) the SQL level — the 5 `mastery_states` scalar columns are nullable `Float?`, not defaulted to `0`.

**Persistence granularity (D-043):** a row is written once ANY attempt exists for the student/concept (not only once every dimension has data) — `toMasteryStatePersistenceRecord()` returns `null` (writes nothing) only when `totalAttempts === 0`. This was a genuine refinement over the original D-042 rule ("write nothing if ANY measure is null"), which would have silently discarded real, usable partial data.

## No recency/decay formula — deliberately

Phase 5B forbade inventing an unexplained recency-decay weighting. `MasteryComponentDetail` preserves everything a future recency-aware pass would need (`contributingAttemptIds` in chronological order, `earliestAttemptAt`/`latestAttemptAt`, the raw ordered correctness `sequence`) **without this phase inventing the weighting scheme itself.**

## Why no confidence score exists here either

Same rule as everywhere else in this codebase (D-005) — mastery measures observable performance only. There is no "how sure is the system that this student has mastered this" field; there is only "how many observations, and what did they show."

## Reuses, never duplicates, Question DNA

`MasteryAttemptRecord = {contribution: AttemptMasteryContribution, question: AutopsyQuestionContext}` — reuses `@ipmat/autopsy`'s already-restated Question DNA type directly, rather than restating a third parallel shape (D-040). Content-readiness coverage is reused directly from `@ipmat/question-engine`'s `computePatternFamilyReadiness()`, kept explicitly distinct from student-exposure coverage — two different axes sharing one taxonomy vocabulary, not a second coverage model.

## Persistence status

`MasteryStateRepository` exists, tested, and has **never been called by any real flow** — see [21_STUDENT_MEMORY.md](21_STUDENT_MEMORY.md). Mastery is meant to always be computed fresh from real attempt history at the point of use, not read back as a cache.

See also: [26_ADAPTIVE_SELECTION.md](26_ADAPTIVE_SELECTION.md) for how mastery measures feed the global "what's next" ranking, [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §9 for the exact assembly pipeline a future composition layer will use.
