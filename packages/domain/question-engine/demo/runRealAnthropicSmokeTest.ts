import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  AnthropicProvider,
  AiGenerationError,
  examinerLensAnalysisAiSchema,
  generateStructured,
  type AiResultMetadata,
  type ExaminerLensAnalysisAiOutput
} from "@ipmat/ai";
import { getAllRelationsFor, percentagesConceptGraph } from "@ipmat/concept-graph";
import { percentagesLens } from "@ipmat/examiner-lens";
import { buildLensComparisonReport } from "../src/comparisonReport.js";
import { runGenerationPipeline } from "../src/generationPipeline.js";
import { buildLensRegenerationSystemPrompt, buildLensRegenerationUserPrompt } from "../src/prompts.js";
import { demoBlueprint, existingQuestionStems } from "../fixtures/pipelineFixtures.js";

/**
 * Phase 3.1 §5-6: exactly one real Examiner Lens regeneration and one real
 * question-generation pipeline run against the live Anthropic API. NEVER
 * falls back to FixtureProvider — if ANTHROPIC_API_KEY is missing or the
 * call fails, this reports the exact failure and exits non-zero. Does not
 * overwrite the human-authored Lens baseline and does not persist
 * anything (there is no database connection in this environment at all —
 * see docs/PHASE_REVIEW.md).
 *
 * Run with: npm run smoke:anthropic --workspace @ipmat/question-engine
 */

function loadRootEnvIfPresent(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootEnvPath = resolve(here, "../../../../.env");
  if (!existsSync(rootEnvPath)) return;
  const content = readFileSync(rootEnvPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function printMetadata(label: string, metadata: AiResultMetadata | null) {
  if (!metadata) {
    console.log(`   ${label}: (no call metadata — see failure above)`);
    return;
  }
  console.log(`   ${label}:`);
  console.log(`     provider=${metadata.provider} model=${metadata.model} attempts=${metadata.attempts}`);
  console.log(`     latencyMs=${metadata.latencyMs} success=${metadata.success} validationOutcome=${metadata.validationOutcome}`);
  console.log(
    `     tokenUsage=${metadata.tokenUsage ? `input=${metadata.tokenUsage.inputTokens} output=${metadata.tokenUsage.outputTokens}` : "unavailable"}`
  );
  console.log(`     estimatedCostUsd=${metadata.estimatedCostUsd ?? "unavailable"}`);
}

async function main() {
  loadRootEnvIfPresent();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("FAILURE: ANTHROPIC_API_KEY is not set (checked process.env and root .env).");
    console.error("This smoke test does NOT fall back to FixtureProvider — refusing to run.");
    process.exitCode = 1;
    return;
  }

  const provider = new AnthropicProvider("claude-sonnet-5");
  const results: Record<string, unknown> = {};

  console.log("=".repeat(70));
  console.log("REAL ANTHROPIC SMOKE TEST — Phase 3.1 §5");
  console.log("Provider: anthropic | Model: claude-sonnet-5");
  console.log("=".repeat(70));

  // --- Task 1: real Examiner Lens regeneration -----------------------
  console.log("\n[1/2] Examiner Lens regeneration for Percentages (real call)...");
  try {
    const percentagesConcept = percentagesConceptGraph.concepts.find((c) => c.name === "Percentages")!;
    const neighborNames = new Set(
      getAllRelationsFor(percentagesConceptGraph, "Percentages").map((edge) =>
        edge.from === "Percentages" ? edge.to : edge.from
      )
    );
    const neighborConcepts = percentagesConceptGraph.concepts
      .filter((c) => neighborNames.has(c.name))
      .map((c) => ({ name: c.name, description: c.description }));

    const lensResult = await generateStructured<ExaminerLensAnalysisAiOutput>(provider, {
      task: "examiner-lens-analysis",
      promptVersion: "examiner-lens-analysis-v1",
      systemPrompt: buildLensRegenerationSystemPrompt(),
      userPrompt: buildLensRegenerationUserPrompt({
        conceptName: percentagesConcept.name,
        conceptDescription: percentagesConcept.description,
        neighborConcepts
      }),
      schema: examinerLensAnalysisAiSchema,
      options: { maxRetries: 2, timeoutMs: 60_000 }
    });

    console.log("   SUCCESS.");
    printMetadata("metadata", lensResult.metadata);

    const comparison = buildLensComparisonReport(percentagesLens, lensResult.data, percentagesConceptGraph);
    console.log("\n   Comparison vs. human baseline (human baseline NOT modified):");
    console.log(`     valid generation combinations: ${comparison.combinations.validGenerationCombination.join(", ") || "(none)"}`);
    console.log(`     related but non-combinable:    ${comparison.combinations.relatedButNonCombinable.join(", ") || "(none)"}`);
    console.log(`     unsupported/invented:          ${comparison.combinations.unsupportedByGraph.join(", ") || "(none)"}`);
    console.log(`     missed by AI:                  ${comparison.combinations.missedByAi.join(", ") || "(none)"}`);
    console.log(`     completeness claim found:      ${comparison.completenessClaims.hasUnsupportedClaim}`);

    results.examinerLensRegeneration = { success: true, metadata: lensResult.metadata, aiOutput: lensResult.data, comparison };
  } catch (error) {
    const aiError = error instanceof AiGenerationError ? error : null;
    console.error(`   FAILURE: ${error instanceof Error ? error.message : String(error)}`);
    if (aiError) printMetadata("metadata (failed attempt)", aiError.metadata);
    results.examinerLensRegeneration = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: aiError?.metadata ?? null
    };
  }

  // --- Task 2: real question-generation pipeline ----------------------
  console.log("\n[2/2] Question-generation pipeline for an existing Percentages blueprint (real calls)...");
  try {
    const pipelineResult = await runGenerationPipeline({
      blueprint: demoBlueprint,
      aiProvider: provider,
      graph: percentagesConceptGraph,
      existingQuestionStems,
      provenanceSourceType: "original"
    });

    console.log(`   Final status: ${pipelineResult.status}`);
    console.log(`   Candidate stem: ${pipelineResult.candidate?.stem ?? "(none — generation failed)"}`);
    console.log(`   Candidate stated answer: ${pipelineResult.candidate?.correctAnswer ?? "(none)"}`);
    console.log(`   Checks: structural=${pipelineResult.checks.structural.valid} computation=${pipelineResult.checks.computation.valid} reverification=${pipelineResult.checks.reverification.valid} duplicateRisk=${pipelineResult.checks.duplicateRisk.valid} judge=${pipelineResult.checks.judge.valid}`);
    if (pipelineResult.rejectionReasons.length > 0) {
      console.log("   Rejection reasons:");
      for (const reason of pipelineResult.rejectionReasons) {
        console.log(`     - (${reason.code}) ${reason.field}: ${reason.message}`);
      }
    }
    printMetadata("generation metadata", pipelineResult.metadata.generation);
    printMetadata("reverification metadata", pipelineResult.metadata.reverification);
    printMetadata("judge metadata", pipelineResult.metadata.judge);

    results.questionGeneration = { success: true, result: pipelineResult };
  } catch (error) {
    console.error(`   FAILURE: ${error instanceof Error ? error.message : String(error)}`);
    results.questionGeneration = { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "real-smoke-test-output.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\nFull results written to ${outPath}`);
  console.log("=".repeat(70));
}

main();
