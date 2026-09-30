import { FixtureProvider } from "@ipmat/ai";
import { percentagesConceptGraph } from "@ipmat/concept-graph";
import {
  assertCandidateIsImportable,
  percentagePointStandaloneStandard,
  runGenerationPipeline,
  successivePnlAdvanced,
  type CoverageExpansionFixture,
  type ImportableCandidate
} from "@ipmat/question-engine";
import type { QuestionImportRepository, QuestionPublicationRepository } from "../src/repositories/types.js";

/**
 * Product Phase 2 Unit 8 -- a SMALL persisted practice content set for a local/disposable database.
 *
 * Nothing here bypasses publication rules. Each question goes through the SAME production path any
 * future content would:
 *   1. the real `runGenerationPipeline()` (deterministic validation; the model responses come from
 *      `FixtureProvider` fixtures already in this repo -- NEVER a live model) must reach `"validated"`;
 *   2. `QuestionImportRepository.importValidatedCandidate()` writes it as `ai_validated` with a fresh
 *      `Provenance` row (`sourceType: "original"`);
 *   3. `QuestionPublicationRepository.decide(id, "publish")` -- the one legitimate publish path, which
 *      calls `decidePublication()` -- publishes it. That is permitted WITHOUT a human reviewer only for
 *      standard/advanced tiers (D-008); a hard/extreme candidate would be refused and fail the seed.
 *
 * Content is original/internal (repository-owned Phase 3.5 fixtures): none of it is from any external
 * source and none is presented as an official IPMAT question. The hard/extreme fixtures are NOT
 * included -- they require human review, which cannot honestly be claimed here.
 *
 * Together with the base seed's existing original demonstration question this gives 3 published
 * Percentages questions. It is a development/test content set, not a question bank.
 */
export const PRACTICE_CONTENT_FIXTURES: readonly CoverageExpansionFixture[] = [successivePnlAdvanced, percentagePointStandaloneStandard];

export interface ValidatedPracticeCandidate extends ImportableCandidate {
  label: string;
}

/** Runs each fixture through the real pipeline and returns only candidates that are importable (`"validated"`); anything else throws. */
export async function buildValidatedPracticeCandidates(fixtures: readonly CoverageExpansionFixture[] = PRACTICE_CONTENT_FIXTURES): Promise<ValidatedPracticeCandidate[]> {
  const out: ValidatedPracticeCandidate[] = [];
  const stems: string[] = [];
  for (const fixture of fixtures) {
    const provider = new FixtureProvider([JSON.stringify(fixture.candidate), JSON.stringify(fixture.reverification), JSON.stringify(fixture.judge)]);
    const result = await runGenerationPipeline({
      blueprint: fixture.blueprint,
      aiProvider: provider,
      graph: percentagesConceptGraph,
      existingQuestionStems: [...stems],
      provenanceSourceType: "original"
    });
    const importable = assertCandidateIsImportable(result); // throws unless the pipeline verdict is "validated"
    stems.push(importable.candidate.stem);
    out.push({ label: fixture.label, ...importable });
  }
  return out;
}

export interface SeededPracticeQuestion {
  label: string;
  questionId: string;
  outcome: "published" | "already_published";
}

/** Idempotent: re-running leaves already-imported/published questions alone. */
export async function seedPracticeContent(
  repositories: { importer: QuestionImportRepository; publication: QuestionPublicationRepository },
  candidates: readonly ValidatedPracticeCandidate[]
): Promise<SeededPracticeQuestion[]> {
  const results: SeededPracticeQuestion[] = [];
  for (const { label, blueprint, candidate } of candidates) {
    const imported = await repositories.importer.importValidatedCandidate({
      blueprint,
      candidate,
      status: "validated",
      provenance: { sourceType: "original", sourceRef: `phase-2-unit-8-dev-seed: ${label}`, attributedTo: "IPMAT AI Prep (original, internal development content)" }
    });
    if (imported.validationState === "published") {
      results.push({ label, questionId: imported.id, outcome: "already_published" });
      continue;
    }
    const decided = await repositories.publication.decide(imported.id, "publish"); // throws if publication is not currently allowed
    results.push({ label, questionId: decided.id, outcome: "published" });
  }
  return results;
}
