import type { DashboardViewModel } from "../adapter/index.js";
import { RecommendationCard } from "./RecommendationCard.js";

export function Dashboard({ dashboard, onStart }: { dashboard: DashboardViewModel; onStart: () => void }) {
  return (
    <div className="screen">
      <p className="eyebrow">Dashboard</p>
      <h1 className="headline">Welcome back.</h1>
      <p className="subtext">
        {dashboard.questionsPracticedSoFar === 0
          ? "Let's see how you approach a few questions before we personalize anything."
          : `You've worked through ${dashboard.questionsPracticedSoFar} question${dashboard.questionsPracticedSoFar === 1 ? "" : "s"} so far. Here's what we'd focus on next.`}
      </p>
      <RecommendationCard recommendation={dashboard.recommendation} actionLabel="Start training" onAction={onStart} />
    </div>
  );
}
