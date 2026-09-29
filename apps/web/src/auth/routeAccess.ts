import type { AuthState } from "./authState.js";

/** Pure decision, unit-testable without rendering — `RequireAuth.tsx` is a thin wrapper that calls this and renders accordingly. Presentational only (Product Phase 1 Unit 5's own scope) — the server remains the sole security boundary; this never grants or denies real access. */
export type RouteAccessDecision = "render" | "redirect-to-login" | "loading" | "error";

export function decideProtectedRouteAccess(status: AuthState["status"]): RouteAccessDecision {
  switch (status) {
    case "authenticated":
      return "render";
    case "loading":
      return "loading";
    case "unauthenticated":
      return "redirect-to-login";
    case "error":
      return "error";
  }
}

/**
 * Product Phase 1 Unit 6 -- the onboarding-specific branch, layered ONLY
 * on top of an already-`"authenticated"` state (a caller must be nested
 * inside `RequireAuth`, which already resolved loading/error/
 * unauthenticated before this ever runs). `"require-incomplete"` is the
 * `/onboarding` screen itself: an already-onboarded student is sent to
 * `/dashboard` (onboarding is a one-time step, not a revisitable page).
 * `"require-complete"` is the post-onboarding shell (`/dashboard`, every
 * practice route): a student who hasn't finished onboarding yet is sent
 * to `/onboarding` instead of the real content.
 */
export type OnboardingGateMode = "require-incomplete" | "require-complete";

export function decideOnboardingGateAccess(onboardingCompleted: boolean, mode: OnboardingGateMode): "render" | "redirect" {
  const satisfied = mode === "require-incomplete" ? !onboardingCompleted : onboardingCompleted;
  return satisfied ? "render" : "redirect";
}
