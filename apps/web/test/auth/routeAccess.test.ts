import { describe, expect, it } from "vitest";
import { decideProtectedRouteAccess } from "../../src/auth/routeAccess.js";

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
