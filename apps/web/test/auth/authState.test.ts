import { describe, expect, it } from "vitest";
import { authReducer, failureToHydrateEvent, type AuthState, type StudentAccountDto } from "../../src/auth/authState.js";

const STUDENT: StudentAccountDto = { id: "student-1", email: "student@example.com", createdAt: "2026-09-29T00:00:00.000Z", onboardingCompletedAt: null };
const LOADING: AuthState = { status: "loading" };

describe("authReducer", () => {
  it("HYDRATE_AUTHENTICATED -> authenticated with the student", () => {
    expect(authReducer(LOADING, { type: "HYDRATE_AUTHENTICATED", student: STUDENT })).toEqual({ status: "authenticated", student: STUDENT });
  });

  it("HYDRATE_UNAUTHENTICATED -> unauthenticated (a 401 is this, never 'error')", () => {
    expect(authReducer(LOADING, { type: "HYDRATE_UNAUTHENTICATED" })).toEqual({ status: "unauthenticated" });
  });

  it("HYDRATE_ERROR -> error with the message, never silently becoming unauthenticated", () => {
    expect(authReducer(LOADING, { type: "HYDRATE_ERROR", message: "We couldn't reach the server." })).toEqual({ status: "error", message: "We couldn't reach the server." });
  });

  it("SIGNED_UP -> authenticated", () => {
    expect(authReducer(LOADING, { type: "SIGNED_UP", student: STUDENT })).toEqual({ status: "authenticated", student: STUDENT });
  });

  it("LOGGED_IN -> authenticated, from any prior state (e.g. a prior error state recovers on successful login)", () => {
    const errorState: AuthState = { status: "error", message: "prior failure" };
    expect(authReducer(errorState, { type: "LOGGED_IN", student: STUDENT })).toEqual({ status: "authenticated", student: STUDENT });
  });

  it("LOGGED_OUT -> unauthenticated, from an authenticated state", () => {
    const authenticated: AuthState = { status: "authenticated", student: STUDENT };
    expect(authReducer(authenticated, { type: "LOGGED_OUT" })).toEqual({ status: "unauthenticated" });
  });

  it("ONBOARDING_COMPLETED -> authenticated with the updated (onboardingCompletedAt-set) student", () => {
    const updated: StudentAccountDto = { ...STUDENT, onboardingCompletedAt: "2026-09-29T01:00:00.000Z" };
    const authenticated: AuthState = { status: "authenticated", student: STUDENT };
    expect(authReducer(authenticated, { type: "ONBOARDING_COMPLETED", student: updated })).toEqual({ status: "authenticated", student: updated });
  });
});

describe("failureToHydrateEvent", () => {
  it("not_authenticated -> HYDRATE_UNAUTHENTICATED (never HYDRATE_ERROR)", () => {
    expect(failureToHydrateEvent({ kind: "not_authenticated" })).toEqual({ type: "HYDRATE_UNAUTHENTICATED" });
  });

  it("network_error -> HYDRATE_ERROR with an honest, distinct message from a 401", () => {
    const event = failureToHydrateEvent({ kind: "network_error" });
    expect(event.type).toBe("HYDRATE_ERROR");
    expect((event as { message: string }).message).toMatch(/couldn't reach the server/i);
  });

  it("an unexpected failure -> HYDRATE_ERROR carrying its own message", () => {
    const event = failureToHydrateEvent({ kind: "unexpected", message: "Something went wrong. Please try again." });
    expect(event).toEqual({ type: "HYDRATE_ERROR", message: "Something went wrong. Please try again." });
  });
});
