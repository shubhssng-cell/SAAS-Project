import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { percentagesLens } from "@ipmat/examiner-lens";
import { buildLensComparisonReport } from "../src/comparisonReport.js";
import { aiLensRegenerationOutput } from "../fixtures/aiLensOutputs.js";

/**
 * Phase 3 §9/§13 demonstration: human-authored Examiner Lens (the
 * evaluation baseline, unmodified) vs. an AI regeneration. No API key is
 * configured in this environment, so the "AI output" here is a
 * deterministic fixture standing in for what a live call would return —
 * see docs/AI_ARCHITECTURE.md and the Phase 3 report for how this wires
 * up to a real provider. The comparison logic itself is real and runs
 * against whatever AI output it's given.
 */
const report = buildLensComparisonReport(percentagesLens, aiLensRegenerationOutput, percentagesConceptGraph);

console.log("=".repeat(70));
console.log("HUMAN BASELINE vs AI EXAMINER LENS — Percentages");
console.log("(the human-authored Lens is never overwritten; this is a read-only comparison)");
console.log("=".repeat(70));

console.log("\n1. Skill focus");
console.log(`   Human: ${report.skillFocus.human}`);
console.log(`   AI:    ${report.skillFocus.ai}`);
console.log(`   Agree: ${report.skillFocus.agree}`);

console.log("\n2. Prerequisite");
console.log(`   Human: ${report.prerequisite.human}  |  AI: ${report.prerequisite.ai}  |  Agree: ${report.prerequisite.agree}`);

console.log("\n3. Testing modes");
console.log(`   Agreed on:  ${report.testingModes.agreedOn.join(", ") || "(none)"}`);
console.log(`   Human only (AI under-discovered): ${report.testingModes.humanOnly.join(", ") || "(none)"}`);
console.log(`   AI only (AI over-discovered):      ${report.testingModes.aiOnly.join(", ") || "(none)"}`);

console.log("\n4. Difficulty dimensions (human vs AI, |delta|)");
for (const [dimension, delta] of Object.entries(report.difficultyDimensions.deltas)) {
  console.log(
    `   ${dimension}: human=${report.difficultyDimensions.human[dimension as keyof typeof report.difficultyDimensions.human]} ai=${report.difficultyDimensions.ai[dimension as keyof typeof report.difficultyDimensions.ai]} delta=${delta.toFixed(2)}`
  );
}

console.log("\n5. Error/trap categories");
console.log(`   Agreed on: ${report.errorCategories.agreedOn.join(", ") || "(none)"}`);
console.log(`   Human only: ${report.errorCategories.humanOnly.join(", ") || "(none)"}`);
console.log(`   AI only: ${report.errorCategories.aiOnly.join(", ") || "(none)"}`);

console.log("\n6. Combinations — four categories, not two (Phase 3.1 §2 fix)");
console.log(`   AI suggested: ${report.combinations.aiSuggested.join(", ")}`);
console.log(`   [1] VALID generation combination (real, useful-for-generation edge): ${report.combinations.validGenerationCombination.join(", ") || "(none)"}`);
console.log(`   [2] Related but NON-combinable (a real edge exists, e.g. related_but_distinct — do NOT combine): ${report.combinations.relatedButNonCombinable.join(", ") || "(none)"}`);
console.log(`   [3] UNSUPPORTED / invented (no edge exists at all): ${report.combinations.unsupportedByGraph.join(", ") || "(none)"}`);

console.log("\n7. DOES AI MISS IMPORTANT PATTERNS?");
console.log(`   [4] Real, useful combinations the AI did NOT mention: ${report.combinations.missedByAi.join(", ") || "(none)"}`);

console.log("\n8. DOES AI MAKE UNSUPPORTED COMPLETENESS CLAIMS?");
console.log(`   Completeness claims found: ${report.completenessClaims.found.join("; ") || "(none)"}`);
console.log(`   hasUnsupportedClaim: ${report.completenessClaims.hasUnsupportedClaim}`);

console.log("\nCONCLUSION: do not assume AI is correct.");
console.log(
  `AI invented ${report.combinations.unsupportedByGraph.length} unsupported relationship(s), proposed ${report.combinations.relatedButNonCombinable.length} that are related but NOT combinable, and missed ${report.combinations.missedByAi.length} real one(s). Neither the human baseline nor the graph was modified by this comparison.`
);
console.log("=".repeat(70));
