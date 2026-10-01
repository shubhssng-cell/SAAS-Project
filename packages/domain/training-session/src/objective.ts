import type { TrainingRequirement } from "@ipmat/training-systems";
import type { TrainingDimension, TrainingSystemDefinition } from "./catalog.js";

/**
 * Phase 5 Unit 1 -- an EXPLICIT, inspectable training objective, snapshotted onto the
 * session when it starts. Built only from (a) the catalog's authored words and (b) the
 * target the provider's own applicability decision named (when it names one). It states
 * what is being trained -- never what the student feels, intends or is "like".
 */
export interface TrainingObjective {
  systemId: string;
  dimension: TrainingDimension;
  /** Authored, student-safe: what this session trains. */
  statement: string;
  /** The concept the provider targeted, when its requirement names one; otherwise `null`. */
  targetConceptName: string | null;
}

/** Reads `targetConceptName` off a provider requirement without knowing the provider's own requirement type. */
export function readTargetConceptName(requirement: TrainingRequirement): string | null {
  const candidate = (requirement as { targetConceptName?: unknown }).targetConceptName;
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : null;
}

export function buildTrainingObjective(definition: TrainingSystemDefinition, requirement: TrainingRequirement): TrainingObjective {
  const targetConceptName = definition.conceptNotInObjective ? null : readTargetConceptName(requirement);
  return {
    systemId: definition.systemId,
    dimension: definition.dimension,
    statement: targetConceptName !== null ? `${definition.trains} Focus: ${targetConceptName}.` : definition.focusSentence ? `${definition.trains} ${definition.focusSentence}` : definition.trains,
    targetConceptName
  };
}

/** Validates an UNTRUSTED persisted objective back into the typed shape; `null` when it is not one. */
export function parseTrainingObjective(value: unknown): TrainingObjective | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.systemId !== "string" || typeof v.dimension !== "string" || typeof v.statement !== "string") return null;
  if (v.targetConceptName !== null && typeof v.targetConceptName !== "string") return null;
  return { systemId: v.systemId, dimension: v.dimension as TrainingDimension, statement: v.statement, targetConceptName: v.targetConceptName as string | null };
}
