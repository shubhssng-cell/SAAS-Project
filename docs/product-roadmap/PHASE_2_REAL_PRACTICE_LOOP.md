# Product Phase 2 — Real Practice Loop

## Phase objective

From the master roadmap: *a real student can practice real published questions end-to-end against a real database.* Phase 2 is delivered as a sequence of small units. Only **Unit 1** has started.

## Unit status

| Unit | Scope | Status |
|---|---|---|
| 1 | Real published practice content foundation (dev/in-memory content path) | **COMPLETE** (this document) |
| 2 | Real question → timer → answer → submit | **COMPLETE** (below) |
| 3 | Real submission → result → explanation | **COMPLETE** (below) |
| 4 | Continuous next-question practice loop | **COMPLETE** (below) |
| 5+ | Not defined here yet — persistence/recovery, real database — **NOT STARTED** | NOT STARTED |

## Unit 1 — Real published practice content foundation

**Objective.** Remove the content blocker Phase 1's browser QA disclosed: the real dev wiring had no published training questions, so the real API correctly returned an empty recommendation and the student saw "Practice isn't available right now." Unit 1 is about content *availability*, not the practice loop.

**Root cause.** `createInMemoryDependencies()` (`apps/api/src/wiring.ts`) hardcoded `trainingQuestionReader` and `conceptReader` as empty stubs, and its `seed` parameter had no way to supply training-question or concept data. `npm run dev`/`start` seeded nothing. (The Prisma wiring was already correct; it reads whatever real rows exist.)

**Implementation (existing contracts only — no new architecture).**
- `apps/api/src/wiring.ts`: `seed` gained optional `trainingQuestions` / `concepts` maps (keyed by exam id), fed to the existing `InMemoryTrainingQuestionReader` / `InMemoryConceptReader`. Default is still genuinely empty (covered by a test).
- `apps/api/src/devContent.ts` (new, development-only): `buildDevContentSeed()` builds a deterministic set of **3 published questions**, all original/internal (no external, proprietary, or previous-year material; none claimed to be official IPMAT):
  - the two Phase 3.5 fixture candidates whose tier (advanced / standard) may publish without human review — run through the real `runGenerationPipeline()` via `FixtureProvider`, required to reach `validated`, checked with `assertCandidateIsImportable()`, then published by the real `decidePublication()` (via `InMemoryQuestionPublicationRepository.decide()`);
  - the repo's existing original demonstration question (already published by `packages/db/prisma/seed.ts`, provenance `original`), checked with `validateQuestionDna()`.
  - The five hard/extreme fixtures are **not** included: they require human review, which cannot honestly be claimed in this environment, so they stay unpublished. Publication rules were not weakened.
  - One source shape per question derives all three read models (`TrainingQuestionRecord`, `CanonicalQuestion`, `StudentQuestionRecord`) so they cannot disagree.
- `apps/api/src/index.ts`: the dev entry point seeds this content and logs that it is development-only.
- `apps/api/package.json` (+ lockfile): declares `@ipmat/ai`, `@ipmat/concept-graph`, `@ipmat/question-engine` — already-existing workspace packages the new file imports.
- `apps/web` is untouched: it still uses `createApiTrainingAdapter()` only; no fixture fallback, no frontend question data, no hardcoded id.

**Tests.** New `apps/api/test/devContent.test.ts` (10 tests): deterministic set with stable ids; every question published with complete Question DNA; student content never carries the answer key; all three read models agree on ids; hard tier still refused by `decidePublication()`; the training reader excludes an unpublished record; concept reader exposes the real concept; real-HTTP `POST /v1/recommendation` discovers a published question; the recommended question starts with student-safe content; an unseeded wiring is still empty.

**Validation results.**
- `apps/api`: 47/47 passing (37 existing + 10 new).
- Full repository: 1583/1583 passing across 165 files (was 1573).
- Typecheck: clean across all workspaces. Build: clean. Lint: clean. `git diff --check`: clean.

