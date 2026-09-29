import { useEffect, useState } from "react";
import type { DashboardViewModel } from "../adapter/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { Dashboard } from "../components/Dashboard.js";
import { derivePrepStatus } from "../dashboard/prepStatus.js";
import { Button, Screen } from "../design/index.js";
import { useEnrollment } from "../enrollment/EnrollmentContext.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

type DashboardLoadState = { status: "loading" } | { status: "loaded"; dashboard: DashboardViewModel } | { status: "error" };

/**
 * `DashboardRoute` is only ever reached after `RequireAuth` +
 * `OnboardingGate(require-complete)` + `EnrollmentGate(require-complete)`
 * have all already resolved (see `router/AppRoutes.tsx`) -- `authState`
 * is guaranteed `"authenticated"` and `enrollmentState` is guaranteed
 * `"enrolled"` by the time this renders. The checks below are still
 * explicit, defensive fallbacks -- never assumed silently -- so a genuine
 * gate-composition regression fails safely (a loading message) instead of
 * crashing on an undefined access.
 *
 * The practice recommendation preview (`adapter.getDashboard()`) now goes
 * through the REAL, HTTP-backed adapter (Product Phase 1 Unit 10,
 * `createApiTrainingAdapter()` — selected once in `App.tsx`), which can
 * genuinely fail (network/server error) where the pre-Unit-10 fixture call
 * never could — `.catch()` below maps that to an explicit, student-safe
 * error state with a retry action, the same `.btn-row` two-action pattern
 * `PracticeNextRoute` already established in Unit 9. `dashboard.recommendation`
 * is used only for the on-page preview (headline/explanation/disabled
 * state); the "Start Practice" action itself does not navigate to a
 * dashboard-chosen question id (Product Phase 1 Unit 9) -- it hands off to
 * the real practice-entry boundary at `/practice/next`, which resolves the
 * next question itself via the same adapter. Dashboard.tsx never decides
 * what question comes next.
 */
export function DashboardRoute() {
  const { adapter } = usePracticeSession();
  const { state: authState } = useAuth();
  const { state: enrollmentState } = useEnrollment();
  const navigate = useNavigate();
  const [state, setState] = useState<DashboardLoadState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    adapter
      .getDashboard()
      .then((dashboard) => {
        if (!cancelled) setState({ status: "loaded", dashboard });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, retryCount]);

  const prepStatus = derivePrepStatus(enrollmentState);

  if (authState.status !== "authenticated" || !prepStatus) return <p className="loading-text">Loading your dashboard…</p>;
  if (state.status === "loading") return <p className="loading-text">Loading your dashboard…</p>;

  if (state.status === "error") {
    return (
      <Screen eyebrow="Dashboard" headline="We couldn't load your dashboard." subtext="Something went wrong. Please try again.">
        <Button onClick={() => setRetryCount((n) => n + 1)}>Retry</Button>
      </Screen>
    );
  }

  return (
    <Dashboard
      dashboard={state.dashboard}
      studentEmail={authState.student.email}
      prepStatus={prepStatus}
      onStart={() => navigate("/practice/next")}
    />
  );
}
