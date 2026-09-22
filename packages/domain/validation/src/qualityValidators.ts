import { findCompletenessClaims } from "@ipmat/examiner-lens";
import { hasConcept, type ConceptGraph } from "@ipmat/concept-graph";
import type { QuestionCandidateAiOutput } from "@ipmat/ai";
import { fail, mergeResults, ok, type ValidationResult } from "./types.js";

/**
 * Minimal, locally-declared shape of "what the candidate must not
 * silently diverge from" — deliberately NOT imported from
 * @ipmat/question-engine's QuestionBlueprint to avoid a package cycle
 * (question-engine depends on validation, not the reverse; see docs/
 * ARCHITECTURE.md §6). Any object with these fields satisfies it
 * structurally.
 *
 * Every field the candidate could silently drift on is checked (Phase
 * 3.1 §7): concept, pattern family, difficulty tier, testing modes, the
 * trap it was asked to build in, and combination concepts. `exam`,
 * `section`, and `chapter` are not listed here because the candidate
 * schema has no field for them at all — the AI is structurally unable to
 * restate or change them, since it's never asked to.
 */
export interface BlueprintExpectation {
  id: string;
  conceptName: string;
  patternFamilyName: string;
  difficultyTier: string;
  /** Every mode listed here MUST appear in the candidate's testingModes — the candidate may exercise additional modes, never fewer than required. */
  requiredTestingModes: string[];
  /** null means the blueprint did not specify a trap; any candidate value is then acceptable. Non-null means an exact match is required. */
  trapErrorTaxonomyCode: string | null;
  /** The exact set of concepts this question must combine with — checked as a set, order-independent. */
  combinationConcepts: string[];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((item) => setB.has(item));
}

/** "The generator must not be allowed to change the blueprint silently" (docs/QUESTION_ENGINE.md §5). */
export function validateBlueprintCompliance(
  candidate: QuestionCandidateAiOutput,
  blueprint: BlueprintExpectation
): ValidationResult {
  const issues: ValidationResult[] = [];
  if (candidate.blueprintId !== blueprint.id) {
    issues.push(
      fail(
        "blueprint_violation",
        "blueprintId",
        `Candidate echoed blueprintId "${candidate.blueprintId}", expected "${blueprint.id}"`
      )
    );
  }
  if (candidate.questionDna.conceptName !== blueprint.conceptName) {
    issues.push(
      fail(
        "blueprint_violation",
        "questionDna.conceptName",
        `Candidate targets concept "${candidate.questionDna.conceptName}", blueprint specified "${blueprint.conceptName}"`
      )
    );
  }
  if (candidate.questionDna.patternFamilyName !== blueprint.patternFamilyName) {
    issues.push(
      fail(
        "blueprint_violation",
        "questionDna.patternFamilyName",
        `Candidate targets pattern family "${candidate.questionDna.patternFamilyName}", blueprint specified "${blueprint.patternFamilyName}"`
      )
    );
  }
  if (candidate.questionDna.difficultyTier !== blueprint.difficultyTier) {
    issues.push(
      fail(
        "blueprint_violation",
        "questionDna.difficultyTier",
        `Candidate claims difficulty tier "${candidate.questionDna.difficultyTier}", blueprint specified "${blueprint.difficultyTier}"`
      )
    );
  }
  const candidateTestingModes: string[] = candidate.questionDna.testingModes;
  const missingModes = blueprint.requiredTestingModes.filter((mode) => !candidateTestingModes.includes(mode));
  if (missingModes.length > 0) {
    issues.push(
      fail(
        "blueprint_violation",
        "questionDna.testingModes",
        `Candidate is missing required testing mode(s) from the blueprint: ${missingModes.join(", ")}`
      )
    );
  }
  if (blueprint.trapErrorTaxonomyCode !== null && candidate.questionDna.trapErrorTaxonomyCode !== blueprint.trapErrorTaxonomyCode) {
    issues.push(
      fail(
        "blueprint_violation",
        "questionDna.trapErrorTaxonomyCode",
        `Candidate built in trap "${candidate.questionDna.trapErrorTaxonomyCode}", blueprint required "${blueprint.trapErrorTaxonomyCode}"`
      )
    );
  }
  if (!sameSet(candidate.questionDna.combinesWithConcepts, blueprint.combinationConcepts)) {
    issues.push(
      fail(
        "blueprint_violation",
        "questionDna.combinesWithConcepts",
        `Candidate combines with [${candidate.questionDna.combinesWithConcepts.join(", ")}], blueprint required exactly [${blueprint.combinationConcepts.join(", ")}]`
      )
    );
  }
  return mergeResults(...issues);
}

/** Every concept name the candidate references must be a real node in the concept graph. */
export function validateSyllabusCompatibility(candidate: QuestionCandidateAiOutput, graph: ConceptGraph): ValidationResult {
  const names = [
    candidate.questionDna.conceptName,
    ...candidate.questionDna.subconcepts,
    ...candidate.questionDna.prerequisites,
    ...candidate.questionDna.combinesWithConcepts
  ];
  const issues = names
    .filter((name) => !hasConcept(graph, name))
    .map((name) => fail("out_of_syllabus", "questionDna", `"${name}" is not a concept in the seeded graph`));
  return mergeResults(...issues, ok());
}

/** Exactly one correct answer for multiple-choice; the stated correctAnswer must appear exactly once among the options. */
export function validateSingleCorrectAnswer(candidate: QuestionCandidateAiOutput): ValidationResult {
  if (candidate.answerFormat !== "multiple_choice") return ok();
  const options = candidate.options ?? [];
  if (options.length === 0) {
    return fail("multiple_or_no_correct_answer", "options", "multiple_choice format requires a non-empty options array");
  }
  const matches = options.filter((option) => option.trim() === candidate.correctAnswer.trim());
  if (matches.length !== 1) {
    return fail(
      "multiple_or_no_correct_answer",
      "options",
      `correctAnswer must appear exactly once among options (found ${matches.length} match(es))`
    );
  }
  const uniqueOptions = new Set(options.map((option) => option.trim()));
  if (uniqueOptions.size !== options.length) {
    return fail("distractor_quality", "options", "options array contains duplicate values");
  }
  return ok();
}

/** Every free-text field must avoid asserting literal completeness (docs/DECISIONS.md D-007). */
export function validateNoCompletenessClaims(candidate: QuestionCandidateAiOutput): ValidationResult {
  const text = [candidate.stem, candidate.explanation, ...candidate.solutionSteps, candidate.reasoning].join(" ");
  const claims = findCompletenessClaims(text);
  if (claims.length > 0) {
    return fail(
      "unsupported_completeness_claim",
      "stem/explanation/solutionSteps",
      `Contains a false-completeness claim: "${claims[0]}"`
    );
  }
  return ok();
}

/** A published question must always have carried a provenance source type through generation (docs/DATABASE.md). */
export function validateProvenancePresent(provenanceSourceType: string | null | undefined): ValidationResult {
  if (!provenanceSourceType) {
    return fail("missing_provenance", "provenanceSourceType", "A question cannot proceed toward publication without a provenance source type");
  }
  return ok();
}
