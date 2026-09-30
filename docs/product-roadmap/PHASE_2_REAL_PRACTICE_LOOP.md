# Product Phase 2 — Real Practice Loop

## Phase objective

From the master roadmap: *a real student can practice real published questions end-to-end against a real database.* Phase 2 is delivered as a sequence of small units. Only **Unit 1** has started.

## Unit status

| Unit | Scope | Status |
|---|---|---|
| 1 | Real published practice content foundation (dev/in-memory content path) | **COMPLETE** (this document) |
| 2 | Real question → timer → answer → submit | **COMPLETE** (below) |
| 3+ | Not defined here yet — result/explanation, next-question loop, persistence/recovery, real database — **NOT STARTED** | NOT STARTED |

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

**Unit 3+ status: NOT STARTED.**
