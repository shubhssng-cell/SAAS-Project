import type { TrainingPlaygroundScenario } from "../domain/types.js";

interface EvidencePanelProps {
  scenario: TrainingPlaygroundScenario;
}

/**
 * Shows only OBSERVABLE fixture facts (docs/DECISIONS.md D-057) -- never
 * phrased as the student's private reasoning, and never a decision. The
 * actual decision each system reached lives in `DecisionPanel`, not here.
 */
export function EvidencePanel({ scenario }: EvidencePanelProps) {
  return (
    <section aria-labelledby="evidence-panel-heading" className="panel">
      <h2 id="evidence-panel-heading">Observable fixture evidence</h2>
      <p className="panel__note">These are facts built into the fixture, not conclusions. Compare against the training decision above.</p>
      <ul className="evidence-list">
        {scenario.evidenceSummary.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
