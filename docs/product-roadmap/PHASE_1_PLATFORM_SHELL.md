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

**Current Unit: Unit 1.**

## Phase 1 unit plan

Each unit below is documented only at the level of objective / expected student-visible outcome / dependencies / acceptance criteria — deliberately not prescribing implementation details that would lock in choices (e.g. which router, which design-system approach, which auth provider) ahead of the decisions those units themselves exist to make.

### Unit 1 — Audit current `apps/web` and lock the existing product-shell foundation
- **Objective:** Establish, in writing, exactly what of the existing `apps/web` demo is reusable foundation vs. what must be restructured for a real product shell.
- **Expected student-visible outcome:** None yet — this is an audit unit.
- **Dependencies:** None.
- **Acceptance criteria:** This document's "Current state" section (above) is accurate against the real repository at the time Unit 1 is closed; any discrepancy found is recorded, not silently fixed by rewriting history.

### Unit 2 — Application shell + routing
- **Objective:** Introduce real routes/URLs (landing, auth, onboarding, enrollment, dashboard, practice) replacing the single in-memory `Screen` union in `App.tsx`.
- **Expected student-visible outcome:** Distinct, navigable URLs exist for each top-level area, even if most still render placeholder content.
- **Dependencies:** Unit 1.
- **Acceptance criteria:** Deep-linking to any top-level route works; back/forward browser navigation behaves correctly; the existing practice/result/autopsy flow still renders (may still be fixture-backed at this point).

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

## Phase 1 definition of done

The student can enter the product, authenticate, complete onboarding, establish IPMAT enrollment, reach a coherent dashboard, and enter the practice experience. The product must feel like one application. The frontend must not duplicate backend intelligence. Tests/typecheck/lint/build must pass before the phase is closed.

## Execution log

_Empty. Updated after every completed unit._

| Unit | Status | Date | Commit | Tests | Files changed | Important discoveries | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
