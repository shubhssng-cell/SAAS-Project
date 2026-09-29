import type { ReactElement } from "react";
import { OnboardingGate } from "../auth/OnboardingGate.js";
import { RequireAuth } from "../auth/RequireAuth.js";
import { EnrollmentGate } from "../enrollment/EnrollmentGate.js";
import { DashboardRoute } from "../routes/DashboardRoute.js";
import { EnrollPage } from "../routes/EnrollPage.js";
import { LandingPage } from "../routes/LandingPage.js";
import { LoginPage } from "../routes/LoginPage.js";
import { NotFoundPage } from "../routes/NotFoundPage.js";
import { OnboardingPage } from "../routes/OnboardingPage.js";
import { PracticeAutopsyRoute } from "../routes/PracticeAutopsyRoute.js";
import { PracticeNextRoute } from "../routes/PracticeNextRoute.js";
import { PracticeQuestionRoute } from "../routes/PracticeQuestionRoute.js";
import { PracticeResultRoute } from "../routes/PracticeResultRoute.js";
import { SignupPage } from "../routes/SignupPage.js";
import { matchPath } from "./match.js";
import { ROUTE_TABLE } from "./routeTable.js";
import { usePathname } from "./router.js";

/**
 * Maps each `ROUTE_TABLE` id to the page it renders. Kept separate from
 * `ROUTE_TABLE` itself so the pattern/precedence data can be unit-tested
 * without importing JSX/React rendering (see test/router.test.ts).
 */
/**
 * `dashboard` and every `practice-*` route are the "authenticated shell"
 * (Product Phase 1 Unit 5) -- wrapped in `RequireAuth`, which is
 * PRESENTATIONAL protection only (a frontend redirect, not a security
 * boundary; the server remains authoritative). `landing`/`login`/`signup`
 * stay public and unwrapped, per this unit's own route classification.
 *
 * `onboarding` and the authenticated-shell routes additionally nest
 * `OnboardingGate` (Product Phase 1 Unit 6) INSIDE `RequireAuth` -- by the
 * time it renders, auth is already resolved, so it only ever needs to
 * decide the onboarding-specific branch: `/onboarding` itself redirects an
 * already-onboarded student to `/dashboard` (`"require-incomplete"`);
 * everything else redirects a not-yet-onboarded student to `/onboarding`
 * (`"require-complete"`).
 *
 * `enroll` and the authenticated-shell routes further nest `EnrollmentGate`
 * (Product Phase 1 Unit 7) INSIDE `OnboardingGate mode="require-complete"`
 * -- a student cannot reach the enrollment step (or beyond) before
 * finishing onboarding. `/enroll` itself uses `"require-incomplete"`
 * (redirects an already-enrolled student to `/dashboard`); `/dashboard`
 * and every practice route use `"require-complete"` (redirects a
 * not-yet-enrolled student to `/enroll`). The full chain for the
 * authenticated shell is therefore: `RequireAuth` -> `OnboardingGate
 * (require-complete)` -> `EnrollmentGate (require-complete)` -> the real
 * route -- each gate resolves exactly one concern and hands off to the
 * next only once its own condition is satisfied, so no two gates ever
 * fight over the same redirect.
 */
const RENDERERS: Record<string, (params: Record<string, string>) => ReactElement> = {
  landing: () => <LandingPage />,
  login: () => <LoginPage />,
  signup: () => <SignupPage />,
  onboarding: () => (
    <RequireAuth>
      <OnboardingGate mode="require-incomplete">
        <OnboardingPage />
      </OnboardingGate>
    </RequireAuth>
  ),
  enroll: () => (
    <RequireAuth>
      <OnboardingGate mode="require-complete">
        <EnrollmentGate mode="require-incomplete">
          <EnrollPage />
        </EnrollmentGate>
      </OnboardingGate>
    </RequireAuth>
  ),
  dashboard: () => (
    <RequireAuth>
      <OnboardingGate mode="require-complete">
        <EnrollmentGate mode="require-complete">
          <DashboardRoute />
        </EnrollmentGate>
      </OnboardingGate>
    </RequireAuth>
  ),
  "practice-next": () => (
    <RequireAuth>
      <OnboardingGate mode="require-complete">
        <EnrollmentGate mode="require-complete">
          <PracticeNextRoute />
        </EnrollmentGate>
      </OnboardingGate>
    </RequireAuth>
  ),
  "practice-result": (params) => (
    <RequireAuth>
      <OnboardingGate mode="require-complete">
        <EnrollmentGate mode="require-complete">
          <PracticeResultRoute questionId={params.questionId ?? ""} />
        </EnrollmentGate>
      </OnboardingGate>
    </RequireAuth>
  ),
  "practice-autopsy": (params) => (
    <RequireAuth>
      <OnboardingGate mode="require-complete">
        <EnrollmentGate mode="require-complete">
          <PracticeAutopsyRoute questionId={params.questionId ?? ""} />
        </EnrollmentGate>
      </OnboardingGate>
    </RequireAuth>
  ),
  "practice-question": (params) => (
    <RequireAuth>
      <OnboardingGate mode="require-complete">
        <EnrollmentGate mode="require-complete">
          <PracticeQuestionRoute questionId={params.questionId ?? ""} />
        </EnrollmentGate>
      </OnboardingGate>
    </RequireAuth>
  )
};

export function AppRoutes(): ReactElement {
  const pathname = usePathname();

  for (const entry of ROUTE_TABLE) {
    const match = matchPath(entry.pattern, pathname);
    const render = match ? RENDERERS[entry.id] : undefined;
    if (match && render) return render(match.params);
  }

  return <NotFoundPage />;
}
