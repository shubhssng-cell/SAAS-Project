import type { TrainingPlaygroundRunResult } from "../domain/types.js";
import { describeOutcome, SYSTEM_DISPLAY_NAMES } from "./outcomePresentation.js";

interface DecisionPanelProps {
  runResult: TrainingPlaygroundRunResult;
}

/**
 * A fixed, STATIC description of the deterministic selection PIPELINE
 * stages -- never a per-run generated "why the AI thinks this" narrative.
 * The same five stages apply to every provider (`@ipmat/training-systems`'s
 * `runTrainingSystemProvider()`) and to orchestration's own repair/adaptive
 * sequencing; only WHICH stage a given outcome stopped at differs.
 */
const DETERMINISTIC_STAGES = [
  "1. Candidate eligibility (published, structurally valid)",
  "2. Training-system requirement filtering (concept / trap code / load / stage constraints)",
  "3. Exposure avoidance (least prior exposure preferred)",
  "4. Deterministic tie-break (system-specific: e.g. taxonomy-cell variation, tighter expected time, lowest questionId)",
  "5. Selected question, or an ordinary no_eligible_question / no_action outcome if no candidate survives"
];

export function DecisionPanel({ runResult }: DecisionPanelProps) {
  return (
    <section aria-labelledby="decision-panel-heading" className="panel">
      <h2 id="decision-panel-heading">Training decision</h2>
      <div className="decision-grid">
        {runResult.systemResults.map((systemResult) => {
          const presentation = describeOutcome(systemResult.outcome);
          return (
            <article key={systemResult.systemId} className="decision-card">
              <header className="decision-card__header">
                <span className="decision-card__system">{SYSTEM_DISPLAY_NAMES[systemResult.systemId] ?? systemResult.systemId}</span>
                <span className={`badge badge--${presentation.tone}`}>{presentation.statusLabel}</span>
              </header>
              <p className="decision-card__explanation">{presentation.explanation}</p>
              <dl className="decision-card__facts">
                <div>
                  <dt>Selected question</dt>
                  <dd>{presentation.questionId ?? "—"}</dd>
                </div>
                {presentation.wasFallbackFromRepair !== null && (
                  <div>
                    <dt>Fallback from repair</dt>
                    <dd>{presentation.wasFallbackFromRepair ? "Yes" : "No"}</dd>
                  </div>
                )}
              </dl>
            </article>
          );
        })}
      </div>

      <details className="stages-detail">
        <summary>Deterministic selection stages (fixed pipeline, not generated per run)</summary>
        <ol>
          {DETERMINISTIC_STAGES.map((stage) => (
            <li key={stage}>{stage}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}
