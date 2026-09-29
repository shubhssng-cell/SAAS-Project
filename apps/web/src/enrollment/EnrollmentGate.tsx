import { useEffect, type ReactElement } from "react";
import type { OnboardingGateMode } from "../auth/routeAccess.js";
import { useNavigate } from "../router/router.js";
import { useEnrollment } from "./EnrollmentContext.js";
import { decideEnrollmentGateAccess } from "./routeAccess.js";

/**
 * Enrollment route protection (Product Phase 1 Unit 7) -- must be
 * rendered INSIDE `RequireAuth` (guarantees authenticated) and, for the
 * post-onboarding shell, inside `OnboardingGate mode="require-complete"`
 * too (guarantees onboarding is done). `require-incomplete` is the
 * `/enroll` screen itself (redirects an already-enrolled student to
 * `/dashboard`); `require-complete` is the authenticated shell (redirects
 * a not-yet-enrolled student to `/enroll`).
 *
 * Never redirects while enrollment state is unresolved (`idle`/`loading`/
 * `error` all map to `"unresolved"` via `decideEnrollmentGateAccess()`) --
 * only a real, server-derived `"enrolled"`/`"not-enrolled"` answer can
 * trigger a redirect, so there is no window where this gate could bounce
 * a student based on a guess.
 *
 * PRESENTATIONAL only -- a frontend redirect, not a security boundary;
 * the server remains authoritative.
 */
export function EnrollmentGate({ mode, children }: { mode: OnboardingGateMode; children: ReactElement }): ReactElement {
  const { state } = useEnrollment();
  const navigate = useNavigate();
  const redirectTo = mode === "require-incomplete" ? "/dashboard" : "/enroll";
  const decision = decideEnrollmentGateAccess(state.status, mode);

  useEffect(() => {
    if (decision === "redirect") navigate(redirectTo);
  }, [decision, redirectTo, navigate]);

  if (decision === "render") return children;

  if (state.status === "error") {
    return <p className="loading-text">We couldn't check your enrollment status. Please refresh the page.</p>;
  }

  // idle / loading / the brief moment before the redirect effect above fires.
  return <p className="loading-text">Checking your enrollment…</p>;
}