**Browser verification** (raw CDP / headless Edge, real `npm run start --workspace @ipmat/api` + `npm run dev --workspace @ipmat/web`, fresh disposable account): signup → onboarding → enrollment → dashboard → real click on "Start Practice" → `/practice/next` (no "Practice isn't available right now") → real click on "Continue to next question" → `/practice/dev-…` rendered a real published question with options and "Submit answer". 8/8 scripted checks passed; no JSON/diagnostics rendered. Submit/result/explanation/next were deliberately not exercised (later units).

**Known limitations.**
- **Development content only.** It exists in the in-memory wiring; a process restart rebuilds it, and it is not in any database. A deployed system still depends on real `Question`/`Provenance` rows through the Prisma readers, which remain never run against a live database.
- The two pipeline-derived questions were validated using `FixtureProvider` (deterministic fixtures), **not** a live model call; nothing here is presented as real-model output.
- Question ids are dev ids (`dev-…`); taxonomy-cell ids are derived deterministically, not real DB ids.
- Only one concept (Percentages) and 3 questions — enough to prove discovery, not a question bank (that is Phase 6).
- Recommendation currently picks among the 3 questions via the existing selection logic; no adaptive behavior was added or tuned.

## Unit 2 — Real question → timer → answer → submit

**Objective.** A student reaches a real published question through the existing API path, sees it with a running timer, chooses (or types) an answer, and submits it through the existing backend attempt lifecycle. The frontend stays presentation-only; the server decides correctness and time spent.

**What already worked (inspected, unchanged).** `QuestionPlayer` (multiple-choice toggle options with `aria-pressed`, typed-answer input with Enter-to-submit for option-less questions, Submit disabled until an answer exists and while submitting), `Timer`, `PracticeQuestionRoute` (student-safe failure copy, expired-session handling), and `createApiTrainingAdapter()`, whose `submitAnswer()` already sends only `{ questionId, chosenAnswer }` — `timeTakenSeconds` is intentionally discarded because the server derives time spent from its own attempt events (D-034).

**Real defects found and fixed (the only source changes).**
1. **Orphan attempts.** `PracticeApiService.startAttempt` creates a new attempt on every call, and React StrictMode double-invokes the mount effect, so every question view started two attempts (one left `in_progress`). New `apps/web/src/practice/singleFlight.ts` coalesces concurrent calls per question; `createApiTrainingAdapter()` uses it for `loadQuestion` (and `submitAnswer`). The browser run now shows exactly one `POST /v1/attempts`.
2. **Double submit.** The guard was React state only, which two same-tick clicks can both pass. `PracticeQuestionRoute` now also guards with a `useRef`, and the adapter coalesces concurrent submits. The browser run (two `click()` calls in one tick) sent exactly one `POST …/submit`.
3. **Timer drift.** The timer counted interval ticks, which browsers throttle in background tabs. It now shows whole seconds since the question was presented (`practice/elapsed.ts`, wall clock). Display only; still one interval, cleared on unmount/question change.

No API contract, adapter interface, backend, or dependency changed. No grading, mastery, autopsy, adaptive, or fixture logic entered `apps/web`; `createApiTrainingAdapter()` remains the only runtime adapter.

**Tests.** New `apps/web/test/practice/questionSubmission.test.ts` (17 tests): single-flight behavior; elapsed-time helper; timer interval/cleanup structure; adapter starts exactly one attempt for two concurrent loads; submit body contains only the answer + question id (no timing/correctness/student id); typed answer sent verbatim with correctness taken from the server response; concurrent submits → one request; failed submit and expired-session (401) handling; Submit disabled without an answer; option/typed-input behavior; ref-based duplicate guard; fixed student-safe error copy; no grading or domain/Prisma imports in the question path; production adapter unchanged. One existing structure test was updated for the new guard expression. (The repo has no DOM test library; component behavior is pinned by source-structure checks per existing convention, and by the browser run.)

**Validation.** apps/web 224/224 (was 207); full repository 1600/1600 across 166 files (was 1583); typecheck, build, lint, `git diff --check` clean.

