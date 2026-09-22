import { FixtureProvider } from "@ipmat/ai";
import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { describe, expect, it } from "vitest";
import { computeTaxonomyCellCoverage } from "../src/coverage.js";
import { runGenerationPipeline } from "../src/generationPipeline.js";
import { percentagesTaxonomyCells } from "../fixtures/percentagesTaxonomyCells.js";
import { percentagesReversePercentageExample } from "../fixtures/percentagesQuestionDnaExample.js";
import {
  coverageExpansionFixtures,
  duplicateRiskDemoFixture,
  type CoverageExpansionFixture
} from "../fixtures/percentagesCoverageExpansion.js";
import type { QuestionRefForCellCoverage } from "../src/types.js";

/**
 * Phase 3.5: runs the REAL `runGenerationPipeline()` — the same blueprint
 * -> AI abstraction -> deterministic validation -> lifecycle code path a
 * live model call would go through — for every Phase 3.5 coverage-
 * expansion fixture, via `FixtureProvider` (no live `ANTHROPIC_API_KEY`
 * available or used, per docs/MASTER_PLAN.md). Proves: every cell reaches
 * the CORRECT lifecycle status for its own difficulty tier (never
 * "published" — nothing in this codebase performs that transition
 * automatically, so publication stays strict, Phase 3.5 §7), and the
 * duplicate-risk demonstration is rejected specifically for redundancy.
 */

async function runFixture(fixture: CoverageExpansionFixture, existingQuestionStems: string[]) {
  const provider = new FixtureProvider([
    JSON.stringify(fixture.candidate),
    JSON.stringify(fixture.reverification),
    JSON.stringify(fixture.judge)
  ]);
  return runGenerationPipeline({
    blueprint: fixture.blueprint,
    aiProvider: provider,
    graph: percentagesConceptGraph,
    existingQuestionStems,
    provenanceSourceType: "original"
  });
}

