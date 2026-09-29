import type { RecommendationViewModel } from "../adapter/index.js";
import { Button, Card } from "../design/index.js";

export function RecommendationCard({ recommendation, actionLabel, onAction }: { recommendation: RecommendationViewModel; actionLabel: string; onAction: () => void }) {
  return (
    <Card>
      <span className="badge">{recommendation.modeLabel}</span>
      <h2 className="headline headline-compact">{recommendation.headline}</h2>
      <p className="subtext" style={{ marginBottom: 20 }}>
        {recommendation.explanation}
      </p>
      <Button block onClick={onAction} disabled={!recommendation.questionId}>
        {recommendation.questionId ? actionLabel : "Nothing to start yet"}
      </Button>
    </Card>
  );
}
