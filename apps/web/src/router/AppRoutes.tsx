import type { ReactElement } from "react";
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
const RENDERERS: Record<string, (params: Record<string, string>) => ReactElement> = {
  landing: () => <LandingPage />,
  login: () => <LoginPage />,
  signup: () => <SignupPage />,
  onboarding: () => <OnboardingPage />,
  enroll: () => <EnrollPage />,
  dashboard: () => <DashboardRoute />,
  "practice-next": () => <PracticeNextRoute />,
  "practice-result": (params) => <PracticeResultRoute questionId={params.questionId ?? ""} />,
  "practice-autopsy": (params) => <PracticeAutopsyRoute questionId={params.questionId ?? ""} />,
  "practice-question": (params) => <PracticeQuestionRoute questionId={params.questionId ?? ""} />
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