**Browser verification** (raw CDP / headless Edge, real `apps/api` + `apps/web`, Unit 1 dev content, fresh account; network recorded via CDP): signup → onboarding → enrollment → dashboard → Start Practice → `/practice/next` → Continue → real question. 13/13 checks: one attempt started; timer visible and advancing (0:00 → 0:02); Submit disabled before selecting; 4 options; selected option `aria-pressed=true`; Submit enabled; same-tick double click sent exactly one `POST /v1/attempts/:id/submit`; no JSON/ids/diagnostics rendered. After submit the app navigated to the pre-existing Phase 1 result screen (server-graded; not touched or evaluated here).

**Known limitations.**
- **Typed-answer input not browser-verified.** All 3 dev questions are multiple choice, and no numeric-entry content was invented. That path is covered by structure tests and the adapter test only.
- The failure path (failed submit re-enabling controls) is covered by adapter/structure tests, not induced in the browser.
- The result screen reached after submit is Phase 1's; its `solutionSteps` remain empty and it loses state on hard refresh — Unit 3+ territory.
- Refreshing a question page still starts a fresh attempt (no recovery of an in-progress attempt) — a later unit.
- The displayed timer restarts at page load, while the server's clock starts when the attempt is created; server time is authoritative.

## Unit 3 — Real submission → result → explanation

**Objective.** After submitting a real question, the student sees a clear, student-safe result — correct/incorrect, their answer, the correct answer, the question, and the authored worked solution — all from the real API path. No next-question loop (Unit 4).

**What already worked (inspected).** Submit → server-graded result (`isCorrect`, `correctAnswer`, server-derived time) → `ResultScreen` with a solution toggle, and `GET /v1/attempts/:id/result` already existed in `@ipmat/practice-api`/`apps/api` (ownership-checked, submitted-only answer key) but the web adapter never used it.

**What was actually missing.**
1. **No explanation data reached the student.** `AttemptResultView` had no solution field; the real adapter hard-coded `solutionSteps: []`, so the solution control never appeared. The authored steps already exist in the content model (`Question.solutionSteps`; the dev fixtures/demo carry them) but were not readable server-side.
2. **No question context on the result** (a refreshed result would be a bare verdict).
3. **Result lost on hard refresh** (Unit 2 limitation).

**Implementation.**
- `@ipmat/db`: `CanonicalQuestion` (the server-side, answer-key-bearing model) gained optional `solutionSteps`; `PrismaQuestionReader` maps the Json column, accepting only a non-empty array of strings (else `null` — never coerced). The student-facing `StudentQuestionRecord` is unchanged and still excludes solutions.
- `@ipmat/practice-api`: `AttemptResultView` gained `solutionSteps: string[]` and `question: { prompt, chapterName, conceptName } | null`. Both are populated **only for `status === "submitted"`** (same rule as `correctAnswer`), in `submitAttempt()` and `getAttemptResult()`, resolved from the attempt's own `questionId`. `startAttempt()` exposes neither. A skip reveals none.
- `apps/api/src/devContent.ts`: the dev canonical questions carry their authored `solutionSteps` (from the same fixtures/demo content — nothing written for this unit).
- `apps/web`: adapter maps `solutionSteps`/`question`, validates that a result is renderable (ids, boolean verdict, both answers) and rejects otherwise; new `getAttemptResult(attemptId)` uses the existing endpoint. Submit now navigates to `/practice/:questionId/result?attempt=<id>` (new `practice/resultLocation.ts`); `PracticeResultRoute` shows the in-session result if it is that attempt, else fetches it by id, with loading, retry/back error, and expired-session states, and refuses a result whose question differs from the route's. `ResultScreen` shows the question and hides the solution control when there are no steps. The fixture adapter got the matching (test-only) fields.
- Route shape unchanged (only a query parameter added), so this was a small fix rather than the route redesign the old comment feared. The attempt id in the URL is opaque and useless to anyone but the owner (server re-checks ownership; verified 403 for another student).
- No grading, mastery, autopsy, adaptive or fixture-runtime logic entered `apps/web`; `createApiTrainingAdapter()` is still the only runtime adapter. No dependency changes.

