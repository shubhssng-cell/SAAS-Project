import { describe, expect, it } from "vitest";
import { decideOnboardingGateAccess, decideProtectedRouteAccess } from "../../src/auth/routeAccess.js";

describe("decideProtectedRouteAccess", () => {
  it("authenticated -> render", () => {
    expect(decideProtectedRouteAccess("authenticated")).toBe("render");
  });

  it("loading -> loading (never renders the protected content early)", () => {
    expect(decideProtectedRouteAccess("loading")).toBe("loading");
  });

  it("unauthenticated -> redirect-to-login", () => {
    expect(decideProtectedRouteAccess("unauthenticated")).toBe("redirect-to-login");
  });

  it("error -> error (never silently redirects to login for a broken service)", () => {
    expect(decideProtectedRouteAccess("error")).toBe("error");
  });
});

describe("decideOnboardingGateAccess", () => {
  describe('mode "require-incomplete" (the /onboarding screen itself)', () => {
    it("renders when onboarding is NOT yet completed", () => {
      expect(decideOnboardingGateAccess(false, "require-incomplete")).toBe("render");
    });

    it("redirects (to /dashboard) when onboarding IS already completed -- not shown as a required step again", () => {
      expect(decideOnboardingGateAccess(true, "require-incomplete")).toBe("redirect");
    });
  });

  describe('mode "require-complete" (the post-onboarding shell: /dashboard, practice routes)', () => {
    it("renders when onboarding IS completed", () => {
      expect(decideOnboardingGateAccess(true, "require-complete")).toBe("render");
    });

    it("redirects (to /onboarding) when onboarding is NOT yet completed -- a new student is directed through onboarding before dashboard access", () => {
      expect(decideOnboardingGateAccess(false, "require-complete")).toBe("redirect");
    });
  });
});
