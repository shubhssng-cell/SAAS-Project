import { useEffect, useState } from "react";
import type { TrainingSessionViewModel } from "../adapter/index.js";
import { Card } from "../design/index.js";
import { usePracticeSession } from "../practice/PracticeSessionContext.js";
import { describeProgress, trainingSessionPath } from "../training/trainingEntry.js";
import { PracticeResultRoute } from "./PracticeResultRoute.js";

/**
 * A training question's result (Phase 5 Unit 2): the ORDINARY result screen first and unchanged (it is an ordinary attempt), preceded by a small
 * line saying which training this belongs to -- the system, its current stage, and the observable progress. The context is supplementary:
 * if it cannot be loaded the result still shows, exactly as it would without it. Nothing here is a score or a claim of improvement.
 */
export function TrainingResultRoute({ sessionId, questionId }: { sessionId: string; questionId: string }) {
  const { adapter } = usePracticeSession();
  const [session, setSession] = useState<TrainingSessionViewModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    adapter
      .getTrainingSession(sessionId)
      .then((value) => {
        if (!cancelled) setSession(value);
      })
      .catch(() => {
        // optional context
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, sessionId, questionId]);

  return (
    <>
      {session && (
        <Card>
          <p className="mode-tag">{session.systemTitle}</p>
          <p className="subtext" data-testid="training-result-context">
            {session.stage ? `${session.stage.label} · ` : ""}
            {describeProgress(session)}
          </p>
        </Card>
      )}
      <PracticeResultRoute questionId={questionId} continueTo={trainingSessionPath(sessionId)} backTo={trainingSessionPath(sessionId)} />
    </>
  );
}
