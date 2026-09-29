import type { RecommendationViewModel } from "../adapter/index.js";
import { Button, Card } from "../design/index.js";
import { describeRecommendation } from "../practice/practiceEntry.js";

export function RecommendationCard({ recommendation, actionLabel, onAction }: { recommendation: RecommendationViewModel; actionLabel: string; onAction: () => void }) {
  const display = describeRecommendation(recommendation);

  return (
    <Card>
      {display.badge && <span className="badge">{display.badge}</span>}
      <h2 className="headline headline-compact">{display.headline}</h2>
      {display.explanation && <p className="subtext recommendation-explanation">{display.explanation}</p>}
      <Button block onClick={onAction} disabled={!recommendation.questionId}>
        {recommendation.questionId ? actionLabel : "Nothing to start yet"}
      </Button>
    </Card>
  );
}
