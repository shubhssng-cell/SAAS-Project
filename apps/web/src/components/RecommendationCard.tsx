import type { RecommendationViewModel } from "../adapter/index.js";

export function RecommendationCard({ recommendation, actionLabel, onAction }: { recommendation: RecommendationViewModel; actionLabel: string; onAction: () => void }) {
  return (
    <div className="card">
      <span className="badge">{recommendation.modeLabel}</span>
      <h2 className="headline" style={{ fontSize: "1.4rem" }}>
        {recommendation.headline}
      </h2>
      <p className="subtext" style={{ marginBottom: 20 }}>
        {recommendation.explanation}
      </p>
      <button type="button" className="btn btn-primary btn-block" onClick={onAction} disabled={!recommendation.questionId}>
        {recommendation.questionId ? actionLabel : "Nothing to start yet"}
      </button>
    </div>
  );
}
