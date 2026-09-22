import type { AttemptAutopsyEvidence } from "@ipmat/attempt";
import type { AutopsyQuestionContext, CandidateErrorEvidence, ErrorTaxonomyEntry } from "./types.js";

const QUALIFICATION =
  "This is a CANDIDATE error category derived from question design metadata and observable behavior only — " +
  "it is NOT a confirmed diagnosis and must not be treated as one until the student confirms or corrects it " +
  "(docs/DECISIONS.md D-006). It is a deterministic pattern match, not an AI judgment and not a measurement " +
  "of the student's actual reasoning process.";

/**
 * A deterministic CANDIDATE error category (Phase 5A §8) — never an AI
 * call, never promoted to a confirmed diagnosis. Integrates the EXISTING
 * `ErrorTaxonomy` (caller-supplied `errorTaxonomy` entries) rather than
 * defining a second one. Returns `null` when there is no wrong answer to
 * categorize at all (correct, skipped, abandoned, or still in_progress) —
 * error-category evidence only applies to a submitted, incorrect attempt.
 */
export function deriveCandidateErrorEvidence(
  evidence: AttemptAutopsyEvidence,
  question: AutopsyQuestionContext,
  errorTaxonomy: ErrorTaxonomyEntry[]
): CandidateErrorEvidence | null {
  if (evidence.isCorrect !== false) return null;

  const supportingEvidence: string[] = [
    `Attempt was submitted with final answer "${evidence.finalAnswer}", which did not match the authoritative correct answer "${evidence.correctAnswer}".`
  ];
  const missingEvidence: string[] = [
    "No record of the student's own reasoning process for this attempt (reasoning_text/working_steps are not consumed in this phase)."
  ];

  if (question.trapErrorTaxonomyCode === null) {
    missingEvidence.push("This question has no designated trap/error-taxonomy code to pattern-match the incorrect answer against.");
    return {
      proposedErrorCategory: null,
      proposedErrorTaxonomyCode: null,
      supportingEvidence,
      missingEvidence,
      qualification: QUALIFICATION
    };
  }

  const matchedEntry = errorTaxonomy.find((entry) => entry.code === question.trapErrorTaxonomyCode);
  if (!matchedEntry) {
    missingEvidence.push(
      `Designated trap code "${question.trapErrorTaxonomyCode}" was not found in the supplied error taxonomy — its category could not be resolved.`
    );
    return {
      proposedErrorCategory: null,
      proposedErrorTaxonomyCode: question.trapErrorTaxonomyCode,
      supportingEvidence,
      missingEvidence,
      qualification: QUALIFICATION
    };
  }

  supportingEvidence.push(
    `This question was designed with trap "${matchedEntry.code}" (${matchedEntry.category}): ${matchedEntry.description}`
  );
  missingEvidence.push(
    "This is a pattern match against the question's DESIGNED trap, not independent verification that the student's actual error matches it."
  );

  return {
    proposedErrorCategory: matchedEntry.category,
    proposedErrorTaxonomyCode: matchedEntry.code,
    supportingEvidence,
    missingEvidence,
    qualification: QUALIFICATION
  };
}
