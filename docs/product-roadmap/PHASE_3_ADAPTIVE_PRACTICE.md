# Product Phase 3 — Adaptive Practice

## Phase objective

From the master roadmap: *the dashboard/practice entry actually surfaces the adaptive recommendation to a real student.* Phase 3 is delivered as a sequence of small units. Numbering continues the running unit count from Phase 2 (Units 1–8), so Phase 3's first unit is **Unit 9 = Phase 3.1**.

## Unit status

| Unit | Scope | Status |
|---|---|---|
| 9 (Phase 3.1) | First adaptive layer: react to the most recent finalized attempt | **COMPLETE** (below) |
| 10 (Phase 3.2) | Accumulated adaptive evidence: repeated observable performance over multiple attempts | **COMPLETE** (below) |
| Phase 3 Unit 3 (Phase 3.3) | Trend-aware adaptive evidence: how observed performance on a concept is changing (last 3 graded answers vs. the earlier ones) | **COMPLETE** (below) |
| Phase 3 Unit 4 | Adaptive question selection across concept, pattern, difficulty, novelty, coverage and progression | **NOT STARTED** |
| Phase 3 Unit 5 | Adaptive-system hardening / calibration / validation | **NOT STARTED** |

*Numbering note: Units 9 and 10 above carry the running Phase-2-continuing numbers they were committed under. From here on units are Phase-3-relative ("Phase 3 Unit 3" = Phase 3.3), as the roadmap now defines them: Unit 1 = latest attempt, Unit 2 = accumulated evidence, Unit 3 = trend/recency/streak, Unit 4 = selection across dimensions, Unit 5 = hardening.*

## Unit 9 (Phase 3.1) — First adaptive recommendation layer

> **This is the FIRST adaptive layer, not the final intelligence system.** It is a small, deterministic, explainable rule set over the student's most recent persisted attempt. It is not machine learning, not a mastery model, not Question Autopsy, and it makes no claim about the student.

**Objective.** After a student has demonstrated performance on a question, the next recommendation should be able to respond to that observable performance — using only evidence that actually exists in the persisted practice record — and must still fail safely when there is not enough data.

### What already existed (inspected)

`GET`/`POST /v1/recommendation` → `@ipmat/practice-api` → `TrainingRecommendationService` (`@ipmat/training-recommendation`, reads persisted state through the `@ipmat/db` ports) → `orchestrateNextTrainingAction()` (`@ipmat/training-orchestration`: repair → training-system providers → adaptive) → `@ipmat/adaptive-selection`'s `selectNextQuestion()`. That last package already had a deterministic, ranked set of named reason codes (never a numeric score), driven by **mastery** measures. Those measures are deliberately `null` below `MIN_OBSERVATIONS_FOR_COMPONENT` (3) — so after one or two attempts nothing reacted, and the coverage-gap reason won: the "coverage-first" behavior seen in Phases 2. The persisted `Attempt` records (status, verdict, server-derived time, timestamps) and each question's Question DNA were already flowing into the service as `attemptRecords`/candidates. **No schema, migration, repository, API-contract, or frontend change was needed.**

### Observable inputs used (and only these)

For the student's **most recent finalized attempt** (latest `finalizedAt`; abandoned attempts and other students' attempts ignored):
- **Outcome:** `submitted` or `skipped`.
- **Verdict:** `isCorrect` (submitted attempts only). A submitted attempt with no verdict is not evidence.
- **Time:** `timeTakenSeconds` (server-derived `finalizedAt − startedAt`) against the question's `expectedTimeSeconds`.
- **Question DNA of the answered question and of each candidate:** `questionId`, `conceptName`, `patternFamilyName`, `difficultyTier`, `combinesWithConcepts`, plus the candidate's `expectedTimeSeconds` and publication state.

### Exact deterministic rules

