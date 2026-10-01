import { useEffect, useRef, useState } from "react";
import type { HypothesisOfferViewModel, HypothesisResultViewModel, TrainingRecommendationAdapter } from "../adapter/index.js";
import { Button, Card, ErrorNotice } from "../design/index.js";

export const MAX_CORRECTION_LENGTH = 500;

type Phase =
  | { kind: "loading" }
  | { kind: "hidden" } // nothing to explain
  | { kind: "unavailable" }
  | { kind: "ready"; offer: Extract<HypothesisOfferViewModel, { status: "ready" }>; stage: "asking" | "correcting" | "sending"; error: string | null }
  | { kind: "done"; summary: string; result: HypothesisResultViewModel };

/**
 * Phase 4 Unit 2 -- ONE possible explanation for an incorrect answer, offered for the student to confirm, reject or correct.
 *
 * It is always framed as a guess, never as a fact ("This is a guess based on what was recorded -- not a fact"), it lists only the
 * recorded facts it rests on. Since Unit 3 the student's response is saved by the server (once; the first answer stands) and shown again
 * after a reload or restart. It is supplementary -- while it
 * loads, if it is unavailable, or if it fails, the result above it and Continue below it are unaffected, and no explanation is ever invented.
 * The student's own words are sent exactly as typed; this component never rewrites, categorizes or "improves" them.
 */
export function PossibleExplanation({ adapter, attemptId }: { adapter: TrainingRecommendationAdapter; attemptId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [correction, setCorrection] = useState("");
  const [retry, setRetry] = useState(0);
  const sending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "loading" });
    adapter
      .requestHypothesis(attemptId)
      .then((offer) => {
        if (cancelled) return;
        if (offer.status === "ready") setPhase({ kind: "ready", offer, stage: "asking", error: null });
        else if (offer.status === "answered") setPhase({ kind: "done", summary: "", result: offer.result });
        else setPhase({ kind: offer.status === "not_applicable" ? "hidden" : "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, attemptId, retry]);

  if (phase.kind === "hidden") return null;

  if (phase.kind === "loading") {
    return (
      <Card>
        <h2 className="headline headline-compact">A possible explanation</h2>
        <p className="subtext" role="status">
          Looking for a possible explanation…
        </p>
      </Card>
    );
  }

  if (phase.kind === "unavailable") {
    return (
      <Card>
        <h2 className="headline headline-compact">A possible explanation</h2>
        <p className="subtext" role="status">
          We couldn't suggest an explanation this time. You can carry on.
        </p>
      </Card>
    );
  }

  if (phase.kind === "done") {
    const { result } = phase;
    return (
      <Card>
        <h2 className="headline headline-compact">A possible explanation</h2>
        <p className="subtext" role="status">
          {result.status === "confirmed" && "Recorded as a confirmed explanation."}
          {result.status === "rejected" && "This explanation was not confirmed."}
          {result.status === "corrected" && "Your correction was recorded."}
        </p>
        {result.status === "corrected" && result.studentCorrectionText !== null && <blockquote className="hypothesis-text">{result.studentCorrectionText}</blockquote>}
        {result.status === "corrected" && <p className="subtext evidence-note">Your own words are saved as you wrote them. They are not treated as a confirmed explanation.</p>}
        {result.status === "confirmed" && result.repairPlan !== null && (
          <p className="subtext evidence-note">
            Practice focus: {result.repairPlan.patternFamilyName} in {result.repairPlan.conceptName}.
          </p>
        )}
      </Card>
    );
  }

  const { offer, stage, error } = phase;

  async function respond(response: { type: "confirmed" } | { type: "rejected" } | { type: "corrected"; correctedExplanation: string }) {
    if (sending.current) return;
    sending.current = true;
    setPhase({ kind: "ready", offer, stage: "sending", error: null });
    try {
      const result = await adapter.respondToHypothesis({ attemptId, token: offer.token, response });
      setPhase({ kind: "done", summary: offer.summary, result });
    } catch {
      setPhase({ kind: "ready", offer, stage: stage === "correcting" ? "correcting" : "asking", error: "We couldn't record that. Please try again." });
    } finally {
      sending.current = false;
    }
  }

  const busy = stage === "sending";
  const text = correction;

  return (
    <Card>
      <h2 className="headline headline-compact">A possible explanation</h2>
      <p className="mode-tag">This is a guess based on what was recorded — not a fact</p>
      <div className="hypothesis-box">
        <p className="hypothesis-text">{offer.summary}</p>
        {offer.supportingEvidence.length > 0 && (
          <>
            <p className="subtext">What it is based on:</p>
            <ul className="hypothesis-support">
              {offer.supportingEvidence.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {error && <ErrorNotice>{error}</ErrorNotice>}
      {error && (
        <div className="btn-row btn-row-flush">
          <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            Show a new explanation
          </Button>
        </div>
      )}

      {stage !== "correcting" ? (
        <>
          <p className="confirm-question" id="hypothesis-question">
            Is that what happened?
          </p>
          <div className="btn-row btn-row-flush" role="group" aria-labelledby="hypothesis-question">
            <Button disabled={busy} onClick={() => void respond({ type: "confirmed" })}>
              Yes, that's what happened
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setPhase({ kind: "ready", offer, stage: "correcting", error: null })}>
              No, something else happened
            </Button>
          </div>
        </>
      ) : (
        <>
          <label className="confirm-question" htmlFor="hypothesis-correction">
            What happened instead? (optional)
          </label>
          <textarea
            id="hypothesis-correction"
            className="form-input"
            rows={3}
            maxLength={MAX_CORRECTION_LENGTH}
            value={text}
            disabled={busy}
            onChange={(event) => setCorrection(event.target.value)}
          />
          <div className="btn-row btn-row-flush">
            <Button disabled={busy} onClick={() => void respond(text.trim().length > 0 ? { type: "corrected", correctedExplanation: text } : { type: "rejected" })}>
              Send my answer
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