describe("Phase 3.5 coverage expansion — real generation pipeline, FixtureProvider, no live AI call", () => {
  it("every uncovered-cell fixture passes structural/computation/reverification/duplicate/judge checks and lands in the correct lifecycle status for its tier", async () => {
    const existingQuestionStems: string[] = [percentagesReversePercentageExample.content.body];
    const results: Array<{ fixture: CoverageExpansionFixture; result: Awaited<ReturnType<typeof runFixture>> }> = [];

    for (const fixture of coverageExpansionFixtures) {
      const result = await runFixture(fixture, existingQuestionStems);
      results.push({ fixture, result });
      // Each new stem joins the pool BEFORE the next fixture runs, so later
      // duplicate-risk checks are against a genuinely accumulating universe,
      // not a static list.
      existingQuestionStems.push(fixture.candidate.stem);
    }

    for (const { fixture, result } of results) {
      expect(result.checks.structural.valid, `${fixture.label}: structural`).toBe(true);
      expect(result.checks.computation.valid, `${fixture.label}: computation`).toBe(true);
      expect(result.checks.reverification.valid, `${fixture.label}: reverification`).toBe(true);
      expect(result.checks.duplicateRisk.valid, `${fixture.label}: duplicateRisk`).toBe(true);
      expect(result.checks.judge.valid, `${fixture.label}: judge`).toBe(true);

      const tier = fixture.candidate.questionDna.difficultyTier;
      if (tier === "hard" || tier === "extreme" || tier === "novel") {
        expect(result.status, `${fixture.label}: status`).toBe("review_required");
      } else {
        expect(result.status, `${fixture.label}: status`).toBe("validated");
      }
      // Nothing in this pipeline ever produces "published" directly (Phase 3.5 §7 — publication stays strict).
      expect(result.status).not.toBe("published");
    }

    // 2 of 7 (advanced/standard tiers) reach "validated"; the remaining 5 (hard/extreme) require review.
    const validatedCount = results.filter((r) => r.result.status === "validated").length;
    const reviewRequiredCount = results.filter((r) => r.result.status === "review_required").length;
    expect(validatedCount).toBe(2);
    expect(reviewRequiredCount).toBe(5);
    expect(results.every((r) => r.result.status !== "rejected")).toBe(true);
  });

  it("the duplicate-risk demonstration is rejected specifically for redundancy against an already-added near-twin stem, isolated from every other check", async () => {
    const existingQuestionStems = [percentagesReversePercentageExample.content.body];
    // The standalone percentage-point fixture must already be in the pool for the near-twin to collide with.
    const standalone = coverageExpansionFixtures.find((f) => f.label.includes("standalone"))!;
    existingQuestionStems.push(standalone.candidate.stem);

    const result = await runFixture(duplicateRiskDemoFixture, existingQuestionStems);

    expect(result.checks.structural.valid).toBe(true);
    expect(result.checks.computation.valid).toBe(true);
    expect(result.checks.reverification.valid).toBe(true);
    expect(result.checks.judge.valid).toBe(true);
    expect(result.checks.duplicateRisk.valid).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.rejectionReasons.some((issue) => issue.code === "duplicate_risk")).toBe(true);
  });

  it("before/after per-cell coverage: all 7 previously-uncovered cells move from uncovered to underrepresented (never falsely 'covered' without a published question)", async () => {
    const before = computeTaxonomyCellCoverage(percentagesTaxonomyCells, [
      {
        patternFamilyName: percentagesReversePercentageExample.dna.patternFamilyName,
        combination: percentagesReversePercentageExample.dna.combinesWithConcepts,
        testingMode: "reverse",
        trapErrorTaxonomyCode: percentagesReversePercentageExample.dna.trapErrorTaxonomyCode,
        difficultyTier: percentagesReversePercentageExample.dna.difficultyTier,
        validationState: percentagesReversePercentageExample.dna.validationState
      }
    ]);
    const beforeUncoveredCount = before.filter((c) => c.status === "uncovered").length;
    expect(beforeUncoveredCount).toBe(7);

    const existingQuestionStems: string[] = [percentagesReversePercentageExample.content.body];
    const generatedRefs: QuestionRefForCellCoverage[] = [
      {
        patternFamilyName: percentagesReversePercentageExample.dna.patternFamilyName,
        combination: percentagesReversePercentageExample.dna.combinesWithConcepts,
        testingMode: "reverse",
        trapErrorTaxonomyCode: percentagesReversePercentageExample.dna.trapErrorTaxonomyCode,
        difficultyTier: percentagesReversePercentageExample.dna.difficultyTier,
        validationState: percentagesReversePercentageExample.dna.validationState
      }
    ];

    for (const fixture of coverageExpansionFixtures) {
      const result = await runFixture(fixture, existingQuestionStems);
      existingQuestionStems.push(fixture.candidate.stem);
      expect(result.status).not.toBe("rejected");
      generatedRefs.push({
        patternFamilyName: fixture.candidate.questionDna.patternFamilyName,
        combination: fixture.candidate.questionDna.combinesWithConcepts,
        testingMode: fixture.candidate.questionDna.testingModes[0] ?? null,
        trapErrorTaxonomyCode: fixture.candidate.questionDna.trapErrorTaxonomyCode,
        difficultyTier: fixture.candidate.questionDna.difficultyTier,
        // Maps QuestionLifecycleStatus (this pipeline's richer, in-memory vocabulary) down onto the
        // persisted 5-value ValidationState the DB/coverage layer actually uses — "validated" here maps
        // to "ai_validated" (matching computePatternFamilyReadiness()'s own treatment of that value as
        // real validated content); "review_required" has no DB-level equivalent yet, so it stays "draft"
        // rather than being inflated to a state it hasn't actually reached. Never "published" — status is
        // never inflated (Phase 3.5 §7).
        validationState: result.status === "validated" ? "ai_validated" : "draft"
      });
    }

    const after = computeTaxonomyCellCoverage(percentagesTaxonomyCells, generatedRefs);
    const afterUncoveredCount = after.filter((c) => c.status === "uncovered").length;
    const afterUnderrepresentedCount = after.filter((c) => c.status === "underrepresented").length;
    const afterCoveredCount = after.filter((c) => c.status === "covered").length;

    expect(afterUncoveredCount).toBe(0);
    // The 5 review_required (hard/extreme) cells landed as "draft" refs above (never validated/published);
    // the 2 validated (advanced/standard) cells are real "validated" refs — both statuses count as
    // "has a question" (underrepresented), never "covered", since nothing here was published.
    expect(afterUnderrepresentedCount).toBe(7);
    expect(afterCoveredCount).toBe(1); // only the original Phase 2 demonstration question
  });
});
