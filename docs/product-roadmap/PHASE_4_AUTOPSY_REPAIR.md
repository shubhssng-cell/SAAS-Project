# Product Phase 4 — Question Autopsy → Confirmation → Repair → Targeted Practice

## Phase objective

From the master roadmap: *the confirm/correct UI ships; a wrong answer can lead to a confirmed diagnosis and a repair question, in-product.* The engineering foundations already exist as domain code (`@ipmat/autopsy`, `@ipmat/repair-selection`, the attempt lifecycle, mastery, adaptive selection, orchestration). Phase 4 integrates them into the real student flow, one small unit at a time, keeping the project's rule that **observation ≠ evidence ≠ hypothesis ≠ diagnosis** (docs/DECISIONS.md D-005, D-006).

Numbering is **Phase-4-relative** (Unit 1 … Unit 5); there is no relation to the old global unit counts.

## Unit status

| Unit | Scope | Status |
|---|---|---|
| Unit 1 | Autopsy **evidence** (observation only) surfaced in the real student flow | **COMPLETE** (below) |
| Unit 2 | Hypothesis generation + student confirmation / correction | NOT STARTED |
| Unit 3 | Persist confirmed diagnosis + RepairPlan | NOT STARTED |
| Unit 4 | Targeted repair-question selection + adaptive integration | NOT STARTED |
| Unit 5 | Full end-to-end Autopsy → Repair → improved-practice hardening | NOT STARTED |

*(This is a working plan; later units may be adjusted when they start.)*

## Unit 1 — Autopsy evidence surfaced in the real student flow

> **Unit 1 answers "what happened?" — never "why did it happen?".** It reports recorded and derived facts about one finalized attempt. It does not diagnose, hypothesize, label, or repair, and it makes no claim about the student.

### Boundary

```
Attempt  ─►  Observable Evidence   ◄── Unit 1 implements exactly this
                 │
                 ▼  (later units, none built here)
            Hypothesis  ─►  Confirmation  ─►  Diagnosis  ─►  RepairPlan
```

Not built, deliberately: LLM hypothesis generation, any confidence/psychology, student confirmation UI, persisted diagnosis, RepairPlan creation, targeted repair selection, new adaptive scoring, ML, embeddings, RAG, a vector store. No database table, schema or migration was added.

### What already existed (inspected)

- `@ipmat/attempt`: `toAutopsyEvidence()` / `AttemptAutopsyEvidence` (the finalized-attempt contract, a structurally psychology-free type), `deriveAnswerChangeHistory()`.
- `@ipmat/autopsy`: `buildAutopsyOutput()` (deterministic signals **plus** a candidate error category from the error taxonomy — diagnosis-adjacent, therefore **not used** by Unit 1), `deriveBehaviorSignals()` (used for the time ratio), `HistoricalAttemptRecord`.
- `@ipmat/training-recommendation`: the persisted-state composition (finalized history, the published DNA pool, canonical questions, concept links) — reused.
- `@ipmat/practice-api` / `@ipmat/api` / `apps/web`: result endpoint and result screen — extended.

### Evidence model (`ObservationEvidence`, `@ipmat/autopsy/src/observationEvidence.ts`)

A pure, deterministic builder over the existing contracts. It adds no metadata that was not already recorded, and it carries **no answer key** (`correctAnswer` is not a field; the graded verdict is the only answer-related fact).

| Group | Fields | Source |
|---|---|---|
| identity | `studentId`, `attemptId`, `questionId` | observed |
| outcome | `status` (`submitted`/`skipped`/`abandoned`), `verdict` (`correct`/`incorrect`/`not_graded`), `selectedAnswer` | observed |
| timing | `elapsedSeconds` (finalizedAt − startedAt, recorded by the lifecycle), `expectedSeconds` (question metadata) | observed |
| | `timeRatio` (= elapsed ÷ expected, only when both are valid) | **derived** |
| interaction | `recordedSelectionCount`, `hintEventsRecorded`, `solutionOpenedRecorded` | observed (counts/flags of *recorded* events) |
| | `answerChangeCount`, `answerChanged` | **derived**, and **unknown (`null`) unless ≥ 2 selections were recorded** |
| eventSequence | the recorded events, in order (type + timestamp only) | observed |
| questionContext | chapter, concept, pattern family, taxonomy cell, difficulty tier, novelty level, testing modes, combining concepts | observed (question metadata); `null` = unknown |
| history | counts of prior outcomes on the same concept / pattern family / taxonomy cell / question, prior-attempt total, the last ≤ 5 outcomes on the concept | **derived**; `null` = no earlier attempts, or unknown |
| fieldSources | field path → `observed` \| `derived` (a constant table, `OBSERVATION_FIELD_SOURCES`) | — |
| unknown | paths that are unknown for this attempt, plus `never_collected.{reasoning, working_steps, confidence, intent}` | — |

