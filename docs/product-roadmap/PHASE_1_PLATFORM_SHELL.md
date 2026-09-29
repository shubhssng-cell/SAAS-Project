# Product Phase 1 — Platform Shell

Status: **NOT STARTED** as a product phase. This file is the authoritative execution specification. No implementation work has begun under this phase's numbering as of 2026-09-29.

## Objective

Turn the existing engineering foundation into a real student-facing IPMAT product shell. At the end of this phase, a student should be able to go:

```
Landing
  -> Sign up / Login
  -> Onboarding
  -> IPMAT enrollment
  -> Dashboard
  -> Start Practice
  -> Enter the practice experience
```

as one coherent application, not a collection of disconnected demos.

## Architecture rule (binding for every unit in this phase)

```
Student UI
  -> application/API boundary
  -> existing application/domain services
  -> repositories
  -> database
```

The frontend must **not** implement:
- adaptive decisions
- grading
- authoritative timing
- mastery calculations
- training-system ranking
- publication rules

All of the above already exist as domain/application logic (`@ipmat/practice-api`, `@ipmat/training-recommendation`, `@ipmat/practice-loop`, `@ipmat/attempt`, `@ipmat/mastery`, `@ipmat/training-orchestration`, etc.) or, where they don't yet have a real caller, must be reached through that boundary once one exists — never reimplemented client-side. This is a restatement of CLAUDE.md's module-boundary rule and [../ARCHITECTURE.md](../ARCHITECTURE.md) §6, applied to this phase specifically.

## Phase 1 should include

- Landing page
- Application shell
- Routing
- Navigation
- Authentication foundation
- Signup / login / logout
- Onboarding
- IPMAT enrollment
- Dashboard
- Practice entry
- Design system foundation
- Responsive behavior
- Loading states
- Empty states
- Error states
- Security foundations
- Thin API/application integration where required

## Phase 1 must NOT become

- New adaptive-selection algorithms
- New training providers
- AI question generation
- The full Autopsy loop (confirm/correct UI is Product Phase 4)
- Massive content-generation work
- Mocks
- Revision system
- Overtraining
- Parent dashboard
- WhatsApp
- Voice
- Social/community features
- Payments
- Multi-exam expansion
- Native mobile applications
- B2B platform

## Current state (audited 2026-09-29, against the actual repository — not against the engineering plan's intentions)

### Existing reusable foundation

- **`apps/web`** (Vite + React + TypeScript) exists and runs, but it is a single-file-flow internal demo, not a platform shell:
  - `App.tsx` owns one linear screen-state machine: `loading → dashboard → question → result → autopsy → next`. There is no router, no distinct routes/URLs for these screens, no landing page, no auth screens, no onboarding, no enrollment flow.
  - It talks to a `TrainingRecommendationAdapter` interface (`src/adapter/*`) via `createFixtureTrainingAdapter()` — a **fixture-backed adapter**, not a real HTTP client. Per `App.tsx`'s own doc comment, swapping in a real, persistence-backed adapter implementing the same interface is meant to be the only change needed later — no component below `App.tsx` should need to change for that swap.
  - Components present: `Dashboard`, `QuestionPlayer`, `ResultScreen`, `AutopsyCard`, `NextTrainingCard`, `RecommendationCard`, `Timer`. These are real, working UI for the practice/result/autopsy loop, but scoped to that loop only — nothing for landing/auth/onboarding/enrollment.
  - No authentication of any kind — no login screen, no session/token handling, no identity concept in the UI at all.
  - Has its own `vitest`-based test (`test/service.test.ts`) and a `dist/` build output already checked in, confirming the app builds today.

