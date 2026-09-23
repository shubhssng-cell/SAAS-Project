import type { NoveltyLevel, TrainingRequirement } from "@ipmat/training-systems";

/**
 * The three authoritative, non-"standard" values of Question DNA's
 * existing `NoveltyLevel` vocabulary (`@ipmat/question-engine`) — no new
 * taxonomy is introduced. Peer categories, not an ordered ladder (docs/
 * DECISIONS.md D-058: no progression).
 */
export type NonStandardNoveltyLevel = Exclude<NoveltyLevel, "standard">;

export const NON_STANDARD_NOVELTY_LEVELS: readonly NonStandardNoveltyLevel[] = ["novel_representation", "novel_combination", "novel_context"];

/**
 * Provider-specific extension of the shared `TrainingRequirement` (docs/
 * DECISIONS.md D-053 item 3). `targetConceptName` is mandatory (unlike
 * Trap Lab's optional field, D-056) — a novelty level is not a portable
 * cross-concept identity. No `targetPatternFamily`/`targetTaxonomyCell`/
 * `targetTransformation`/`requireUnseenCombination`/`requireUnseenRepresentation`
 * fields exist: none is justified as a gating fact (D-058) — taxonomy-cell
 * identity stays selector-internal, mirroring Trap Lab's own tie-break.
 */
export interface NoveltyTrainingRequirement extends TrainingRequirement {
  targetConceptName: string;
  targetNoveltyLevel: NonStandardNoveltyLevel;
}

/**
 * Observed exposure for ONE non-standard novelty level, for one concept.
 * `distinctQuestionIds` is SET-derived — a single question retried
 * repeatedly contributes at most one entry. `distinctPatternFamilyNames`/
 * `combinedConceptNames` are diagnostic-only, never gate applicability;
 * `combinedConceptNames` is populated only when `noveltyLevel ===
 * "novel_combination"`.
 */
export interface NoveltyDimensionExposure {
  noveltyLevel: NonStandardNoveltyLevel;
  distinctQuestionIds: string[];
  distinctPatternFamilyNames: string[];
  combinedConceptNames: string[];
}

/**
 * The core derived signal this provider introduces: exposure evidence for
 * ONE concept, computed ENTIRELY from a student's attempt history — never
 * from a candidate pool (docs/DECISIONS.md D-058). `standardExposureCount`
 * is the concept-specific baseline (see the invariant in
 * `noveltyEvidence.ts`); `dimensions` always contains exactly the three
 * `NON_STANDARD_NOVELTY_LEVELS`, in that order, regardless of what was
 * actually observed (a level with zero exposure still gets an entry with
 * empty arrays — "limited prior exposure" is itself meaningful evidence,
 * never omitted).
 *
 * This is an EXPOSURE model, not a weakness/ability model: correctness is
 * never read here. No novelty "ability" score, confidence, composite
 * mastery score, or predicted ability exists anywhere in this package.
 */
export interface NoveltyExposureEvidence {
  conceptName: string;
  standardExposureCount: number;
  dimensions: NoveltyDimensionExposure[];
}