**Tests (new).** `packages/practice-api/test/resultReveal.test.ts` (6: revealed on submit and on re-read; absent from `startAttempt`; none for a skip; empty when none stored; attempt's own question decides), `packages/db/test/repositories/prismaQuestionReaderSolution.test.ts` (6 mapping cases), two new HTTP tests in `apps/api/test/devContent.test.ts` (solutions present in dev content; submit → graded result with solution + question, re-read equals submit response, another student gets 403 with nothing leaked, nothing leaked before submission), and `apps/web/test/practice/resultFlow.test.ts` (23: real `react-dom/server` renders of `ResultScreen` for correct/incorrect/with-solution/no-solution/no-question; result-URL helpers; adapter mapping, malformed/skipped/404/401/network failures; route boundary checks).

**Validation.** apps/web 247/247 (was 224); full repository 1637/1637 across 169 files (was 1600); typecheck, build, lint and `git diff --check` clean.

**Browser verification** (raw CDP / headless Edge, real `apps/api` + `apps/web`, Unit 1 dev content, fresh account): 15/15 checks. Signup → onboarding → enrollment → dashboard → Start Practice → question → picked an option → **Correct.** (answer shown, no redundant correct-answer row, question prompt shown) → "View solution" showed the 3 authored steps (`aria-expanded=true`) → **hard refresh** re-read the result via `GET /v1/attempts/:id/result` and showed the same verdict/answer → same question again with a wrong option → **Not quite.** with Your answer 5.5 and Correct answer 5 → unknown attempt id shows the student-safe "We couldn't load this result." with Try again / Back to dashboard and no ids/JSON → result URL with no attempt id shows "This result isn't available anymore." → clearing cookies then refreshing on the result URL redirected to `/login` with no result shown.

**Known limitations.**
- **Explanation = the stored worked solution only.** The model-written `explanation` field from the generation pipeline is not persisted anywhere (no column), so there is no separate "why" prose; nothing was invented or hardcoded.
- A question with no stored solution shows the result without a solution control (covered by tests; every dev question has steps, so not seen in the browser).
- The "unavailable result" and "network error" cases share one error screen (the transport layer maps every non-401 failure to one kind); the offline/timeout branch is unit-tested, not induced in the browser.
- Dev StrictMode fires the result read twice on a refresh (idempotent GET; the attempt-start duplicate was fixed in Unit 2).
- "Time taken" reflects the server's attempt clock, so scripted instant answers show 0s.
- The Autopsy screen and the Continue button's next-question behavior are unchanged Phase 1 behavior — Unit 4+.
- Still dev/in-memory content; Prisma readers (including the new solution mapping) are unit-tested against a fake client, never a live database.

## Unit 4 — Continuous next-question practice loop

**Objective.** Question → Submit → Result → Explanation → **Continue → Practice Next → a NEW real question** → … repeatedly, with every next question resolved through the existing recommendation API path and no selection logic in the frontend. Transport/UI loop only — no adaptive work.

**What already worked (inspected).** The skeleton was in place from Phase 1: the result screen's Continue → `/practice/next` → `PracticeNextRoute` → `adapter.getNextRecommendation()` → `POST /v1/recommendation` → recommendation card → `/practice/:recommendedId` → `PracticeQuestionRoute` → a fresh attempt. Loading / unavailable / retryable-error / expired-session screens for `/practice/next` also already existed (Phase 1 Units 9 and 11), as did per-question state reset (the player's effect is keyed on the question id) and browser back/forward (plain pushState routes). No routing change was needed.

**Gaps found and fixed (the only source changes).**
1. **Continue label.** The result screen's action was a bare "Continue"; it now reads "Continue to next question".
2. **Duplicate recommendation requests.** StrictMode's double mount (and any double activation) fired two `POST /v1/recommendation` calls when resolving the next question. `createApiTrainingAdapter()` now coalesces concurrent recommendation reads with the Unit 2 single-flight helper (dashboard and `/practice/next` both benefit). Sequential calls still each ask the server afresh — every Continue gets a fresh recommendation.
3. **Malformed recommendation read as "nothing available".** A non-object body or a missing/odd `questionId` silently became `questionId: null` and showed "Practice isn't available right now." `readRecommendation()` now treats anything other than a non-empty string or an explicit `null` as a malformed response and rejects, so the student gets the retryable error screen instead of a false empty state.
4. **Duplicate Continue.** Both Continue actions (result → next, recommendation card → question) now have an explicit once-only guard (a ref, re-armed when the route/attempt/recommendation changes) on top of the router's existing same-path no-op.
5. **Result bleed.** The result route reused any remembered result for the same question id when the URL had no attempt id. It now shows a remembered result only for the exact attempt the URL names, so a result from an earlier pass over a question can never appear for a later one.

