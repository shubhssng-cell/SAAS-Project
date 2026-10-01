import { useEffect, useRef, useState } from "react";
import { isSessionExpiredError, type TrainingCompletionViewModel, type TrainingHubViewModel } from "../adapter/index.js";
import { FailureScreen } from "../components/FailureScreen.js";
import { TrainingHub } from "../components/TrainingHub.js";
import { LoadingState } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { useNavigate } from "../router/router.js";
import { trainingSessionPath } from "../training/trainingEntry.js";

type HubState = { status: "loading" } | { status: "loaded"; hub: TrainingHubViewModel } | { status: "error"; sessionExpired: boolean };

/**
 * The Training entry point route (Phase 5 Unit 1). Loads the hub from the adapter (every system's availability was decided
 * server-side by its own engine), starts a session on the student's explicit choice, and hands off to the session route.
 * No selection logic of its own.
 */
export function TrainingHubRoute() {
  const { adapter } = usePracticeSession();
  const navigate = useNavigate();
  const [state, setState] = useState<HubState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);
  const [startingSystemId, setStartingSystemId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // A ref (not just state) so two clicks in the same frame cannot both pass the guard before React re-renders.
  const startInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    adapter
      .getTrainingHub()
      .then((hub) => {
        if (!cancelled) setState({ status: "loaded", hub });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", sessionExpired: isSessionExpiredError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, retryCount]);

  if (state.status === "loading") return <LoadingState message="Loading training…" />;

  if (state.status === "error") {
    return (
      <FailureScreen
        eyebrow="Training"
        headline="We couldn't load training."
        sessionExpired={state.sessionExpired}
        onRetry={() => setRetryCount((n) => n + 1)}
        back={{ label: "Back to dashboard", to: "/dashboard" }}
      />
    );
  }

  async function handleStart(systemId: string, completion: TrainingCompletionViewModel) {
    if (startInFlight.current) return;
    startInFlight.current = true;
    setStartError(null);
    setStartingSystemId(systemId);
    try {
      const { session } = await adapter.startTrainingSession({ systemId, completion });
      navigate(trainingSessionPath(session.sessionId));
    } catch (error) {
      if (isSessionExpiredError(error)) {
        setState({ status: "error", sessionExpired: true });
      } else {
        setStartError("We couldn't start that training. Please try again.");
        // The hub may have changed under us (e.g. another tab started a session): re-read it.
        setRetryCount((n) => n + 1);
      }
      startInFlight.current = false;
      setStartingSystemId(null);
    }
  }

  return <TrainingHub hub={state.hub} startingSystemId={startingSystemId} startError={startError} onStart={handleStart} onResume={(sessionId) => navigate(trainingSessionPath(sessionId))} />;
}