**Observed vs derived vs unknown.** *Observed* = a fact the system recorded. *Derived* = a deterministic calculation from observed facts (time ratio, change count, history counts). *Unknown* = not available: the value is `null` and its path appears in `unknown`; it is **never guessed, defaulted or zero-filled**. `confidence` and `intent` are explicitly *never collected* and have no field.

**An honesty point discovered while inspecting.** The real student flow records exactly **one** `answer_selected` event, at submission, and no `question_opened`, `answer_changed`, `hint_opened` or `solution_opened` events (the UI has no hints and does not send selection changes). One recorded selection is consistent with "never changed" *and* with "changed but not recorded", so the change count is **unknown**, not 0 — the student sees "Changes to your answer before submitting are not recorded in this practice flow." rather than a false "you did not change your answer". Hint/solution fields are named as counts of *recorded* events for the same reason. (Recording selection changes in the UI is a possible later addition; Unit 1 does not add it.)

### Integration point in the student flow

```
Start Practice → question → answer → Submit → finalized attempt → result screen
                                                                     │
                     GET /v1/attempts/:id/evidence  ◄────────────────┘  (after the result is showing)
```

- `TrainingRecommendationService.getAttemptObservationEvidence()` (`@ipmat/training-recommendation`) verifies enrollment ownership, loads the student's finalized attempts (total order: finalization time, then id), the published DNA pool, the canonical question and the concept link, and calls `buildObservationEvidence()`. Prior attempts whose question is outside the published DNA pool, whose canonical question cannot be loaded, or whose concept link does not resolve are **excluded** from history (the same rule mastery uses), never given invented context.
- `PracticeApiService.getAttemptEvidence()` (`@ipmat/practice-api`) verifies the attempt belongs to the requesting student, **refuses an attempt that is still `in_progress` (409)** so nothing can be read before submission, and maps the evidence to a student-safe `AttemptEvidenceView` (`observations`, `facts`, `context`, `history`, `notRecorded`). It is the only place evidence becomes sentences.
- `apps/api`: `GET /v1/attempts/:attemptId/evidence` (auth required; 401/403/404/409 as for the result endpoint).
- `apps/web`: `adapter.getAttemptEvidence()` and a "What was recorded" card on the result screen (graded and skipped). It is **supplementary**: it loads after the result is on screen, and a failure or empty evidence simply shows nothing — the result and Continue are never blocked.

### Student-facing copy (fixed templates; observation only)

"Your selected answer was B." · "Your answer was correct/incorrect." · "You skipped this question." · "You took 86 seconds." · "The expected time was 60 seconds." · "That is about 1.4 times the expected time." · "You changed your answer once before submitting." (only when ≥ 2 selections were recorded) · "You opened 2 hints." / "You opened the solution during this attempt." (only when recorded) · "This question was in Percentages, pattern "Reverse Percentage", at the standard level." · "Before this attempt you had 3 earlier attempts on Percentages: 1 correct, 2 incorrect."

Every sentence restates a number; none gives a cause, a label, or a judgment beyond the graded verdict (tests assert an exact template allow-list and ban causal/psychological words).

### Privacy / safety boundary

- **No answer leakage.** Nothing exists before submission (server refuses; the page shows no evidence card; the question page has no key). After submission the view carries the student's *own* selected answer and the verdict; it has no answer-key or solution field (the existing result endpoint already shows those after submission, unchanged).
- **No psychological inference.** There is no field for confidence, motivation, intelligence, ability, emotion, personality or intent (D-005/D-006); `never_collected.*` states their absence.
- **No diagnosis.** No candidate error category, taxonomy lookup, hypothesis, or repair exists in the evidence object or the view (tests assert this structurally and by scan). `AutopsyOutput`'s `candidateErrorEvidence` is deliberately not exposed.
- **Read-only.** Asking for evidence writes nothing (verified on real Postgres: no `autopsies`, `repair_plans` or `mastery_states` row is created by it).

### Persistence and reproducibility

Nothing is stored. The evidence is rebuilt on every request from the persisted attempt, its events and the persisted question metadata, and it depends only on the attempt and the attempts finalized **before** it — so later practice never changes what an older result says, and a fresh API process or a second instance returns the identical object (verified on real Postgres and in the browser, including across a hard API restart).

### Tests

