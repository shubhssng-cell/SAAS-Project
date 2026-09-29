import { useEffect, type ReactElement } from "react";
import { Button, LoadingState, Screen } from "../design/index.js";
import { useNavigate } from "../router/router.js";
import { useAuth } from "./AuthContext.js";
import { decideProtectedRouteAccess } from "./routeAccess.js";

/**
 * Route protection for the authenticated shell (`/dashboard`, the practice
 * routes) — PRESENTATIONAL only, per this unit's scope: a frontend
 * redirect is not a security boundary, the server remains the sole
 * authority (every practice route call still goes through the existing,
 * unmodified fixture adapter in this unit — see PHASE_1_PLATFORM_SHELL.md's
 * Unit 5 summary for what "authenticated shell" means before Unit 10 wires
 * real practice traffic).
 */
export function RequireAuth({ children }: { children: ReactElement }): ReactElement {
  const { state } = useAuth();
  const navigate = useNavigate();
  const decision = decideProtectedRouteAccess(state.status);

  useEffect(() => {
    if (decision === "redirect-to-login") navigate("/login");
  }, [decision, navigate]);

  if (decision === "render") return children;

  if (decision === "error") {
    const message = state.status === "error" ? state.message : "Please check your connection and try again.";
    return (
      <Screen role="alert" eyebrow="Connection problem" headline="We couldn't reach the server." subtext={message}>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </Screen>
    );
  }

  // "loading" (hydrating) or "redirect-to-login" (a brief flash before the effect above navigates away).
  return <LoadingState message="Checking your session…" />;
}
