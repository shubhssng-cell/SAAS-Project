# 24 — Repair (`RepairPlan` + `@ipmat/repair-selection`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-037, D-039 (+ addendum), D-044 (read in full).

## Two distinct concepts, not to be confused

- **`RepairContext`** (Phase 5A) — built from EVIDENCE alone (`buildRepairContext()`), can exist for any incorrect attempt, confirmed or not. Identifies a target and a coarse priority/mode, nothing more.
- **`RepairPlan`** (Phase 5B) — built from a CONFIRMED hypothesis specifically (`buildRepairPlan()`). This is what actually drives targeted repair selection.

Neither has a `followUpQuestionIds` field — identifying a target is not the same as selecting a question. That's `@ipmat/repair-selection`'s job.

## `RepairPlan`'s exact fields, and where each comes from

```ts
interface RepairPlan {
  targetConceptName: string;              // from output.questionFacts.conceptName — a SNAPSHOT
  targetPatternFamilyName: string;        // from output.questionFacts.patternFamilyName — a SNAPSHOT
  targetTaxonomyCellId: string;           // from output.questionFacts — a SNAPSHOT
  targetErrorCategory: ErrorCategory;     // from the CONFIRMED hypothesis (student-validated)
  targetErrorTaxonomyCode: string | null; // from the deterministic candidateErrorEvidence (may differ from targetErrorCategory — a documented, disclosed tension)
  recommendedTrainingMode: RecommendedTrainingMode;  // computed once, at diagnosis time
  priority: RepairPriority;               // computed once, at diagnosis time
  rationale: string[];
  prerequisites: string[];                // real concept-graph prerequisites, [] if no graph supplied
  confirmationSource: { attemptId: string; hypothesisConfirmedAt: string };
}
```

**Critical distinction for anyone touching this type: the first six fields are historical snapshots, not live-derivable facts.** A RepairPlan describes *what was diagnosed*, at that moment — if the underlying Concept or PatternFamily is renamed later, a past RepairPlan must still describe the name as it was understood at diagnosis time. This is why the D-039 addendum persisted these as their own snapshot string/enum columns rather than resolving them via a live join at read time (see [23_AUTOPSY.md](23_AUTOPSY.md)).

## `@ipmat/repair-selection` — deterministic, never AI-chosen (D-044)

`selectRepairQuestion(input)` has no dependency on `@ipmat/ai` in its own source. Selection order:

1. **Structural validity** — malformed candidates excluded and counted, never silently scored.
2. **Eligibility** — `validationState === "published"` AND `conceptName` matches the plan's target concept.
3. **Training-mode hard requirement** — applied uniformly, never relaxed for a "fallback": `timed_pressure_drill` requires `testingModes.includes("time_pressured")`, `novelty_exposure` requires non-`"standard"` `noveltyLevel`.
4. **Match tier** (`classifyMatchTier()`), most to least specific, exactly 6 named tiers:

```
direct_cell_and_trap > direct_cell > pattern_family_and_trap > trap_only > pattern_family > concept_fallback
```

Ranking `trap_only` above bare `pattern_family` is a deliberate judgment call: directly repairing the diagnosed error outranks merely repairing the same question structure without addressing why the student got it wrong. `concept_fallback` is the ONE tier explicitly marked `isFallback: true`, with a standardized "broader concept-level repair selected as a deliberate fallback" explanation.

5. **Deterministic tie-break** (`tieBreak.ts`), in fixed order:
   - **Overuse avoidance** — excludes a candidate attempted ≥ `OVERUSE_MIN_ATTEMPT_COUNT` (currently **2**) times, but only when a fresher alternative exists in the same tier; never empties a tier to zero.
   - **Speed-weakness preference** — reusing `@ipmat/autopsy`'s own `AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO`, never a second invented threshold; prefers the shorter `expectedTimeSeconds` candidate.
   - **Difficulty-tier proximity** to the originally diagnosed question's tier.
   - **Lexicographically smallest `questionId`** — final, always-decisive.

**Important, verified-by-direct-testing consequence:** because `OVERUSE_MIN_ATTEMPT_COUNT` is 2, a single prior wrong attempt on a question does **not** exclude that same question from being re-recommended as its own repair — the tie-break will happily pick the same `questionId` again if it's lexicographically first and no other tier-1 match exists. This was directly discovered while building `apps/web`'s fixture question bank in this session — see [64_QUESTION_PLAYER.md](64_QUESTION_PLAYER.md).

## Confirmation re-verified at this package's own boundary

`selectRepairQuestion()` re-checks `repairPlan.confirmationSource?.hypothesisConfirmedAt` before doing anything else — the same "never trust a value merely typed as X" defense-in-depth discipline used throughout this codebase (D-043/D-044). A `"corrected"` hypothesis never reaches this package at all, since `buildRepairPlan()` already refused to construct a `RepairPlan` from one.

## What this package explicitly is NOT (5C-2 vs 5C-3 boundary)

`@ipmat/repair-selection` has no concept of "what should this student practice next in general" — no cross-concept prioritization, no mastery-driven queue, no `MasteryState` read at all. It answers exactly one question: given THIS ONE confirmed diagnosis, which available question repairs it. Global, mastery-aware "what's the single best use of this student's next practice" is `@ipmat/adaptive-selection`'s job (see [26_ADAPTIVE_SELECTION.md](26_ADAPTIVE_SELECTION.md)) — merging the two was explicitly rejected as making either impossible to reason about in isolation.

## The read-side contract, now complete (D-039 addendum)

`RepairPlanRepository.findConfirmedActiveByStudentId(studentId)` — confirmation truth is `Autopsy.confirmed === true` (joined via `RepairPlan.autopsyId`), never `RepairStatus` alone; `status !== "completed"` is a separate, orthogonal exclusion. See [23_AUTOPSY.md](23_AUTOPSY.md) and [54_SECURITY_AND_OWNERSHIP.md](54_SECURITY_AND_OWNERSHIP.md) for the exact eligibility rules this method enforces.
