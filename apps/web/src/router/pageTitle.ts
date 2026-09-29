import { matchPath } from "./match.js";
import { ROUTE_TABLE } from "./routeTable.js";

const APP_TITLE = "IPMAT AI — Training";

const ROUTE_TITLES: Record<string, string> = {
  landing: "Welcome",
  login: "Log in",
  signup: "Sign up",
  onboarding: "Getting started",
  enroll: "Enroll",
  dashboard: "Dashboard",
  "practice-next": "Practice",
  "practice-result": "Result",
  "practice-autopsy": "Review",
  "practice-question": "Question"
};

/**
 * The document title for a URL (Product Phase 1 Unit 11) -- a single-page app never reloads,
 * so without this every route shares one tab/history/screen-reader title. Pure and driven by
 * the same `ROUTE_TABLE` `AppRoutes` renders from, so a new route can't silently keep a stale title.
 */
export function pageTitleForPath(pathname: string): string {
  for (const entry of ROUTE_TABLE) {
    if (matchPath(entry.pattern, pathname)) {
      const title = ROUTE_TITLES[entry.id];
      return title ? `${title} — ${APP_TITLE}` : APP_TITLE;
    }
  }
  return `Page not found — ${APP_TITLE}`;
}
