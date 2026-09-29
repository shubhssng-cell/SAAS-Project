import { describe, expect, it } from "vitest";
import { pageTitleForPath } from "../src/router/pageTitle.js";
import { ROUTE_TABLE } from "../src/router/routeTable.js";

describe("pageTitleForPath (Product Phase 1 Unit 11)", () => {
  it("gives each route its own title, so a tab/history entry/screen reader can tell screens apart", () => {
    expect(pageTitleForPath("/login")).toBe("Log in — IPMAT AI — Training");
    expect(pageTitleForPath("/dashboard")).toBe("Dashboard — IPMAT AI — Training");
    expect(pageTitleForPath("/practice/next")).toBe("Practice — IPMAT AI — Training");
    expect(pageTitleForPath("/practice/q-1")).toBe("Question — IPMAT AI — Training");
    expect(pageTitleForPath("/practice/q-1/result")).toBe("Result — IPMAT AI — Training");
    expect(pageTitleForPath("/practice/q-1/autopsy")).toBe("Review — IPMAT AI — Training");
  });

  it("titles an unknown URL as not-found rather than inheriting a real screen's title", () => {
    expect(pageTitleForPath("/nope")).toBe("Page not found — IPMAT AI — Training");
  });

  it("every ROUTE_TABLE entry has a distinct title -- a new route can't silently fall back to the generic one", () => {
    const samples: Record<string, string> = {
      landing: "/",
      login: "/login",
      signup: "/signup",
      onboarding: "/onboarding",
      enroll: "/enroll",
      dashboard: "/dashboard",
      "practice-next": "/practice/next",
      "practice-result": "/practice/x/result",
      "practice-autopsy": "/practice/x/autopsy",
      "practice-question": "/practice/x"
    };
    expect(Object.keys(samples).sort()).toEqual(ROUTE_TABLE.map((r) => r.id).sort());
    const titles = ROUTE_TABLE.map((r) => pageTitleForPath(samples[r.id]!));
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) expect(title).not.toBe("IPMAT AI — Training");
  });
});