- **`apps/api`** (`node:http`, no framework) exists per Engineering Phase 5I:
  - Routes: `POST /v1/recommendation`, `POST /v1/attempts`, `POST /v1/attempts/:id/submit`, `POST /v1/attempts/:id/skip`, `GET /v1/attempts/:id/result`, `GET /v1/attempts/:id/autopsy`.
  - Delegates all business logic to `@ipmat/practice-api`'s `PracticeApiService` — the transport file itself is deliberately logic-free.
  - **No auth middleware.** `studentId`/`enrollmentId` are accepted as plain, unauthenticated request fields (`StudentRequestClaim`) — explicitly documented in `server.ts` as the same trust boundary the domain layer already has as function parameters, not a new gap introduced by this transport, but also explicitly not a real auth story. D-004 (auth provider choice) is still open.
  - Wiring (`wiring.ts`) constructs only in-memory dependencies today — **no live database is wired in**, consistent with the rest of the repo (no Postgres instance has ever been reachable in this environment across any engineering phase).
  - `apps/web` does **not** call `apps/api` today — the two exist side by side, unconnected. Wiring that connection is explicitly Phase 1 Unit 10 below, not assumed done.

- **`@ipmat/practice-api`** (`packages/practice-api`) is a real, tested, framework-agnostic application service sitting in front of `@ipmat/training-recommendation` and `@ipmat/practice-loop`, with its own error/validation/presentation layers. This is the correct thing for a real `apps/web` to eventually call through `apps/api`.

