import { useEffect, useState } from "react";
import type { RecommendationViewModel } from "../adapter/index.js";
import { NextTrainingCard } from "../components/NextTrainingCard.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

export function PracticeNextRoute() {
  const { adapter } = usePracticeSession();
  const navigate = useNavigate();
  const [recommendation, setRecommendation] = useState<RecommendationViewModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    adapter.getNextRecommendation().then((result) => {
      if (!cancelled) setRecommendation(result);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  if (!recommendation) return <p className="loading-text">Finding what's next…</p>;

  return (
    <NextTrainingCard
      recommendation={recommendation}
      onContinue={() => (recommendation.questionId ? navigate(`/practice/${recommendation.questionId}`) : navigate("/dashboard"))}
    />
  );
}
