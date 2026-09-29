import { useEffect, useState } from "react";
import type { QuestionViewModel } from "../adapter/index.js";
import { QuestionPlayer } from "../components/QuestionPlayer.js";
import { Button, Screen } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

type QuestionLoadState = { status: "loading" } | { status: "loaded"; question: QuestionViewModel } | { status: "error" };

/**
 * `adapter.loadQuestion()`/`adapter.submitAnswer()` now go through the
 * real, HTTP-backed adapter (Product Phase 1 Unit 10), which can genuinely
 * fail — both are wrapped with explicit, student-safe error handling
 * (never a raw error, never a silently-stuck loading state), the same
 * pattern `PracticeNextRoute`/`DashboardRoute` already use.
 */
export function PracticeQuestionRoute({ questionId }: { questionId: string }) {
  const { adapter, setLastResult } = usePracticeSession();
  const navigate = useNavigate();
  const [state, setState] = useState<QuestionLoadState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);
  const [submitError, setSubmitError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    adapter
      .loadQuestion(questionId)
      .then((question) => {
        if (!cancelled) setState({ status: "loaded", question });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, questionId, retryCount]);

  if (state.status === "loading") return <p className="loading-text">Loading question…</p>;

  if (state.status === "error") {
    return (
      <Screen eyebrow="Practice" headline="We couldn't load this question." subtext="Something went wrong. Please try again.">
        <div className="btn-row">
          <Button onClick={() => setRetryCount((n) => n + 1)}>Try again</Button>
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </Screen>
    );
  }

  async function handleSubmit(chosenAnswer: string, timeTakenSeconds: number) {
    setSubmitError(false);
    try {
      const result = await adapter.submitAnswer({ questionId, chosenAnswer, timeTakenSeconds });
      setLastResult(questionId, result);
      navigate(`/practice/${questionId}/result`);
    } catch {
      setSubmitError(true);
    }
  }

  return (
    <>
      <QuestionPlayer question={state.question} onSubmit={handleSubmit} />
      {submitError && <p className="subtext">We couldn't submit your answer. Please try again.</p>}
    </>
  );
}
