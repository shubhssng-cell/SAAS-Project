import { useState } from "react";
import type { TrainingCompletionViewModel, TrainingHubViewModel, TrainingSystemCardViewModel } from "../adapter/index.js";
import { Button, Card, ErrorNotice, Screen } from "../design/index.js";
import { DEFAULT_COMPLETION_PRESET_ID, describeProgress, isStartable, presetsFor } from "../training/trainingEntry.js";

function SystemCard({
  system,
  starting,
  anyStarting,
  onStart
}: {
  system: TrainingSystemCardViewModel;
  starting: boolean;
  anyStarting: boolean;
  onStart: (systemId: string, completion: TrainingCompletionViewModel) => void;
}) {
  const [presetId, setPresetId] = useState(DEFAULT_COMPLETION_PRESET_ID);
  const startable = isStartable(system.availability);
  const presets = presetsFor(system.completionKinds);
  const selectedPresetId = presets.some((p) => p.id === presetId) ? presetId : presets[0]!.id;
  const selectId = `completion-${system.systemId}`;

  return (
    <Card>
      <span className="badge" data-availability={system.availability}>
        {system.label}
      </span>
      <h2 className="headline headline-compact">{system.trains}</h2>
      <p className="subtext recommendation-explanation">{system.note}</p>
      {startable && (
        <>
          <label className="form-label" htmlFor={selectId}>
            Session length
          </label>
          <select id={selectId} className="form-input" value={selectedPresetId} onChange={(event) => setPresetId(event.target.value)} disabled={anyStarting}>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </>
      )}
      <Button
        block
        disabled={!startable || anyStarting}
        aria-label={startable ? `Start ${system.label} training` : `${system.label} training is not available`}
        onClick={() => onStart(system.systemId, (presets.find((p) => p.id === selectedPresetId) ?? presets[0]!).completion)}
      >
        {starting ? "Starting…" : startable ? "Start training" : "Not available"}
      </Button>
    </Card>
  );
}

/**
 * The Training entry point (Phase 5 Unit 1). Presentational: which system is startable, and why not, was decided
 * server-side by each system's own engine -- this only shows it.
 */
export function TrainingHub({
  hub,
  startingSystemId,
  startError,
  onStart,
  onResume
}: {
  hub: TrainingHubViewModel;
  startingSystemId: string | null;
  startError: string | null;
  onStart: (systemId: string, completion: TrainingCompletionViewModel) => void;
  onResume: (sessionId: string) => void;
}) {
  const active = hub.activeSession;
  return (
    <Screen
      eyebrow="Training"
      headline="Choose what you want to train."
      subtext="Training is deliberate: you pick one performance dimension and work on it for a set length. It is separate from Practice, where the system chooses what comes next."
    >
      {startError && <ErrorNotice>{startError}</ErrorNotice>}

      {active && (
        <Card>
          <p className="mode-tag">Session in progress</p>
          <h2 className="headline headline-compact">{active.systemLabel}</h2>
          <p className="subtext recommendation-explanation">{active.objective.statement}</p>
          <p className="subtext">{describeProgress(active)}</p>
          <Button block onClick={() => onResume(active.sessionId)}>
            Resume session
          </Button>
        </Card>
      )}

      {hub.systems.map((system) => (
        <SystemCard key={system.systemId} system={system} starting={startingSystemId === system.systemId} anyStarting={startingSystemId !== null || active !== null} onStart={onStart} />
      ))}
    </Screen>
  );
}