No API, backend, contract, or dependency change. No selection, ranking, randomization, adaptive, mastery, autopsy or fixture logic entered `apps/web`; `createApiTrainingAdapter()` remains the only runtime adapter; no question id is hardcoded anywhere in the practice path.

**Next-question flow.** Result → Continue (once) → `/practice/next` (loading → one `POST /v1/recommendation`) → recommendation card → Continue to next question (once) → `/practice/<id the server named>` → one `POST /v1/attempts` (a brand-new attempt, even if the server names a question seen before) → fresh player (nothing selected, Submit disabled, timer at 0:00) → submit → that attempt's own result. The intermediate card is Phase 1's deliberate one-click confirmation; it was kept (the student consciously continues; the brief lists "Practice Next" as a step).

**Tests (new).** `apps/web/test/practice/continuousLoop.test.ts` (25): next recommendation via `POST /v1/recommendation` each time and the server's id used as-is; concurrent resolution → one request; the same question recommended again is honored; a two-question loop creating two independent attempts, each submitted to its own attempt id; a repeated question getting a new attempt; `questionId: null` → unavailable outcome; 5 malformed shapes reject; failure → retry runs a new request; 401 → expired session; network failure; result screen shows "Continue to next question"; once-only guards on both Continue actions; loading/unavailable/retry/expired states present; player state and timer reset per question; exact-attempt result matching; no hardcoded ids, no selection/adaptive/mastery/random/domain imports in the practice path (comments excluded); production adapter unchanged.

**Validation.** apps/web 272/272 (was 247); full repository 1662/1662 across 170 files (was 1637); typecheck, build, lint and `git diff --check` clean.

**Browser verification** (raw CDP / headless Edge, real `apps/api` + `apps/web`, Unit 1 dev content, fresh account): 33/33 checks. Four consecutive rounds of question → answer → submit → result → Continue → `/practice/next` → Continue → next question. Each round: a real question with fresh state (no option pressed, Submit disabled, timer 0:00); exactly one attempt started and one submit sent; the result showed that question's own prompt (no bleed); double-clicking Continue in the same tick added one history entry and sent exactly ONE `POST /v1/recommendation`; resolving a recommendation started no attempt; double-clicking the card's Continue started exactly one new attempt. The explanation ("View solution", 3 steps) rendered on round 1. Forcing `/v1/recommendation` responses through CDP `Fetch` interception (the real UI, a simulated server answer — the server itself was never made to fail): `questionId: null` → "Practice isn't available right now." + Back to dashboard; HTTP 500 → student-safe error with Try again + Back to dashboard, no message/stack leaked, and Try again recovered to a real recommendation; a malformed body → the error screen (not "nothing available"); 401 → "Your session has expired." + Log in; Continue from a result while nothing is recommendable → the unavailable screen, no dead end.

**What the real recommendation actually did.** With the 3 dev questions the existing backend recommended, in order: percentage-point question → successive-percentage question → population/reverse question → the percentage-point question again. So the server's own coverage-based selection visits each dev question before repeating; this unit adds no guarantee of "different every time" (with 3 questions it necessarily repeats after 3), and the frontend neither enforces nor fakes uniqueness.

**Known limitations.**
- A repeat is possible/expected once the small dev pool is exhausted; uniqueness and adaptivity are backend/content concerns (later phases).
- Browser Back from a question to a result/recommendation works, but going Back to an already-submitted `/practice/:id` starts a fresh attempt (no in-progress/finished attempt recovery) — a persistence unit's concern.
- `questionsPracticedSoFar` remains the adapter instance's session-local count.
- Error/empty/expired states for the next-question step were forced by interception (see above); the server was never actually made to fail or expire mid-run.
- Autopsy/Continue-after-autopsy behavior is unchanged Phase 1 behavior and is never reached with real data.
- Still dev/in-memory content and repositories.

**Unit 5+ status: NOT STARTED.**
