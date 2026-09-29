import { useEffect, useState } from "react";
import type { RecommendationViewModel } from "../adapter/index.js";
import { NextTrainingCard } from "../components/NextTrainingCard.js";
import { Button, Screen } from "../design/index.js";
import { decidePracticeEntryOutcome } from "../practice/practiceEntry.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

type PracticeNextState = { status: "loading" } | { status: "loaded"; recommendation: RecommendationViewModel } | { status: "error" };

/**
 * The one real practice-entry boundary (Product Phase 1 Unit 9) -- reached
 * from the dashboard's "Start Practice" action and from the existing
 * result/autopsy "Continue" actions (all three already navigated here
 * before this unit; only this route's own handling of the empty/error case
 * was incomplete). Asks the EXISTING `TrainingRecommendationAdapter` for
 * the next item via `getNextRecommendation()` -- the same call this route
 * already made -- and does nothing else: no recommendation logic of its
 * own, no second decision engine. `decidePracticeEntryOutcome()` only names
 * the "nothing to recommend" branch `RecommendationViewModel` already
 * encodes as `questionId: null`.
 */
export function PracticeNextRoute() {
  const { adapter } = usePracticeSession();
  const navigate = useNavigate();
  const [state, setState] = useState<PracticeNextState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    adapter
      .getNextRecommendation()
      .then((recommendation) => {
        if (!cancelled) setState({ status: "loaded", recommendation });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, retryCount]);

  if (state.status === "loading") return <p className="loading-text">Finding your next question…</p>;

  if (state.status === "error") {
    return (
      <Screen eyebrow="Practice" headline="We couldn't load your next question." subtext="Something went wrong. Please try again.">
        <div className="btn-row">
          <Button onClick={() => setRetryCount((n) => n + 1)}>Try again</Button>
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </Screen>
    );
  }

  const outcome = decidePracticeEntryOutcome(state.recommendation);

  if (outcome.kind === "unavailable") {
    return (
      <Screen eyebrow="Practice" headline="Practice isn't available right now." subtext="There's nothing to practice at the moment — check back soon.">
        <Button onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
      </Screen>
    );
  }

  return <NextTrainingCard recommendation={state.recommendation} onContinue={() => navigate(`/practice/${outcome.questionId}`)} />;
}
