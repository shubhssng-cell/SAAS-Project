import type { TrainingPlaygroundRunResult } from "../domain/types.js";
import { SYSTEM_DISPLAY_NAMES } from "./outcomePresentation.js";

interface DiagnosticsPanelProps {
  runResult: TrainingPlaygroundRunResult;
}

/**
 * A plain, readable dump of each system's REAL `diagnostics` object (or,
 * for `error`, the fact that none exists -- itself a meaningful,
 * documented contract detail, D-053). Never summarized or reworded --
 * what is shown here is exactly what the domain call returned.
 */
export function DiagnosticsPanel({ runResult }: DiagnosticsPanelProps) {
  return (
    <section aria-labelledby="diagnostics-panel-heading" className="panel">
      <h2 id="diagnostics-panel-heading">Diagnostics</h2>
      <div className="diagnostics-grid">
        {runResult.systemResults.map((systemResult) => (
          <article key={systemResult.systemId} className="diagnostics-card">
            <h3>{SYSTEM_DISPLAY_NAMES[systemResult.systemId] ?? systemResult.systemId}</h3>
            {"diagnostics" in systemResult.outcome ? (
              <pre className="diagnostics-json">{JSON.stringify(systemResult.outcome.diagnostics, null, 2)}</pre>
            ) : (
              <p className="panel__note">No diagnostics on this outcome -- `error` is reserved for invalid/impossible execution, and deliberately carries no diagnostics object (docs/DECISIONS.md D-053).</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
