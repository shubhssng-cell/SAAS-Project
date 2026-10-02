import type { RelationType } from "@ipmat/concept-graph";

/**
 * What each of the eight relationship types means STRUCTURALLY
 * (docs/DECISIONS.md D-013 for meaning, D-082 for the structural rules).
 *
 * - symmetric: direction carries no meaning, so A->B and B->A are one claim.
 * - ordering:  the edge says the source comes before the target in a
 *              learning/knowledge order, so a cycle in these edges is
 *              self-contradictory ("A needs B needs A") and is rejected.
 *
 * Cycles are checked PER ordering type, never across all types: the same
 * pair is legitimately connected in opposite directions by different types
 * (e.g. Ratio is a prerequisite of Percentages while Percentages is a
 * dependent of Ratio). `application` and `dependent` are directional but
 * not ordering - mutual application between two concepts is a real,
 * non-contradictory situation - so they are allowed to be cyclic.
 */
export interface RelationTypeSemantics {
  symmetric: boolean;
  ordering: boolean;
}

export const RELATION_TYPE_SEMANTICS: Readonly<Record<RelationType, RelationTypeSemantics>> = {
  prerequisite: { symmetric: false, ordering: true },
  foundational: { symmetric: false, ordering: true },
  advanced_extension: { symmetric: false, ordering: true },
  application: { symmetric: false, ordering: false },
  dependent: { symmetric: false, ordering: false },
  directly_related: { symmetric: true, ordering: false },
  commonly_combined: { symmetric: true, ordering: false },
  related_but_distinct: { symmetric: true, ordering: false }
};

export const ALL_RELATION_TYPES = Object.keys(RELATION_TYPE_SEMANTICS) as RelationType[];
export const ORDERING_RELATION_TYPES = ALL_RELATION_TYPES.filter((t) => RELATION_TYPE_SEMANTICS[t].ordering);

/** Strict gate only. "Ancestors"/"unlocks" default to this; callers opt into broader types explicitly. */
export const DEFAULT_ANCESTRY_TYPES: readonly RelationType[] = ["prerequisite"];

const PACK_KEY_PATTERN = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/;

export function isValidPackKey(key: string): boolean {
  return PACK_KEY_PATTERN.test(key);
}

/** Deterministic key from a display name: lowercase, runs of non-alphanumerics become "-". */
export function slugKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
