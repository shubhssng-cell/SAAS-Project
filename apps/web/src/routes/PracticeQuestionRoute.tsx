import { useEffect, useRef, useState } from "react";
import { isSessionExpiredError, type QuestionViewModel } from "../adapter/index.js";
import { FailureScreen } from "../components/FailureScreen.js";
import { QuestionPlayer } from "../components/QuestionPlayer.js";
import { LoadingState } from "../design/index.js";
import { resultPath } from "../practice/resultLocation.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";

type QuestionLoadState = { status: "loading" } | { status: "loaded"; question: QuestionViewModel } | { status: "error"; sessionExpired: boolean };

/**
 * `adapter.loadQuestion()`/`adapter.submitAnswer()` now go through the
 * real, HTTP-backed adapter (Product Phase 1 Unit 10), which can genuinely
 * fail — both are wrapped with explicit, student-safe error handling
 * (never a raw error, never a silently-stuck loading state), the same
 * pattern `PracticeNextRoute`/`DashboardRoute` already use. While an answer
 * is being submitted (Product Phase 1 Unit 11) the player's controls are
 * disabled, so a second click can never send a duplicate submission; a failed
 * submit re-enables them so the student can try again.
 */
export function PracticeQuestionRoute({ questionId }: { questionId: string }) {
  const { adapter, setLastResult } = usePracticeSession();
  const navigate = useNavigate();
  const [state, setState] = useState<QuestionLoadState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  // A ref (not just `submitting` state) so two clicks in the same frame cannot both pass the guard before React re-renders.
  const submitInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSubmitting(false);
    submitInFlight.current = false;
    setSubmitFailed(false);
    adapter
      .loadQuestion(questionId)
      .then((question) => {
        if (!cancelled) setState({ status: "loaded", question });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", sessionExpired: isSessionExpiredError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, questionId, retryCount]);

  if (state.status === "loading") return <LoadingState message="Loading question…" />;

  if (state.status === "error") {
    return (
      <FailureScreen
        eyebrow="Practice"
        headline="We couldn't load this question."
        sessionExpired={state.sessionExpired}
        onRetry={() => setRetryCount((n) => n + 1)}
        back={{ label: "Back to dashboard", to: "/dashboard" }}
      />
    );
  }

  async function handleSubmit(chosenAnswer: string, timeTakenSeconds: number) {
    if (submitting || submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitFailed(false);
    setSubmitting(true);
    try {
      const result = await adapter.submitAnswer({ questionId, chosenAnswer, timeTakenSeconds });
      setLastResult(questionId, result);
      navigate(resultPath(questionId, result.attemptId));
    } catch (error) {
      // A dead session can never be fixed by resubmitting -- fall through to the same expired-session screen a failed load uses.
      if (isSessionExpiredError(error)) {
        setState({ status: "error", sessionExpired: true });
      } else {
        setSubmitFailed(true);
      }
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  return <QuestionPlayer question={state.question} onSubmit={handleSubmit} submitting={submitting} submitError={submitFailed ? "We couldn't submit your answer. Please try again." : null} />;
}
