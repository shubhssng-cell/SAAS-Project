import { toMasteryContribution, type AttemptQuestionContext, type AttemptState } from "@ipmat/attempt";
import { fromRepairPlanPersistenceRecord } from "@ipmat/autopsy";
import type { CanonicalQuestion, ConceptRecord, StoredRepairPlan, TrainingQuestionRecord } from "@ipmat/db";
import { computeMasteryState } from "@ipmat/mastery";
import {
  deriveBlockActiveSolvingTimeSeconds,
  deriveBlockWallClockDurationSeconds,
  deriveInterAttemptGapsSeconds,
  type PracticeBlockState
} from "@ipmat/practice-block";
import type { ValidationState } from "@ipmat/question-engine";
import type {
  ActiveRepairPlanContext,
  MasteryAttemptRecord,
  MasteryStateResult,
  TrainingCandidateQuestion,
  TrainingPracticeBlockContext
} from "@ipmat/training-orchestration";

/**
 * Small, pure read-model mappers. None of them decides anything about
 * WHAT to train — every calculation is delegated to the existing domain
 * function that owns it (`toMasteryContribution`, `computeMasteryState`,
 * `fromRepairPlanPersistenceRecord`, the three `@ipmat/practice-block`
 * time derivations). They only restate persisted data into the existing
 * public contracts, and exclude (never coerce) data that cannot be restated
 * faithfully.
 */

const PUBLISHED: ValidationState = "published";

/**
 * `TrainingQuestionRecord` (`@ipmat/db`) and `TrainingCandidateQuestion`
 * (`@ipmat/training-orchestration`) are structurally identical by design
 * (37_TRAINING_RECOMMENDATION.md §2). Each candidate is still rebuilt
 * field-by-field so nothing beyond the three contract fields can ride
 * along into selection, and non-published records are dropped as defense
 * in depth.
 */
export function toTrainingCandidates(records: TrainingQuestionRecord[]): TrainingCandidateQuestion[] {
  return records
    .filter((record) => record.validationState === PUBLISHED)
    .map((record) => ({ question: record.question, expectedTimeSeconds: record.expectedTimeSeconds, validationState: record.validationState }));
}

/**
 * `fromRepairPlanPersistenceRecord()` returns `null` for any row it cannot
 * reconstruct faithfully (a pre-D-039 row with null snapshot fields, or a
 * linked Autopsy with no `confirmedAt`) — such plans are EXCLUDED, never
 * completed with invented values. `behaviorSignals`/`targetDifficultyTier`
 * are optional tie-break context that is not persisted on RepairPlan, so
 * they are omitted rather than guessed.
 */
export function toActiveRepairPlanContexts(storedPlans: StoredRepairPlan[]): ActiveRepairPlanContext[] {
  const contexts: ActiveRepairPlanContext[] = [];
  for (const stored of storedPlans) {
    const plan = fromRepairPlanPersistenceRecord(stored);
    if (plan !== null) contexts.push({ plan });
  }
  return contexts;
}

/** The ONE place a `CanonicalQuestion` becomes an `AttemptQuestionContext` here — same `answerFormat` derivation as `@ipmat/practice-loop` (options present => multiple_choice). Used only as `toMasteryContribution()`'s input. */
function toAttemptQuestionContext(question: CanonicalQuestion): AttemptQuestionContext {
  return {
    questionId: question.id,
    conceptId: question.conceptId,
    answerFormat: question.options !== null ? "multiple_choice" : "numeric_entry",
    options: question.options,
    correctAnswer: question.correctAnswer,
    expectedTimeSeconds: question.expectedTimeSeconds
  };
}

/**
 * Finalized attempts -> `MasteryAttemptRecord[]`, preserving the input
 * order (`finalizedAt ASC`). An attempt is EXCLUDED (never given invented
 * context) when:
 * - its question is not in this exam's published, DNA-complete pool
 *   (includes attempts on another exam's questions), or
 * - its canonical question cannot be loaded, or
 * - the canonical `conceptId` does not resolve to the same concept name
 *   the DNA context carries (a broken persisted link).
 * Canonical questions are loaded once per distinct question id.
 */
export async function buildMasteryAttemptRecords(input: {
  attempts: AttemptState[];
  questionContextById: ReadonlyMap<string, TrainingQuestionRecord>;
  conceptNameById: ReadonlyMap<string, string>;
  loadCanonicalQuestion: (questionId: string) => Promise<CanonicalQuestion | null>;
}): Promise<MasteryAttemptRecord[]> {
  const canonicalById = new Map<string, CanonicalQuestion | null>();
  const records: MasteryAttemptRecord[] = [];

  for (const attempt of input.attempts) {
    const context = input.questionContextById.get(attempt.questionId);
    if (context === undefined) continue;

    if (!canonicalById.has(attempt.questionId)) {
      canonicalById.set(attempt.questionId, await input.loadCanonicalQuestion(attempt.questionId));
    }
    const canonical = canonicalById.get(attempt.questionId) ?? null;
    if (canonical === null || canonical.id !== attempt.questionId) continue;
    if (input.conceptNameById.get(canonical.conceptId) !== context.question.conceptName) continue;

    records.push({ contribution: toMasteryContribution(attempt, toAttemptQuestionContext(canonical)), question: context.question });
  }

  return records;
}

/** One `computeMasteryState()` call per concept — the existing, multidimensional computation, never a new or blended score. */
export function computeMasteryByConcept(input: {
  attemptRecords: MasteryAttemptRecord[];
  concepts: ConceptRecord[];
  studentId: string;
  now: string;
}): MasteryStateResult[] {
  return input.concepts.map((concept) =>
    computeMasteryState(input.attemptRecords, { studentId: input.studentId, conceptId: concept.id, conceptName: concept.name, now: input.now })
  );
}

/**
 * One PracticeBlock -> `TrainingPracticeBlockContext`, with all three time
 * measures computed by `@ipmat/practice-block`'s own derive functions.
 * `attempts` must already be ownership-verified and in
 * `blockSequenceNumber` order.
 *
 * Returns `null` (block omitted) when the block has no attempts, or when
 * any of its attempts is absent from `attemptRecordIds` (still
 * `in_progress`, or excluded from mastery for missing question context):
 * `TrainingSystemContext.practiceBlocks` requires every listed attempt id to
 * appear in `attemptRecords`, and dropping individual attempts would
 * misstate the block's own sequence/gap evidence.
 */
export function buildPracticeBlockContext(input: {
  block: PracticeBlockState;
  attempts: Array<AttemptState & { blockMembership: NonNullable<AttemptState["blockMembership"]> }>;
  attemptRecordIds: ReadonlySet<string>;
}): TrainingPracticeBlockContext | null {
  const { block, attempts } = input;
  if (attempts.length === 0) return null;
  if (!attempts.every((attempt) => input.attemptRecordIds.has(attempt.id))) return null;

  return {
    practiceBlockId: block.id,
    attemptIdsInOrder: attempts.map((attempt) => attempt.id),
    targetQuestionCount: block.targetQuestionCount,
    blockTimeBudgetSeconds: block.blockTimeBudgetSeconds,
    wallClockDurationSeconds: deriveBlockWallClockDurationSeconds(block),
    activeSolvingTimeSeconds: deriveBlockActiveSolvingTimeSeconds(attempts),
    interAttemptGapsSeconds: deriveInterAttemptGapsSeconds(
      attempts.map((attempt) => ({
        blockSequenceNumber: attempt.blockMembership.blockSequenceNumber,
        startedAt: attempt.startedAt,
        finalizedAt: attempt.finalizedAt
      }))
    )
  };
}
