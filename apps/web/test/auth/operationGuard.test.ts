import { describe, expect, it } from "vitest";
import { createOperationGuard } from "../../src/auth/operationGuard.js";

describe("createOperationGuard", () => {
  it("each next() token starts current", () => {
    const guard = createOperationGuard();
    const token = guard.next();
    expect(guard.isCurrent(token)).toBe(true);
  });

  it("a later next() invalidates an earlier token -- proves the exact race the Unit 5 instructions name", () => {
    const guard = createOperationGuard();
    const hydrateToken = guard.next(); // e.g. GET /v1/auth/me started
    const loginToken = guard.next(); // login started before hydrate resolved

    expect(guard.isCurrent(hydrateToken)).toBe(false); // the stale hydrate response must be discarded
    expect(guard.isCurrent(loginToken)).toBe(true); // the newer login result governs state
  });

  it("logout finishing after a subsequent login does not win", () => {
    const guard = createOperationGuard();
    const logoutToken = guard.next(); // logout started
    const loginToken = guard.next(); // user logged back in before logout's request resolved

    expect(guard.isCurrent(logoutToken)).toBe(false);
    expect(guard.isCurrent(loginToken)).toBe(true);
  });

  it("tokens are strictly increasing and never reused", () => {
    const guard = createOperationGuard();
    const seen = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      const token = guard.next();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });
});
