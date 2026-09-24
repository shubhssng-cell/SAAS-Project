import type { AutopsyResponse, AutopsyViewModel } from "../adapter/index.js";
import { ConfirmationPrompt } from "./ConfirmationPrompt.js";

/**
 * Deliberately keeps three things visually and textually separate: what was
 * OBSERVED (a plain list of facts), what the system THINKS may have
 * happened (clearly labeled a hypothesis, never stated as settled), and the
 * student's own CONFIRMATION, which is the only thing that can turn this
 * into something the system acts on.
 */
export function AutopsyCard({ autopsy, onRespond }: { autopsy: AutopsyViewModel; onRespond: (response: AutopsyResponse) => void }) {
  return (
    <div className="screen">
      <p className="eyebrow">What happened</p>
      <h1 className="headline">Here's what we noticed.</h1>

      <div className="card">
        <p className="mode-tag">Observed</p>
        <ul className="evidence-list">
          {autopsy.observed.map((item, i) => (
            <li key={i} className="evidence-item">
              <span className="evidence-dot" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

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

            <ConfirmationPrompt onRespond={onRespond} />
          </>
        )}
      </div>
    </div>
  );
}
