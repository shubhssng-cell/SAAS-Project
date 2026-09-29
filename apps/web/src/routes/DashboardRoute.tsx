import { useEffect, useState } from "react";
import type { DashboardViewModel } from "../adapter/index.js";
import { Dashboard } from "../components/Dashboard.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

export function DashboardRoute() {
  const { adapter } = usePracticeSession();
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

  if (!dashboard) return <p className="loading-text">Loading your dashboard…</p>;

  return <Dashboard dashboard={dashboard} onStart={() => navigate(`/practice/${dashboard.recommendation.questionId ?? "q-reverse-1"}`)} />;
}
