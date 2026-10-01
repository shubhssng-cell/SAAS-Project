import { useEffect, useRef, useState } from "react";
import { isSessionExpiredError, type TrainingNextViewModel, type TrainingSessionViewModel } from "../adapter/index.js";
import { FailureScreen } from "../components/FailureScreen.js";
import { QuestionPlayer } from "../components/QuestionPlayer.js";
import { Button, Card, ErrorNotice, LoadingState, Screen } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";
import { describeCompletion, describeProgress, trainingResultPath } from "../training/trainingEntry.js";

type SessionState = { status: "loading" } | { status: "loaded"; next: TrainingNextViewModel } | { status: "error"; sessionExpired: boolean };

function SessionHeader({ session }: { session: TrainingSessionViewModel }) {
  return (
    <Card>
      <p className="mode-tag">{session.systemLabel} training</p>
      <p className="subtext recommendation-explanation">{session.objective.statement}</p>
      <p className="subtext" role="status">
        {describeProgress(session)}
      </p>
    </Card>
  );
}

/**
 * One training session's screen (Phase 5 Unit 1). Asks the server for the session's next step -- the open question (resumed
 * after a reload or restart), the next question, or completion -- and reuses the ordinary question player and attempt
 * routes: a training answer is a normal attempt, just placed in the session's block by the server. All decisions
 * (which question, whether the session is complete) are the server's.
 */
export function TrainingSessionRoute({ sessionId }: { sessionId: string }) {
  const { adapter, setLastResult } = usePracticeSession();
  const navigate = useNavigate();
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSubmitting(false);
    setSkipping(false);
    setEnding(false);
    setFailure(null);
    inFlight.current = false;
    adapter
      .nextTrainingQuestion(sessionId)
      .then((next) => {
        if (!cancelled) setState({ status: "loaded", next });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", sessionExpired: isSessionExpiredError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, sessionId, retryCount]);

  if (state.status === "loading") return <LoadingState message="Loading your session…" />;

  if (state.status === "error") {
    return (
      <FailureScreen
        eyebrow="Training"
        headline="We couldn't load this session."
        sessionExpired={state.sessionExpired}
        onRetry={() => setRetryCount((n) => n + 1)}
        back={{ label: "Back to training", to: "/training" }}
      />
    );
  }

  const { next } = state;

  if (next.status === "completed") {
    const { session } = next;
    return (
      <Screen eyebrow={`${session.systemLabel} training`} headline="Session complete." subtext={`You worked on: ${session.objective.statement}`}>
        <Card>
          <div className="fact-row">
            <span className="fact-label">Questions answered</span>
            <span className="fact-value">{session.progress.submittedCount}</span>
          </div>
          <div className="fact-row">
            <span className="fact-label">Questions skipped</span>
            <span className="fact-value">{session.progress.skippedCount}</span>
          </div>
          <div className="fact-row">
            <span className="fact-label">Session length</span>
            <span className="fact-value">{describeCompletion(session.completion)}</span>
          </div>
        </Card>
        <div className="btn-row btn-row-flush">
          <Button onClick={() => navigate("/training")}>Back to training</Button>
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>
            Dashboard
          </Button>
        </div>
      </Screen>
    );
  }

  if (next.status === "no_question") {
    const handleEnd = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setEnding(true);
      setFailure(null);
      try {
        const ended = await adapter.finishTrainingSession(sessionId);
        setState({ status: "loaded", next: { status: "completed", session: ended } });
      } catch (error) {
        if (isSessionExpiredError(error)) setState({ status: "error", sessionExpired: true });
        else setFailure("We couldn't end the session. Please try again.");
        inFlight.current = false;
        setEnding(false);
      }
    };
    return (
      <Screen eyebrow={`${next.session.systemLabel} training`} headline="No further question fits right now." subtext={next.message}>
        <SessionHeader session={next.session} />
        {failure && <ErrorNotice>{failure}</ErrorNotice>}
        <Button block disabled={ending} onClick={handleEnd}>
          {ending ? "Ending…" : "End session"}
        </Button>
      </Screen>
    );
  }

  const { question, session } = next;

  // Submit and skip share one in-flight guard, exactly like ordinary practice: neither can repeat or overlap.
  async function handleSubmit(chosenAnswer: string, timeTakenSeconds: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    setSubmitting(true);
    try {
      const result = await adapter.submitAnswer({ questionId: question.questionId, chosenAnswer, timeTakenSeconds });
      setLastResult(question.questionId, result);
      navigate(trainingResultPath(sessionId, question.questionId, result.attemptId));
    } catch (error) {
      if (isSessionExpiredError(error)) setState({ status: "error", sessionExpired: true });
      else setFailure("We couldn't submit your answer. Please try again.");
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    setSkipping(true);
    setSubmitting(true);
    try {
      const result = await adapter.skipQuestion({ questionId: question.questionId });
      setLastResult(question.questionId, result);
      navigate(trainingResultPath(sessionId, question.questionId, result.attemptId));
    } catch (error) {
      if (isSessionExpiredError(error)) setState({ status: "error", sessionExpired: true });
      else setFailure("We couldn't skip this question. Please try again.");
      inFlight.current = false;
      setSkipping(false);
      setSubmitting(false);
    }
  }

  return (
    <>
      <SessionHeader session={session} />
      <QuestionPlayer question={question} onSubmit={handleSubmit} onSkip={handleSkip} submitting={submitting} skipping={skipping} submitError={failure} />
    </>
  );
}
