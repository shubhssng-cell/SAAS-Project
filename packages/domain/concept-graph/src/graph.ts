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

export function getPrerequisites(graph: ConceptGraph, conceptName: string): string[] {
  return graph.relations
    .filter((edge) => edge.to === conceptName && edge.type === "prerequisite_of")
    .map((edge) => edge.from);
}

export function getCombinableConcepts(graph: ConceptGraph, conceptName: string): string[] {
  return graph.relations
    .filter(
      (edge) =>
        edge.type === "combines_with" &&
        (edge.from === conceptName || edge.to === conceptName)
    )
    .map((edge) => (edge.from === conceptName ? edge.to : edge.from));
}

export function hasConcept(graph: ConceptGraph, conceptName: string): boolean {
  return graph.concepts.some((concept) => concept.name === conceptName);
}
