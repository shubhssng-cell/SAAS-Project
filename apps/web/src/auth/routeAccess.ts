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
