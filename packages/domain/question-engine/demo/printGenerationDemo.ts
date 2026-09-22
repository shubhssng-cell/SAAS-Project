import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { FixtureProvider } from "@ipmat/ai";
import { runGenerationPipeline } from "../src/generationPipeline.js";
import {
  demoBlueprint,
  existingQuestionStems,
  passingJudge,
  validGeneratedCandidate,
  validReverification
} from "../fixtures/pipelineFixtures.js";

/**
 * Phase 3 §13 demonstration: INPUT (one blueprint) -> AI generation ->
 * independent verification -> quality validation -> final candidate.
 * No ANTHROPIC_API_KEY is configured in this environment, so this runs
 * against FixtureProvider (deterministic canned responses) rather than a
 * live model — the pipeline code itself is provider-agnostic and would
 * run identically against a real AiProvider (see @ipmat/ai's
 * AnthropicProvider). Run with:
 *   npm run demo:generation --workspace @ipmat/question-engine
 */
async function main() {
  console.log("=".repeat(70));
  console.log("QUESTION GENERATION PIPELINE — valid candidate path");
  console.log("(FixtureProvider stands in for a live AI call — see the Phase 3 report)");
  console.log("=".repeat(70));

  console.log("\nINPUT: QuestionBlueprint");
  console.log(JSON.stringify(demoBlueprint, null, 2));

  const provider = new FixtureProvider([
    JSON.stringify(validGeneratedCandidate),
    JSON.stringify(validReverification),
    JSON.stringify(passingJudge)
  ]);

  const result = await runGenerationPipeline({
    blueprint: demoBlueprint,
    aiProvider: provider,
    graph: percentagesConceptGraph,
    existingQuestionStems,
    provenanceSourceType: "original"
  });

  console.log("\n--- AI GENERATION ---");
  console.log(`provider=${result.metadata.generation?.provider} model=${result.metadata.generation?.model} attempts=${result.metadata.generation?.attempts} success=${result.metadata.generation?.success}`);
  console.log(`Generated stem: ${result.candidate?.stem}`);
  console.log(`Stated answer: ${result.candidate?.correctAnswer}`);

  console.log("\n--- INDEPENDENT VERIFICATION ---");
  console.log(`Deterministic recomputation (mathjs, candidate never trusted on its own): ${result.checks.computation.valid ? "MATCH" : "MISMATCH"}`);
  console.log(`Independent re-derivation (second, separate AI call given only the stem): ${result.checks.reverification.valid ? "AGREES" : "DISAGREES"}`);

  console.log("\n--- QUALITY VALIDATION ---");
  console.log(`Blueprint compliance / syllabus / single-answer / no-completeness-claim / provenance: ${result.checks.structural.valid ? "PASS" : "FAIL"}`);
  console.log(`Duplicate risk vs. existing bank: ${result.checks.duplicateRisk.valid ? "PASS (not a duplicate)" : "FAIL"}`);
  console.log(`AI-judge pass (ambiguity, contradiction, difficulty honesty): ${result.checks.judge.valid ? "PASS" : "FAIL"}`);

  console.log("\n--- FINAL QUESTION CANDIDATE ---");
  console.log(`Lifecycle status: ${result.status}`);
  console.log(`Requires human review: ${result.status === "review_required"}`);
  console.log(`Rejection reasons: ${result.rejectionReasons.length === 0 ? "(none)" : JSON.stringify(result.rejectionReasons)}`);

  console.log("\n" + "=".repeat(70));
}

main();
