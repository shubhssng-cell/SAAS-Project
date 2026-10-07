/**
 * Pure route pattern data (id + pattern string, no JSX) so this table's
 * coverage and precedence can be unit-tested without a DOM or React
 * rendering. `AppRoutes.tsx` maps each id to its actual page component.
 *
 * Order matters: a literal segment (`/practice/next`) must be listed
 * before the param route it would otherwise also match
 * (`/practice/:questionId`) -- `matchPath()` is checked top to bottom and
 * returns the first match, the same pattern `apps/api/src/server.ts`'s own
 * `ROUTES` table already uses.
 */
export interface RouteTableEntry {
  id: string;
  pattern: string;
}

export const ROUTE_TABLE: RouteTableEntry[] = [
  { id: "landing", pattern: "/" },
  { id: "login", pattern: "/login" },
  { id: "signup", pattern: "/signup" },
  { id: "onboarding", pattern: "/onboarding" },
  { id: "enroll", pattern: "/enroll" },
  { id: "dashboard", pattern: "/dashboard" },
  { id: "practice-next", pattern: "/practice/next" },
  { id: "practice-result", pattern: "/practice/:questionId/result" },
  { id: "practice-autopsy", pattern: "/practice/:questionId/autopsy" },
  { id: "practice-question", pattern: "/practice/:questionId" },
  // Phase 5 Unit 1 -- deliberate training. Literal/longer patterns first, like the practice routes above.
  { id: "training", pattern: "/training" },
  { id: "training-result", pattern: "/training/:sessionId/result/:questionId" },
  { id: "training-session", pattern: "/training/:sessionId" },
  // Phase 9 Unit 4 -- plan, access and usage. Authenticated, but deliberately not behind enrollment: entitlement and enrollment are separate.
  { id: "billing", pattern: "/billing" }
];
