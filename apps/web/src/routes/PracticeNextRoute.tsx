import { useEffect, useState } from "react";
import { isSessionExpiredError, type RecommendationViewModel } from "../adapter/index.js";
import { FailureScreen } from "../components/FailureScreen.js";
import { NextTrainingCard } from "../components/NextTrainingCard.js";
import { Button, LoadingState, Screen } from "../design/index.js";
import { decidePracticeEntryOutcome, PRACTICE_UNAVAILABLE_COPY } from "../practice/practiceEntry.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

type PracticeNextState = { status: "loading" } | { status: "loaded"; recommendation: RecommendationViewModel } | { status: "error"; sessionExpired: boolean };

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
 * encodes as `questionId: null`. Loading/error rendering goes through the
 * shared `LoadingState`/`FailureScreen` (Product Phase 1 Unit 11).
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
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", sessionExpired: isSessionExpiredError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, retryCount]);

  if (state.status === "loading") return <LoadingState message="Finding your next question…" />;

  if (state.status === "error") {
    return (
      <FailureScreen
        eyebrow="Practice"
        headline="We couldn't load your next question."
        sessionExpired={state.sessionExpired}
        onRetry={() => setRetryCount((n) => n + 1)}
        back={{ label: "Back to dashboard", to: "/dashboard" }}
      />
    );
  }

  const outcome = decidePracticeEntryOutcome(state.recommendation);

  if (outcome.kind === "unavailable") {
    return (
      <Screen eyebrow="Practice" headline={PRACTICE_UNAVAILABLE_COPY.headline} subtext={PRACTICE_UNAVAILABLE_COPY.explanation}>
        <Button onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
      </Screen>
    );
  }

  return <NextTrainingCard recommendation={state.recommendation} onContinue={() => navigate(`/practice/${outcome.questionId}`)} />;
}
