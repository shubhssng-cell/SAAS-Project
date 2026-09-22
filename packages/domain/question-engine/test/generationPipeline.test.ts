import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { FixtureProvider } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import { runGenerationPipeline } from "../src/generationPipeline.js";
import {
  demoBlueprint,
  disagreeingReverification,
  existingQuestionStems,
  passingJudge,
  validGeneratedCandidate,
  validReverification,
  wrongAnswerGeneratedCandidate
} from "../fixtures/pipelineFixtures.js";

describe("runGenerationPipeline — INPUT (blueprint) -> AI generation -> independent verification -> quality validation -> candidate", () => {
  it("produces a 'validated' (or better) result when every check passes", async () => {
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

    expect(result.candidate).not.toBeNull();
    expect(result.checks.structural.valid).toBe(true);
    expect(result.checks.computation.valid).toBe(true);
    expect(result.checks.reverification.valid).toBe(true);
    expect(result.checks.duplicateRisk.valid).toBe(true);
    expect(result.checks.judge.valid).toBe(true);
    expect(result.status).toBe("validated"); // advanced tier -> no human review needed
    expect(result.rejectionReasons).toEqual([]);
    expect(result.metadata.generation?.success).toBe(true);
  });

  it("rejects when the stated answer disagrees with independent recomputation AND independent re-derivation, even though the judge sees nothing wrong", async () => {
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

    expect(result.status).toBe("rejected");
    expect(result.checks.computation.valid).toBe(false);
    expect(result.checks.reverification.valid).toBe(false);
    expect(result.checks.judge.valid).toBe(true); // the judge alone would have let this through
    expect(result.rejectionReasons.some((issue) => issue.code === "answer_mismatch")).toBe(true);
  });

  it("terminates safely (no throw) when the generation call itself fails after retries", async () => {
    const provider = new FixtureProvider(["not json", "still not json", "still not json"]);
    const result = await runGenerationPipeline({
      blueprint: demoBlueprint,
      aiProvider: provider,
      graph: percentagesConceptGraph,
      existingQuestionStems,
      provenanceSourceType: "original"
    });
    expect(result.status).toBe("rejected");
    expect(result.candidate).toBeNull();
  });

  it("a Hard/Extreme/Novel candidate that passes everything still lands in review_required, never auto-published", async () => {
    const hardCandidate = {
      ...validGeneratedCandidate,
      questionDna: { ...validGeneratedCandidate.questionDna, difficultyTier: "hard" as const }
    };
    const provider = new FixtureProvider([
      JSON.stringify(hardCandidate),
      JSON.stringify(validReverification),
      JSON.stringify(passingJudge)
    ]);
    const result = await runGenerationPipeline({
      blueprint: { ...demoBlueprint, difficultyTier: "hard" },
      aiProvider: provider,
      graph: percentagesConceptGraph,
      existingQuestionStems,
      provenanceSourceType: "original"
    });
    expect(result.status).toBe("review_required");
  });
});
