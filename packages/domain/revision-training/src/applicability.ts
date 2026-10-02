import type { TrainingSystemApplicability, TrainingSystemContext } from "@ipmat/training-systems";
import { DORMANCY_MS, REVISION_CONSTANTS } from "./constants.js";
import type { RevisionTrainingRequirement } from "./types.js";

export interface ConceptDormancy {
  conceptName: string;
  gradedAttemptCount: number;
  /** Epoch milliseconds of the most recent graded attempt's persisted `finalizedAt`. */
  lastGradedAtMs: number;
}

/**
 * Per-concept graded-attempt count and most recent graded timestamp for THIS student. A graded
 * attempt is `status === "submitted"` with `isCorrect !== null` (skipped/abandoned are never
 * graded) AND a parseable persisted `finalizedAt` -- an attempt with no usable timestamp is not
 * evidence of WHEN anything happened and is excluded entirely (fail closed). Correctness never
 * matters: a concept answered wrongly three times is exactly as "attempted" as one answered
 * correctly (Revision is re-exposure, not mistake repair).
 */
export function deriveConceptDormancies(context: TrainingSystemContext): ConceptDormancy[] {
  const byConcept = new Map<string, ConceptDormancy>();
  for (const record of context.attemptRecords) {
    const contribution = record.contribution;
    if (contribution.studentId !== context.studentId) continue;
    if (contribution.status !== "submitted" || contribution.isCorrect === null) continue;
    if (contribution.finalizedAt === null) continue;
    const at = Date.parse(contribution.finalizedAt);
    if (!Number.isFinite(at)) continue;
    const conceptName = record.question.conceptName;
    const existing = byConcept.get(conceptName);
    if (existing) {
      existing.gradedAttemptCount += 1;
      if (at > existing.lastGradedAtMs) existing.lastGradedAtMs = at;
    } else {
      byConcept.set(conceptName, { conceptName, gradedAttemptCount: 1, lastGradedAtMs: at });
    }
  }
  return [...byConcept.values()];
}

/**
 * The ONE authoritative applicability decision for Revision (docs/DECISIONS.md D-081). Reads
 * ONLY `context.studentId`, `context.attemptRecords` and `context.now` -- never `candidates`
 * (applicability can never depend on available content), never trap codes, novelty levels,
 * practice blocks, mastery or the error taxonomy.
 *
 * A concept is eligible when it has >= MIN_GRADED_ATTEMPTS graded attempts AND its most recent
 * graded attempt is at least DORMANCY_DAYS old. The target is the eligible concept whose most
 * recent graded attempt is OLDEST (dormant the longest); ties break on conceptName ascending.
 * A missing or unparseable `now` fails closed (not applicable): the provider never reads a
 * clock itself, so the same context always gives the same answer.
 */
export function evaluateRevision(context: TrainingSystemContext): TrainingSystemApplicability {
  const nowMs = context.now === undefined ? Number.NaN : Date.parse(context.now);
  if (!Number.isFinite(nowMs)) {
    return { applicable: false, reason: "insufficient_evidence", explanation: "No evaluation time was supplied, so no concept can be judged dormant." };
  }

  const eligible = deriveConceptDormancies(context).filter(
    (concept) => concept.gradedAttemptCount >= REVISION_CONSTANTS.MIN_GRADED_ATTEMPTS && nowMs - concept.lastGradedAtMs >= DORMANCY_MS
  );
  if (eligible.length === 0) {
    return { applicable: false, reason: "insufficient_evidence", explanation: "No concept has enough graded attempts and has also gone unattempted for the dormancy interval." };
  }

  eligible.sort((a, b) => a.lastGradedAtMs - b.lastGradedAtMs || (a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0));
  const target = eligible[0]!;
  const requirement: RevisionTrainingRequirement = {
    targetConceptName: target.conceptName,
    notes: [`Targeting concept "${target.conceptName}": it has gone unattempted for the dormancy interval.`]
  };
  return { applicable: true, requirement, explanation: `Concept "${target.conceptName}" is the longest-dormant eligible concept.` };
}
