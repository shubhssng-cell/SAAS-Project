import type { AuthFailure } from "./failureMapping.js";

/** `onboardingCompletedAt` (Product Phase 1 Unit 6) is `null` until the server records completion -- this is the ONE server-authoritative fact `OnboardingGate` reads; it is never derived, cached, or overridden client-side. */
export interface StudentAccountDto {
  id: string;
  email: string;
  createdAt: string;
  onboardingCompletedAt: string | null;
}

/**
 * A small, explicit state model -- exactly the four states this unit's
 * instructions name, no more. `"error"` is reserved for a genuine
 * network/infrastructure failure during hydration -- a `401` from
 * `/v1/auth/me` is `"unauthenticated"`, never `"error"` (a 401 is the
 * ordinary, expected answer for "you're not logged in," not a broken
 * service -- conflating the two would hide a real outage behind a normal
 * login screen).
 */
export type AuthState = { status: "loading" } | { status: "unauthenticated" } | { status: "authenticated"; student: StudentAccountDto } | { status: "error"; message: string };

export type AuthEvent =
  | { type: "HYDRATE_AUTHENTICATED"; student: StudentAccountDto }
  | { type: "HYDRATE_UNAUTHENTICATED" }
  | { type: "HYDRATE_ERROR"; message: string }
  | { type: "SIGNED_UP"; student: StudentAccountDto }
  | { type: "LOGGED_IN"; student: StudentAccountDto }
  | { type: "LOGGED_OUT" }
  | { type: "ONBOARDING_COMPLETED"; student: StudentAccountDto };

/**
 * Pure state transition function -- no I/O, no React, fully unit-testable
 * on its own. `AuthProvider` (`AuthContext.tsx`) is a thin `useReducer`
 * wrapper around this; every actual decision about what the NEXT state
 * should be lives here, not scattered across event handlers.
 */
export function authReducer(_state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case "HYDRATE_AUTHENTICATED":
    case "SIGNED_UP":
    case "LOGGED_IN":
    case "ONBOARDING_COMPLETED":
      return { status: "authenticated", student: event.student };
    case "HYDRATE_UNAUTHENTICATED":
    case "LOGGED_OUT":
      return { status: "unauthenticated" };
    case "HYDRATE_ERROR":
      return { status: "error", message: event.message };
  }
}

export function failureToHydrateEvent(failure: AuthFailure): AuthEvent {
  if (failure.kind === "not_authenticated") return { type: "HYDRATE_UNAUTHENTICATED" };
  const message = failure.kind === "network_error" ? "We couldn't reach the server. Check your connection and try again." : failure.message;
  return { type: "HYDRATE_ERROR", message };
}
