import type { ConceptGraph, ConceptRelationEdge, RelationType } from "./types.js";

export function findRelation(
  graph: ConceptGraph,
  from: string,
  to: string,
  type: RelationType
): ConceptRelationEdge | undefined {
  return graph.relations.find(
    (edge) => edge.from === from && edge.to === to && edge.type === type
  );
}

export function findRelationsBetween(
  graph: ConceptGraph,
  a: string,
  b: string
): ConceptRelationEdge[] {
  return graph.relations.filter(
    (edge) => (edge.from === a && edge.to === b) || (edge.from === b && edge.to === a)
  );
}

/** Concepts that must be understood before this one — a strict, directional gate. */
export function getPrerequisites(graph: ConceptGraph, conceptName: string): string[] {
  return graph.relations
    .filter((edge) => edge.to === conceptName && edge.type === "prerequisite")
    .map((edge) => edge.from);
}

/** Broad numeracy/skill bases this concept sits on top of. */
export function getFoundations(graph: ConceptGraph, conceptName: string): string[] {
  return graph.relations
    .filter((edge) => edge.to === conceptName && edge.type === "foundational")
    .map((edge) => edge.from);
}

/**
 * Concepts worth considering as combination partners when generating
 * questions — deliberately excludes `related_but_distinct` (those exist to
 * flag confusion risk, not to suggest combining) and pulls only from the
 * types that actually describe combinable, testable overlap.
 */
export function getCombinationCandidates(
  graph: ConceptGraph,
  conceptName: string
): ConceptRelationEdge[] {
  const combinableTypes: RelationType[] = ["commonly_combined", "application", "dependent"];
  return graph.relations.filter(
    (edge) =>
      combinableTypes.includes(edge.type) &&
      edge.usefulForQuestionGeneration &&
      (edge.from === conceptName || edge.to === conceptName)
  );
}

/** Concepts that look similar but are genuinely distinct — useful for teaching, not combining. */
export function getDistinctButRelated(graph: ConceptGraph, conceptName: string): ConceptRelationEdge[] {
  return graph.relations.filter(
    (edge) =>
      edge.type === "related_but_distinct" && (edge.from === conceptName || edge.to === conceptName)
  );
}

export function getAllRelationsFor(graph: ConceptGraph, conceptName: string): ConceptRelationEdge[] {
  return graph.relations.filter((edge) => edge.from === conceptName || edge.to === conceptName);
}

export function hasConcept(graph: ConceptGraph, conceptName: string): boolean {
  return graph.concepts.some((concept) => concept.name === conceptName);
}

/**
 * Canonical comparison key for a concept name (Phase 3.1.1 §4 /
 * docs/DECISIONS.md D-030): trims, collapses internal whitespace runs to a
 * single space, and lowercases. This exists so "Percentages", "percentages",
 * "Percentages " (trailing space), and "PERCENTAGES" compare as the same
 * concept — harmless authoring/formatting variance, not a different claim.
 *
 * Deliberately narrow: this does NOT stem, pluralize-fold, fuzzy-match, or
 * correct typos. "Percentages" and "Percentage" normalize to two DIFFERENT
 * keys ("percentages" vs "percentage") and are never silently treated as
 * the same concept — conflating genuinely different names is a worse bug
 * than failing to normalize a real formatting variant. Only exact match on
 * this normalized key is ever used for comparison; nothing maps an
 * ambiguous name to an arbitrarily "closest" concept.
 */
export function normalizeConceptNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getConcept(graph: ConceptGraph, conceptName: string) {
  return graph.concepts.find((concept) => concept.name === conceptName);
}
