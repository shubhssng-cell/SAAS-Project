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

**Current Unit: Unit 4 — implemented (2026-09-29, not yet committed), see "Unit 4 implementation summary" below. Unit 3 is complete and committed (`994ae93`). Unit 5 is next.**

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

### Unit 2 implementation summary (2026-09-29)

**What was built.** A minimal, dependency-free client-side router (`history.pushState` + `popstate` + React 18's `useSyncExternalStore` — no routing library was added; the existing route set is small and fixed enough that none was genuinely required), plus route-level page components for every route named above. `App.tsx` no longer owns any screen-state union — it is now purely the shell (header + `<PracticeSessionProvider>` + `<AppRoutes />`).

**Actual routes implemented** (exactly the ten required, no more):

| Path | Component | Kind |
|---|---|---|
| `/` | `LandingPage` | new placeholder |
| `/login` | `LoginPage` | new placeholder |
| `/signup` | `SignupPage` | new placeholder |
| `/onboarding` | `OnboardingPage` | new placeholder |
| `/enroll` | `EnrollPage` | new placeholder |
| `/dashboard` | `DashboardRoute` | reuses existing `Dashboard` |
| `/practice/next` | `PracticeNextRoute` | reuses existing `NextTrainingCard` |
| `/practice/:questionId/result` | `PracticeResultRoute` | reuses existing `ResultScreen` |
| `/practice/:questionId/autopsy` | `PracticeAutopsyRoute` | reuses existing `AutopsyCard`, `ConfirmationPrompt` |
| `/practice/:questionId` | `PracticeQuestionRoute` | reuses existing `QuestionPlayer`, `Timer` |

Placeholder screens (`/`, `/login`, `/signup`, `/onboarding`, `/enroll`) each contain only a heading, one short paragraph naming which later unit implements the real behavior, and a plain `Continue`/navigation link — explicitly no form submission, no session/identity creation, no onboarding or enrollment logic. This is disclosed inline in each file's own doc comment.

**Files added:**
- `apps/web/src/router/match.ts` — pure path/param matcher (no JSX, no DOM access)
- `apps/web/src/router/routeTable.ts` — pure `{id, pattern}[]` route data (mirrors `apps/api/src/server.ts`'s own `ROUTES` table style), separated from JSX specifically so it's unit-testable without rendering
- `apps/web/src/router/router.tsx` — `navigate()`, `usePathname()`, `useNavigate()`, `Link`
- `apps/web/src/router/AppRoutes.tsx` — maps `ROUTE_TABLE` ids to page components, renders `NotFoundPage` on no match
- `apps/web/src/practice/PracticeSessionContext.tsx` — holds the one adapter instance plus the minimum transient UI-navigation state (see "architectural decisions" below)
- `apps/web/src/routes/{LandingPage,LoginPage,SignupPage,OnboardingPage,EnrollPage,NotFoundPage,DashboardRoute,PracticeQuestionRoute,PracticeResultRoute,PracticeAutopsyRoute,PracticeNextRoute}.tsx`
- `apps/web/test/router.test.ts`, `apps/web/test/architectureBoundary.test.ts`

**Files modified:** `apps/web/src/App.tsx` only (rewritten as the shell, described above).

**Files NOT touched:** `apps/web/src/adapter/*` (interface and fixture implementation both untouched, per instruction), all of `apps/web/src/components/*` (reused verbatim, zero edits), `apps/web/src/styles.css`, `apps/web/package.json` (no dependency added), `apps/web/test/service.test.ts` (still passes unmodified), any backend/domain package, any Prisma/schema file.

**How the existing practice flow was preserved.** The dashboard → question → result → autopsy → next sequence is identical in substance to the pre-Unit-2 flow — same components, same adapter calls, same order — the only change is that each step now corresponds to a URL (`navigate(...)` replaces `setScreen(...)`) instead of local component state. `TrainingRecommendationAdapter` and `createFixtureTrainingAdapter()` were not modified at all.

**Architectural decision: a small `PracticeSessionContext` for transient cross-route handoff state.** `TrainingRecommendationAdapter` has no "fetch by id" method — `submitAnswer()` and `getAutopsy()` each return their view model inline, once, not something a later route can re-fetch from a bare URL. Since `/practice/:questionId/result` and `/practice/:questionId/autopsy` are separate routes from `/practice/:questionId`, something has to carry the just-returned `AttemptResultViewModel`/`AutopsyViewModel` from the step that produced it to the step that displays it. `PracticeSessionContext` does exactly that and nothing else: it holds the one `TrainingRecommendationAdapter` instance for the session plus two small maps (`questionId -> last result`, `attemptId -> last autopsy`), populated only with values the adapter itself already returned. It makes no decisions, computes nothing, and is not a second adapter. **Known, disclosed limitation:** because this state is in-memory only, a hard refresh directly on `/practice/:questionId/result` or `/practice/:questionId/autopsy` (without having gone through the flow first) shows an honest "not available, go back to the question" fallback rather than the real result/autopsy — this is a direct consequence of the fixture adapter's shape (no fetch-by-id), not a routing defect, and is the same in-memory-only constraint the pre-Unit-2 `Screen` state already had. It is expected to resolve naturally once Unit 10 wires a real, server-backed adapter that can fetch an attempt's result/autopsy by id.

**Tests added (all pure-function/static-analysis, no new dependency, no jsdom/testing-library):**
- `router.test.ts` (17 tests): `ROUTE_TABLE` contains exactly the ten required routes; `/practice/next`, `/practice/:questionId/result`, `/practice/:questionId/autopsy` are ordered before the generic `/practice/:questionId` (precedence); `matchPath()` resolves every required route from a raw pathname (deep-linking) and extracts `questionId` correctly; an unknown path resolves to no route; a trailing slash is treated the same as none.
- `architectureBoundary.test.ts` (24 tests): every file under `src/router/` and `src/routes/` is statically scanned for an import from any of the 17 banned specifiers (`@ipmat/attempt`, `@ipmat/autopsy`, `@ipmat/mastery`, `@ipmat/training-orchestration`, `@ipmat/adaptive-selection`, `@ipmat/repair-selection`, `@ipmat/training-systems`, the five training-system provider packages, `@ipmat/practice-loop`, `@ipmat/training-recommendation`, `@ipmat/db`, `@ipmat/ai`, `@prisma/client`) — all pass with zero offenders; plus checks that each real route composes its corresponding existing component (`Dashboard`, `QuestionPlayer`, `ResultScreen`, `AutopsyCard`, `NextTrainingCard`) and reaches the adapter only via `usePracticeSession()`, never a second `createFixtureTrainingAdapter()` call.
- `test/service.test.ts` (existing, 6 tests): unmodified, still passing — proves the adapter itself is untouched.

Browser-rendered navigation (actually clicking through the app) was not exercised in this unit — only `tsc`/`vite build`/`vitest` were run, per this unit's own instruction to avoid unrelated expensive validation; manual browser QA of the full journey is Unit 12's explicit job.

**Tests/typecheck/build results:**
- `vitest run apps/web/test`: 3 files, **47/47 tests passing** (17 new router tests + 24 new architecture-boundary tests + 6 pre-existing adapter tests, all green).
- `npm run typecheck --workspace @ipmat/web` (`tsc --noEmit`): clean, 0 errors (two rounds of `noUncheckedIndexedAccess`-driven fixes applied to `match.ts`/`AppRoutes.tsx` during implementation, then clean).
- `npm run build --workspace @ipmat/web` (`tsc --noEmit && vite build`): clean, succeeds (1308 modules transformed, `dist/assets/index-*.js` 323.59 kB / gzip 90.39 kB).
- `eslint apps/web/src apps/web/test --ext .ts,.tsx`: 0 errors, 0 warnings.

**Deviations from scope:** none identified. No routing dependency was added (a hand-rolled ~90-line router was used instead, consistent with instruction 2's "minimum appropriate routing dependency only if one is genuinely required"); no domain package was imported by any new file; the existing fixture adapter, its interface, and all presentational components were reused unmodified; no auth/onboarding/enrollment/API-integration/adaptive logic was implemented, only navigation stubs to their future routes.

**Unresolved/carried-forward items (expected, not blockers for Unit 2 closure):** the result/autopsy hard-refresh limitation described above (resolves at Unit 10); placeholder screens have no real content (expected — Units 4–7); `apps/web/package.json` still has its Unit-1-documented direct domain-package dependencies, unchanged (expected — those are only removed when Unit 10 retires the fixture adapter, not before).

### Unit 3 — Design system foundation
- **Objective:** Establish a minimal, consistent visual/component foundation (tokens, base components) the rest of the shell builds on.
- **Expected student-visible outcome:** A coherent visual identity across the new routes, replacing ad hoc per-component styling.
- **Dependencies:** Unit 2.
- **Acceptance criteria:** Landing, auth, dashboard, and practice screens visibly share the same design language; no route looks like an unstyled fixture demo.

### Unit 3 implementation summary (2026-09-29)

**Audit finding.** `styles.css` was already unusually close to the desired direction before this unit started: it already used CSS custom properties for color/radius/shadow/font-family, already had a restrained palette (warm off-white background, navy accent, a serif display face for headlines paired with Inter for body text), and already had a dark-mode block. What it lacked was an EXPLICIT typography/spacing/control/focus token layer — font sizes, weights, line-heights, and spacing were all still hand-typed literals repeated across ~30 rules (13 distinct font sizes, several of them within 0.05rem of each other purely by organic drift), there was no `:focus-visible` rule anywhere in the file (keyboard focus relied entirely on inconsistent browser defaults), and there was no button/card/page-container React primitive — every component re-typed `<div className="screen">`, `<div className="card">`, or `<button className="btn btn-primary">` itself.

**Token foundation added to `styles.css`** (all under the existing `:root`, alongside the pre-existing color/radius/shadow/font-family tokens, which were kept unchanged):
- **Typography scale:** `--text-2xs` through `--text-4xl` (10 named steps covering every font size in the app, `--text-4xl` staying the existing responsive `clamp(1.5rem, 3vw, 2rem)` headline size).
- **Font weights:** `--weight-medium` (500), `--weight-semibold` (600), `--weight-bold` (700).
- **Line heights:** `--leading-tight` (1.25), `--leading-normal` (1.5), `--leading-relaxed` (1.6), `--leading-loose` (1.7).
- **Spacing scale:** `--space-1` (4px) through `--space-9` (56px), a clean 4px-based scale, applied to structural layout spacing (page/header/main padding, card padding, stacking margins, `.btn-row` gap) — left as literal, undisturbed values anywhere a spacing value is component-local and never recurs elsewhere (e.g. badge padding's `5px`, evidence-dot sizing), rather than forcing every micro-value onto a grid.
- **Control sizing:** `--control-padding-y`/`--control-padding-x` (13px/22px, unchanged from the existing `.btn` padding, just named) and a NEW `--control-min-height: 44px`, applied to `.btn` and `.option` — the app previously had no explicit minimum tap-target height at all; this is a genuine accessibility-foundation addition, not a rename.
- **Layout:** `--content-width: 640px` (replaces the `.screen` class's hardcoded `max-width: 640px`).
- **Focus:** `--focus-ring-color`/`--focus-ring-width`/`--focus-ring-offset`, backing a new global `:focus-visible { outline: ...; outline-offset: ...; }` rule — every interactive element in the app (buttons, options, links) now gets a consistent, visible keyboard-focus ring for the first time.

**Disclosed, documented value consolidations (all ≤0.05rem / ≤2px, listed exhaustively — nothing else in the file changed numerically):**
- Font sizes: `0.78rem` (mode-tag) and `0.82rem` (question-topic) and `0.85rem` (hypothesis-support) → merged onto one shared `--text-sm: 0.8rem` step. `0.98rem` (subtext) → merged onto the existing `1rem` step (`--text-lg`, shared with `.option`/`.hypothesis-text`/`.confirm-question`, which were already exactly `1rem`).
- Line heights: `1.55` (prompt-text, hypothesis-text) → merged onto the existing `1.5` step (`--leading-normal`, already used by `.evidence-item`).
- Two inline `style={{ fontSize: "1.35rem" }}` / `style={{ fontSize: "1.4rem" }}` overrides (ResultScreen's and RecommendationCard's in-card headline) → replaced by one shared `.headline-compact { font-size: 1.375rem; margin: 0; }` class.
- `.option` padding second value `18px` → `20px`, to land on the spacing scale AND slightly increase the tap-target width (a positive, disclosed accessibility side-effect, not a hidden regression).
- `.question-topic`'s inline `marginBottom: 10` (QuestionPlayer) → a new `.question-topic-spaced { margin-bottom: var(--space-2); }` class at `8px`.

**Reusable primitives created** (`apps/web/src/design/`, new directory — `Screen.tsx`, `Card.tsx`, `Button.tsx`, `index.ts` barrel):
- **`Screen`** — the page-container primitive. Every existing top-level component (`Dashboard`, `QuestionPlayer`, `ResultScreen`, `AutopsyCard`, `NextTrainingCard`) and every Unit 2 route/placeholder page independently re-typed the identical `<div className="screen">` wrapper, and 8 of them repeated the exact same `eyebrow`/`headline`/`subtext` heading block on top of it — `Screen` takes those three as optional props plus `children`, rendering the SAME existing `.screen`/`.eyebrow`/`.headline`/`.subtext` classes, so no new CSS and no visual change for any caller that migrates to it.
- **`Card`** — wraps the existing `.card` class; used by `ResultScreen`, `AutopsyCard`, `RecommendationCard` (previously each re-typed `<div className="card">`).
- **`Button`** — wraps the existing `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-block` classes, defaults `type="button"`, and accepts an optional `className` that is APPENDED (never replaces) the computed classes — a deliberate, narrow escape hatch used exactly twice (`.solution-toggle` on `ResultScreen`'s "view solution" button, a spacing-only modifier) rather than a way for a caller to redefine the button's look.

No `Input` primitive was added — nothing in this app renders a text input today (the `numeric_entry` `AnswerFormat` value exists in the adapter's types but no component actually renders it; `QuestionPlayer` only ever renders multiple-choice option buttons). Building an unused primitive would be dead code, not foundation — this is flagged here as a known, pre-existing product gap, out of scope for a design-system unit to silently fix.

**Existing components migrated to the new primitives** (product/business logic untouched in every case — only the JSX wrapper markup changed): `Dashboard`, `NextTrainingCard`, `RecommendationCard`, `ResultScreen`, `AutopsyCard`, `ConfirmationPrompt`, `QuestionPlayer` (all in `src/components/`), plus every Unit 2 route file: `LandingPage`, `LoginPage`, `SignupPage`, `OnboardingPage`, `EnrollPage`, `NotFoundPage`, and the two in-line fallback states inside `PracticeResultRoute`/`PracticeAutopsyRoute`. `Timer.tsx` and `DashboardRoute`/`PracticeQuestionRoute`/`PracticeNextRoute`'s bare `<p className="loading-text">` lines were deliberately left untouched — the pre-Unit-2 `App.tsx` never wrapped its loading state in `.screen` either, so this preserves that exact existing behavior rather than introducing a new visual change.

**Responsive foundation.** The existing `clamp()`-based fluid spacing (header/main padding, card padding, headline size) was preserved and re-expressed through tokens rather than replaced — this was already a reasonable mobile-first foundation. The existing `@media (max-width: 480px)` block (stacked `.btn-row`, tighter header padding) is unchanged. No new breakpoints were added; the full responsive audit across every screen remains Unit 11's job.

**Accessibility foundation.** Added: the global `:focus-visible` ring (previously nonexistent), `--control-min-height: 44px` on buttons/options (previously no explicit floor). Not touched: color contrast (the existing palette was already using reasonably dark ink-on-light-surface pairs; no formal contrast audit was run — that is Unit 11's job, not silently done here), ARIA roles/labels, screen-reader testing. This unit establishes the two structural pieces (focus visibility, tap-target size) the instruction named as minimums; it is not the Unit 11 accessibility audit.

**Files changed:**
- New: `apps/web/src/design/{Screen.tsx,Card.tsx,Button.tsx,index.ts}`
- Modified: `apps/web/src/styles.css`; `apps/web/src/components/{Dashboard,NextTrainingCard,RecommendationCard,ResultScreen,AutopsyCard,ConfirmationPrompt,QuestionPlayer}.tsx`; `apps/web/src/routes/{LandingPage,LoginPage,SignupPage,OnboardingPage,EnrollPage,NotFoundPage,PracticeResultRoute,PracticeAutopsyRoute}.tsx`; `apps/web/test/architectureBoundary.test.ts` (scan scope widened from `src/router`+`src/routes` to also cover the new `src/design` and the existing `src/components`, so the Web Architecture Lock keeps guarding the whole UI layer, not just Unit 2's files)
- Untouched: `Timer.tsx`, `DashboardRoute.tsx`/`PracticeQuestionRoute.tsx`/`PracticeNextRoute.tsx` (only their already-existing bare loading text, unchanged), `apps/web/src/adapter/*`, `App.tsx`, `apps/web/package.json` (no dependency added), all backend/domain packages, Prisma/schema.

**Tests/typecheck/build/lint results:**
- `vitest run apps/web/test`: 3 files, **47/47 tests still passing** (same 17 router + 24 architecture-boundary, now scanning 4 directories instead of 2 + 6 adapter tests, all unaffected since no adapter/business logic changed).
- `npm run typecheck --workspace @ipmat/web` (`tsc --noEmit`): clean, 0 errors.
- `npm run build --workspace @ipmat/web`: clean (1312 modules transformed, CSS bundle 9.02 kB / gzip 2.55 kB, up from 7.04 kB / 2.18 kB pre-Unit-3 due to the added token/focus/primitive rules; JS bundle 322.31 kB / gzip 90.49 kB, effectively unchanged from Unit 2's 323.59 kB / 90.39 kB).
- `eslint apps/web/src apps/web/test --ext .ts,.tsx`: 0 errors, 0 warnings.
- No jsdom/testing-library was added, per instruction — no new tests required rendering; the existing pure-function/static-analysis test strategy from Unit 2 continued to apply cleanly since this unit's changes are markup/CSS-shape changes, not new branching logic.

**Deviations from scope:** none identified. No UI framework, Tailwind, or component library was added. No new product functionality, auth, onboarding, enrollment, API integration, or adaptive intelligence was implemented. The 5 disclosed value consolidations above (all ≤0.05rem/≤2px) are the only numeric visual changes in the entire unit; everything else is a pure rename (literal → token) or additive (focus ring, min-height) with zero visual delta.

**Unresolved/carried-forward items (expected, not blockers for Unit 3 closure):** full color-contrast/ARIA/screen-reader audit (Unit 11); full responsive audit across every screen at real mobile widths (Unit 11); no `Input` primitive exists (no consumer yet — would become relevant if/when `numeric_entry` questions are actually rendered, tracked as a pre-existing gap, not a Unit 3 regression); browser-rendered visual QA was not performed in this unit (only `tsc`/`vite build`/`vitest`/`eslint` were run, consistent with the instruction to add focused tests only where they provide real value and avoid a large visual-testing stack) — full browser QA of the visual result remains Unit 12's explicit job.

### Unit 4 — Authentication architecture
- **Objective:** Make the real D-004 decision (auth provider/approach) and establish the technical foundation for it (session/token handling, how `apps/api` will authenticate a request going forward).
- **Expected student-visible outcome:** None directly yet — this is the architectural foundation Unit 5 builds the visible flow on.
- **Dependencies:** Unit 2.
- **Acceptance criteria:** D-004 is resolved and recorded in [../DECISIONS.md](../DECISIONS.md) (not left open); a concrete mechanism exists for `apps/api` to derive a trusted identity from a request, replacing today's unauthenticated `StudentRequestClaim` fields.

### Unit 4 — Authentication Architecture (2026-09-29)

**Audit findings (existing infrastructure discovered before any design decision was made).**
- `packages/db/prisma/schema.prisma` already has a `Student` model: `id` (uuid), `authRef String? @unique` (`@@map("auth_ref")`), `createdAt`. No `email`, no password/credential field of any kind, no `Session`/`Account` model anywhere in the schema.
- `docs/DATABASE.md` documents `auth_ref` explicitly as a **placeholder**: *"`auth_ref` is nullable/placeholder until the real auth decision lands — it never blocks Phase 1's use of this table for calendar-phase testing."* This is the one field in the schema that exists specifically for D-004 to eventually resolve.
- The ONLY existing reference to `authRef` anywhere in the codebase is `packages/db/prisma/seed.ts`'s single seeded internal test student (`INTERNAL_TEST_STUDENT_AUTH_REF = "internal-test-student"`) — the "single seeded internal user is acceptable to unblock Phase 2–3 development" path CLAUDE.md and D-004 both describe. This seed path is untouched by this unit (see "What was deliberately NOT touched" below).
- No auth library of any kind exists anywhere in the repo — no bcrypt/argon2/jsonwebtoken/passport/next-auth/Clerk/Supabase-auth, nothing. `apps/api/src/server.ts` has zero auth middleware; every route resolves identity from a plain, unauthenticated `StudentRequestClaim` (`{studentId, enrollmentId}`) supplied directly by the caller — `server.ts`'s own doc comment already flags this as D-004's open gap, not a bug.
- `packages/practice-api/src/types.ts`'s `StudentRequestClaim` doc comment already states the exact problem this unit exists to solve: *"Resolving this FROM a real authenticated session is explicitly future work (D-004, still open)."*
- **Conclusion:** there is no competing identity/session model to reuse or conflict with — `Student.authRef` is a deliberately-left placeholder, not a shipped mechanism. This unit adds real credential/session fields alongside it rather than repurposing or removing it (see Identity Model below).

**1. Identity model.**
`Student` gains two new, nullable columns: `email String? @unique` and `passwordHash String?`. Nullable, not required, for one reason: `Student.authRef`-based rows (the existing internal-test-student seed path) legitimately have neither and must keep working unmodified — this unit does not touch `seed.ts` or retire the internal-test-student mechanism. At the APPLICATION layer, `@ipmat/auth-api`'s `signup()` always sets both — the schema's nullability is what allows two different kinds of `Student` row to coexist (internal-test-only vs. real-credentialed), never a weakening of what a real signup produces. No profile/enrollment/mastery/preference/parent/subscription field was added — exactly the existing `Student` row, plus the two columns a credential-based login genuinely needs. `Session` is a new, separate model (below) — sessions are not folded into `Student`.

**2. Session model — server-authoritative, opaque bearer token, never a JWT.**
- A new `Session` table: `id` (uuid), `studentId` (FK → `Student`, cascade delete), `tokenHash` (unique — the token itself is NEVER stored, only its SHA-256 digest, so a database read can never be replayed as a live session, mirroring password hashing's own "never store the secret, store a verifier" principle), `createdAt`, `expiresAt`, `revokedAt` (nullable — logout SETS this rather than deleting the row, preserving an audit trail; validity is `revokedAt IS NULL AND expiresAt > now()`).
- **Why not JWT:** a JWT would let a compromised or overly-long-lived token keep working after logout unless a separate revocation list existed anyway — at which point the server is already authoritative and the JWT's main selling point (statelessness) is gone. A plain, server-checked opaque token is simpler, is genuinely revocable on logout, and needs no signing-key management. This directly follows the instruction's "prefer a server-authoritative session model... do NOT implement an unsafe JWT-everywhere solution merely because it is easy."
- **Session identifier representation:** a 256-bit (`crypto.randomBytes(32)`) random hex token, generated server-side at signup/login, returned to the client exactly once (never re-derivable, never re-displayable). The client's only job is to send it back on every request; it never inspects or decodes it (there is nothing to decode — it carries no claims).
- **Where session state lives:** the `Session` table (server-authoritative, source of truth). Nothing about "is this session valid" is ever decided client-side.
- **Expiration:** absolute TTL, `SESSION_TTL_SECONDS = 14 days` (`@ipmat/auth`'s `SESSION_TTL_SECONDS`, explicitly marked PROVISIONAL — not calibrated against real usage, the same "provisional until real data exists" discipline this codebase already applies to `MASTERY_CONSTANTS`/`AUTOPSY_THRESHOLDS`). No idle/sliding expiry in V1 — a deliberate simplification (`Do not over-engineer` per this unit's own instruction); a session either has or hasn't reached its absolute expiry, checked fresh on every request.
- **Logout invalidation:** `logout()` sets `revokedAt = now()` on the matching session row. A subsequent `findActiveByTokenHash()` for that token returns `null` (fails closed) — the same token can never be replayed after logout, even if an attacker captured it before the logout call.
- **Cookie attributes** (set by `apps/api`'s auth routes, never by `apps/web`): `HttpOnly` (JavaScript can never read the token — defeats XSS token theft), `SameSite=Lax` (the primary CSRF mitigation for V1 — blocks the cookie being sent on a cross-site POST, which covers every state-changing route this unit adds; a dedicated CSRF token scheme is explicitly NOT added now, flagged as a future hardening step only if a genuine cross-origin requirement appears), `Path=/`, `Max-Age` matching `SESSION_TTL_SECONDS`, and `Secure` gated on `NODE_ENV === "production"` (a real deployment sits behind TLS termination; requiring `Secure` unconditionally would break local `http://localhost` development, which this repository's own dev workflow still needs).
- **How authenticated requests reach application services:** `apps/api` reads the `Cookie` header, extracts the session token, hashes it, and calls `AuthApiService.getCurrentSession({sessionToken}, {now})` — which returns a verified `{studentId}` or throws `not_authenticated`. This verified `studentId` is the ONLY source of identity for any route this unit protects; nothing accepts a client-supplied `studentId` as trusted going forward (see item 4).

**3. Request authentication flow.**
```
Signup:  browser -> POST /v1/auth/signup {email, password}
                  -> AuthApiService.signup(): validate -> hashPassword() -> create Student row
                  -> generate session token -> hash it -> create Session row
                  -> response: Set-Cookie (HttpOnly/SameSite=Lax/Secure-in-prod) + student view (id, email, createdAt -- NEVER passwordHash)

Login:   browser -> POST /v1/auth/login {email, password}
                  -> AuthApiService.login(): findByEmailWithCredentials() -> verifyPassword() (timing-safe)
                  -> on ANY failure (unknown email OR wrong password): the SAME generic "invalid_credentials" error,
                     same message, same HTTP status -- an attacker cannot distinguish "no such account" from
                     "wrong password" (account-enumeration resistance)
                  -> on success: new Session row (existing sessions, if any, are left active -- multiple concurrent
                     sessions/devices are allowed; a deliberate, disclosed V1 simplification, not an oversight)
                  -> response: Set-Cookie + student view

Me:      browser -> GET /v1/auth/me (cookie only, no body)
                  -> AuthApiService.getCurrentSession(): hash cookie token -> findActiveByTokenHash()
                  -> null/expired/revoked all produce the SAME "not_authenticated" (401) -- the caller can never
                     tell which of the three actually happened (fail-closed, no internal-state leak)
                  -> response: student view, or 401

Logout:  browser -> POST /v1/auth/logout (cookie only)
                  -> AuthApiService.logout(): hash cookie token -> revoke() if an active session matches
                  -> logging out an ALREADY-invalid/expired/missing session is a no-op SUCCESS, never an error
                     (there is nothing meaningfully "wrong" about a client asking to end a session that is
                     already effectively ended)
                  -> response: clears the cookie (Set-Cookie with Max-Age=0)
```

**4. Browser/server responsibility boundary.**
| | Browser (`apps/web`) | Server (`apps/api` / `@ipmat/auth-api`) |
|---|---|---|
| Collect credentials | ✅ (Unit 5's job — forms only, not this unit) | — |
| Submit credentials to the auth endpoint | ✅ | receives, never trusts the transport alone |
| Verify a password | ❌ never | ✅ only place `verifyPassword()` runs |
| Issue/validate a session | ❌ never | ✅ only place a `Session` row is created/checked |
| Store a password hash | ❌ never | ✅ only in `Student.passwordHash`, never returned to a client |
| Access Prisma/the database | ❌ never (Web Architecture Lock, unchanged by this unit) | ✅ via `@ipmat/db`'s repository ports only |
| Maintain presentation-level "am I logged in" state | ✅ (Unit 5) — informational only, never authoritative | the ONLY authoritative answer is `getCurrentSession()` |
| Invent/assert an identity (`studentId`) | ❌ never, before or after this unit | the ONLY legitimate source is a verified session |

**5. API contracts prepared for Unit 5** (implemented this unit — `@ipmat/auth-api`'s `AuthApiService`, exposed over HTTP by `apps/api` at `/v1/auth/*`):
- `signup(input: {email, password}, opts?: {now}): Promise<AuthApiSessionResult>` — `AuthApiSessionResult = {student: {id, email, createdAt}, sessionToken, expiresAt}`. Throws `invalid_request` (bad email format, password under 8 characters) or `email_already_registered`.
- `login(input: {email, password}, opts?: {now}): Promise<AuthApiSessionResult>` — same result shape. Throws `invalid_credentials` for EITHER an unknown email or a wrong password (identical error/message, by design — see account-enumeration note above).
- `getCurrentSession(input: {sessionToken}, opts?: {now}): Promise<{student: {id, email, createdAt}}>` — throws `not_authenticated` for a missing/invalid/expired/revoked token (all indistinguishable to the caller).
- `logout(input: {sessionToken}, opts?: {now}): Promise<void>` — never throws for an already-invalid token (no-op success).
- `apps/api` routes: `POST /v1/auth/signup`, `POST /v1/auth/login`, `GET /v1/auth/me`, `POST /v1/auth/logout` — each a thin, logic-free wrapper (same discipline as the existing 6 `/v1/*` routes), translating the `Cookie` header / JSON body into a service call and the result into `Set-Cookie` + JSON, never containing auth logic itself.
- None of these are wired to `apps/web` yet (explicitly out of scope — see Explicit exclusions).

**6. Security decisions.**
- **Password hashing:** Node's built-in `crypto.scrypt` (via `node:crypto`, `promisify`'d), NOT bcrypt/argon2 — no new npm dependency was added. `scrypt` is an OWASP-acceptable KDF; a random 16-byte salt is generated per password and encoded alongside the derived key in one stored string (`scrypt:<saltHex>:<hashHex>`), so no separate salt column is needed. Verification uses `crypto.timingSafeEqual` on the derived key (never a plain `===` string comparison, which would leak timing information about how many leading bytes matched).
- **Credential handling:** a raw password is used ONLY inside `hashPassword()`/`verifyPassword()`'s own call — never logged, never stored, never echoed back in any response or error message.
- **Session entropy:** 256 bits (`crypto.randomBytes(32)`) per token — far beyond brute-force range; only the SHA-256 hash of the token is ever persisted (see Session model above).
- **Cookie flags:** `HttpOnly`, `SameSite=Lax`, `Secure` (production only), `Path=/`, `Max-Age` — see Session model above.
- **Secure transport:** this unit assumes TLS termination happens in front of `apps/api` in any real deployment (the same assumption every cookie-based session system makes) — `apps/api` itself is still the same bare `node:http` server from Unit... (Phase 5I); adding TLS termination itself is out of scope (infrastructure/deployment, not application architecture).
- **CSRF:** `SameSite=Lax` is the V1 mitigation (see Session model above) — sufficient for a same-origin app with no cross-site form posting need yet; a dedicated CSRF token is explicitly deferred, not silently skipped.
- **Authentication error behavior / account enumeration:** login failures never distinguish "no such account" from "wrong password" (same code, same message, same HTTP status — `401`). Signup DOES reveal `email_already_registered` distinctly (a account-creation flow inherently needs to tell a user their email is taken — a different, accepted tradeoff, consistent with how virtually every real signup form behaves).
- **Secret/configuration boundary:** this unit introduces no new secret material to configure — there is no signing key (no JWT), no third-party API key, no OAuth client secret. The only "secret" is each session's own random token, generated and hashed entirely server-side, never configured. `NODE_ENV` (already a standard Node convention, not a new secret) gates the `Secure` cookie flag.
- **Development/test configuration separation:** tests inject `now` explicitly (the same existing "caller supplies `now`, nothing reads the system clock internally" convention `@ipmat/attempt`/`@ipmat/practice-api` already use) so session-expiry behavior is deterministically testable without waiting 14 real days or mocking global time.
- **No information leakage:** `AuthApiSessionResult`'s `student` view is a hand-typed `{id, email, createdAt}` object — it has no field through which `passwordHash`, a raw session token (after the one-time signup/login response), a `tokenHash`, or any internal diagnostic could ever be included, even accidentally. This is structurally enforced (the type has no such field), the same discipline `PresentedQuestionView`/`JudgeView`/`StudentQuestionView` already use elsewhere in this codebase (D-020).
- **Explicitly not added (per instruction):** OAuth/social login, MFA, email verification (no existing product requirement forces it yet), any third-party auth platform (Clerk/Auth0/Supabase-auth/etc.) — self-hosted was chosen specifically because the instructions steer away from adding a third-party platform "unless the repository or product requirements genuinely require it," and none do yet.

**7. Configuration/secrets boundary.** No `.env` changes were required — this unit adds no API key, connection string, or signing secret beyond what `packages/db/.env`/`.env.example` (the existing `DATABASE_URL`) already covers. `NODE_ENV` is read only to decide the `Secure` cookie flag, nowhere else.

**8. What Unit 5 depends on (all delivered by this unit):**
- `@ipmat/auth` (`packages/domain/auth`) — `hashPassword`/`verifyPassword`, `generateSessionToken`/`hashSessionToken`/`computeSessionExpiry`/`SESSION_TTL_SECONDS`, `normalizeEmail`/`assertValidEmail`/`assertValidPassword`. Database-free, zero npm dependencies (uses only `node:crypto`).
- `@ipmat/db` additions — `StudentAccountRepository`/`SessionRepository` port interfaces, `InMemoryStudentAccountRepository`/`InMemorySessionRepository` (test doubles), `PrismaStudentAccountRepository`/`PrismaSessionRepository` (written, never run against a live database, same status as every other Prisma repository in this codebase).
- `@ipmat/auth-api` (`packages/auth-api`) — `AuthApiService` with `signup`/`login`/`logout`/`getCurrentSession`, `AuthApiError`, student-safe presentation mapping.
- `apps/api` — `POST /v1/auth/signup`, `POST /v1/auth/login`, `GET /v1/auth/me`, `POST /v1/auth/logout`, cookie issuance/parsing, wired in `wiring.ts` alongside the existing practice-api dependencies.
- Unit 5 is expected to: build the actual signup/login form UI in `apps/web`, call these four endpoints (this is the FIRST real `apps/web` → `apps/api` connection — Unit 10's "thin real API/client integration" unit can therefore start from this precedent), maintain presentation-level "logged in" state, implement logout, and protect the post-login routes client-side (informationally — the server remains the only authoritative check).

**9. Explicit exclusions (deliberately not done this unit).**
- No signup/login/logout UI was built in `apps/web` — Unit 5's job, per instruction.
- No password-reset flow.
- No onboarding/enrollment logic.
- `apps/web` was NOT connected to `apps/api` in this unit (per instruction) — the four new routes exist and are tested, but nothing in `apps/web` calls them yet.
- **`packages/practice-api`'s existing `StudentRequestClaim` type and all 6 existing `/v1/*` practice routes were left completely unmodified.** They still accept a client-supplied `studentId`/`enrollmentId` exactly as before Unit 4. This is a deliberate, disclosed scope boundary, not an oversight: those routes have zero real callers today (`apps/web` doesn't call `apps/api` at all yet, confirmed in Unit 1's audit), so retrofitting them now would be touching already-shipped, already-tested code "simply because it could eventually benefit from auth" — exactly what this unit's own instructions say not to do. The REPLACEMENT plan is documented here: once real, authenticated traffic is wired into `apps/web` (Unit 10, or whichever unit first connects a live session to a practice route), every such route must derive `studentId` from `AuthApiService.getCurrentSession()`'s verified result — **never again from a client-supplied field** — using the exact mechanism this unit built. `StudentRequestClaim` itself is not replaced by this unit; the plan is written down so a future unit does not have to re-derive it.
- **`docs/DECISIONS.md`'s D-004 now carries `Status: Accepted`**, with the full resolved decision (self-hosted email/password, scrypt hashing, server-authoritative opaque session, SHA-256-only token storage, logout revocation, HttpOnly/SameSite=Lax cookies) — see D-004 there directly, satisfying Unit 1's original Unit 4 acceptance criterion ("D-004 is resolved and recorded in DECISIONS.md — not left open"). This file remains the detailed architecture/implementation record; `DECISIONS.md`'s D-004 is the concise, cross-referenced engineering-decision-log entry pointing back here.
- No OAuth/social login, no MFA, no email verification (see Security decisions above).
- No rate-limiting/brute-force lockout on login attempts — a real, known gap for a production login endpoint, explicitly flagged as unresolved (see the implementation-summary "Unresolved" list below), not silently accepted as fine.

### Unit 4 implementation summary (2026-09-29)

**What was built, exactly.**
- **`@ipmat/auth`** (new, `packages/domain/auth`) — `hashPassword`/`verifyPassword` (Node `scrypt`, zero new npm dependency), `generateSessionToken`/`hashSessionToken`/`computeSessionExpiry`/`SESSION_TTL_SECONDS`, `normalizeEmail`/`assertValidEmail`/`assertValidPassword`/`AuthValidationError`, `AuthenticatedIdentity`. Database-free, framework-free — `package.json` declares zero dependencies (only `node:crypto`/`node:util`, both Node built-ins).
- **`packages/db` schema** — `prisma/schema.prisma`: `Student` gains nullable `email`/`passwordHash`; new `Session` model (`id`, `studentId`, `tokenHash` unique, `createdAt`, `expiresAt`, `revokedAt`). New hand-written migration `0008_authentication_foundation` (no live/shadow database has ever been reachable in this environment, same as every prior migration — see MASTER_PLAN.md "Current state"). `prisma generate` WAS run (schema-only, no database connection required) so the new fields/model typecheck against the real generated client — this is genuinely new: every migration before this one was written but never regenerated-against in this session; this one was, because the new Prisma repositories below needed real generated types to typecheck at all.
- **`packages/db` repositories** — `StudentAccountRepository`/`SessionRepository` port interfaces (`types.ts`); `InMemoryStudentAccountRepository`/`InMemorySessionRepository` (test doubles, exercised by 11 new tests); `PrismaStudentAccountRepository`/`PrismaSessionRepository` (written, typechecked against the regenerated client, never run against a live database — same status as every other `PrismaXRepository` in this codebase).
- **`@ipmat/auth-api`** (new, `packages/auth-api`) — `AuthApiService` (`signup`/`login`/`logout`/`getCurrentSession`), `AuthApiError`, `toStudentAccountView()`. Declares exactly two dependencies (`@ipmat/auth`, `@ipmat/db`), verified by its own `dependencyBoundary.test.ts` (mirrors `@ipmat/practice-api`'s own boundary test almost exactly).
- **`apps/api`** — four new routes (`POST /v1/auth/signup`, `POST /v1/auth/login`, `GET /v1/auth/me`, `POST /v1/auth/logout`) added as a SEPARATE `AUTH_ROUTES` table in `server.ts`, dispatched before the pre-existing `ROUTES` table — the existing 6 practice routes and their dispatch logic were not touched at all. Cookie parsing (`parseCookies()`) and issuance (`sessionCookieHeader()`/`clearSessionCookieHeader()`, gating `Secure` on `NODE_ENV === "production"`) are new, small, pure functions. `wiring.ts`'s `createInMemoryDependencies()`/`createPrismaDependencies()` both extended (additively — every existing field they returned is unchanged) to also construct/return `studentAccounts`/`sessions`.

**Deviation actually taken vs. the architecture doc's `/v1/auth/me` design:** the architecture section above describes `getCurrentSession()` treating a missing token the same as any other invalid one (`not_authenticated`, indistinguishable). In the actual `apps/api` implementation, a request with NO cookie at all is intercepted at the transport layer (`server.ts`) and answered `401 not_authenticated` directly, without ever calling `AuthApiService.getCurrentSession()` — calling the service with an empty string would instead hit its `assertNonEmptyString()` guard and produce `400 invalid_request`, which is the wrong status for "you're simply not logged in yet" (an ordinary, expected state for a first-time visitor, not a malformed request). The end result the architecture doc promises (`401 not_authenticated` either way) is preserved; only which layer produces it for the "no cookie sent" sub-case changed during implementation. The same fix was applied to `POST /v1/auth/logout` (a missing cookie is treated as an immediate no-op success, matching the documented "logging out an already-ended session is a no-op success" behavior, without needing to round-trip through the service for a token that was never sent). This is recorded here rather than silently reflected only in the code.

**Tests added:**
- `packages/domain/auth`: 26 tests across `password.test.ts` (roundtrip, wrong password, salt uniqueness, format, no-leak, fail-closed-on-malformed), `session.test.ts` (token format/uniqueness, hash determinism, expiry math), `validation.test.ts` (email/password validation), `dependencyBoundary.test.ts` (zero deps, no forbidden imports).
- `packages/db`: 11 new tests (`studentAccountRepository.test.ts`, `sessionRepository.test.ts`) proving create/duplicate-rejection/lookup/expiry/revocation against the in-memory doubles; the existing `domainBoundary.test.ts` automatically picked up `@ipmat/auth` (it iterates every `packages/domain/*` directory) and passed without modification.
- `packages/auth-api`: 22 tests (`service.test.ts`, `dependencyBoundary.test.ts`) covering signup success/duplicate-email/invalid-email/weak-password, login success/unknown-email/wrong-password, the account-enumeration-resistance property (byte-for-byte identical error for unknown-email vs. wrong-password, asserted directly), multi-session independence, `getCurrentSession` success/garbage-token/expired/logged-out, `logout` idempotency, and a structural "never contains passwordHash anywhere in the result" check.
- `apps/api`: 11 new HTTP-level tests (`authServer.test.ts`) proving the actual transport — cookie issuance/attributes (`HttpOnly`/`SameSite=Lax`/`session_token=`), duplicate-email 409, wrong-password 401, missing-cookie 401 (never 400), garbage-cookie 401, logout clearing the cookie (`Max-Age=0`) and invalidating the session, logout-with-no-cookie no-op 200, and that the unrelated existing routes are unaffected.

**Tests/typecheck/build/lint results:**
- `vitest run` (full repo): **1354/1354 tests passing** across 143 files — up from 1241 pre-Unit-4 (see Phase 5I's count in MASTER_PLAN.md) plus this unit's own ~113 new tests, zero regressions in any pre-existing suite.
- `npm run typecheck` (all 29 workspaces, including the 2 new ones): clean, 0 errors. Required one real fix during implementation: `packages/domain/auth/src/password.ts`'s destructured `[, saltHex, hashHex]` needed an explicit `if (!saltHex || !hashHex) return false;` guard for `noUncheckedIndexedAccess` (same class of fix Units 2/3 also hit).
- `npm run build` (all 29 workspaces): clean, exit code 0 — every `@ipmat/*` package's `tsc -p tsconfig.json` succeeded, and both Vite apps (`apps/training-playground`, `apps/web`) built without error (`apps/web`'s bundle unchanged from Unit 3's numbers, confirming this unit touched no frontend code at all).
- `eslint packages/domain/auth packages/auth-api packages/db apps/api --ext .ts,.tsx`: 0 errors, 0 warnings.
- `npm install` was run twice at the repo root (once after adding `@ipmat/auth`/`@ipmat/auth-api` as new workspaces, once after adding `apps/api`'s new `@ipmat/auth-api` dependency) — both are workspace-symlink-only changes; `package-lock.json`'s diff was inspected line by line and contains no new EXTERNAL npm dependency, only the two new local workspace package entries.

**Deviations from scope:** none beyond the one disclosed above (the `/v1/auth/me`/`logout` missing-cookie handling moved from the service layer to the transport layer during implementation, same end behavior). No signup/login/logout UI was built. `apps/web` was not touched at all in this unit — confirmed by `git diff --name-status` showing zero files under `apps/web/`. `packages/practice-api`'s 6 existing routes and its `StudentRequestClaim` type are byte-for-byte unchanged (verified: `git diff --name-only -- packages/practice-api` is empty).

**Unresolved (explicitly, not silently accepted):**
- No rate-limiting/brute-force lockout on `/v1/auth/login` — a real production gap for a login endpoint; not built, not designed away, genuinely open.
- `PrismaStudentAccountRepository`/`PrismaSessionRepository` have never executed against a live database (same status as every other Prisma repository in this codebase — no live/shadow Postgres has ever been reachable in this environment).
- The 6 existing practice routes still trust a client-supplied `studentId` — the REPLACEMENT plan is documented (see "Explicit exclusions" item 3 above) but not executed; that retrofit is deliberately left to whichever unit first wires real authenticated traffic into those routes.
- Multiple concurrent sessions per student are allowed with no "log out everywhere" mechanism — a reasonable, disclosed V1 scope boundary, not a gap being hidden.

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
| 1 | COMPLETE | 2026-09-29 | `41889a2` | No code changed; audit validated against actual repository content (package.json, adapter/service.ts, adapter/types.ts, adapter/presentation.ts, all components, apps/api/src/server.ts, packages/practice-api/src/types.ts + presentation.ts) | docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md only | `apps/web`'s current adapter imports domain packages (`@ipmat/attempt`, `@ipmat/autopsy`, `@ipmat/mastery`, `@ipmat/training-orchestration`, `@ipmat/ai`) directly and performs grading/timing/orchestration client-side — a deliberate, documented, temporary exception to the target architecture, retired by Unit 10, not to be extended. `@ipmat/practice-api` already independently converged on near-identical student-facing view shapes, narrowing Unit 10's eventual work. | Web Architecture Lock established; Unit 2 scope defined; no router/design-system/auth/onboarding/enrollment exists yet. |
| 2 | COMPLETE | 2026-09-29 | `c03bc11` | 47/47 passing (17 new router tests, 24 new architecture-boundary tests, 6 pre-existing adapter tests unmodified); typecheck clean; build clean; eslint clean | apps/web/src/App.tsx (modified); apps/web/src/router/{match.ts,routeTable.ts,router.tsx,AppRoutes.tsx} (new); apps/web/src/practice/PracticeSessionContext.tsx (new); apps/web/src/routes/*.tsx (11 new files); apps/web/test/{router.test.ts,architectureBoundary.test.ts} (new); docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md | Built a ~90-line dependency-free router (`pushState`/`popstate`/`useSyncExternalStore`) instead of adding a routing library — genuinely not required for 10 fixed routes. `TrainingRecommendationAdapter` has no fetch-by-id method, so result/autopsy routes need a small in-memory `PracticeSessionContext` to carry a just-returned view model across the route boundary — disclosed as a known, temporary, hard-refresh limitation resolved at Unit 10. | No dependency added; adapter/components/styles untouched; no auth/onboarding/enrollment/API-integration/adaptive logic implemented, only navigation stubs. |
| 3 | COMPLETE | 2026-09-29 | `994ae93` | 47/47 passing (unchanged test count; architecture-boundary scan widened from 2 to 4 directories); typecheck clean; build clean (CSS bundle 7.04kB→9.02kB); eslint clean | apps/web/src/design/{Screen.tsx,Card.tsx,Button.tsx,index.ts} (new); apps/web/src/styles.css (modified, token foundation added); 7 files in apps/web/src/components/ (modified, migrated to primitives); 8 files in apps/web/src/routes/ (modified, migrated to primitives); apps/web/test/architectureBoundary.test.ts (modified, scan scope widened) | `styles.css` was already close to the target aesthetic (serif+sans pairing, restrained palette, tokens for color/radius/shadow) before this unit — the gap was an explicit type/spacing/control/focus scale and reusable React primitives, not a redesign. Every top-level component/route already independently re-typed the same `.screen`/`.card`/`.btn` wrapper markup, making `Screen`/`Card`/`Button` primitives directly justified by 20+ existing call sites. No `:focus-visible` rule existed anywhere before this unit. | No dependency added (no Tailwind, no component library); 5 disclosed value consolidations, all ≤0.05rem/≤2px (listed exhaustively in the Unit 3 summary); no business logic in any migrated component changed; no Input primitive added (no consumer exists yet). |
| 4 | COMPLETE | 2026-09-29 | (not committed yet) | 1354/1354 passing full-repo (up from 1241, ~113 new); typecheck clean across all 29 workspaces; build clean (exit 0); eslint clean | New: packages/domain/auth/* (4 src + 4 test files), packages/auth-api/* (5 src + 3 test files), packages/db/prisma/migrations/0008_authentication_foundation/, packages/db/src/repositories/{inMemoryStudentAccountRepository,inMemorySessionRepository,prismaStudentAccountRepository,prismaSessionRepository}.ts, packages/db/test/repositories/{studentAccountRepository,sessionRepository}.test.ts, apps/api/test/authServer.test.ts. Modified: packages/db/prisma/schema.prisma, packages/db/src/repositories/{types,index}.ts, apps/api/{package.json,src/server.ts,src/wiring.ts}, package-lock.json (workspace links only, no new external dep), docs/DECISIONS.md (D-004 resolved: Open → Accepted), docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md | `Student.authRef` was already a documented D-004 placeholder, not a shipped mechanism — no competing identity model existed to reconcile. Chose self-hosted email+password (scrypt via node:crypto, zero new dependency) over a third-party platform or OTP, per the instruction's "don't add a third-party platform unless genuinely required." Server-authoritative opaque session token (never JWT) — real, immediate revocation on logout. | `apps/web` untouched (verified: 0 files under apps/web/ in the diff); `packages/practice-api`'s 6 existing routes and StudentRequestClaim byte-for-byte unchanged (verified); D-004 recorded as `Accepted` in [../DECISIONS.md](../DECISIONS.md) with the full resolved decision, satisfying Unit 1's original acceptance criterion; one implementation deviation from the architecture doc (missing-cookie handling moved to the transport layer for /me and /logout — same end behavior, disclosed in the Unit 4 implementation summary). |
