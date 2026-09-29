import type { RecommendationViewModel } from "../adapter/index.js";
import { Screen } from "../design/index.js";
import { RecommendationCard } from "./RecommendationCard.js";

export function NextTrainingCard({ recommendation, onContinue }: { recommendation: RecommendationViewModel; onContinue: () => void }) {
  return (
    <Screen eyebrow="Up next" headline="Here's what we'd focus on now.">
      <RecommendationCard recommendation={recommendation} actionLabel="Continue to next question" onAction={onContinue} />
    </Screen>
  );
}