- Underlying domain capability (all real, tested, but proven only via `FixtureProvider`/in-memory doubles — never a live database or live AI provider call, per [../MASTER_PLAN.md](../MASTER_PLAN.md)'s "Current state"): concept graph, Examiner Lens, Question Engine (one published demo question), the full AI generation pipeline, attempt lifecycle, autopsy (observation → evidence → hypothesis → confirmed diagnosis), mastery engine, repair selection, adaptive selection, training orchestration, five concrete training-system providers, practice session/block foundation, training recommendation composition, the application/API boundary itself.

### Important dependencies / blockers for this phase

- **No live database has ever been reachable in this environment.** Every persistence adapter (`PrismaAttemptRepository`, the Phase 5C-1 repositories, `QuestionImportRepository`, etc.) is built and tested only against in-memory doubles. A real Platform Shell (signup, login, enrollment, dashboard reflecting real data) needs a reachable Postgres instance — this is a blocker for Units 4–10 below reaching a genuinely real (non-fixture) state, though the shell's structure, routing, and design system (Units 1–3, 11) do not require it.
- **Auth (D-004) is explicitly still open.** No provider has been chosen. Unit 4 (Authentication architecture) is where this decision must actually be made for Phase 1 to proceed past a stub — it cannot stay deferred once Phase 1 reaches signup/login.
- **Only one question is published** in the entire system (Phase 3.5's coverage-expansion work reached `validated`/`review_required`, not `published`, for its 7 fixture candidates). Practice entry in this phase can wire to real content, but real content is extremely thin — this is a known, pre-existing content gap, not something this phase is expected to fix (filling it is Product Phase 6).
- **`apps/web`'s fixture adapter is the thing Unit 10 replaces** — until then, everything upstream of it (Units 1–9) can be built and demonstrated against the fixture adapter's existing shape, same as today.

### Known architectural boundaries (binding, not just descriptive)

- `packages/domain/*` must never import Next.js, a Prisma client, or a concrete AI provider directly ([../ARCHITECTURE.md](../ARCHITECTURE.md) §6).
- All AI calls go through `@ipmat/ai`'s `generateStructured()` with a Zod schema — Phase 1 introduces no new AI call sites at all (no AI features are in scope for this phase).
- `apps/web` may only reach domain/application logic through `apps/api` / `@ipmat/practice-api`'s public contract — never by importing a domain package directly.

### Current Unit

**Current Unit: Unit 1 — audit complete (2026-09-29), see "Unit 1 audit findings" and "Web Architecture Lock" below. Unit 2 is defined and ready to start, but not yet begun.**

## Phase 1 unit plan

Each unit below is documented only at the level of objective / expected student-visible outcome / dependencies / acceptance criteria — deliberately not prescribing implementation details that would lock in choices (e.g. which router, which design-system approach, which auth provider) ahead of the decisions those units themselves exist to make.

### Unit 1 — Audit current `apps/web` and lock the existing product-shell foundation
- **Objective:** Establish, in writing, exactly what of the existing `apps/web` demo is reusable foundation vs. what must be restructured for a real product shell.
- **Expected student-visible outcome:** None yet — this is an audit unit.
- **Dependencies:** None.
- **Acceptance criteria:** This document's "Current state" section (above) is accurate against the real repository at the time Unit 1 is closed; any discrepancy found is recorded, not silently fixed by rewriting history.

### Unit 2 — Application shell + routing

**Objective:** Introduce real, addressable routes/URLs for the top-level product areas (landing, auth, onboarding, enrollment, dashboard, practice), replacing the single in-memory `Screen` union in `App.tsx` — purely a navigation/shell restructuring, not a rebuild of what already works inside the practice loop.

**Screens/routes involved:**
- `/` — landing (new; does not exist today)
- `/login`, `/signup` — auth screens (new shells only; no real auth logic — that is Units 4–5)
- `/onboarding` — onboarding shell (new; no real onboarding content — that is Unit 6)
- `/enroll` — enrollment shell (new; no real enrollment logic — that is Unit 7)
- `/dashboard` — reuses the existing `Dashboard` component, now reached by URL instead of initial screen state
- `/practice/:questionId`, `/practice/:questionId/result`, `/practice/:questionId/autopsy`, `/practice/next` — reuse the existing `QuestionPlayer` / `ResultScreen` / `AutopsyCard` / `NextTrainingCard` components, now reached by URL instead of `useState<Screen>` transitions

**Student-visible outcome:** Each top-level area has its own URL and is reachable by direct navigation and browser back/forward, even though most screens besides dashboard/practice still render placeholder or minimal content at the end of this unit. The already-working dashboard → question → result → autopsy → next flow keeps working exactly as it does today, just reached through routes instead of local screen state.

**Dependencies:** Unit 1 (this audit).

**Acceptance criteria:**
- Deep-linking directly to any top-level route works (no route requires passing through `/` first).
- Browser back/forward moves between screens correctly.
- The existing practice/result/autopsy loop still renders and still round-trips through the (still fixture-backed) adapter unchanged.
- No route performs any authentication check, calls a domain package directly, or bypasses `TrainingRecommendationAdapter` — this unit only changes how a screen is reached, never what decides its content.

**Explicit exclusions for Unit 2** (each is scoped to its own later unit — do not pull any of it forward):
- Authentication / session logic (Unit 4–5)
- Signup/login form submission logic (Unit 5)
- Onboarding content/logic (Unit 6)
- IPMAT enrollment logic (Unit 7)
- Dashboard business logic (already exists via the adapter — Unit 2 does not change it)
- Real API integration (Unit 10)
- Any adaptive/orchestration logic (already exists server-side/adapter-side — Unit 2 does not touch it)
- Payments (out of scope for all of Phase 1)

### Unit 3 — Design system foundation
- **Objective:** Establish a minimal, consistent visual/component foundation (tokens, base components) the rest of the shell builds on.
- **Expected student-visible outcome:** A coherent visual identity across the new routes, replacing ad hoc per-component styling.
- **Dependencies:** Unit 2.
- **Acceptance criteria:** Landing, auth, dashboard, and practice screens visibly share the same design language; no route looks like an unstyled fixture demo.

### Unit 4 — Authentication architecture
- **Objective:** Make the real D-004 decision (auth provider/approach) and establish the technical foundation for it (session/token handling, how `apps/api` will authenticate a request going forward).
- **Expected student-visible outcome:** None directly yet — this is the architectural foundation Unit 5 builds the visible flow on.
- **Dependencies:** Unit 2.
- **Acceptance criteria:** D-004 is resolved and recorded in [../DECISIONS.md](../DECISIONS.md) (not left open); a concrete mechanism exists for `apps/api` to derive a trusted identity from a request, replacing today's unauthenticated `StudentRequestClaim` fields.

### Unit 5 — Signup / Login / Logout
- **Objective:** Implement real signup, login, and logout using the Unit 4 foundation.
- **Expected student-visible outcome:** A student can create an account, log in, and log out.
- **Dependencies:** Unit 4.
- **Acceptance criteria:** A new student can sign up and immediately reach an authenticated state; a returning student can log in; logout actually terminates the session; unauthenticated access to post-login routes is rejected/redirected.

### Unit 6 — Onboarding
- **Objective:** Build the first-run onboarding sequence between signup and dashboard.
- **Expected student-visible outcome:** A newly-signed-up student is guided through onboarding before reaching the dashboard for the first time.
- **Dependencies:** Unit 5.
- **Acceptance criteria:** Onboarding appears exactly once for a new student (not on every login); its output is real state the rest of the product can read (not a UI-only formality).

### Unit 7 — IPMAT enrollment
- **Objective:** Establish a real `Enrollment` for the student against the existing domain model (calendar-awareness / `computePrepPhase` inputs already exist per Engineering Phase 1 — this unit wires a real UI to real enrollment creation, it does not redesign enrollment).
- **Expected student-visible outcome:** The student explicitly enrolls in IPMAT (and implicitly establishes their prep-phase timeline) before reaching a populated dashboard.
- **Dependencies:** Unit 6.
- **Acceptance criteria:** A real `Enrollment` record results from this flow (once Unit 10's real wiring exists — may be stubbed/fixture-backed before that, but must not silently invent a fake enrollment client-side); enrollment date is recorded correctly for later `computePrepPhase` use.

### Unit 8 — Dashboard
- **Objective:** Build the real product dashboard the student lands on after enrollment/login.
- **Expected student-visible outcome:** A coherent home screen showing the student's current state and a clear path to practice.
- **Dependencies:** Unit 7.
- **Acceptance criteria:** Dashboard content reflects the identity/enrollment established in prior units (not hardcoded); a clear, single primary call-to-action leads into practice entry.

### Unit 9 — Practice entry
- **Objective:** Build the transition from dashboard into the practice experience.
- **Expected student-visible outcome:** Clicking "start practice" (or equivalent) takes the student into the existing `QuestionPlayer` flow.
- **Dependencies:** Unit 8.
- **Acceptance criteria:** Entry point is reachable from the dashboard; the existing practice/result/autopsy screens (already built) are reached through real navigation, not the old ad hoc screen-state machine.

### Unit 10 — Thin real API/client integration
- **Objective:** Replace `apps/web`'s `createFixtureTrainingAdapter()` with a real adapter calling `apps/api`'s existing `/v1/*` routes (and any new routes Units 4–9 required, e.g. auth/enrollment), per `App.tsx`'s own documented swap contract.
- **Expected student-visible outcome:** The product now reflects real (or at least really-persisted-where-a-database-is-reachable) state end to end, not fixture data.
- **Dependencies:** Units 2–9 (needs real routes to exist on both sides first).
- **Acceptance criteria:** No component below `App.tsx` needed to change, per the existing adapter-swap design; every screen that previously showed fixture data now round-trips through `apps/api` → `@ipmat/practice-api`; explicitly known gap (a live database) is called out honestly if still unresolved at this point, not papered over with a silent fixture fallback.

### Unit 11 — Responsive / loading / empty / error / accessibility hardening
- **Objective:** Make the whole shell (Units 2–10) behave correctly under real-world conditions: small screens, slow/failed network calls, no data yet, and basic accessibility.
- **Expected student-visible outcome:** The product doesn't break or look broken on mobile widths, on a slow connection, with no data, or on a failed request.
- **Dependencies:** Unit 10.
- **Acceptance criteria:** Every route has an explicit loading state, an explicit empty state (where applicable), and an explicit error state (not a blank screen or unhandled exception); core flows are usable at common mobile viewport widths; basic keyboard/screen-reader accessibility is verified, not assumed.

### Unit 12 — Browser QA + final hardening + documentation + Git checkpoint
- **Objective:** Close out Phase 1 — manual browser QA of the full landing → practice journey, final fixes, documentation update, and a clean Git checkpoint.
- **Expected student-visible outcome:** The full journey works end to end, in a real browser, without a developer narrating around gaps.
- **Dependencies:** Unit 11.
- **Acceptance criteria:** Tests/typecheck/lint/build all pass; the full journey (landing → signup/login → onboarding → enrollment → dashboard → start practice → practice experience) has been manually exercised in a real browser and confirmed working; this file's "Current state" and "Execution Log" sections are updated to reflect what actually shipped; a Git checkpoint (commit) captures the completed phase.

## Unit 1 audit findings (2026-09-29)

### Audited apps/web architecture, as it actually is

- **Entry point:** `src/main.tsx` mounts `<App />` into `#root`, no providers, no router library installed (no `react-router` or equivalent in `package.json`).
- **Screen/state model:** `App.tsx` owns a single `useState<Screen>` discriminated union (`loading | dashboard | question | result | autopsy | next`) and transitions between them via plain function calls (`startQuestion`, `refreshDashboard`, `handleAnswerSubmit`, `handleSeeWhatHappened`, `handleAutopsyResponse`, `handleContinueAfterResult`). There are no URLs for any of these states — refresh always returns to `loading → dashboard`.
- **Adapter layer** (`src/adapter/`): `types.ts` defines `TrainingRecommendationAdapter`, a clean, student-safe interface (`getDashboard`, `loadQuestion`, `submitAnswer`, `getAutopsy`, `respondToAutopsy`, `getNextRecommendation`) that already matches the shape `@ipmat/practice-api` independently converged on (see "Important discovery" below). `service.ts`'s `createFixtureTrainingAdapter()` is the only implementation today.
- **Presentation/view-model layer** (`src/adapter/presentation.ts`): `toRecommendationViewModel()` and `describeObservations()` translate raw domain output into plain student-facing strings — never expose provider ids, action types, or raw evidence structures to components.
- **Fixtures** (`src/adapter/fixtures.ts`, 202 lines): two hand-authored questions (`q-reverse-1`, `q-percentage-repair-1`, plus a non-trap `q-direct-1` used in tests) with full Question DNA, attempt context, solution steps, and a canned AI hypothesis output. Clearly synthetic, clearly labeled as a stand-in.
- **Components** (`src/components/`): `Dashboard`, `QuestionPlayer`, `ResultScreen`, `AutopsyCard`, `ConfirmationPrompt`, `NextTrainingCard`, `RecommendationCard`, `Timer`. Each is a small, focused, presentational component driven entirely by adapter view models — none imports a domain package directly, none makes its own decisions. This part of the UI is genuinely reusable.
- **Styling:** one hand-authored `styles.css` (497 lines), no CSS framework/design-system library. Token-like CSS custom properties are used informally (e.g. `var(--ink-faint)`) but there is no formal design-token file.
- **Assets/fonts:** none — no `public/` directory, no custom fonts, no image assets.
- **Config/env:** `apps/web` has no `.env`/config file of its own; the repo root's `.env.example` only defines `ANTHROPIC_API_KEY` (irrelevant to the frontend). `vite.config.ts` hardcodes dev port `5184`, no API base URL configuration exists anywhere.
- **Scripts:** `dev`, `build` (`tsc --noEmit && vite build`), `typecheck`, `preview` — standard, nothing unusual.
- **Tests:** one file, `test/service.test.ts` (75 lines), which deliberately proves the fixture adapter is "a thin wiring layer over the REAL domain packages, not a second decision engine" — i.e. it verifies that `createFixtureTrainingAdapter()`'s output is whatever `orchestrateNextTrainingAction()`/`buildRepairPlan()`/etc. actually produced, never a value the adapter invented itself.
- **Build configuration:** standard Vite + `tsc`; `apps/web/dist/` is checked in from a prior build, confirming the app builds today.

### Important discovery: `apps/web`'s adapter currently bypasses the application/API boundary entirely

`apps/web/package.json` depends directly on `@ipmat/ai`, `@ipmat/attempt`, `@ipmat/autopsy`, `@ipmat/mastery`, and `@ipmat/training-orchestration` — and `src/adapter/service.ts` imports and calls real domain-package functions in the browser: `startAttempt`/`recordAttemptEvent`/`submitAttempt` (`@ipmat/attempt`), `buildAutopsyOutput`/`generateHypothesis`/`confirmHypothesis`/`rejectHypothesis`/`buildRepairPlan` (`@ipmat/autopsy`), `computeMasteryState` (`@ipmat/mastery`), `orchestrateNextTrainingAction` (`@ipmat/training-orchestration`), and even instantiates a `FixtureProvider` from `@ipmat/ai` to stand in for a live AI call.

This is a **deliberate, well-documented, temporary scope decision** for the current fixture-driven vertical slice (the adapter's own doc comment explains this stands in for a not-yet-built Training Recommendation Composition Layer, and `TrainingRecommendationAdapter`'s interface was designed so only the factory function needs to change later). It is not an accident and does not need to be treated as a bug — but it is a real, current violation of the target architecture ("Student UI → application/API boundary → ... → database") stated at the top of this document and in CLAUDE.md's module-boundary rule, and it must not be extended or copied forward into new work. It also explains why `apps/web`'s `package.json` currently has direct domain-package dependencies that a real product shell must not have.

**A second, favorable discovery narrows the gap this creates:** `@ipmat/practice-api` (`packages/practice-api/src/types.ts`, `presentation.ts`) already independently converged on the *same* student-facing shapes `apps/web`'s adapter uses — `RecommendationView`/`toRecommendationView()` is structurally and even textually near-identical to the adapter's `RecommendationViewModel`/`toRecommendationViewModel()` (same `PROVIDER_COPY` table, same fields), and `StudentQuestionView`/`AttemptResultView`/`PendingAutopsyView` map cleanly onto `QuestionViewModel`/`AttemptResultViewModel`/`AutopsyViewModel`. This means Unit 10's eventual swap to a real adapter calling `apps/api` is more mechanical than it might appear — the target shapes already exist and were designed with this exact swap in mind, they are just not wired to `apps/web` yet.

### Relevant contracts inspected (practice-api / apps/api)

- `packages/practice-api/src/types.ts` / `presentation.ts`: confirmed the server-side view shapes above.
- `apps/api/src/server.ts`: confirmed the 6 existing HTTP routes (`POST /v1/recommendation`, `POST /v1/attempts`, `POST /v1/attempts/:id/submit`, `POST /v1/attempts/:id/skip`, `GET /v1/attempts/:id/result`, `GET /v1/attempts/:id/autopsy`), that it is a pure, logic-free transport over `PracticeApiService`, and that it has no auth middleware (`StudentRequestClaim` fields are accepted unauthenticated, consistent with D-004 remaining open).
- No unrelated backend packages were inspected beyond what `apps/web` and these two directly touch, per this unit's scope.

### Classification

| Area | Classification | Why |
|---|---|---|
| App entry (`main.tsx`) | KEEP | Minimal, correct, framework-idiomatic; nothing to change. |
| Current layout (`App.tsx`'s screen shell/header) | KEEP WITH MODIFICATION | The visual shell (header/wordmark/`app-main`) is fine; the screen-selection mechanism inside it must become route-driven. |
| Navigation | REPLACE | There is none today beyond local function calls — a real router is needed for Unit 2. |
| Routing/state model (`useState<Screen>` union) | REPLACE | Must become URL-addressable routes; the underlying transition logic (which screen follows which) is sound and can inform route design, but the mechanism itself must change. |
| Dashboard (`Dashboard.tsx`) | KEEP | Presentational, adapter-driven, no changes needed for Phase 1 routing/shell work. |
| Question UI (`QuestionPlayer.tsx`, `Timer.tsx`) | KEEP | Same — clean, adapter-driven, reusable as-is. |
| Result UI (`ResultScreen.tsx`) | KEEP | Same. |
| Autopsy UI (`AutopsyCard.tsx`, `ConfirmationPrompt.tsx`) | KEEP | Same — and already correctly enforces the observation/hypothesis/confirmation separation CLAUDE.md requires. |
| Adapter layer — interface (`adapter/types.ts`) | KEEP | `TrainingRecommendationAdapter` is exactly the right seam; no change needed even after the Unit 10 swap. |
| Adapter layer — implementation (`adapter/service.ts`, fixture-backed, direct domain imports) | DEFER | Correct and useful until Unit 10; must not be extended with new domain-package calls in the meantime, and is explicitly replaced (not modified) by Unit 10, not by this phase's earlier units. |
| Presentation mapping (`adapter/presentation.ts`) | KEEP | Reusable translation logic; already has a near-identical server-side counterpart in `@ipmat/practice-api` for Unit 10 to converge on. |
| Styling (`styles.css`) | KEEP WITH MODIFICATION | Usable foundation; needs to become an explicit design-system/token layer under Unit 3, not a rewrite from scratch. |
| Reusable components (all of `src/components/`) | KEEP | Genuinely presentational, adapter-driven, no direct domain/backend imports — safe to reuse unchanged through the rest of Phase 1. |
| Assets/fonts | DEFER | None exist; Unit 3 introduces them if the design system needs any. |
| Fixtures (`adapter/fixtures.ts`) | DEFER | Correct and necessary until Unit 10 provides real content; not touched by Units 2–9. |
| API integration | MISSING (not yet classifiable as keep/replace — see Unit 10) | `apps/web` does not call `apps/api` at all today; this is new work, not a modification of existing integration. |
| Configuration (env/API base URL) | MISSING | No frontend env/config mechanism exists yet; needed no later than Unit 10, and auth config no later than Unit 4. |
| Tests (`test/service.test.ts`) | KEEP | Correctly scoped to proving the fixture adapter is a thin wrapper over real domain logic; will need a parallel/replacement test once Unit 10 swaps the adapter implementation, but the existing test does not need to change before then. |

### Gap analysis

**A. Already good / reusable as-is:** the component layer (`Dashboard`, `QuestionPlayer`, `ResultScreen`, `AutopsyCard`, `ConfirmationPrompt`, `NextTrainingCard`, `RecommendationCard`, `Timer`), the `TrainingRecommendationAdapter` interface, the presentation/translation layer, the existing CSS foundation, the existing test's intent and coverage of the practice/autopsy loop.

**B. Needs modification:** the screen-selection mechanism in `App.tsx` (→ real routing, Unit 2), the CSS foundation (→ formalized design tokens, Unit 3), `apps/web/package.json`'s dependency list (its direct `@ipmat/attempt`/`@ipmat/autopsy`/`@ipmat/mastery`/`@ipmat/training-orchestration`/`@ipmat/ai` dependencies must be removed once Unit 10 replaces the fixture adapter — not before, since removing them earlier would break the still-needed fixture adapter).

**C. Missing entirely:** landing page, auth screens and logic, onboarding, enrollment flow, a real router, a design-token/component-foundation layer, any frontend env/config mechanism, a real (non-fixture) adapter implementation calling `apps/api`, loading/empty/error states beyond the single existing `"Loading your dashboard…"` string, responsive/accessibility hardening, and any connection at all between `apps/web` and `apps/api` (they exist side by side today, entirely unconnected).

**D. Intentionally deferred (per this document and CLAUDE.md, not oversights):** the fixture adapter's direct domain-package calls (deferred to Unit 10), a live database connection (deferred beyond Phase 1's structural units, blocked on Postgres reachability), real AI provider calls (out of scope — Phase 1 has no AI features), payments/mocks/social features/multi-exam support (out of scope for the whole product per Product Phase 0's exclusions).

## Web Architecture Lock

This section is binding for every subsequent unit in this phase (Units 2–12) and may only be revised by a deliberate, documented decision — not silently reinterpreted unit-to-unit.

```
Student UI (apps/web)
  -> application/API boundary (apps/api -> @ipmat/practice-api)
  -> existing application/domain services (@ipmat/training-recommendation, @ipmat/practice-loop, ...)
  -> repositories (@ipmat/db)
  -> database
```

**The frontend (`apps/web`) must NOT:**
- import `@prisma/client` or any Prisma-generated types
- import `@ipmat/adaptive-selection`, `@ipmat/repair-selection`, `@ipmat/training-orchestration`, or any individual training-system provider (`@ipmat/calculation-gym`, `@ipmat/speed-lab`, `@ipmat/trap-lab`, `@ipmat/novelty-training`, `@ipmat/pressure-training`) directly
- perform authoritative grading (comparing a chosen answer to a correct answer) — that is always server-side, per D-034
- calculate authoritative timing — `timeSpentSeconds` is always server-derived (`finalizedAt - startedAt`), per D-034; a client-side timer display (as `Timer.tsx` already does) is fine, an authoritative one is not
- implement adaptive-selection or repair-selection decisions itself
- implement training-system ranking/priority logic itself
- bypass the application/API boundary once Unit 10 lands (no direct `@ipmat/db` repository calls, no direct `@ipmat/attempt`/`@ipmat/autopsy`/`@ipmat/mastery` calls)
- expose internal diagnostics or answer keys to the browser before grading (mirrors D-048's `QuestionReader` server-side-only resolution and `@ipmat/practice-api`'s `StudentQuestionView`/`JudgeView`-style narrowing)

**Explicit, temporary exception (tracked, not silently allowed to persist):** `apps/web/src/adapter/service.ts`'s `createFixtureTrainingAdapter()` currently violates several of the rules above (direct imports of `@ipmat/attempt`/`@ipmat/autopsy`/`@ipmat/mastery`/`@ipmat/training-orchestration`/`@ipmat/ai`, and performs grading/timing/orchestration client-side). This is accepted **only** because:
1. It predates this Product Phase 1 lock (built during the earlier fixture-driven vertical-slice work).
2. It is fully documented as a temporary stand-in, structurally isolated behind the `TrainingRecommendationAdapter` interface, and covered by a test that proves it never invents its own decisions.
3. It is explicitly retired by Unit 10, not extended by any unit before it.

No new code written during Units 2–9 may add further direct domain-package imports to `apps/web` — the existing exception is not a precedent for more of the same.

**The existing fixture adapter is temporary and replaceable** — `TrainingRecommendationAdapter`'s interface (`adapter/types.ts`) is the permanent seam; `createFixtureTrainingAdapter()` (`adapter/service.ts`) is the only piece Unit 10 replaces, per the adapter's own existing doc comment.

**Existing UI is preserved where it does not conflict with Phase 1's product direction** — see the classification table above: every component in `src/components/` is KEEP, not REPLACE. This phase does not introduce a new frontend framework, new state-management library, or new architecture merely because one might be preferred in the abstract — React + Vite + the existing component/adapter structure stays, and only the specific gaps identified above (routing, auth, onboarding, enrollment, design tokens, real API wiring) are added.

## Phase 1 definition of done

The student can enter the product, authenticate, complete onboarding, establish IPMAT enrollment, reach a coherent dashboard, and enter the practice experience. The product must feel like one application. The frontend must not duplicate backend intelligence. Tests/typecheck/lint/build must pass before the phase is closed.

## Execution log

Updated after every completed unit.

| Unit | Status | Date | Commit | Tests | Files changed | Important discoveries | Notes |
|---|---|---|---|---|---|---|---|
| 1 | COMPLETE | 2026-09-29 | (not committed yet) | No code changed; audit validated against actual repository content (package.json, adapter/service.ts, adapter/types.ts, adapter/presentation.ts, all components, apps/api/src/server.ts, packages/practice-api/src/types.ts + presentation.ts) | docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md only | `apps/web`'s current adapter imports domain packages (`@ipmat/attempt`, `@ipmat/autopsy`, `@ipmat/mastery`, `@ipmat/training-orchestration`, `@ipmat/ai`) directly and performs grading/timing/orchestration client-side — a deliberate, documented, temporary exception to the target architecture, retired by Unit 10, not to be extended. `@ipmat/practice-api` already independently converged on near-identical student-facing view shapes, narrowing Unit 10's eventual work. | Web Architecture Lock established; Unit 2 scope defined; no router/design-system/auth/onboarding/enrollment exists yet. |
