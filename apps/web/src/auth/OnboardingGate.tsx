import { useEffect, type ReactElement } from "react";
import { LoadingState } from "../design/index.js";
import { useNavigate } from "../router/router.js";
import { useAuth } from "./AuthContext.js";
import { decideOnboardingGateAccess, type OnboardingGateMode } from "./routeAccess.js";

/**
 * Must be rendered INSIDE `RequireAuth` -- its parent already guarantees
 * `state.status === "authenticated"` by the time this renders, so this
 * component adds ONLY the onboarding-specific branch (see
 * `decideOnboardingGateAccess()`), never re-handles loading/error/
 * unauthenticated. Presentational only -- the server (`onboardingCompletedAt`
 * on the verified session's student) remains the sole authority; a
 * redirect here is a UX convenience, not a security boundary.
 */
export function OnboardingGate({ mode, children }: { mode: OnboardingGateMode; children: ReactElement }): ReactElement {
  const { state } = useAuth();
  const navigate = useNavigate();
  const completed = state.status === "authenticated" && state.student.onboardingCompletedAt !== null;
  const decision = state.status === "authenticated" ? decideOnboardingGateAccess(completed, mode) : "redirect";
  const redirectTo = mode === "require-incomplete" ? "/dashboard" : "/onboarding";

  useEffect(() => {
    if (state.status === "authenticated" && decision === "redirect") navigate(redirectTo);
  }, [state.status, decision, redirectTo, navigate]);

  if (state.status === "authenticated" && decision === "render") return children;
  return <LoadingState message="Redirecting…" />;
}
