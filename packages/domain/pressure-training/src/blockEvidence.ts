import type { MasteryAttemptRecord, TrainingPracticeBlockContext } from "@ipmat/training-systems";
import { PRESSURE_TRAINING_CONSTANTS } from "./constants.js";
import { PRESSURE_DIMENSIONS, type BlockPressureEvidence, type PressureDimension } from "./types.js";

/** The minimum total attempts a block must have to be considered at all (docs/DECISIONS.md D-061) — reused nowhere else; this is a structural sequence-length floor, distinct from `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` (the per-concept QUALIFYING-BLOCK-COUNT floor, applied one level up in `applicability.ts`). */
const QUALIFYING_BLOCK_MIN_ATTEMPTS = 3;

/**
 * Exact deterministic median (docs/DECISIONS.md D-061): copies and sorts
 * ascending (NEVER mutates the caller's array, NEVER assumes it is
 * pre-sorted — `interAttemptGapsSeconds` is in attempt-sequence order, not
 * magnitude order). Empty array -> `null`. Odd length -> the middle
 * element. Even length -> the arithmetic mean of the two middle elements
 * (the same "population stddev, mean-of-middle" register `@ipmat/mastery`'s
 * own `stdDev()`/`mean()` helpers already use).
 */
export function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Exact first-half/second-half split (docs/DECISIONS.md D-061):
 * `half = floor(n / 2)`; first half = the first `half` items, second half
 * = the LAST `half` items. For an ODD-length input, the single middle item
 * belongs to NEITHER half (never arbitrarily assigned, never double-
 * counted) — the two halves never overlap by construction.
 */
export function splitHalves<T>(items: readonly T[]): { firstHalf: T[]; secondHalf: T[] } {
  const half = Math.floor(items.length / 2);
  return { firstHalf: items.slice(0, half), secondHalf: items.slice(items.length - half) };
}

function isQualifyingAttempt(record: MasteryAttemptRecord): boolean {
  return record.contribution.status === "submitted" && record.contribution.isCorrect !== null;
}

/**
 * Exact accuracy computation over one half (docs/DECISIONS.md D-061):
 * denominator = count of QUALIFYING attempts in that half (`status ===
 * "submitted" && isCorrect !== null` — skipped/abandoned never qualify,
 * since both always have `isCorrect === null`, D-034/D-035); numerator =
 * how many of those are correct. Hint-assisted attempts DO count
 * (deliberately, unlike Speed Lab's hint-free requirement — hint usage
 * under sustained sequence pressure is part of the degradation story this
 * dimension exists to observe, not noise to filter out). Zero qualifying
 * attempts in the half -> `null` (never coerced to 0 or 1, mirroring
 * `MasteryComponentMeasures`'s own "null means insufficient data"
 * discipline, D-043).
 */
function computeHalfAccuracy(ids: readonly string[], recordsById: ReadonlyMap<string, MasteryAttemptRecord>): number | null {
  const qualifying = ids.map((id) => recordsById.get(id)).filter((record): record is MasteryAttemptRecord => record !== undefined && isQualifyingAttempt(record));
  if (qualifying.length === 0) return null;
  const correctCount = qualifying.filter((record) => record.contribution.isCorrect === true).length;
  return correctCount / qualifying.length;
}

/**
 * Block Evidence Validation — the exact 9-step fail-closed pipeline
 * (docs/DECISIONS.md D-061). ANY failure among steps 1-7 invalidates the
 * ENTIRE block (it contributes to nothing, ever); step 8 (malformed
 * budget) disables ONLY the budget-consumption dimension, never the whole
 * block; step 9 (`targetQuestionCount`) is not validated or used at all in
 * V1. This function never throws — a validation failure is reported as
 * `false`, and the caller (`deriveBlockPressureEvidence`) simply excludes
 * the block, letting every other block's evaluation proceed unaffected.
 */
function isValidBlock(block: TrainingPracticeBlockContext, recordsById: ReadonlyMap<string, MasteryAttemptRecord>): boolean {
  const ids = block.attemptIdsInOrder;

  // 1. attemptIdsInOrder.length === 0
  if (ids.length === 0) return false;

  // 2. duplicate attempt IDs
  if (new Set(ids).size !== ids.length) return false;

  // 3. any attempt ID missing from context.attemptRecords
  if (!ids.every((id) => recordsById.has(id))) return false;

  // 4. resolved non-null finalizedAt timestamps must be non-decreasing in attemptIdsInOrder order
  let lastFinalizedMs: number | null = null;
  for (const id of ids) {
    const finalizedAt = recordsById.get(id)!.contribution.finalizedAt;
    if (finalizedAt === null) continue;
    const ms = Date.parse(finalizedAt);
    if (lastFinalizedMs !== null && ms < lastFinalizedMs) return false;
    lastFinalizedMs = ms;
  }

  // 5. interAttemptGapsSeconds: every value finite and >= 0; length <= ids.length - 1
  if (block.interAttemptGapsSeconds.length > ids.length - 1) return false;
  if (!block.interAttemptGapsSeconds.every((gap) => Number.isFinite(gap) && gap >= 0)) return false;

  // 6. activeSolvingTimeSeconds finite and >= 0
  if (!Number.isFinite(block.activeSolvingTimeSeconds) || block.activeSolvingTimeSeconds < 0) return false;

  // 7. wallClockDurationSeconds, when non-null, finite and >= 0
  if (block.wallClockDurationSeconds !== null && (!Number.isFinite(block.wallClockDurationSeconds) || block.wallClockDurationSeconds < 0)) return false;

  // 8. budget validity is NOT a whole-block invalidator — handled separately in hasValidBudget().
  // 9. targetQuestionCount is not validated or used.

  return true;
}

