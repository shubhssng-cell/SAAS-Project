import { useEffect, useState } from "react";
import type { DashboardViewModel } from "../adapter/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { Dashboard } from "../components/Dashboard.js";
import { derivePrepStatus } from "../dashboard/prepStatus.js";
import { useEnrollment } from "../enrollment/EnrollmentContext.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

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
 * The practice recommendation preview itself (`adapter.getDashboard()`) is
 * completely UNCHANGED from Unit 5 -- still the same fixture-backed
 * `TrainingRecommendationAdapter`. `dashboard.recommendation` is used only
 * for the on-page preview (headline/explanation/disabled state); the
 * "Start Practice" action itself no longer navigates to a dashboard-chosen
 * question id (Product Phase 1 Unit 9) -- it hands off to the real
 * practice-entry boundary at `/practice/next`, which resolves the next
 * question itself via the same adapter. Dashboard.tsx never decides what
 * question comes next.
 */
export function DashboardRoute() {
  const { adapter } = usePracticeSession();
  const { state: authState } = useAuth();
  const { state: enrollmentState } = useEnrollment();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<DashboardViewModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    adapter.getDashboard().then((result) => {
      if (!cancelled) setDashboard(result);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const prepStatus = derivePrepStatus(enrollmentState);

  if (authState.status !== "authenticated" || !prepStatus) return <p className="loading-text">Loading your dashboard…</p>;
  if (!dashboard) return <p className="loading-text">Loading your dashboard…</p>;

  return (
    <Dashboard
      dashboard={dashboard}
      studentEmail={authState.student.email}
      prepStatus={prepStatus}
      onStart={() => navigate("/practice/next")}
    />
  );
}
