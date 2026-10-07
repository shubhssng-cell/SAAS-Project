import { useEffect, useRef, useState } from "react";
import { Button, Card, ErrorNotice } from "../design/index.js";
import { Link } from "../router/router.js";
import { apiAskTutor, apiGetPreferences, apiUpdatePreferences, TUTOR_LANGUAGES, TUTOR_VERBOSITIES, type Preferences, type TutorAnswer, type TutorOperation } from "./api.js";

/**
 * The tutor on the result screen (Phase 9 Unit 2, D-098). Every request names a question and one help operation; the server decides
 * whether the answer key may be used (only after a submitted attempt) and validates the reply before it reaches here. This
 * component renders only the student-safe fields the API client already narrowed, and shows the tutor's reply as AI-written text -
 * with any hypothesis labelled as one - never as a diagnosis or a judgment of the student.
 */
export type TutorPanelState = { status: "idle" } | { status: "loading"; operation: TutorOperation } | { status: "shown"; answer: TutorAnswer } | { status: "error"; message: string; /** The refusal is about the student's plan or usage: offer the billing page. */ billing?: boolean };

const OPERATION_LABELS: Array<[TutorOperation, string]> = [
  ["explain_mistake", "Explain what went wrong"],
  ["clarify_solution", "Walk me through the solution"],
  ["give_hint", "Give me a hint"]
];

export function TutorAnswerView({ answer }: { answer: TutorAnswer }) {
  return (
    <div className="tutor-answer" aria-live="polite">
      {answer.status === "not_answered" ? <p className="subtext">{answer.failureMessage ?? answer.message}</p> : <p>{answer.message}</p>}
      {answer.question ? <p className="tutor-question">{answer.question}</p> : null}
      {answer.parts.map((part) => (
        <div key={part.label} className="fact-row">
          <span className="fact-label">{part.label}</span>
          <span className="fact-value">{part.text}</span>
        </div>
      ))}
      {answer.hypotheses.map((text) => (
        <p key={text} className="subtext">
          <strong>AI hypothesis:</strong> {text}
        </p>
      ))}
      {answer.basedOn.length > 0 ? <p className="subtext">Based on: {answer.basedOn.join(", ")}</p> : null}
      {answer.preferenceNotes.map((note) => (
        <p key={note} className="subtext">
          {note}
        </p>
      ))}
      {answer.status === "answered" ? <p className="subtext">This answer was written by AI. Check it against your own working.</p> : null}
    </div>
  );
}

export function TutorPanelView({
  state,
  preferences,
  preferenceMessage,
  onAsk,
  onPreference
}: {
  state: TutorPanelState;
  preferences: Preferences | null;
  preferenceMessage: string | null;
  onAsk: (operation: TutorOperation) => void;
  onPreference: (patch: Partial<Preferences>) => void;
}) {
  const busy = state.status === "loading";
  return (
    <Card>
      <h2 className="headline headline-compact" id="tutor-heading">
        Ask the tutor
      </h2>
      <div className="btn-row" role="group" aria-labelledby="tutor-heading">
        {OPERATION_LABELS.map(([operation, label]) => (
          <Button key={operation} variant="secondary" disabled={busy} onClick={() => onAsk(operation)}>
            {label}
          </Button>
        ))}
      </div>
      {state.status === "loading" ? <p className="subtext" role="status">The tutor is working on it…</p> : null}
      {state.status === "error" ? <ErrorNotice>{state.message}</ErrorNotice> : null}
      {state.status === "error" && state.billing ? (
        <p className="subtext">
          <Link to="/billing">See your plan and usage</Link>
        </p>
      ) : null}
      {state.status === "shown" ? <TutorAnswerView answer={state.answer} /> : null}
      {preferences ? (
        <div className="tutor-preferences">
          <label>
            Language{" "}
            <select value={preferences.language ?? ""} onChange={(e) => onPreference({ language: e.target.value === "" ? null : e.target.value })}>
              <option value="">Default (English)</option>
              {TUTOR_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            Length{" "}
            <select value={preferences.verbosity ?? ""} onChange={(e) => onPreference({ verbosity: e.target.value === "" ? null : e.target.value })}>
              <option value="">Default</option>
              {TUTOR_VERBOSITIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {preferenceMessage ? <p className="subtext" role="status">{preferenceMessage}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

/** Maps a failed tutor request to fixed, student-safe copy (the server's wording is never shown). */
export function errorState(failure: { kind: string; message?: string }): Extract<TutorPanelState, { status: "error" }> {
  switch (failure.kind) {
    case "network_error":
      return { status: "error", message: "We couldn't reach the tutor. Check your connection and try again." };
    case "rate_limited":
      return { status: "error", message: failure.message ?? "You're going a little fast. Please wait a moment and try again." };
    case "not_authenticated":
      return { status: "error", message: "Your session has ended. Please log in again to use the tutor." };
    case "not_entitled":
      return { status: "error", message: "The tutor isn't part of your current access.", billing: true };
    case "usage_limit_reached":
      return { status: "error", message: "You've used the tutor as much as your plan allows for now.", billing: true };
    default:
      return { status: "error", message: "The tutor isn't available right now. Please try again later." };
  }
}

/** Stateful wrapper. Network details stay in `api.ts`; a stale reply (the student asked again) never overwrites a newer one. */
export function TutorPanel({ questionId }: { questionId: string }) {
  const [state, setState] = useState<TutorPanelState>({ status: "idle" });
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void apiGetPreferences().then((result) => {
      if (!cancelled && result.ok) setPreferences(result.preferences);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function ask(operation: TutorOperation): void {
    const id = ++latest.current;
    setState({ status: "loading", operation });
    void apiAskTutor(operation, questionId).then((result) => {
      if (id !== latest.current) return;
      if (result.ok) setState({ status: "shown", answer: result.answer });
      else setState(errorState(result.failure));
    });
  }

  function savePreference(patch: Partial<Preferences>): void {
    void apiUpdatePreferences(patch).then((result) => {
      if (result.ok) {
        setPreferences(result.preferences);
        setPreferenceMessage("Saved.");
      } else setPreferenceMessage("We couldn't save that. Please try again.");
    });
  }

  return <TutorPanelView state={state} preferences={preferences} preferenceMessage={preferenceMessage} onAsk={ask} onPreference={savePreference} />;
}
