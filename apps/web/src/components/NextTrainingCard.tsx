import type { RecommendationViewModel } from "../adapter/index.js";
import { RecommendationCard } from "./RecommendationCard.js";

export function NextTrainingCard({ recommendation, onContinue }: { recommendation: RecommendationViewModel; onContinue: () => void }) {
  return (
    <div className="screen">
      <p className="eyebrow">Up next</p>
      <h1 className="headline">Here's what we'd focus on now.</h1>
      <RecommendationCard recommendation={recommendation} actionLabel="Continue to next question" onAction={onContinue} />
    </div>
  );
}