The signal (`deriveRecentEvidence`):
- `skipped` — the attempt was skipped.
- `incorrect` — submitted with `isCorrect === false`.
- `correct_slow` — submitted correct with `timeTaken / expected ≥ 1.3`. The 1.3 is the **existing** per-attempt ratio (`ADAPTIVE_SELECTION_CONSTANTS.SPEED_WEAKNESS_RATIO`, equal to autopsy's `SLOW_SPEED_RATIO`); **no new threshold was introduced**. A missing or zero expected time is never "slow".
- `correct_on_pace` — submitted correct, not slow.

Four new named reason codes, and which candidates satisfy each. In every rule the just-attempted question is excluded ("related" is a pure DNA fact: same concept, or either question lists the other's concept in `combinesWithConcepts`; "not harder" uses the existing fixed `DIFFICULTY_TIER_ORDER`):

| Signal | Reason code | A candidate satisfies it when | Preference inside the bucket (before the generic tie-breaks) |
|---|---|---|---|
| incorrect | `recent_incorrect` | related to the missed question **and** not harder | same pattern family first; then a strictly easier tier before an equal one |
| skipped | `recent_skip` | not harder (any concept) | strictly easier tier first; then shorter expected time |
| correct_slow | `recent_slow` | same tier **and** same concept | shorter expected time |
| correct_on_pace | `recent_correct_on_pace` | not easier | the smallest step up first; the same tier only when nothing harder is offered |

Where they sit in the fixed priority order (`TRAINING_NEED_PRIORITY_ORDER`):
`repair_priority > repeated_error > prerequisite_weakness > accuracy_weakness > speed_weakness > recent_incorrect > recent_skip > recent_slow > coverage_gap > underexposure > pressure_gap > novelty_gap > difficulty_progression > recent_correct_on_pace`.
- The **multi-attempt** measured reasons (repeated error, accuracy, speed weakness — which need ≥ 3 observations) still outrank any single-attempt reaction.
- An incorrect answer, a skip, or a slow correct answer are immediate signals, so they outrank the exposure/coverage reasons.
- A **correct, on-pace answer is deliberately not a "need"**: it never overrides a coverage/novelty/pressure gap or mastery-driven progression, and is the lowest named reason. (My first version ranked it above coverage; four existing tests showed that changed established behavior more than this unit needs, so it was demoted — see "Deliberate change to earlier tests" below.)
- Independently of the reasons, `selectNextQuestion()` **never immediately re-serves the just-attempted question** from any bucket while an alternative exists (a repeat still beats returning nothing when it is the only candidate).
- **Fails safe:** with no attempts (cold start) `recentEvidence` is `null` and behavior is exactly as before; if no candidate satisfies the winning rule (a thin pool) nothing is forced — selection falls through to the existing reasons and finally the `difficulty_progression` fallback, so a published question is always returned when one exists. Unpublished/malformed candidates are excluded exactly as before.

`AdaptiveSelectionResult` gained `recentEvidence` (the observed signal, or `null`) and the four reason codes; explanations are deterministic strings built from the observation (e.g. *"Your most recent attempt was a "advanced" "Successive Percentage Change" question and the answer was incorrect, so this is a related question at a lower difficulty tier."*).

### Student-facing wording

`@ipmat/practice-api`'s presentation mapping (the one place internal vocabulary becomes student language) maps each reason to **fixed** copy — no internal reason code, provider result, or diagnostics ever reaches the student:

| Reason | Mode label | Explanation |
|---|---|---|
| `recent_incorrect` | After an incorrect answer | Your last answer was incorrect, so here's a related question that isn't harder. |
| `recent_skip` | After a skipped question | You skipped your last question, so here's one that isn't harder. |
| `recent_slow` | Steady pace | Your last answer was correct but took longer than expected, so here's another at the same level before moving up. |
| `recent_correct_on_pace` | Next step | Your last answer was correct within the expected time, so here's one that isn't easier. |

Every other adaptive reason keeps the existing "Coverage" copy. The response shape is unchanged (`questionId`, `modeLabel`, `headline`, `explanation`).

### What the system deliberately does NOT infer

No confidence, motivation, emotion, anxiety, carelessness, intelligence, ability, "weakness", or hidden reasoning is inferred or stated — not in the rules, not in the copy (tests assert the explanation and copy contain none of that vocabulary). One incorrect answer produces *"the answer was incorrect, so here is a related question that isn't harder"*, never *"the student is weak at Percentages"*; that would only ever be a hypothesis for the later, separate diagnostic layer (Autopsy, confirmed by the student). The rules do not use the `AttemptEvent` log (answer changes, hints), only outcome/verdict/time.

### Persistence behavior

Nothing new is stored. The rules read the **same persisted finalized attempts** the recommendation service already loads (`findFinalizedByStudentId`), so the adaptive choice is a pure function of database state: a fresh API process, or a different API instance, makes the same choice. Verified on real Postgres (below).

### Tests

- `packages/domain/adaptive-selection/test/recentEvidence.test.ts` (24): signal derivation (cold start, all four signals, the exact 1.3 boundary, missing/zero expected time, latest-by-`finalizedAt` regardless of array order, abandoned/other-student ignored, no-verdict); each rule (incorrect incl. same-family preference, unrelated concept and harder tier excluded, `combinesWithConcepts` counts as related; skip incl. any-concept and shorter-time preference; slow; on-pace); **skip ≠ incorrect** from an identical pool; on-pace vs slow from the same answer changing only elapsed time; priority order (multi-attempt weakness outranks, recent above coverage, on-pace lowest); measured repeated-error beats the single-attempt reaction; published-only; the only-candidate repeat; no immediate repeat from any bucket; determinism; explanations free of inference vocabulary.
- `packages/training-recommendation/test/adaptiveFirstLayer.test.ts` (10): through the real `TrainingRecommendationService` over real attempt-lifecycle history — no prior performance, incorrect, skip, slow vs on-pace (elapsed from persisted timestamps), correct not treated as weak, most-recent-attempt-only, published-only, fresh-service determinism, other students' attempts ignored, no answer-key leakage.
- `packages/practice-api/test/adaptiveCopy.test.ts` (7): fixed copy per reason, no internal vocabulary or inference language, other reasons unchanged.
- `apps/api/test/devContent.test.ts` (+5, in-memory server over real HTTP): cold start, incorrect, skip, correct on pace, cross-student isolation.
- `apps/api/test/prismaPersistence.integration.test.ts` (**real Postgres**, opt-in): +8 Phase 3.1 tests — cold start; incorrect (and a **restarted instance makes the identical choice**); skip (read by a **different instance**); slow (persisted `started_at` moved back so the server-derived elapsed time is genuinely long); on-pace correct; most-recent-only; cross-student isolation; published-only (a draft copy that would be the best match is never recommended).

### Deliberate change to earlier tests (disclosed)

- **Four `@ipmat/adaptive-selection` tests** (coverage/novelty/pressure/progression after a correct answer) initially failed when `recent_correct_on_pace` outranked them. Rather than editing them, the policy was adjusted (on-pace demoted to the lowest named reason) and they pass **unchanged**.
- **Two Unit 8 real-database tests** were **modified**: *"a student can practice ALL of it … (submit or skip)"* and *"recommendation continuity survives a restart"* asserted that the recommender visits all three questions before repeating, but practiced with deliberately wrong answers and a skip. Those are exactly the outcomes the adaptive layer now reacts to (e.g. "a related question that isn't harder"), which can legitimately revisit ground, so the coverage-tour property no longer holds for them. They now practice with correct, on-pace answers (where the tour still holds — this is itself a check that correct answers don't disturb coverage) and carry a comment explaining why; the adaptive reactions are covered by the new tests. One in-file `regressionGuards` fixture gained the new `recentEvidence` field. No other existing test was changed.

### Validation

Default suite (no database): full repository **1814 passed + 22 skipped** across 182 files (was 1767 + 14 across 179); the 22 skipped are the opt-in real-database suite, run separately on the real Postgres: **22/22 passed** (was 14). Per package: apps/web 319 (unchanged); apps/api 66 passed + 22 skipped; practice-api 77 (was 70); db 278 (unchanged); adaptive-selection 49 (was 25); training-orchestration 54 (unchanged); training-recommendation 63 (was 53). Typecheck (all workspaces), build, lint and `git diff --check` clean. (A full-workspace typecheck caught a second test fixture, in training-orchestration, that needed the new field — vitest does not typecheck — fixed before committing.)

### Browser verification (real `apps/web` + real `apps/api` in Prisma mode + a disposable Postgres 16)

18/18 checks (`IPMAT_PERSISTENCE=prisma`, the same disposable-container procedure as Units 7/8 on `127.0.0.1:55432`; the unrelated Postgres on 5432 was not touched; no fixture adapter). Four fresh students:
1. **Cold start** → "Keep building your coverage". Then **A = the advanced *Successive* question, answered incorrectly** (server-graded "Not quite.") → Continue → card **"After an incorrect answer / Try a related question / Your last answer was incorrect, so here's a related question that isn't harder."** → **B = the standard-tier *Percentage Point* question** (related, easier, not the missed one). B answered correctly → **API killed and restarted** → the recommendation is computed by the fresh process from persisted attempts, is not the incorrect-answer copy and does not repeat B.
2. **Restart mid-evidence:** wrong answer → API killed and restarted *before* any recommendation was requested → the fresh process still recommends **"After an incorrect answer"** → the same easier question.
3. **Skip** the advanced question → "Skipped." → card **"After a skipped question / Try a question that isn't harder"** (different copy from the incorrect case) → the standard-tier question.
4. **Slow but correct:** waited ~100 s of real time on the 75 s question, then answered correctly (result showed "Time taken 101s (expected 75s)") → card **"Steady pace / Stay at this level … took longer than expected"** → the *other advanced* question (same tier — not the standard one, not a step up).
Postgres held all four students' attempts (`submitted:false,submitted:true` / `submitted:false` / `skipped` / `submitted:true`, plus the not-yet-answered opens created by following each card). 9 recommendation responses inspected in the browser: none contained an answer key, solution, or internal reason code, and each had exactly `questionId`, `modeLabel`, `headline`, `explanation`. Cookies cleared → `/login`.

### Known limitations

- **One attempt of memory.** The layer reacts to the single most recent finalized attempt only. It has no view of trends, streaks (beyond the existing repeated-error mastery reason), or time since the attempt; two skips in a row are not treated differently from one.
- **Tiny pool.** With three published questions (one standard, two advanced) the rules are visible but coarse: e.g. an incorrect answer on the standard question has no easier related question, so nothing is forced and the existing reasons decide. Behavior with a realistic bank is unverified.
- **Policy, not calibration.** The pool constraints ("not harder", "same tier", "related") and the in-bucket preferences are authored policy over a fixed difficulty ordering that the codebase already labels provisional (D-021); no rule has been validated against learning outcomes.
- **Correct answers barely steer.** By design a correct on-pace answer only avoids repetition and, when nothing else stands out, steps up; mastery-driven progression still needs ≥ 3 observations per tier.
- Training-system providers and confirmed repair plans (still gated on later phases' evidence) are consulted **before** adaptive practice, exactly as before; this layer lives inside the adaptive step.
- Real-database verification is on a disposable local container only, and is opt-in (not part of `npm test`/CI). The slow-answer integration test moves the persisted `started_at` (test-only) to create a long elapsed time; the browser run used real waiting instead.

### What remains for later phases

Question Autopsy (confirmed diagnoses), RepairPlan-driven selection, expanded mastery, trend/streak-aware rules, calibration of difficulty and thresholds against real data, a larger content bank, and any student-facing surfacing beyond the recommendation card — none started.

*(Status when Unit 9 landed: Unit 10 not yet started. Unit 10 has since been completed — below. Unit 9's text above is left as written.)*

## Unit 10 (Phase 3.2) — Accumulated adaptive evidence

> **Accumulated evidence is still evidence about observed performance, not a psychological diagnosis.** Everything below is counts and ratios of what was recorded in the student's persisted attempts. It is deterministic, not machine learning, not an LLM, not confidence estimation, and not Question Autopsy.

**Objective.** Unit 9 reacts to *what just happened* (the latest attempt). Unit 10 makes the recommendation respond correctly and consistently to *what has repeatedly been demonstrated* over enough observations — so one isolated mistake or one fast answer is not treated as the whole picture.

### The first question: does the architecture already calculate accumulated evidence?

**Yes — Unit 10 is mainly about making existing evidence drive recommendations correctly, not about a new mechanism.** `@ipmat/mastery` already recomputes per-concept aggregates from persisted attempts on every request (never stored, never a running counter), and `@ipmat/adaptive-selection` already had the reasons that read them. No second mastery system, no new relationship system ("related" stays the existing concept-level grain), no new persistence, no schema/migration/API-contract/frontend change.

Before changing anything, the current system was probed on the real development-content DNA for each requested case. Findings that shaped the unit:
- `accuracy_weakness`, `speed_weakness` and progression were already gated correctly on the one shared minimum-observation rule and drove recommendations from persisted history; Speed Lab (an existing training system, consulted before adaptive practice) already answers repeated slow-correct answers.
- **Defect 1 — a permanence bug.** `repeated_error` used the mastery detail's `longestIncorrectStreak` — the longest run **ever**. Two misses early in a history kept the concept `repeated_error` forever (the second-highest priority reason), however many correct answers followed; and it stayed true right after "3 incorrect then a correct answer". Fixed (below).
- **Defect 2 — a wrong explanation.** The accumulated reasons had no student copy, so the student saw "This targets a part of the topic you haven't practiced much yet" when the real reason was, e.g., repeated incorrect answers. Fixed (below).
- **Gap — no visible evidence facts.** Nothing exposed the counts behind an accumulated decision, so honest observation-only copy was impossible. Fixed (below).

### Recent evidence vs accumulated evidence

| | Recent (Unit 9) | Accumulated (existing reasons + Unit 10 fixes) |
|---|---|---|
| Question answered | "What just happened?" | "What has been demonstrated over enough observations?" |
| Window | The single most recent finalized attempt | All of the student's persisted attempts on the concept |
| Reasons | `recent_incorrect`, `recent_skip`, `recent_slow`, `recent_correct_on_pace` | `repeated_error`, `accuracy_weakness`, `speed_weakness`, `difficulty_progression` (+ Speed Lab and other training systems, unchanged) |
| Minimum observations | none (one attempt is enough to react, and only reacts) | the existing `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` = **3** for accuracy, speed and per-tier progression; `repeated_error` has its own existing rule of **2 consecutive incorrect answers** (`REPEATED_ERROR_MIN_STREAK`, mirroring autopsy's "a single occurrence is never a pattern") |

**No second minimum and no new threshold were introduced**; the existing values are unchanged. Below the minimum a measure is `null` = "no claim".

### Exact accumulated signals consumed (all from the existing `MasteryStateResult`, recomputed per request)

- **Accuracy:** mean accuracy over graded attempts, `< 0.6` (`ACCURACY_WEAKNESS_THRESHOLD`) when ≥ 3 graded attempts → `accuracy_weakness`.
- **Speed:** mean of time-taken / expected-time over attempts with both times, `≥ 1.3` (`SPEED_WEAKNESS_RATIO`) when ≥ 3 observations → `speed_weakness`. *(As in Phase 5B, every attempt with recorded times counts — including skipped ones. A quick skip therefore lowers the mean and counts toward the minimum; see limitations.)*
- **Repeated error (fixed):** the **current** run of consecutive incorrect graded answers — new `trailingIncorrectStreak()`, read from the existing ordered `accuracyStability.sequence` — `≥ 2` → `repeated_error`. Skips are not graded and do not break a run. The all-time `longestIncorrectStreak` is unchanged in mastery (raw counts are preserved) but no longer drives the reason.
- **Progression (refactored, same behavior):** the highest tier with ≥ 3 graded attempts and accuracy `≥ 0.8` (`PROGRESSION_ACCURACY_THRESHOLD`) makes the next tier the target. The rule now lives in one function, `highestDemonstratedTier()`, that both the decision (`computeProgressionTargetTier`) and its explanation use, so they cannot disagree.

New descriptive result field `AdaptiveSelectionResult.accumulatedEvidence` (for the selected question's concept): `conceptName`, `gradedAttempts`, `incorrectCount`, `trailingIncorrectStreak`, `speedObservations`, `meanSpeedRatio`, `highestDemonstratedTier` — counts and ratios only, no label or score.

### Final recommendation priority (explicit and deterministic)

`repair_priority > repeated_error > prerequisite_weakness > accuracy_weakness > speed_weakness > recent_incorrect > recent_skip > recent_slow > coverage_gap > underexposure > pressure_gap > novelty_gap > difficulty_progression > recent_correct_on_pace`

(Above all of these, unchanged: confirmed repair plans, then the training-system providers — Trap Lab, Calculation Gym, Speed Lab, Pressure Training, Novelty Training — are consulted before adaptive practice.) Consequences, each covered by tests:
- Accumulated multi-attempt evidence outranks the one-attempt reaction; **both stay visible** (`allReasonsSatisfied`, `recentEvidence`, `accumulatedEvidence`).
- **One recent success does not erase an accumulated pattern:** three incorrect answers then a correct one → `repeated_error` ends (the current run is 0) but `accuracy_weakness` (3 of 4 incorrect) still decides.
- **One recent failure does not overwrite a long successful history:** five correct then one incorrect → no accumulated weakness; the recent rule reacts.
- **Not permanent:** every reason is recomputed from the persisted history on each request. Incorrect/correct/incorrect/correct reports the observed "2 of 4" (existing threshold) and stops reporting it once later answers are correct; two early misses followed by correct answers never become a permanent classification.
- Unchanged from earlier units and re-tested inside the accumulated path: published-only filtering, malformed-candidate rejection, no immediate repeat of the just-attempted question (a repeat still beats nothing), overuse avoidance, ownership/isolation.

### Student-facing wording (observation-only; fixed shape `questionId`, `modeLabel`, `headline`, `explanation`)

Built in `@ipmat/practice-api`'s presentation mapping from the real numbers; when the facts to state a sentence truthfully are missing it falls back to the neutral coverage copy rather than inventing them.

| Reason | Example sentence (real output) |
|---|---|
| `repeated_error` | "Your last 3 graded answers on Percentages were all incorrect, so here's more practice on Percentages." |
| `accuracy_weakness` | "2 of your 4 graded answers on Percentages were incorrect, so here's more practice on Percentages." |
| `speed_weakness` | "Across 4 attempts on Percentages, your answers took about 1.8 times the expected time, so here's more practice on Percentages while you build speed." |
| `difficulty_progression` (genuine, not the fallback, with a demonstrated tier) | "You answered 3 of 3 graded standard-tier questions on Percentages correctly, so here's a question at the advanced tier." |

Repeated slow-correct answers on the development pool are actually answered by the existing Speed Lab provider, whose existing copy is shown ("You're solving this type correctly, but slower than expected. Same difficulty — the focus this time is pace."). The internal reason explanations were also rewritten as observations (e.g. "The most recent 3 graded answers on "Percentages" were all incorrect").

### What the system deliberately does NOT infer

No confidence, motivation, engagement, ability, intelligence, potential, emotion, "weakness" as a trait, or reason for a mistake — none is inferred, stored, or shown, and no such field exists (tests assert none of that vocabulary appears in any accumulated explanation or copy). "Related" means only the existing concept-level grouping. Nothing about *why* an answer was wrong: no hypothesis, student confirmation, RepairPlan, LLM call, reasoning or voice analysis.

### Persistence behavior

Nothing new is stored. Every accumulated reason is a pure function of the persisted finalized attempts, read through the existing repositories on each request, so a brand-new API process — or a second instance — reconstructs the identical decision from PostgreSQL (verified on real Postgres, below). The in-memory implementation behaves identically.

### Tests

- `packages/domain/adaptive-selection/test/accumulatedEvidence.test.ts` (33): `trailingIncorrectStreak` table; the **minimum-observation boundary** for accuracy, speed, progression (n−1 makes no claim, n does; bound to `MASTERY_CONSTANTS`) and repeated_error's own rule; **Case A** (one incorrect → recent only, no accumulated reason, accuracy stays `null`); **Case B** (three incorrect → `repeated_error` with counts; stability: one later correct → `accuracy_weakness` remains); **Case C** (three slow-correct → `speed_weakness` with the exact mean ratio and text; mixed timing does not qualify); **Case D** (3 on-pace correct on standard → advanced becomes the progression pick over basic repetition; n−1 does not; no "100%" shortcut — 2 of 3 correct does not progress); **Case E** (I/C/I/C → the observed "2 of 4", no repeated_error; not permanent after more correct answers; two early misses + correct run → the all-time streak says 2 but the reason is off); the exact priority order; recent+accumulated coexistence (both visible, accumulated decides); five-correct-then-one-incorrect; published-only and no-immediate-repeat inside an accumulated bucket; the only-candidate repeat; other students' history contributes nothing; cold start; result fields are descriptive only; explanations free of inference vocabulary.
- `packages/training-recommendation/test/accumulatedEvidence.test.ts` (12): Cases A–E and the permanence case through the **real** `TrainingRecommendationService` over persisted-style history on realistic DNA (Case C is answered by Speed Lab, asserted as such); a fresh service reconstructs the same decision; isolation; published-only; no answer-key leakage.
- `packages/practice-api/test/adaptiveCopy.test.ts` (+6): exact accumulated sentences, fallback when facts are absent or inconsistent, student-safe vocabulary and shape.
- `apps/api/test/devContent.test.ts` (+6, real HTTP on the in-memory server): Cases A, B, E, permanence, D, and isolation.
- `apps/api/test/prismaPersistence.integration.test.ts` (**real Postgres**, opt-in): +6 Phase 3.2 tests — Case A; Case B with a **restarted instance and a second instance** returning the identical card; Case C with three slow answers (persisted `started_at` moved back, test-only) and a restarted instance; Case D; Case E plus the permanence case; cross-student isolation and published-only.
- No existing test changed except the two regression-guard fixtures (they build an `AdaptiveSelectionResult` and needed the new field) and one comment-only rename in `adaptiveCopy.test.ts`; all Phase 2 and Unit 9 tests pass unchanged.

### Validation

Default suite (no database): full repository **1871 passed + 28 skipped** across 184 files (was 1814 + 22 across 182); the 28 skipped are the opt-in real-database suite, run separately on the real Postgres: **28/28 passed** (was 22). Per package: apps/web 319 (unchanged); apps/api 72 passed + 28 skipped; practice-api 83 (was 77); adaptive-selection 82 (was 49); training-recommendation 75 (was 63); training-orchestration 54, mastery 40, db 278 (all unchanged). Typecheck (all workspaces), build, lint and `git diff --check` clean. (Lint caught one leftover unused import from the progression refactor; removed before committing.)

### Browser verification (real `apps/web` + real `apps/api` in Prisma mode + a disposable Postgres 16)

18/18 checks (`IPMAT_PERSISTENCE=prisma`; the same disposable-container procedure as Units 7–9 on `127.0.0.1:55432`; the unrelated Postgres on 5432 was not touched; no fixture adapter). Four fresh students, following the real card → question → answer → result → Continue loop:
1. **Repeated incorrect (Cases A + B).** Advanced *Successive* answered incorrectly → card "After an incorrect answer" (recent rule only, no accumulated claim). Following the card: *Point* incorrect → "**Your last 2 graded answers on Percentages were all incorrect**…". Following the card: *Reverse* incorrect → "**Your last 3 graded answers on Percentages were all incorrect, so here's more practice on Percentages.**" (three distinct persisted questions chosen by the recommender). **API killed and restarted** → the reloaded card is byte-identical, reconstructed from Postgres. Postgres held exactly three `submitted:false` attempts.
2. **Mixed (Case E).** wrong, correct, wrong, correct → "**2 of your 4 graded answers on Percentages were incorrect**…" (not a repeated-error claim). Three more correct answers → the claim is gone (coverage card): not permanent.
3. **Repeated success (Case D).** Three correct on-pace standard answers → the next question was the **advanced** tier (*Reverse*), not the basic question; the card showed the coverage reason because in this tiny pool `coverage_gap` outranks `difficulty_progression` (see limitations).
4. **Repeated slow (Case C), real time.** Three correct answers after ~62 s each on the 45 s question (Postgres: `submitted:true:63` ×3) → the existing Speed Lab card "Solving speed / Build solving speed … slower than expected". A second API restart → the identical card.
13 recommendation responses inspected: none contained an answer key, solution, internal reason code, or the word "weak"; each had exactly `questionId`, `modeLabel`, `headline`, `explanation`. Cookies cleared → `/login`; existing Phase 2 flows unchanged.

### Limitations

- **Tiny development pool (3 questions, 1 concept).** The mechanism is proven end to end, but not calibrated: with three questions the choices are coarse (e.g. a "more practice" card can lead to a harder question when nothing easier is unexplored — the accumulated buckets rank by family exposure before tier suitability, unchanged here), and `coverage_gap` outranks `difficulty_progression` so the progression *explanation* rarely surfaces. Behavior on a real exam-sized bank is unverified.
- **No calibration is claimed.** Thresholds (3 observations, 0.6 accuracy, 1.3× time, 0.8 progression, streak of 2) and the difficulty ordering are authored policy, explicitly `provisional` since Phase 5B / D-021; nothing was validated against learning outcomes.
- **Concept-level grain only**, the existing mastery grain: "related questions" means the same concept. Cross-concept or pattern-family-level accumulation is not built.
- **Speed evidence counts every attempt with recorded times, including skipped ones** (existing Phase 5B semantics, deliberately not changed here): a quick skip can mask slowness or count toward the 3-observation minimum. A candidate cleanup for a later unit if the time of a *skip* should stop counting as solving time.
- **No time decay.** Accumulated accuracy and speed use the whole history (recoverable, not permanent, but slow to move over a long history); only `repeated_error` looks at the current run.
- Repeated slow answers are answered by the existing Speed Lab (consulted before adaptive practice); the adaptive `speed_weakness` reason is only reached when no training-system provider applies (covered at domain level).
- Real-database verification is on a disposable local container only and is opt-in (not part of `npm test`/CI); the slow integration test moves `started_at` (test-only), the browser run used real waiting instead.

### How this leads toward the later Autopsy/Repair layer

The system now separates three layers of evidence, each explainable and each explicitly *not* a diagnosis: the latest outcome (Unit 9), accumulated counts/ratios over persisted attempts (Unit 10), and — later — a hypothesis about *why* (Autopsy: observation → evidence → hypothesis → **student confirmation** → confirmed diagnosis → RepairPlan → targeted training → richer mastery). `accumulatedEvidence` is a natural, already-descriptive input for that layer's *observations*; but a count of incorrect answers can only ever become a hypothesis, and only a student's own confirmation can make it a diagnosis (D-006). None of that was started here.

## Phase 3 Unit 3 (Phase 3.3) — Trend-aware adaptive evidence

> **Trend evidence describes changes in observed performance; it does not diagnose the student.** Everything below is counts and runs of correct/incorrect graded answers from the student's persisted attempts. It is deterministic, not machine learning, not an LLM, not a trend *score*, not confidence estimation, and not Question Autopsy.

**Objective.** Unit 1 reacts to *what just happened*, Unit 2 to *what has been demonstrated overall*. Unit 3 adds *how that performance is changing*, so an old problem that has since improved no longer dominates, and a strong older history is distinguishable from a recent decline.

### The first question: what trend/streak machinery already existed?

Inspected before coding: `@ipmat/mastery`'s `MasteryComponentDetail` already exposes the **ordered graded correctness sequence** (`accuracyStability.sequence`, sorted by `finalizedAt`, skipped/abandoned excluded), `errorRecurrence.longestIncorrectStreak` (all-time, never expires), and `earliestAttemptAt`/`latestAttemptAt`; `@ipmat/adaptive-selection` already had `trailingIncorrectStreak()` (Unit 2's current-run fix) and the recent/accumulated evidence modules. There was **no** recent-window comparison, no previous-streak notion, no correct-streak, and no concept of "improving" or "declining". So Unit 3 adds exactly one small module (`trendEvidence.ts`) and reuses everything else: no second mastery system, no stored state, no new persistence, schema, migration, API contract or frontend change.

### Recent vs accumulated vs trend

| | Recent (Unit 1) | Accumulated (Unit 2) | Trend (Unit 3) |
|---|---|---|---|
| Question | "What just happened?" | "What has been demonstrated overall?" | "How is that performance changing?" |
| Window | the latest finalized attempt | all persisted attempts on the concept (mastery aggregates) | the **last 3 graded** attempts on the concept vs. **all graded attempts before them** |
| Output | `recentEvidence` | `accumulatedEvidence` | `trendEvidence` (counts + current/previous run + a `kind` or `null`) |

They never overwrite one another: all three are returned on the result, and `allReasonsSatisfied` still lists every reason a candidate meets.

### Exact rules (all in `packages/domain/adaptive-selection/src/trendEvidence.ts`; thresholds centralized in `TREND_CONSTANTS` or reused from `ADAPTIVE_SELECTION_CONSTANTS`)

**Which attempts count / order / ties.** This student's **graded** attempts (`status = submitted` with a verdict) on the concept. **Skipped and abandoned attempts are not graded: they neither enter a window nor break a streak** (same convention as the mastery sequence and `trailingIncorrectStreak`). Order is `finalizedAt` ascending; **equal or missing timestamps are ordered by `attemptId`** (`compareAttemptsChronologically`), and `@ipmat/mastery`'s own sort now uses the identical tie-break, so one persisted history has exactly one order in both places (previously ties kept input order).

**Windows (recency).** `TREND_RECENT_WINDOW = 3`: the recent window is the last 3 graded attempts; "earlier" is everything before it. There is **no decay formula** and no weighting — a fixed, explicit window, PROVISIONAL authored policy (not calibrated against real data).

**Insufficient history is not a claim.** Any trend `kind` needs a full recent window and at least `TREND_MIN_EARLIER_OBSERVATIONS = 1` earlier graded attempt (sustained success); any *change* claim needs `TREND_MIN_EARLIER_FOR_CHANGE = 2`. Otherwise `kind` is `null`.

**Kinds** (accuracy cut-offs are the **existing** 0.6 `ACCURACY_WEAKNESS_THRESHOLD` and 0.8 `PROGRESSION_ACCURACY_THRESHOLD`; no new accuracy threshold):

| Kind | Rule | Example |
|---|---|---|
| `improving` | earlier accuracy `< 0.6` (≥ 2 earlier) **and all 3 recent answers correct** | w w c c c · w w w c c c |
| `deteriorating` | earlier accuracy `≥ 0.8` (≥ 2 earlier) **and** recent accuracy `< 0.6` | c c c w w · c c c c w c w |
| `persistent_difficulty` | earlier accuracy `< 0.6` (≥ 2 earlier) **and** recent accuracy `< 0.6` | w w c w w · w w c w c w |
| `sustained_success` | all 3 recent correct and not `improving` | c c c c |
| `null` | mixed evidence or too little history: **no claim** | w w w c c (2/3 is not a recovery) |

"All 3 correct" — not 2 of 3 — is required for `improving` on purpose: one temporary success inside an old problem must not read as recovery.

**Streaks.** `currentStreak` = the run of identical graded outcomes ending at the most recent graded attempt; `previousStreak` = the opposite-outcome run immediately before it (or `null`). Never the longest-ever run. Unit 2's `repeated_error` (current trailing incorrect run ≥ 2) is **unchanged**.

### How trend enters the decision (explicit priority)

Two new reason codes, each a reaction to a *change*, both requiring a candidate on the **same concept** and never the just-attempted question:
- `recent_deterioration` — a question **not harder** than the last graded tier (steady difficulty; same tier first, then the nearest easier).
- `recent_improvement` — a question **not easier** than the last graded tier (smallest step up first; same tier only if nothing harder is offered).

Final priority: `repair_priority > repeated_error > recent_deterioration > prerequisite_weakness > accuracy_weakness > speed_weakness > recent_improvement > recent_incorrect > recent_skip > recent_slow > coverage_gap > underexposure > pressure_gap > novelty_gap > difficulty_progression > recent_correct_on_pace`.

Consequences (each tested):
- **Old failure no longer dominates recovered performance.** While the trend is `improving`, the whole-history mean (e.g. 0.5 for w w w c c c) stops raising `accuracy_weakness`; `recent_improvement` takes its place. The counts are **not erased** — `accumulatedEvidence` still reports 3 of 6 incorrect and the copy cites the earlier 0 of 3.
- **A recent success does not erase accumulated evidence unless it is a full run:** w w w c (and w w c w c c — 2 of the last 3) keep `accuracy_weakness`; `persistent_difficulty` (w w c w w) keeps `repeated_error`/`accuracy_weakness`.
- **A recent failure does not overwrite strong recent history:** c c c c c w is not `deteriorating` (recent 2/3); the Unit 1 recent rule reacts.
- **Deterioration after strong history** is visible as a change, not just "some errors": with a trailing error run `repeated_error` still wins (existing behavior preserved) but its copy now states the earlier successful answers; without one (c c c c w c w) `recent_deterioration` decides.
- Nothing is forced: if no candidate satisfies a trend reason the selection falls through to the existing reasons; a thin pool still yields an answer. Published-only, malformed rejection, answer-key protection, overuse avoidance, training-system providers, repair-plan consultation, difficulty ordering and mastery calculations are untouched.

### Student-facing wording (observation-only; fixed shape `questionId`, `modeLabel`, `headline`, `explanation`)

| Situation | Real output |
|---|---|
| improving | *Recent progress* — "Your last 3 graded answers on Percentages were all correct, compared with 0 of 2 earlier ones, so this moves you forward gradually." |
| deteriorating, trailing errors | *Recent change* — "Your last 2 graded answers on Percentages were all incorrect, while 2 of 2 earlier ones were correct, so here's more practice on Percentages at a steady difficulty." |
| deteriorating, no trailing run | *Recent change* — "1 of your last 3 graded answers on Percentages were correct, compared with 4 of 4 earlier ones, so here's another question that isn't harder." |
| persistent (accuracy reason) | *Accuracy over time* — "Only 1 of 3 earlier graded answers and 1 of your last 3 on Percentages were correct, so here's more practice on Percentages." |

No internal reason code, no psychological language, no claim about the student; when the trend facts are absent the copy falls back to the existing wording.

### What is deliberately NOT inferred

No confidence, motivation, emotion, engagement, ability, intelligence, potential or personality; no "trend score", no decay formula, no reason *why* performance changed. No Autopsy: no hypothesis, student confirmation, RepairPlan, LLM diagnosis, reasoning or voice analysis. Trend is correctness-sequence only: **speed trend (recent vs earlier time ratio) is not implemented** — the per-attempt order of time ratios is not exposed by mastery, and inventing it was out of scope.

### Persistence behavior

Nothing new is stored. The trend is a pure function of the persisted finalized attempts, recomputed on each request through the existing repositories — no process-local counter — so a brand-new API process or second instance reconstructs the identical decision from PostgreSQL. The in-memory implementation behaves identically.

### Why this is still deterministic, and why it is not yet Autopsy

Fixed window, fixed thresholds, total ordering, no randomness, no model call. A change in *observed correctness* is evidence; it says nothing about cause. Autopsy would hypothesize a cause and ask the student to confirm it; none of that exists here.

### Tests

- `packages/domain/adaptive-selection/test/trendEvidence.test.ts` (**27 + 1**): constants; cold start / insufficient history; Cases A–E; `classifyTrend` boundaries (earlier exactly 0.6 / 0.8, 2-of-3 recent, one earlier point, window not full); descriptive-only fields; current vs longest streak, previous streak; skipped/abandoned handling; input-order independence; equal-timestamp tie-break (and agreement with mastery's order); student and concept isolation; priority positions; improvement / deterioration / persistent / partial-recovery selection behavior with exact explanations; nothing-forced fall-through; published-only, no immediate repeat, isolation, cold start; determinism; no answer-bearing fields; observation-only wording; trend reasons never satisfied by the just-attempted question.
- `packages/training-recommendation/test/trendEvidence.test.ts` (4): improvement, deterioration, persistent, isolation through the **real** `TrainingRecommendationService`, including reconstruction by a fresh service.
- `packages/practice-api/test/adaptiveCopy.test.ts` (+6): exact trend sentences, enrichment only when the trend supports it, fallback, student-safe vocabulary/shape.
- `apps/api/test/prismaPersistence.integration.test.ts` (**real Postgres**, opt-in, +8): improvement (restarted + second instance identical), deterioration with and without a trailing run, persistent difficulty (two variants), sustained success, skipped attempts, isolation + published-only.
- Changed existing tests: the exact priority-order assertion (two new codes) and the two regression-guard fixtures (new result field). Nothing else.

### Validation

Default suite (no database): full repository **1909 passed + 36 skipped** across 186 files (was 1871 + 28); the 36 skipped are the opt-in real-database suite, run separately on the real Postgres: **36/36 passed** (was 28). New tests: adaptive-selection +28, training-recommendation +4, practice-api +6, real-Postgres +8. Typecheck (all workspaces), build, lint and `git diff --check` clean.

**Real PostgreSQL** (the same disposable-container procedure as Units 7–10: `postgres:16-alpine` on `127.0.0.1:55432`, random throwaway password never written to the repo, database `ipmat_test`; the unrelated Postgres on 5432 was not touched). Through the real HTTP server on the real Prisma repositories: improvement history (w w c c c), deterioration histories (c c c w w; c c c c w c w), persistent histories (w w c w c w; w w c w w), sustained success (c c c c), skipped attempts inside a history, cross-student isolation and published-only — each decision reconstructed **identically by a freshly started instance and a second instance** reading only the database. Because the persisted development pool is still three questions, this proves the temporal evidence mechanism and persistence, **not calibration on an exam-sized question bank**.

**Browser verification** (raw CDP / headless Edge; real `apps/web` + real `apps/api` with `IPMAT_PERSISTENCE=prisma` + the disposable Postgres; no fixture adapter): 24/24 checks. Three fresh students whose histories were built through the real HTTP API, then the real UI loop login → dashboard card → Start Practice → card → (**API process hard-killed and restarted**, page reloaded) → Continue → question → answer → Submit → result → Continue → next card:
1. **Improvement (w w c c c):** "Recent progress" card with the exact sentence above; byte-identical after the restart; after one more correct answer in the browser: "…compared with 1 of 3 earlier ones…" (history-updated).
2. **Deterioration (c c c w w):** "Recent change" card; identical after restart; after a correct answer the card becomes "1 of your last 3 graded answers on Percentages were correct, compared with 3 of 3 earlier ones, so here's another question that isn't harder."
3. **Persistent (w w c w c w):** "Accuracy over time" card; identical after restart; after a wrong answer the existing "Your last 2 graded answers … were all incorrect" card.
Every card and the pre-submission question page were checked: no internal reason code, no `undefined`/`[object`, no answer-key/solution field before submission, no psychological vocabulary.

### Limitations

- **Tiny development pool (3 questions, 1 concept):** the mechanism and persistence are proven; it is **not** calibrated and proves nothing about an exam-sized bank.
- **Window and thresholds are authored policy** (window 3; the existing 0.6/0.8 cut-offs); not validated against learning outcomes. A window of 3 is coarse: one answer moves a recent accuracy by 0.33.
- **Correctness only.** No speed trend, no pressure/novelty trend; concept-level grain only (the existing mastery grain).
- **`improving` is deliberately strict** (all 3 recent correct); a recovery that has 2 of 3 is reported as neither improving nor persistent, and keeps the accumulated reasons.
- **Existing behavior noticed, not changed:** the "no immediate repeat" rule is applied within the winning reason bucket, so if the winning bucket's only member is the just-attempted question it can still be re-served even though lower-priority candidates exist (Unit 1 semantics; relevant to Unit 4's selection work).
- **Mastery sort tie-break changed** (`attemptId` for equal/missing timestamps, previously stable input order): only observable for identical timestamps; all existing mastery tests pass unchanged.
- Real-database verification is on a disposable local container only and is opt-in (not part of `npm test`/CI).

**Unit 11+ status: NOT STARTED.**
