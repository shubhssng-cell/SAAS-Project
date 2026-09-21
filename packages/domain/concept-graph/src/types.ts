export type RelationType = "prerequisite_of" | "related_to" | "combines_with";
export type RelationStrength = "weak" | "moderate" | "strong";
export type RelationSource = "human" | "ai_suggested";
export type ConceptStatus = "draft" | "curated" | "ai_assisted" | "published";

/**
 * A concept graph is identified by human-readable names, not database ids —
 * this package must not depend on Prisma or any concrete id scheme (see
 * ARCHITECTURE.md §6). The db package's seed script maps these names to real
 * rows when it loads a fixture.
 */
export interface ConceptNode {
  name: string;
  description: string;
  status: ConceptStatus;
}

export interface ConceptRelationEdge {
  from: string;
  to: string;
  type: RelationType;
  strength: RelationStrength;
  source: RelationSource;
}

export interface ConceptGraph {
  chapterName: string;
  concepts: ConceptNode[];
  relations: ConceptRelationEdge[];
}
