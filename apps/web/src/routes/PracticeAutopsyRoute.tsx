import { useEffect, useState } from "react";
import type { AutopsyResponse, AutopsyViewModel } from "../adapter/index.js";
import { AutopsyCard } from "../components/AutopsyCard.js";
import { Button, Screen } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

export function PracticeAutopsyRoute({ questionId }: { questionId: string }) {
  const { adapter, getLastResult, getLastAutopsy, setLastAutopsy } = usePracticeSession();
  const navigate = useNavigate();
  const result = getLastResult(questionId);
  const [autopsy, setAutopsy] = useState<AutopsyViewModel | null>(result ? (getLastAutopsy(result.attemptId) ?? null) : null);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    adapter.getAutopsy(result.attemptId).then((fetched) => {
      if (cancelled) return;
      setAutopsy(fetched);
      setLastAutopsy(result.attemptId, fetched);
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

  if (!autopsy) return <p className="loading-text">Loading review…</p>;

  async function handleRespond(response: AutopsyResponse) {
    if (!result) return;
    await adapter.respondToAutopsy({ attemptId: result.attemptId, response });
    navigate("/practice/next");
  }

  return <AutopsyCard autopsy={autopsy} onRespond={handleRespond} />;
}
