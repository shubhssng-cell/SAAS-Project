import type { ReactElement } from "react";
import { RequireAuth } from "../auth/RequireAuth.js";
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
 */
const RENDERERS: Record<string, (params: Record<string, string>) => ReactElement> = {
  landing: () => <LandingPage />,
  login: () => <LoginPage />,
  signup: () => <SignupPage />,
  onboarding: () => <OnboardingPage />,
  enroll: () => <EnrollPage />,
  dashboard: () => (
    <RequireAuth>
      <DashboardRoute />
    </RequireAuth>
  ),
  "practice-next": () => (
    <RequireAuth>
      <PracticeNextRoute />
    </RequireAuth>
  ),
  "practice-result": (params) => (
    <RequireAuth>
      <PracticeResultRoute questionId={params.questionId ?? ""} />
    </RequireAuth>
  ),
  "practice-autopsy": (params) => (
    <RequireAuth>
      <PracticeAutopsyRoute questionId={params.questionId ?? ""} />
    </RequireAuth>
  ),
  "practice-question": (params) => (
    <RequireAuth>
      <PracticeQuestionRoute questionId={params.questionId ?? ""} />
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
