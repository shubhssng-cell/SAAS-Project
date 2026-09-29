import { ResultScreen } from "../components/ResultScreen.js";
import { Button, Screen } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

export function PracticeResultRoute({ questionId }: { questionId: string }) {
  const { getLastResult } = usePracticeSession();
  const navigate = useNavigate();
  const result = getLastResult(questionId);

  // No in-session result for this question -- e.g. a hard refresh on this URL, which the
  // fixture adapter's submit-once/no-fetch-by-id shape doesn't support reconstructing.
  // See PHASE_1_PLATFORM_SHELL.md's Unit 2 notes; resolved for real once Unit 10 wires a
  // server-backed adapter that can fetch a result by attemptId.
  if (!result) {
    return (
      <Screen eyebrow="No result to show" headline="This result isn't available anymore." subtext="Answer the question again to see a result.">
        <Button onClick={() => navigate(`/practice/${questionId}`)}>Back to question</Button>
      </Screen>
    );
  }

  return <ResultScreen result={result} onSeeWhatHappened={() => navigate(`/practice/${questionId}/autopsy`)} onContinue={() => navigate("/practice/next")} />;
}
