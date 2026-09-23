import type { QuestionCandidateAiOutput } from "@ipmat/ai";
import type { QuestionBlueprint } from "./blueprint.js";
import type { QuestionLifecycleStatus } from "./lifecycle.js";

export type { QuestionCandidateAiOutput };

/**
 * The Candidate -> persisted Question import boundary (docs/DECISIONS.md
 * D-050). This is the ONE gate deciding whether a `GenerationPipelineResult`
 * is eligible to become a real, persisted `Question` row — pure and
 * database-free, reusing the pipeline's OWN verdict (`QuestionLifecycleStatus`)
 * rather than re-running any structural/computation/reverification/judge
 * check a second time (those already ran inside `runGenerationPipeline()`;
 * duplicating them here would be exactly the "reimplement validation"
 * mistake this function exists to avoid).
 *
 * Only pipeline status `"validated"` is ever importable. `"review_required"`
 * and `"rejected"` are BOTH refused, fail closed — `computeLifecycleStatus()`
 * already guarantees Hard/Extreme/Novel tiers can never reach `"validated"`
 * (they always land in `"review_required"`, `requiresHumanReview()`/D-008),
 * so refusing `"review_required"` here costs nothing today: there is
 * currently no legitimate persisted representation for content that still
 * needs human review (the existing 5-value `ValidationState` enum has no
 * such state), and inventing one is explicitly out of scope for this
 * boundary. A Hard/Extreme/Novel candidate simply has no import path yet.
 */
export interface ImportableCandidate {
  blueprint: QuestionBlueprint;
  candidate: QuestionCandidateAiOutput;
}

export const CANDIDATE_IMPORT_ERROR_CODES = ["not_validated", "missing_candidate", "blueprint_mismatch"] as const;
export type CandidateImportErrorCode = (typeof CANDIDATE_IMPORT_ERROR_CODES)[number];

/** Fail-closed guard mirroring `PublicationDecisionError`'s style — a definite `ImportableCandidate` or an exception, never a silently-ignorable "maybe". */
export class CandidateImportError extends Error {
  readonly code: CandidateImportErrorCode;

  constructor(code: CandidateImportErrorCode, message: string) {
    super(message);
    this.name = "CandidateImportError";
    this.code = code;
  }
}

/**
 * Narrows a `GenerationPipelineResult`-shaped input down to an
 * `ImportableCandidate`, or throws. Callers (a `QuestionImportRepository`
 * implementation) pass exactly `{ blueprint, candidate, status }` — the
 * SAME fields a real `runGenerationPipeline()` call produces — never a
 * hand-assembled object with independently-settable `correctAnswer`/
 * `difficultyTier`/`validationState` fields that could contradict what the
 * pipeline actually validated.
 *
 * Also verifies `candidate.blueprintId === blueprint.id` — the pipeline's
 * own `validateBlueprintCompliance()` (inside `validateCandidateStructurally()`)
 * already guarantees every field of `candidate.questionDna` is consistent
 * with the REAL blueprint tied to that id, but ONLY for that specific
 * (blueprint, candidate) pair. Without this check here, a caller could
 * supply a genuinely-`"validated"` `candidate` alongside an unrelated
 * `blueprint` object (different `examCode`/`sectionName`/`chapterName`) —
 * `QuestionImportRepository` resolves `examId`/`sectionId`/`chapterId`
 * from `blueprint`, so an unverified blueprint would let validated content
 * be filed under an exam/section/chapter it was never actually checked
 * against. This closes that gap structurally, for both the Prisma and
 * in-memory implementations, since both call this function first.
 */
export function assertCandidateIsImportable(result: {
  blueprint: QuestionBlueprint;
  candidate: QuestionCandidateAiOutput | null;
  status: QuestionLifecycleStatus;
}): ImportableCandidate {
  if (result.status !== "validated") {
    throw new CandidateImportError(
      "not_validated",
      `Cannot import: pipeline status is "${result.status}", not "validated". "review_required" and "rejected" candidates are never importable — see docs/DECISIONS.md D-050.`
    );
  }
  if (!result.candidate) {
    throw new CandidateImportError(
      "missing_candidate",
      "Cannot import: no candidate was produced (a null candidate, e.g. from a failed generation call)."
    );
  }
  if (result.candidate.blueprintId !== result.blueprint.id) {
    throw new CandidateImportError(
      "blueprint_mismatch",
      `Cannot import: candidate.blueprintId ("${result.candidate.blueprintId}") does not match the supplied blueprint's id ("${result.blueprint.id}") — this candidate was never validated against this blueprint.`
    );
  }

  return { blueprint: result.blueprint, candidate: result.candidate };
}
