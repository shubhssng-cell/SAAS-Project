import { describe, expect, it } from "vitest";
import { matchPath } from "../src/router/match.js";
import { ROUTE_TABLE } from "../src/router/routeTable.js";

/**
 * Tests the router's pure data/logic (pattern table + matcher) directly,
 * without rendering React or requiring a DOM -- apps/web has no jsdom/
 * testing-library dependency, and this unit deliberately avoids adding one
 * (see PHASE_1_PLATFORM_SHELL.md Unit 2 notes on the "minimum appropriate
 * dependency" rule). `AppRoutes.tsx` is a thin, untested-by-design wrapper
 * that only maps these same ids to JSX -- the routing behavior itself
 * lives entirely in `matchPath`/`ROUTE_TABLE`.
 */

const REQUIRED_ROUTES: Array<{ id: string; pattern: string }> = [
  { id: "landing", pattern: "/" },
  { id: "login", pattern: "/login" },
  { id: "signup", pattern: "/signup" },
  { id: "onboarding", pattern: "/onboarding" },
  { id: "enroll", pattern: "/enroll" },
  { id: "dashboard", pattern: "/dashboard" },
  { id: "practice-next", pattern: "/practice/next" },
  { id: "practice-result", pattern: "/practice/:questionId/result" },
  { id: "practice-autopsy", pattern: "/practice/:questionId/autopsy" },
  { id: "practice-question", pattern: "/practice/:questionId" }
];

describe("ROUTE_TABLE -- covers every route required by Product Phase 1 Unit 2", () => {
  it("contains exactly the required route ids and patterns", () => {
    expect(ROUTE_TABLE).toEqual(REQUIRED_ROUTES);
  });

  it("lists /practice/next before the generic /practice/:questionId param route", () => {
    const nextIndex = ROUTE_TABLE.findIndex((r) => r.id === "practice-next");
    const questionIndex = ROUTE_TABLE.findIndex((r) => r.id === "practice-question");
    expect(nextIndex).toBeGreaterThanOrEqual(0);
    expect(questionIndex).toBeGreaterThan(nextIndex);
  });

  it("lists /practice/:questionId/result and /practice/:questionId/autopsy before /practice/:questionId", () => {
    const resultIndex = ROUTE_TABLE.findIndex((r) => r.id === "practice-result");
    const autopsyIndex = ROUTE_TABLE.findIndex((r) => r.id === "practice-autopsy");
    const questionIndex = ROUTE_TABLE.findIndex((r) => r.id === "practice-question");
    expect(questionIndex).toBeGreaterThan(resultIndex);
    expect(questionIndex).toBeGreaterThan(autopsyIndex);
  });
});

/** Resolves a pathname against ROUTE_TABLE the same way AppRoutes.tsx does: first match wins. */
function resolve(pathname: string): string | null {
  for (const entry of ROUTE_TABLE) {
    if (matchPath(entry.pattern, pathname)) return entry.id;
  }
  return null;
}

describe("matchPath -- deep-linking resolves every required route directly, with no dependency on visiting / first", () => {
  it.each([
    ["/", "landing"],
    ["/login", "login"],
    ["/signup", "signup"],
    ["/onboarding", "onboarding"],
    ["/enroll", "enroll"],
    ["/dashboard", "dashboard"],
    ["/practice/next", "practice-next"],
    ["/practice/q-reverse-1/result", "practice-result"],
    ["/practice/q-reverse-1/autopsy", "practice-autopsy"],
    ["/practice/q-reverse-1", "practice-question"]
  ])("resolves %s to the %s route", (pathname, expectedId) => {
    expect(resolve(pathname)).toBe(expectedId);
  });

  it("extracts questionId from a practice question URL", () => {
    const match = matchPath("/practice/:questionId", "/practice/q-percentage-repair-1");
    expect(match?.params).toEqual({ questionId: "q-percentage-repair-1" });
  });

  it("extracts questionId from a practice result/autopsy URL, leaving the trailing segment matched literally", () => {
    expect(matchPath("/practice/:questionId/result", "/practice/q-reverse-1/result")?.params).toEqual({ questionId: "q-reverse-1" });
    expect(matchPath("/practice/:questionId/autopsy", "/practice/q-reverse-1/autopsy")?.params).toEqual({ questionId: "q-reverse-1" });
  });

  it("does not resolve an unknown path to any route", () => {
    expect(resolve("/does-not-exist")).toBeNull();
    expect(resolve("/practice/q-1/unknown-subpath")).toBeNull();
  });

  it("treats a trailing slash the same as no trailing slash", () => {
    expect(resolve("/dashboard/")).toBe("dashboard");
  });
});
