# Product Phase 2 — Real Practice Loop

## Phase objective

From the master roadmap: *a real student can practice real published questions end-to-end against a real database.* Phase 2 is delivered as a sequence of small units. Only **Unit 1** has started.

## Unit status

| Unit | Scope | Status |
|---|---|---|
| 1 | Real published practice content foundation (dev/in-memory content path) | **COMPLETE** (this document) |
| 2+ | Not defined here yet — timer, submission/result/explanation/next-question loop, persistence/recovery, real database — **NOT STARTED** | NOT STARTED |

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

**Unit 2+ status: NOT STARTED.**
