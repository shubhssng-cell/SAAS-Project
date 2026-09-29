import { describe, expect, it } from "vitest";
import { decideEnrollmentGateAccess } from "../../src/enrollment/routeAccess.js";

describe("decideEnrollmentGateAccess", () => {
  describe('mode "require-incomplete" (the /enroll screen itself)', () => {
    it("renders when not-enrolled", () => {
      expect(decideEnrollmentGateAccess("not-enrolled", "require-incomplete")).toBe("render");
    });

    it("redirects (to /dashboard) when already enrolled", () => {
      expect(decideEnrollmentGateAccess("enrolled", "require-incomplete")).toBe("redirect");
    });
  });

  describe('mode "require-complete" (the authenticated shell: /dashboard, practice routes)', () => {
    it("renders when enrolled", () => {
      expect(decideEnrollmentGateAccess("enrolled", "require-complete")).toBe("render");
    });

    it("redirects (to /enroll) when not-enrolled", () => {
      expect(decideEnrollmentGateAccess("not-enrolled", "require-complete")).toBe("redirect");
    });
  });

  describe("unresolved statuses never redirect, regardless of mode", () => {
    it.each(["idle", "loading", "error"] as const)("status %s -> unresolved for require-incomplete", (status) => {
      expect(decideEnrollmentGateAccess(status, "require-incomplete")).toBe("unresolved");
    });

    it.each(["idle", "loading", "error"] as const)("status %s -> unresolved for require-complete", (status) => {
      expect(decideEnrollmentGateAccess(status, "require-complete")).toBe("unresolved");
    });
  });
});
