import { useEffect, useState } from "react";
import type { AutopsyResponse, AutopsyViewModel } from "../adapter/index.js";
import { AutopsyCard } from "../components/AutopsyCard.js";
import { Button, Screen } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

/**
 * `adapter.getAutopsy()`/`adapter.respondToAutopsy()` now go through the
 * real, HTTP-backed adapter (Product Phase 1 Unit 10) -- both can
 * genuinely fail, unlike the pre-Unit-10 fixture calls. See
 * PHASE_1_PLATFORM_SHELL.md's Unit 10 summary for a disclosed limitation:
 * the real backend does not yet populate a pending autopsy hypothesis
 * through the ordinary submit flow, so this route is rarely reached today
 * -- its error handling still matters for whenever it is.
 */
export function PracticeAutopsyRoute({ questionId }: { questionId: string }) {
  const { adapter, getLastResult, getLastAutopsy, setLastAutopsy } = usePracticeSession();
  const navigate = useNavigate();
  const result = getLastResult(questionId);
  const [autopsy, setAutopsy] = useState<AutopsyViewModel | null>(result ? (getLastAutopsy(result.attemptId) ?? null) : null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [respondFailed, setRespondFailed] = useState(false);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    setLoadFailed(false);
    adapter
      .getAutopsy(result.attemptId)
      .then((fetched) => {
        if (cancelled) return;
        setAutopsy(fetched);
        setLastAutopsy(result.attemptId, fetched);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, result?.attemptId]);

  // Same limitation as PracticeResultRoute -- no in-session result to review means this URL
  // was reached without going through the practice flow (or after a hard refresh).
  if (!result) {
    return (
      <Screen eyebrow="Nothing to review" headline="There's no result to review for this question.">
        <Button onClick={() => navigate(`/practice/${questionId}`)}>Back to question</Button>
      </Screen>
    );
  }

  if (loadFailed) {
    return (
      <Screen eyebrow="Practice" headline="We couldn't load this review." subtext="Something went wrong. Please try again.">
        <Button onClick={() => navigate("/practice/next")}>Back to practice</Button>
      </Screen>
    );
  }

  if (!autopsy) return <p className="loading-text">Loading review…</p>;

  async function handleRespond(response: AutopsyResponse) {
    if (!result) return;
    setRespondFailed(false);
    try {
      await adapter.respondToAutopsy({ attemptId: result.attemptId, response });
      navigate("/practice/next");
    } catch {
      setRespondFailed(true);
    }
  }

  return (
    <>
      <AutopsyCard autopsy={autopsy} onRespond={handleRespond} />
      {respondFailed && <p className="subtext">We couldn't record your response. Please try again.</p>}
    </>
  );
}
