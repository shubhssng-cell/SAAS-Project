import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { recordAttemptEvent, startAttempt, submitAttempt, toAutopsyEvidence, type AttemptQuestionContext } from "@ipmat/attempt";
import { AnthropicProvider, AiGenerationError, type AiResultMetadata } from "@ipmat/ai";
import { buildAutopsyOutput } from "../src/autopsyOutput.js";
import { generateHypothesis } from "../src/hypothesis.js";
import type { AutopsyQuestionContext, ErrorTaxonomyEntry } from "../src/types.js";

/**
 * The autopsy-hypothesis counterpart to `@ipmat/question-engine`'s
 * `runRealAnthropicSmokeTest.ts` (Phase 3.1 §5) — exactly one real
 * `generateHypothesis()` call (the ONLY AI call in the whole Autopsy
 * pipeline, docs/AI_ARCHITECTURE.md §10) against the live Anthropic API.
 * NEVER falls back to `FixtureProvider` — if `ANTHROPIC_API_KEY` is
 * missing or the call fails, this reports the exact failure and exits
 * non-zero.
 *
 * This lives in `@ipmat/autopsy`, not `@ipmat/question-engine`, because
 * `@ipmat/autopsy` already depends on `@ipmat/question-engine` (for
 * Question-DNA-shaped types) — adding the reverse dependency to run this
 * script from question-engine's workspace would create a circular
 * dependency. Run with:
 *
 *   npm run smoke:anthropic --workspace @ipmat/autopsy
 *
 * (`npm run smoke:anthropic --workspace @ipmat/question-engine` continues
 * to cover the other 4 task types exactly as before — this is a second,
 * analogous script, not a replacement.)
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

// The same real Percentages "Reverse Percentage" scenario used throughout this
// codebase's fixtures — a real, recognizable trap (base_confusion), not a
// contrived edge case invented just to make a call succeed.
const attemptQuestionContext: AttemptQuestionContext = {
  questionId: "question-reverse-percentage-1",
  conceptId: "concept-percentages",
  answerFormat: "multiple_choice",
  options: ["16,000", "18,000", "20,000", "24,000"],
  correctAnswer: "20,000",
  expectedTimeSeconds: 90
};

const autopsyQuestionContext: AutopsyQuestionContext = {
  questionId: attemptQuestionContext.questionId,
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  conceptName: "Percentages",
  patternFamilyName: "Reverse Percentage",
  patternTaxonomyCellId: "cell-percentages-reverse-advanced-1",
  difficultyTier: "advanced",
  difficultyDimensions: { conceptualLoad: 0.4, computationalLoad: 0.3, trapDensity: 0.5, representationNovelty: 0.2, timePressure: 0.3, multiStepDepth: 0.4 },
  noveltyLevel: "standard",
  examRelevance: "core",
  testingModes: ["reverse"],
  trapErrorTaxonomyCode: "base_confusion",
  combinesWithConcepts: ["Ratio"]
};

const errorTaxonomy: ErrorTaxonomyEntry[] = [
  { code: "base_confusion", label: "Base confusion", description: "Applied a percentage change to the wrong base quantity (e.g. new value instead of original).", category: "misconception" }
];

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
  console.log("REAL ANTHROPIC SMOKE TEST — @ipmat/autopsy, autopsy-hypothesis task");
  console.log("Provider: anthropic | Model: claude-sonnet-5");
  console.log("=".repeat(70));

  console.log("\n[1/1] Autopsy hypothesis generation for a real, finalized, incorrect attempt (real call)...");
  try {
    // 1. A real, finalized, incorrect attempt via @ipmat/attempt's lifecycle (Phase 4A) —
    //    the same OBSERVATION source the product actually uses, not a hand-rolled shortcut.
    const t = (offsetSeconds: number) => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();
    const claim = { studentId: "student-smoke-test-1", questionId: attemptQuestionContext.questionId };
    let attempt = startAttempt({ id: "attempt-smoke-test-1", studentId: claim.studentId, questionId: claim.questionId, enrollmentId: "enrollment-smoke-test-1", now: t(0) });
    attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(1), selectedAnswer: "16,000" }, claim);
    attempt = submitAttempt(attempt, claim, attemptQuestionContext, { now: t(45) });
    console.log(`   Attempt finalized: isCorrect=${attempt.isCorrect} chosenAnswer=${attempt.chosenAnswer}`);

    // 2. Deterministic EVIDENCE (Phase 5A) — no AI call in this step.
    const evidence = toAutopsyEvidence(attempt, attemptQuestionContext);
    const autopsyOutput = buildAutopsyOutput({ evidence, question: autopsyQuestionContext, errorTaxonomy });
    console.log(`   Candidate error evidence resolved: ${autopsyOutput.candidateErrorEvidence?.proposedErrorTaxonomyCode ?? "(none)"}`);

    // 3. The ONE real AI call in this whole pipeline.
    const hypothesis = await generateHypothesis(provider, { autopsyOutput }, { maxRetries: 2, timeoutMs: 60_000 });

    console.log("   SUCCESS.");
    console.log(`   confirmationStatus: ${hypothesis.confirmationStatus}`);
    console.log(`   proposedErrorCategory: ${hypothesis.proposedErrorCategory}`);
    console.log(`   proposedExplanation: ${hypothesis.proposedExplanation}`);
    console.log(`   supportingEvidence: ${hypothesis.supportingEvidence.join(" | ") || "(none)"}`);
    console.log(`   contradictoryEvidence: ${hypothesis.contradictoryEvidence.join(" | ") || "(none)"}`);
    console.log(`   missingEvidence: ${hypothesis.missingEvidence.join(" | ") || "(none)"}`);
    console.log(`   modelConfidence: ${hypothesis.modelConfidence ?? "(none given)"}`);
    printMetadata("metadata", hypothesis.generationMetadata);

    results.autopsyHypothesis = { success: true, hypothesis, autopsyOutput };
  } catch (error) {
    const aiError = error instanceof AiGenerationError ? error : null;
    console.error(`   FAILURE: ${error instanceof Error ? error.message : String(error)}`);
    if (aiError) printMetadata("metadata (failed attempt)", aiError.metadata);
    results.autopsyHypothesis = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: aiError?.metadata ?? null
    };
  }

  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "real-smoke-test-output.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\nFull results written to ${outPath}`);
  console.log("=".repeat(70));
}

main();
