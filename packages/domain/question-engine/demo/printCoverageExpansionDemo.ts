import { FixtureProvider } from "@ipmat/ai";
import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { computeTaxonomyCellCoverage } from "../src/coverage.js";
import { runGenerationPipeline } from "../src/generationPipeline.js";
import { percentagesTaxonomyCells } from "../fixtures/percentagesTaxonomyCells.js";
import { percentagesReversePercentageExample } from "../fixtures/percentagesQuestionDnaExample.js";
import { coverageExpansionFixtures, duplicateRiskDemoFixture, type CoverageExpansionFixture } from "../fixtures/percentagesCoverageExpansion.js";
import type { QuestionRefForCellCoverage, ValidationState } from "../src/types.js";

/**
 * Phase 3.5 demonstration: prints the Percentages taxonomy-cell coverage
 * matrix BEFORE and AFTER running the real `runGenerationPipeline()`
 * (FixtureProvider — no live ANTHROPIC_API_KEY available or used, see
 * docs/MASTER_PLAN.md) over every fixture in `percentagesCoverageExpansion.ts`,
 * plus the duplicate-risk rejection demonstration. Run with:
 *   npm run demo:coverage-expansion --workspace @ipmat/question-engine
 */

const baselineRef: QuestionRefForCellCoverage = {
  patternFamilyName: percentagesReversePercentageExample.dna.patternFamilyName,
  combination: percentagesReversePercentageExample.dna.combinesWithConcepts,
  testingMode: "reverse",
  trapErrorTaxonomyCode: percentagesReversePercentageExample.dna.trapErrorTaxonomyCode,
  difficultyTier: percentagesReversePercentageExample.dna.difficultyTier,
  validationState: percentagesReversePercentageExample.dna.validationState
};

function printMatrix(title: string, refs: QuestionRefForCellCoverage[]) {
  console.log(`\n--- ${title} ---`);
  const matrix = computeTaxonomyCellCoverage(percentagesTaxonomyCells, refs);
  for (const cell of matrix) {
    const combo = cell.combination.length > 0 ? cell.combination.join("+") : "(none)";
    console.log(
      `  [${cell.status.padEnd(15)}] ${cell.patternFamilyName} | ${combo} | ${cell.testingMode} | trap=${cell.trapErrorTaxonomyCode ?? "(none)"} | ${cell.difficultyTier} | questions=${cell.existingQuestionCount} published=${cell.publishedQuestionCount}`
    );
  }
  const summary = {
    uncovered: matrix.filter((c) => c.status === "uncovered").length,
    underrepresented: matrix.filter((c) => c.status === "underrepresented").length,
    covered: matrix.filter((c) => c.status === "covered").length
  };
  console.log(`  Summary: uncovered=${summary.uncovered} underrepresented=${summary.underrepresented} covered=${summary.covered} (of ${matrix.length} total cells)`);
  return summary;
}

async function runFixture(fixture: CoverageExpansionFixture, existingQuestionStems: string[]) {
  const provider = new FixtureProvider([JSON.stringify(fixture.candidate), JSON.stringify(fixture.reverification), JSON.stringify(fixture.judge)]);
  return runGenerationPipeline({
    blueprint: fixture.blueprint,
    aiProvider: provider,
    graph: percentagesConceptGraph,
    existingQuestionStems,
    provenanceSourceType: "original"
  });
}

async function main() {
  console.log("=".repeat(78));
  console.log("PHASE 3.5 — PERCENTAGES QUESTION UNIVERSE EXPANSION");
  console.log("FixtureProvider only — no live ANTHROPIC_API_KEY available or used");
  console.log("=".repeat(78));

  printMatrix("BEFORE", [baselineRef]);

  console.log("\n--- RUNNING REAL GENERATION PIPELINE FOR EACH PREVIOUSLY-UNCOVERED CELL ---");
  const existingQuestionStems: string[] = [percentagesReversePercentageExample.content.body];
  const generatedRefs: QuestionRefForCellCoverage[] = [baselineRef];
  let publishedCount = 0;
  let validatedCount = 0;
  let reviewRequiredCount = 0;
  let rejectedCount = 0;

  for (const fixture of coverageExpansionFixtures) {
    const result = await runFixture(fixture, existingQuestionStems);
    existingQuestionStems.push(fixture.candidate.stem);

    console.log(`\n  ${fixture.label}`);
    console.log(`    blueprintId=${fixture.blueprint.id}`);
    console.log(
      `    checks: structural=${result.checks.structural.valid} computation=${result.checks.computation.valid} reverification=${result.checks.reverification.valid} duplicateRisk=${result.checks.duplicateRisk.valid} judge=${result.checks.judge.valid}`
    );
    console.log(`    status=${result.status}`);
    if (result.rejectionReasons.length > 0) {
      console.log(`    rejectionReasons: ${JSON.stringify(result.rejectionReasons)}`);
    }

    if (result.status === "published") publishedCount += 1;
    else if (result.status === "validated") validatedCount += 1;
    else if (result.status === "review_required") reviewRequiredCount += 1;
    else if (result.status === "rejected") rejectedCount += 1;

    const validationState: ValidationState = result.status === "validated" ? "ai_validated" : "draft";
    generatedRefs.push({
      patternFamilyName: fixture.candidate.questionDna.patternFamilyName,
      combination: fixture.candidate.questionDna.combinesWithConcepts,
      testingMode: fixture.candidate.questionDna.testingModes[0] ?? null,
      trapErrorTaxonomyCode: fixture.candidate.questionDna.trapErrorTaxonomyCode,
      difficultyTier: fixture.candidate.questionDna.difficultyTier,
      validationState
    });
  }

  console.log("\n--- DUPLICATE-RISK DEMONSTRATION (excluded from coverage counts above) ---");
  const duplicateResult = await runFixture(duplicateRiskDemoFixture, existingQuestionStems);
  console.log(`  ${duplicateRiskDemoFixture.label}`);
  console.log(`    duplicateRisk.valid=${duplicateResult.checks.duplicateRisk.valid} status=${duplicateResult.status}`);
  console.log(`    rejectionReasons: ${JSON.stringify(duplicateResult.rejectionReasons)}`);

  printMatrix("AFTER", generatedRefs);

  console.log("\n--- SUMMARY ---");
  console.log(`  candidates created: ${coverageExpansionFixtures.length} (+1 duplicate-risk demonstration, excluded from coverage)`);
  console.log(`  published: ${publishedCount}`);
  console.log(`  validated (advanced/standard tier, all checks passed): ${validatedCount}`);
  console.log(`  review_required (hard/extreme tier, all checks passed, human review pending): ${reviewRequiredCount}`);
  console.log(`  rejected: ${rejectedCount}`);
  console.log(`  duplicate-risk demonstration rejected as expected: ${!duplicateResult.checks.duplicateRisk.valid && duplicateResult.status === "rejected"}`);
  console.log("=".repeat(78));
}

main();
