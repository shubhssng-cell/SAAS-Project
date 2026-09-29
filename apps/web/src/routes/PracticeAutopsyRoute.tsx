import { useEffect, useState } from "react";
import { isSessionExpiredError, type AutopsyResponse, type AutopsyViewModel } from "../adapter/index.js";
import { AutopsyCard } from "../components/AutopsyCard.js";
import { FailureScreen } from "../components/FailureScreen.js";
import { Button, LoadingState, Screen } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

/**
 * `adapter.getAutopsy()`/`adapter.respondToAutopsy()` now go through the
 * real, HTTP-backed adapter (Product Phase 1 Unit 10) -- both can
 * genuinely fail, unlike the pre-Unit-10 fixture calls. See
 * PHASE_1_PLATFORM_SHELL.md's Unit 10 summary for a disclosed limitation:
 * the real backend does not yet populate a pending autopsy hypothesis
 * through the ordinary submit flow, so this route is rarely reached today
 * -- its error handling still matters for whenever it is. Product Phase 1
 * Unit 11: a failed load can be retried, and a response can't be recorded twice.
 */
export function PracticeAutopsyRoute({ questionId }: { questionId: string }) {
  const { adapter, getLastResult, getLastAutopsy, setLastAutopsy } = usePracticeSession();
  const navigate = useNavigate();
  const result = getLastResult(questionId);
  const [autopsy, setAutopsy] = useState<AutopsyViewModel | null>(result ? (getLastAutopsy(result.attemptId) ?? null) : null);
  const [loadFailure, setLoadFailure] = useState<{ sessionExpired: boolean } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [responding, setResponding] = useState(false);
  const [respondFailed, setRespondFailed] = useState(false);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    setLoadFailure(null);
    adapter
      .getAutopsy(result.attemptId)
      .then((fetched) => {
        if (cancelled) return;
        setAutopsy(fetched);
        setLastAutopsy(result.attemptId, fetched);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadFailure({ sessionExpired: isSessionExpiredError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, result?.attemptId, retryCount]);

  // Same limitation as PracticeResultRoute -- no in-session result to review means this URL
  // was reached without going through the practice flow (or after a hard refresh).
  if (!result) {
    return (
      <Screen eyebrow="Nothing to review" headline="There's no result to review for this question.">
        <Button onClick={() => navigate(`/practice/${questionId}`)}>Back to question</Button>
      </Screen>
    );
  }

  if (loadFailure) {
    return (
      <FailureScreen
        eyebrow="Practice"
        headline="We couldn't load this review."
        sessionExpired={loadFailure.sessionExpired}
        onRetry={() => setRetryCount((n) => n + 1)}
        back={{ label: "Back to practice", to: "/practice/next" }}
      />
    );
  }

  if (!autopsy) return <LoadingState message="Loading review…" />;

  async function handleRespond(response: AutopsyResponse) {
    if (!result || responding) return;
    setRespondFailed(false);
    setResponding(true);
    try {
      await adapter.respondToAutopsy({ attemptId: result.attemptId, response });
      navigate("/practice/next");
    } catch (error) {
      if (isSessionExpiredError(error)) {
        setLoadFailure({ sessionExpired: true });
      } else {
        setRespondFailed(true);
      }
      setResponding(false);
    }
  }

  return (
    <AutopsyCard
      autopsy={autopsy}
      onRespond={handleRespond}
      onContinue={() => navigate("/practice/next")}
      responding={responding}
      respondError={respondFailed ? "We couldn't record your response. Please try again." : null}
    />
  );
}
