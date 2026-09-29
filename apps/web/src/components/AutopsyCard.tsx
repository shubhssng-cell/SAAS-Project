import type { AutopsyResponse, AutopsyViewModel } from "../adapter/index.js";
import { Button, Card, ErrorNotice, Screen } from "../design/index.js";
import { ConfirmationPrompt } from "./ConfirmationPrompt.js";

/**
 * Deliberately keeps three things visually and textually separate: what was
 * OBSERVED (a plain list of facts), what the system THINKS may have
 * happened (clearly labeled a hypothesis, never stated as settled), and the
 * student's own CONFIRMATION, which is the only thing that can turn this
 * into something the system acts on.
 *
 * Product Phase 1 Unit 11: nothing here is shown unless it exists. An empty "Observed"
 * list (the real API adapter never populates it) renders no label and no list; an attempt
 * with neither observations nor a hypothesis gets an explicit "nothing to review" state
 * with a way forward, instead of a card with no actions. `responding`/`respondError`
 * are display-only inputs from the route that owns the request.
 */
export function AutopsyCard({
  autopsy,
  onRespond,
  onContinue,
  responding = false,
  respondError = null
}: {
  autopsy: AutopsyViewModel;
  onRespond: (response: AutopsyResponse) => void;
  onContinue: () => void;
  responding?: boolean;
  respondError?: string | null;
}) {
  const hasObserved = autopsy.observed.length > 0;

  if (!hasObserved && !autopsy.hypothesis) {
    return (
      <Screen eyebrow="What happened" headline="There's nothing to review for this attempt." subtext="We didn't notice anything specific this time. You can carry on with practice.">
        <Button onClick={onContinue}>Continue</Button>
      </Screen>
    );
  }

  return (
    <Screen eyebrow="What happened" headline="Here's what we noticed.">
      <Card>
        {hasObserved && (
          <>
            <p className="mode-tag">Observed</p>
            <ul className="evidence-list">
              {autopsy.observed.map((item, i) => (
                <li key={i} className="evidence-item">
                  <span className="evidence-dot" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {!autopsy.hypothesis && (
          <div className="btn-row btn-row-flush">
            <Button onClick={onContinue}>Continue</Button>
          </div>
        )}

        {autopsy.hypothesis && (
          <>
            <div className="hypothesis-box">
              <p className="hypothesis-label">Our best guess — not confirmed yet</p>
              <p className="hypothesis-text">{autopsy.hypothesis.summary}</p>
              {autopsy.hypothesis.supportingEvidence.length > 0 && (
                <ul className="hypothesis-support">
                  {autopsy.hypothesis.supportingEvidence.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>

            {respondError && <ErrorNotice>{respondError}</ErrorNotice>}
            <ConfirmationPrompt onRespond={onRespond} disabled={responding} />
          </>
        )}
      </Card>
    </Screen>
  );
}
