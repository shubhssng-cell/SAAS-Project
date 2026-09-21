/**
 * Eight distinct relationship types — deliberately not flattened into a
 * single "related" bucket (see docs/QUESTION_ENGINE.md §1 and
 * docs/DECISIONS.md D-013). Each has a specific, non-overlapping meaning:
 *
 * - prerequisite:        target cannot be correctly understood without the
 *                        source; a strict, directional skill gate.
 * - foundational:        source is a broad numeracy/skill base that
 *                        underlies the target (and usually many other
 *                        concepts too) — broader and less specific than a
 *                        single prerequisite.
 * - directly_related:    the two share core reasoning mechanics; neither
 *                        strictly requires the other.
 * - commonly_combined:   the two are frequently tested together within a
 *                        single question, as a combination of steps.
 * - application:         the source's techniques are applied within the
 *                        target's domain, without the target introducing
 *                        fundamentally new theory of its own.
 * - dependent:           certain (often advanced) forms of the target
 *                        depend on the source, though the target's basic
 *                        form does not require it.
 * - advanced_extension:  the target generalizes or extends the source with
 *                        additional machinery beyond it.
 * - related_but_distinct: surface-level similarity invites confusion, but
 *                        the underlying rules are genuinely different —
 *                        useful for teaching, not for combining questions.
 */
export type RelationType =
  | "prerequisite"
  | "foundational"
  | "directly_related"
  | "commonly_combined"
  | "application"
  | "dependent"
  | "advanced_extension"
  | "related_but_distinct";

/** Is the relationship a hard gate, a nice-to-have, or only relevant in some contexts? */
export type RequirementLevel = "required" | "optional" | "contextual";

/** How sure we are this relationship is real and correctly characterized — never pretend certainty we don't have. */
export type Certainty = "confirmed" | "probable" | "speculative";

export type RelationSource = "human" | "ai_suggested";
export type ConceptStatus = "draft" | "curated" | "ai_assisted" | "published";

export interface ConceptNode {
  name: string;
  /** The chapter this concept formally belongs to — concepts in one chapter's
   *  neighborhood graph routinely reference concepts that live in other
   *  chapters (e.g. Percentages relates to Data Interpretation). */
  chapterName: string;
  description: string;
  status: ConceptStatus;
}

export interface ConceptRelationEdge {
  from: string;
  to: string;
  type: RelationType;
  /** WHY this relationship exists — never a bare label. */
  rationale: string;
  /** WHAT knowledge or mechanic is actually shared between the two concepts. */
  sharedKnowledge: string;
  /** Whether this edge is useful input for question generation/combination,
   *  as opposed to existing purely to guide teaching order or flag confusion risk. */
  usefulForQuestionGeneration: boolean;
  requirementLevel: RequirementLevel;
  certainty: Certainty;
  source: RelationSource;
}

export interface ConceptGraph {
  concepts: ConceptNode[];
  relations: ConceptRelationEdge[];
}
