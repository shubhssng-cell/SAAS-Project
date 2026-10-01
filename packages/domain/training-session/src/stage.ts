import type { TrainingRequirement } from "@ipmat/training-systems";
import type { TrainingStageDefinition, TrainingSystemDefinition } from "./catalog.js";

/**
 * Phase 5 Unit 2 -- stage presentation (docs/DECISIONS.md D-076). A staged provider names its CURRENT stage in the requirement it
 * returns (`requirement.stage`); the stage is derived from persisted history on every call and is never stored. This file only reads
 * that key generically and words it from the catalog -- it contains no stage policy (no thresholds, no progression, no selection).
 */
export interface TrainingStageView {
  key: string;
  label: string;
  summary: string;
  /** 1-based position among the system's stages. */
  position: number;
  total: number;
}

/** Reads `stage` off a provider requirement without knowing the provider's own requirement type; `null` when absent or not a string. */
export function readStageKey(requirement: TrainingRequirement | undefined): string | null {
  const candidate = (requirement as { stage?: unknown } | undefined)?.stage;
  return typeof candidate === "string" && candidate !== "" ? candidate : null;
}

export function describeStage(definition: TrainingSystemDefinition, key: string | null): TrainingStageView | null {
  if (key === null || !definition.stages) return null;
  const index = definition.stages.findIndex((stage: TrainingStageDefinition) => stage.key === key);
  if (index === -1) return null;
  const stage = definition.stages[index]!;
  return { key: stage.key, label: stage.label, summary: stage.summary, position: index + 1, total: definition.stages.length };
}

export interface TrainingStageChange {
  from: TrainingStageView;
  to: TrainingStageView;
  direction: "forward" | "back";
  /** Hand-authored and student-safe: no threshold, no score, no claim about improvement or ability. */
  note: string;
}

/** `null` when either stage is unknown or they are the same. */
export function describeStageChange(definition: TrainingSystemDefinition, fromKey: string | null, toKey: string | null): TrainingStageChange | null {
  const from = describeStage(definition, fromKey);
  const to = describeStage(definition, toKey);
  if (!from || !to || from.key === to.key) return null;
  const forward = to.position > from.position;
  return {
    from,
    to,
    direction: forward ? "forward" : "back",
    note: forward ? "Your recorded answers at the previous stage met this training's requirement for moving on." : "Your recent recorded answers put this training back at an earlier stage."
  };
}
