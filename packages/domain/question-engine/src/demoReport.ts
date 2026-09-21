import {
  getAllRelationsFor,
  getConcept,
  getFoundations,
  getPrerequisites,
  percentagesConceptGraph
} from "@ipmat/concept-graph";
import { percentagesLens, type DifficultyDimensions } from "@ipmat/examiner-lens";
import { buildQuestionUniverseSnapshot } from "./coverage.js";
import { percentagesPatternFamilies } from "../fixtures/percentagesPatternFamilies.js";
import { percentagesTaxonomyCells } from "../fixtures/percentagesTaxonomyCells.js";
import { percentagesReversePercentageExample } from "../fixtures/percentagesQuestionDnaExample.js";
import type { QuestionDnaData, QuestionUniverseSnapshot } from "./types.js";

/**
 * The Phase 2 deterministic demonstration (docs/MASTER_PLAN.md Phase 2,
 * section 12): proves "Percentages" is a node in a larger exam knowledge
 * and question network, not an isolated chapter. Every value here comes
 * from the actual concept graph / Lens / pattern family / taxonomy cell
 * data — nothing is hand-summarized separately, so the demo can never
 * drift from the real structure it's reporting on.
 */
export interface PercentagesDemoReport {
  concept: { name: string; chapter: string; description: string };
  prerequisites: Array<{ concept: string; rationale: string; requirementLevel: string; certainty: string }>;
  connectedConcepts: Array<{
    concept: string;
    type: string;
    direction: "from_percentages" | "to_percentages";
    rationale: string;
    usefulForQuestionGeneration: boolean;
    certainty: string;
  }>;
  patternFamilies: Array<{
    name: string;
    skill: string;
    expectedDifficultyTier: string;
    potentialCombinations: string[];
    potentialTraps: string[];
    potentialTestingModes: string[];
  }>;
  transformationsInUse: string[];
  trapsInUse: string[];
  difficultyDimensionsBaseline: DifficultyDimensions;
  questionUniverseSummary: QuestionUniverseSnapshot["summary"];
  questionDnaExample: QuestionDnaData;
}

export function buildPercentagesDemoReport(): PercentagesDemoReport {
  const conceptName = "Percentages";
  const concept = getConcept(percentagesConceptGraph, conceptName);
  if (!concept) {
    throw new Error("Percentages concept missing from the seeded graph — this should be impossible");
  }

  const prerequisiteNames = getPrerequisites(percentagesConceptGraph, conceptName);
  const foundationNames = getFoundations(percentagesConceptGraph, conceptName);
  const prerequisites = [...prerequisiteNames, ...foundationNames].map((name) => {
    const edge = percentagesConceptGraph.relations.find(
      (relation) => relation.from === name && relation.to === conceptName
    );
    return {
      concept: name,
      rationale: edge?.rationale ?? "",
      requirementLevel: edge?.requirementLevel ?? "unknown",
      certainty: edge?.certainty ?? "unknown"
    };
  });

  const connectedConcepts = getAllRelationsFor(percentagesConceptGraph, conceptName)
    .filter((edge) => edge.type !== "prerequisite" && edge.type !== "foundational")
    .map((edge) => ({
      concept: edge.from === conceptName ? edge.to : edge.from,
      type: edge.type,
      direction: (edge.from === conceptName ? "from_percentages" : "to_percentages") as
        | "from_percentages"
        | "to_percentages",
      rationale: edge.rationale,
      usefulForQuestionGeneration: edge.usefulForQuestionGeneration,
      certainty: edge.certainty
    }));

  const patternFamilies = percentagesPatternFamilies.map((family) => ({
    name: family.name,
    skill: family.skill,
    expectedDifficultyTier: family.expectedDifficultyTier,
    potentialCombinations: family.potentialCombinationConcepts,
    potentialTraps: family.potentialTrapErrorTaxonomyCodes,
    potentialTestingModes: family.potentialTestingModes
  }));

  const snapshot = buildQuestionUniverseSnapshot(
    conceptName,
    percentagesConceptGraph,
    percentagesPatternFamilies,
    percentagesTaxonomyCells,
    [{ patternFamilyName: "Reverse Percentage", validationState: "published" }]
  );

  return {
    concept: { name: concept.name, chapter: concept.chapterName, description: concept.description },
    prerequisites,
    connectedConcepts,
    patternFamilies,
    transformationsInUse: snapshot.transformationsInUse,
    trapsInUse: snapshot.trapsInUse,
    difficultyDimensionsBaseline: percentagesLens.difficultyDimensions,
    questionUniverseSummary: snapshot.summary,
    questionDnaExample: percentagesReversePercentageExample.dna
  };
}
