import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { FixtureProvider } from "@ipmat/ai";
import { runGenerationPipeline } from "../src/generationPipeline.js";
import {
  demoBlueprint,
  disagreeingReverification,
  existingQuestionStems,
  passingJudge,
  wrongAnswerGeneratedCandidate
} from "../fixtures/pipelineFixtures.js";

/**
 * Phase 3 §13 demonstration: a deliberately invalid candidate, and a
 * readable report of exactly why it was rejected. The candidate's stated
 * answer (450) disagrees with its own arithmetic (4 x 150 / 1.25 = 480)
 * — the kind of error an LLM can produce with total apparent confidence.
 * Note that the AI-judge pass alone would NOT have caught this (nothing
 * about the wording is ambiguous or contradictory) — this is exactly why
 * independent computation and re-derivation exist as separate checks
 * (docs/QUESTION_ENGINE.md §5a): never trust "the LLM says the answer is X."
 * Run with: npm run demo:rejection --workspace @ipmat/question-engine
 */
async function main() {
  console.log("=".repeat(70));
  console.log("QUESTION GENERATION PIPELINE — deliberately invalid candidate");
  console.log("=".repeat(70));

  const provider = new FixtureProvider([
    JSON.stringify(wrongAnswerGeneratedCandidate),
    JSON.stringify(disagreeingReverification),
    JSON.stringify(passingJudge)
  ]);

  const result = await runGenerationPipeline({
    blueprint: demoBlueprint,
    aiProvider: provider,
    graph: percentagesConceptGraph,
    existingQuestionStems,
    provenanceSourceType: "original"
  });

  console.log(`\nCandidate stem: ${result.candidate?.stem}`);
  console.log(`Candidate's stated answer: ${result.candidate?.correctAnswer}`);
  console.log(`Candidate's own computation: ${result.candidate?.groundTruthDerivation.computation} (independently recomputed to 480)`);

  console.log("\nREJECTION REPORT");
  console.log("-".repeat(70));
  console.log(`Final status: ${result.status}`);
  console.log(`Was ever eligible for publication? ${result.status === "published" ? "yes" : "NO"}`);
  console.log(`\nThe AI-judge pass alone: ${result.checks.judge.valid ? "PASSED — saw nothing wrong with the wording" : "failed"}`);
  console.log("That is exactly the gap independent verification exists to close:\n");

  for (const [checkName, check] of Object.entries(result.checks)) {
    if (check.valid) continue;
    console.log(`  [FAILED] ${checkName}:`);
    for (const issue of check.issues) {
      console.log(`    - (${issue.code}) ${issue.field}: ${issue.message}`);
    }
  }

  console.log("\nConclusion: this candidate never advances past 'rejected' — it cannot become published content.");
  console.log("=".repeat(70));
}

main();