- `packages/domain/autopsy/test/observationEvidence.test.ts` (**18**): correct / incorrect / skipped / abandoned; timing and the derived ratio (and every way it becomes unknown); answer-change unknown-vs-derived (1 vs ≥ 2 recorded selections); recorded hint/solution; deterministic event ordering; unresolved question context; no-history `null`; multi-prior history at concept / family / cell / question level; the attempt never counts itself; order-independence of supplied priors; the recent-outcomes window; every emitted field has a declared source; `never_collected` always listed; purity and determinism; no diagnosis / answer-key / psychological field.
- `packages/practice-api/test/attemptEvidence.test.ts` (**11**): through the real attempt lifecycle and in-memory repositories — exact sentences for incorrect / correct / skipped; history counts and an earlier result unchanged by later attempts; a new service over the same state returns the identical view; missing metadata is unknown, not guessed; read-only; refused before submission; other student / other enrollment / unknown attempt; no answer key, diagnosis or psychological wording; a template allow-list for every sentence.
- `apps/api/test/devContent.test.ts` (+3): the real HTTP path on the in-memory server: 409 before submission, evidence after; a skip; 401/403/404; history and reproducibility.
- `apps/web`: adapter (+2: mapping, malformed/refused) and the result screen (+4: the card, omission when absent, wording, supplementary wiring).
- `apps/api/test/prismaPersistence.integration.test.ts` (**real Postgres**, +4, opt-in): evidence from the persisted attempt and identical on a restarted and a second instance; 409 / 403 / skip / 404; history from persisted rows and unaffected by later practice; no autopsy / repair-plan / mastery row is created.

### Validation

Default suite (no database): full repository **2012 passed + 50 skipped** across 193 files (was 1974 + 46); the 50 skipped are the opt-in real-database suite, run separately on real Postgres: **50/50 passed** (was 46). New tests: autopsy +18, practice-api +11, api HTTP +3, web +6, real-Postgres +4. Typecheck (all workspaces), build, lint and `git diff --check` clean. Existing tests needed no assertion changes.

**Real PostgreSQL** (the same disposable-container procedure as earlier units: `postgres:16-alpine` on `127.0.0.1:55432`, random throwaway password never written to the repo, database `ipmat_test`; the unrelated Postgres on 5432 was not touched), through the real HTTP server on the real Prisma repositories: submit → persisted finalized attempt → evidence whose answer, verdict and elapsed seconds equal the persisted row → the identical object from a **restarted** instance and a **second** instance; 409 before submission, 403 for another student, 404 for an unknown attempt, a skip reported as a skip; history counts equal the persisted earlier attempts and an earlier attempt's evidence is unchanged by later practice; no `autopsies`, `repair_plans` or `mastery_states` row is created by submitting or by reading evidence (and `/autopsy` still reports nothing pending).

**Browser verification** (raw CDP / headless Edge; real `apps/web` + real `apps/api` in Prisma mode + the disposable Postgres; no fixture adapter): **18/18 checks.** Login → dashboard → Start Practice → question → answer → Submit → result:
1. **Incorrect answer with two earlier attempts:** before submission the page shows no evidence, no answer key and no solution, and the real API refuses evidence for the open attempt (409, asked from the browser with its session). After submitting, the "What was recorded" card appears on the result screen only; the selected answer and verdict equal the persisted attempt, the elapsed seconds equal the persisted `time_spent_seconds`, expected time and ratio are stated as numbers, the history sentence equals the persisted earlier outcomes, unrecorded answer changes are stated as not recorded, and there is no diagnostic/psychological wording or `undefined`/`null`. A hard page refresh shows identical evidence; after the API process was **killed and restarted** the same evidence is reconstructed from Postgres; **Continue** still reaches the next recommendation.
2. **Correct answer:** the recorded verdict and the student's own answer only; no history sentence for a first attempt.
3. **Skipped:** "You skipped this question." with no selected answer or grade; Continue available.

### Limitations

- **Answer changes, hints and solution opening are effectively unobserved in the current student flow** (one recorded selection; no hint UI; the solution is shown only after submission). The evidence says so instead of filling the gap. Capturing selection-change events in the UI would be a separate, deliberate addition.
- Elapsed time is `finalizedAt − startedAt` as recorded, so it includes time on the page before the first interaction; a very short attempt can read "0 seconds" and "about 0.0 times the expected time" — accurate, if unglamorous.
- History is computed over all of a student's earlier finalized attempts (an unbounded V1 policy shared with mastery); a question outside the published DNA pool is excluded from history.
- Only `Percentages` content exists, so concept/family/cell history is shallow in practice; this unit proves the path, not its usefulness on a real bank.
- The evidence is not shown on the separate "what the system noticed" (autopsy) screen, which is unchanged and still has no hypothesis source.
- Real-database and browser verification are opt-in, on a disposable local container.

### What Unit 2 will build (and Unit 1 did NOT)

Unit 2 — **hypothesis generation + student confirmation / correction**: produce a real, always-`awaiting_confirmation` hypothesis (the existing `generateHypothesis()` / `autopsy-hypothesis` AI task, behind `@ipmat/ai`'s schema-validated `generateStructured()`, fed by exactly this evidence), present it as a hypothesis — never as a fact — and let the student confirm, reject or correct it through the existing `applyConfirmationResponse()`. Persisting a confirmed diagnosis and creating a RepairPlan are Unit 3. **None of this was started in Unit 1.**
