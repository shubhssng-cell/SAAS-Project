import { getCombinationCandidates, type ConceptGraph } from "@ipmat/concept-graph";
import type { CombinationCandidate } from "./types.js";

/**
 * The Examiner Lens's "what can it be combined with" answer is DERIVED
 * from the concept graph, never independently authored (docs/QUESTION_
 * ENGINE.md §2) — this is the only function that should populate
 * ExaminerLensAnalysisData.combinations, so a Lens analysis can never say
 * something the graph doesn't actually support.
 */
export function deriveCombinations(graph: ConceptGraph, conceptName: string): CombinationCandidate[] {
  return getCombinationCandidates(graph, conceptName).map((relation) => ({
    concept: relation.from === conceptName ? relation.to : relation.from,
    relation
  }));
}
