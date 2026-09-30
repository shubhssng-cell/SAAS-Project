import { useEffect, useState } from "react";
import { isSessionExpiredError, type AttemptResultViewModel } from "../adapter/index.js";
import { FailureScreen } from "../components/FailureScreen.js";
import { ResultScreen } from "../components/ResultScreen.js";
import { Button, LoadingState, Screen } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { readAttemptParam } from "../practice/resultLocation.js";
import { useNavigate } from "../router/router.js";

type ResultLoadState = { status: "loading" } | { status: "loaded"; result: AttemptResultViewModel } | { status: "error"; sessionExpired: boolean };

/**
 * Shows the result of a submitted attempt. Right after submitting, the result the
 * server already returned is in session state and renders immediately. After a hard
 * refresh (session state lost) the attempt id in the URL is used to re-read the result
 * from the server (`GET /v1/attempts/:id/result`) -- correctness, the answer key and
 * the solution always come from the server, never from this component. With neither,
 * there is genuinely nothing to show.
 */
export function PracticeResultRoute({ questionId }: { questionId: string }) {
  const { adapter, getLastResult, setLastResult } = usePracticeSession();
  const navigate = useNavigate();
  const attemptId = readAttemptParam(window.location.search);
  const remembered = getLastResult(questionId);
  // A remembered result only counts if it is the attempt the URL names (an earlier attempt at the same question must not be shown for a newer link).
  const inSession = remembered && (!attemptId || remembered.attemptId === attemptId) ? remembered : undefined;
  const [state, setState] = useState<ResultLoadState>(inSession ? { status: "loaded", result: inSession } : { status: "loading" });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (inSession || !attemptId) return;
    let cancelled = false;
    setState({ status: "loading" });
    adapter
      .getAttemptResult(attemptId)
      .then((result) => {
        // The URL's question must be the result's question -- never render another question's result under this route.
        if (cancelled) return;
        if (result.questionId !== questionId) {
          setState({ status: "error", sessionExpired: false });
          return;
        }
        setLastResult(questionId, result);
        setState({ status: "loaded", result });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", sessionExpired: isSessionExpiredError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, attemptId, inSession, questionId, retryCount, setLastResult]);

  if (!inSession && !attemptId) {
    return (
      <Screen eyebrow="No result to show" headline="This result isn't available anymore." subtext="Answer the question again to see a result.">
        <Button onClick={() => navigate(`/practice/${questionId}`)}>Back to question</Button>
      </Screen>
    );
  }

  if (state.status === "loading") return <LoadingState message="Loading your result…" />;

  if (state.status === "error") {
    return (
      <FailureScreen
        eyebrow="Result"
        headline="We couldn't load this result."
        sessionExpired={state.sessionExpired}
        onRetry={() => setRetryCount((n) => n + 1)}
        back={{ label: "Back to dashboard", to: "/dashboard" }}
      />
    );
  }

  return <ResultScreen result={state.result} onSeeWhatHappened={() => navigate(`/practice/${questionId}/autopsy`)} onContinue={() => navigate("/practice/next")} />;
}
