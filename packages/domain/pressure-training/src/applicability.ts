import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import type { TrainingSystemApplicability, TrainingSystemContext } from "@ipmat/training-systems";
import { deriveBlockPressureEvidence } from "./blockEvidence.js";
import { PRESSURE_DIMENSIONS, type BlockPressureEvidence, type PressureDimension, type PressureTrainingRequirement } from "./types.js";

export const PRESSURE_TRAINING_NOT_APPLICABLE_REASONS = ["insufficient_evidence", "sufficient_blocks_no_pressure_detected"] as const;
export type PressureTrainingNotApplicableReason = (typeof PRESSURE_TRAINING_NOT_APPLICABLE_REASONS)[number];

/** Purely observational language (docs/DECISIONS.md D-005/D-034/D-038/D-061) — never a claim about stress, fatigue, confidence, motivation, or any other psychological state. */
function describeDimension(dimension: PressureDimension): string {
  switch (dimension) {
    case "within_block_degradation":
      return "within-block accuracy decreased across the sequence";
    case "reduced_recovery":
      return "short inter-attempt gaps were observed within the sequence";
    case "budget_consumption":
      return "active solving time reached the configured block time budget";
  }
}

interface ConceptDimension {
  conceptName: string;
  tier: number;
  dimension: PressureDimension;
}

/**
 * For one concept's qualifying blocks, the SINGLE best (lowest-tier)
 * dimension any of its blocks triggered — never a list, never a blend
 * (docs/DECISIONS.md D-061, D-051's "reason codes, never a numeric score"
 * discipline). `null` if none of its blocks triggered anything.
 */
function bestDimensionForConcept(conceptName: string, blocks: BlockPressureEvidence[]): ConceptDimension | null {
  const triggeredAnywhere = new Set<PressureDimension>();
  for (const block of blocks) {
    for (const dimension of block.triggeredDimensions) triggeredAnywhere.add(dimension);
  }
  for (let tier = 0; tier < PRESSURE_DIMENSIONS.length; tier++) {
    const dimension = PRESSURE_DIMENSIONS[tier]!;
    if (triggeredAnywhere.has(dimension)) return { conceptName, tier, dimension };
  }
  return null;
}

/**
 * The ONE authoritative applicability decision for Pressure Training
 * (docs/DECISIONS.md D-061). Reads ONLY `context.practiceBlocks` and
 * `context.attemptRecords` — never `context.candidates`. Structurally
 * cannot duplicate Speed Lab: `context.practiceBlocks` absent/empty
 * unconditionally yields `not_applicable: insufficient_evidence`,
 * regardless of how much single-question, Speed-Lab-shaped evidence
 * exists in `context.attemptRecords` — Speed Lab's own types never
 * reference `practiceBlocks` at all.
 */
export function evaluatePressureTraining(context: TrainingSystemContext): TrainingSystemApplicability {
  const blocks = context.practiceBlocks ?? [];
  if (blocks.length === 0) {
    return {
      applicable: false,
      reason: "insufficient_evidence",
      explanation:
        "No practice-block evidence was supplied. Pressure Training requires sustained, block-grouped attempt sequences, which single-question attempt history alone cannot provide."
    };
  }

  const evidenceByBlock = blocks
    .map((block) => deriveBlockPressureEvidence(block, context.attemptRecords))
    .filter((evidence): evidence is BlockPressureEvidence => evidence !== null);

  const blocksByConcept = new Map<string, BlockPressureEvidence[]>();
  for (const evidence of evidenceByBlock) {
    const list = blocksByConcept.get(evidence.conceptName) ?? [];
    list.push(evidence);
    blocksByConcept.set(evidence.conceptName, list);
  }

  const qualifyingConcepts = [...blocksByConcept.entries()].filter(([, list]) => list.length >= MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT);
  if (qualifyingConcepts.length === 0) {
    return {
      applicable: false,
      reason: "insufficient_evidence",
      explanation: `No concept has at least ${MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT} qualifying, validly-attributed practice blocks yet.`
    };
  }

  const triggering: ConceptDimension[] = [];
  for (const [conceptName, list] of qualifyingConcepts) {
    const best = bestDimensionForConcept(conceptName, list);
    if (best) triggering.push(best);
  }

  if (triggering.length === 0) {
    return {
      applicable: false,
      reason: "sufficient_blocks_no_pressure_detected",
      explanation:
        "Sufficient block evidence exists, but no concept shows reduced recovery, within-block degradation, or budget consumption meeting the provisional thresholds -- this does not look like a sustained-sequence pressure problem."
    };
  }

  triggering.sort((a, b) => a.tier - b.tier || a.conceptName.localeCompare(b.conceptName));
  const target = triggering[0]!;

  const requirement: PressureTrainingRequirement = {
    targetConceptName: target.conceptName,
    evidencedDimension: target.dimension,
    // Deliberately observational-only phrasing -- the epistemic disclaimer (this is
    // observed sequence-level behavior, never a claim about a psychological state)
    // lives in this file's own doc comments for developers, not in this runtime
    // string, mirroring D-058's "regression test scans runtime text, not doc-comment
    // prose" precedent.
    notes: [`Targeting concept "${target.conceptName}": ${describeDimension(target.dimension)}, observed across sustained practice-block sequences.`]
  };

  return {
    applicable: true,
    requirement,
    explanation: `Sustained-sequence pressure evidence detected for concept "${target.conceptName}" (${describeDimension(target.dimension)}).`
  };
}
