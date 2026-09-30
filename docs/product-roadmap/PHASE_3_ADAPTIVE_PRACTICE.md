# Product Phase 3 — Adaptive Practice

## Phase objective

From the master roadmap: *the dashboard/practice entry actually surfaces the adaptive recommendation to a real student.* Phase 3 is delivered as a sequence of small units. Numbering continues the running unit count from Phase 2 (Units 1–8), so Phase 3's first unit is **Unit 9 = Phase 3.1**.

## Unit status

| Unit | Scope | Status |
|---|---|---|
| 9 (Phase 3.1) | First adaptive layer: react to the most recent finalized attempt | **COMPLETE** (below) |
| 10+ | Not defined here yet | **NOT STARTED** |

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

**Unit 10+ status: NOT STARTED.**