/** Step 8 in isolation: a validly-configured budget, used ONLY to gate the budget-consumption dimension — never invalidates the rest of the block. */
function hasValidBudget(block: TrainingPracticeBlockContext): boolean {
  return block.blockTimeBudgetSeconds !== null && Number.isFinite(block.blockTimeBudgetSeconds) && block.blockTimeBudgetSeconds > 0;
}

/**
 * Concept attribution (docs/DECISIONS.md D-061): the block's concept is
 * whichever `conceptName` holds a STRICT MAJORITY (`count > n / 2`) of its
 * attempts. A strict majority is structurally TIE-FREE (two different
 * concepts can never both exceed 50% of the same total), so no separate
 * tie-break exists. `null` when no concept reaches a strict majority — the
 * block is then ignored for ALL concept-scoped evidence, never causing the
 * whole evaluation to fail.
 */
function attributeConcept(block: TrainingPracticeBlockContext, recordsById: ReadonlyMap<string, MasteryAttemptRecord>): string | null {
  const counts = new Map<string, number>();
  for (const id of block.attemptIdsInOrder) {
    const conceptName = recordsById.get(id)!.question.conceptName;
    counts.set(conceptName, (counts.get(conceptName) ?? 0) + 1);
  }
  const total = block.attemptIdsInOrder.length;
  for (const [conceptName, count] of counts) {
    if (count > total / 2) return conceptName;
  }
  return null;
}

function computeTriggeredDimensions(input: {
  medianGapSeconds: number | null;
  firstHalfAccuracy: number | null;
  secondHalfAccuracy: number | null;
  activeSolvingTimeSeconds: number;
  blockTimeBudgetSeconds: number | null;
}): PressureDimension[] {
  const triggered: PressureDimension[] = [];

  if (input.firstHalfAccuracy !== null && input.secondHalfAccuracy !== null) {
    const drop = input.firstHalfAccuracy - input.secondHalfAccuracy;
    if (drop >= PRESSURE_TRAINING_CONSTANTS.DEGRADATION_ACCURACY_DROP_THRESHOLD) {
      triggered.push("within_block_degradation");
    }
  }

  if (input.medianGapSeconds !== null && input.medianGapSeconds < PRESSURE_TRAINING_CONSTANTS.SHORT_RECOVERY_GAP_SECONDS) {
    triggered.push("reduced_recovery");
  }

  if (input.blockTimeBudgetSeconds !== null && input.activeSolvingTimeSeconds >= input.blockTimeBudgetSeconds) {
    triggered.push("budget_consumption");
  }

  // Preserve PRESSURE_DIMENSIONS' own fixed order regardless of push order above -- callers rely on this for deterministic iteration.
  return PRESSURE_DIMENSIONS.filter((d) => triggered.includes(d));
}

/**
 * The single entry point `applicability.ts` calls per block. Returns
 * `null` for any NON-qualifying block (fails validation, below the
 * minimum attempt-count floor, or has no attributable concept) — such a
 * block contributes to NOTHING: not the qualifying-block count for any
 * concept, not any trigger dimension (docs/DECISIONS.md D-061). Never
 * throws.
 */
export function deriveBlockPressureEvidence(block: TrainingPracticeBlockContext, attemptRecords: readonly MasteryAttemptRecord[]): BlockPressureEvidence | null {
  if (block.attemptIdsInOrder.length < QUALIFYING_BLOCK_MIN_ATTEMPTS) return null;

  const recordsById = new Map(attemptRecords.map((record) => [record.contribution.attemptId, record] as const));
  if (!isValidBlock(block, recordsById)) return null;

  const conceptName = attributeConcept(block, recordsById);
  if (conceptName === null) return null;

  const { firstHalf, secondHalf } = splitHalves(block.attemptIdsInOrder);
  const firstHalfAccuracy = computeHalfAccuracy(firstHalf, recordsById);
  const secondHalfAccuracy = computeHalfAccuracy(secondHalf, recordsById);
  const medianGapSeconds = computeMedian(block.interAttemptGapsSeconds);
  const blockTimeBudgetSeconds = hasValidBudget(block) ? block.blockTimeBudgetSeconds : null;

  const triggeredDimensions = computeTriggeredDimensions({
    medianGapSeconds,
    firstHalfAccuracy,
    secondHalfAccuracy,
    activeSolvingTimeSeconds: block.activeSolvingTimeSeconds,
    blockTimeBudgetSeconds
  });

  return { practiceBlockId: block.practiceBlockId, conceptName, medianGapSeconds, firstHalfAccuracy, secondHalfAccuracy, triggeredDimensions };
}
