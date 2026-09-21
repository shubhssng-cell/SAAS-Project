import { buildPercentagesDemoReport } from "../src/demoReport.js";

/**
 * Runnable demonstration for docs/MASTER_PLAN.md Phase 2, section 12.
 * Run with: npm run demo:percentages --workspace @ipmat/question-engine
 */
const report = buildPercentagesDemoReport();

console.log("=".repeat(70));
console.log(`PERCENTAGES — a node in the exam knowledge network, not an island`);
console.log("=".repeat(70));

console.log("\n1. CORE CONCEPT");
console.log(`   ${report.concept.name} (chapter: ${report.concept.chapter})`);
console.log(`   ${report.concept.description}`);

console.log("\n2. PREREQUISITES / FOUNDATIONS");
for (const p of report.prerequisites) {
  console.log(`   - ${p.concept}  [${p.requirementLevel}, ${p.certainty}]`);
  console.log(`       ${p.rationale}`);
}

console.log("\n3-4. CONNECTED CONCEPTS AND WHY");
for (const c of report.connectedConcepts) {
  const arrow = c.direction === "from_percentages" ? `Percentages -> ${c.concept}` : `${c.concept} -> Percentages`;
  console.log(`   - [${c.type}] ${arrow}  (useful for generation: ${c.usefulForQuestionGeneration}, certainty: ${c.certainty})`);
  console.log(`       ${c.rationale}`);
}

console.log("\n5. QUESTION PATTERN FAMILIES");
for (const f of report.patternFamilies) {
  console.log(`   - ${f.name}  [expected: ${f.expectedDifficultyTier}]`);
  console.log(`       skill: ${f.skill}`);
  console.log(`       potential combinations: ${f.potentialCombinations.join(", ") || "(none)"}`);
  console.log(`       potential traps: ${f.potentialTraps.join(", ") || "(none)"}`);
  console.log(`       potential testing modes: ${f.potentialTestingModes.join(", ")}`);
}

console.log("\n6-7. TRANSFORMATIONS / TESTING MODES IN USE ACROSS MAPPED FAMILIES");
console.log(`   ${report.transformationsInUse.join(", ")}`);

console.log("\n8. TRAPS IN USE ACROSS MAPPED FAMILIES");
console.log(`   ${report.trapsInUse.join(", ")}`);

console.log("\n9. DIFFICULTY DIMENSIONS (standard-tier baseline, each 0-1)");
for (const [dimension, value] of Object.entries(report.difficultyDimensionsBaseline)) {
  console.log(`   ${dimension}: ${value}`);
}

console.log("\n   QUESTION UNIVERSE COVERAGE (known/mapped/covered — never 'complete')");
console.log(`   mapped pattern families: ${report.questionUniverseSummary.mappedFamilyCount}`);
console.log(`   families with at least one question: ${report.questionUniverseSummary.withQuestionsCount}`);
console.log(`   families with validated questions: ${report.questionUniverseSummary.validatedCount}`);
console.log(`   families practice-ready: ${report.questionUniverseSummary.practiceReadyCount}`);

console.log("\n10. QUESTION DNA EXAMPLE");
console.log(JSON.stringify(report.questionDnaExample, null, 2));

console.log("\n" + "=".repeat(70));
