# 40 — Concept Universe (`@ipmat/concept-graph`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/QUESTION_ENGINE.md` §1/§1a, `docs/DECISIONS.md` D-013 (read in full).

## What it is

A directed graph. `Concept` nodes belong to a `Chapter`; `ConceptRelation` edges are typed and carry rich metadata, never just a strength score.

## The 8 relationship types (D-013) — deliberately never flattened to "related"

| Type | Meaning | Directional? |
|---|---|---|
| `prerequisite` | Target cannot be correctly understood without the source — a strict skill gate | Yes |
| `foundational` | Source is a broad numeracy/skill base the target sits on | Yes |
| `directly_related` | The two share core reasoning mechanics; neither requires the other | Symmetric |
| `commonly_combined` | Frequently tested together within one question | Symmetric |
| `application` | Source's techniques apply within the target's domain without new theory | Yes |
| `dependent` | Advanced forms of the target depend on the source; the basic form doesn't | Yes |
| `advanced_extension` | Target generalizes/extends the source with additional machinery | Yes |
| `related_but_distinct` | Surface similarity invites confusion; underlying rules genuinely differ — for teaching, never combining | Symmetric |

Every edge also carries `rationale` (never a bare label), `sharedKnowledge`, `usefulForQuestionGeneration` (combinable, or purely a confusion-risk flag — `related_but_distinct` is typically `false` here), `requirementLevel` (`required`/`optional`/`contextual`), and `certainty` (`confirmed`/`probable`/`speculative` — a claim not yet backed by real error data is marked `probable`, never asserted as fact).

## How the Percentages neighborhood was built

Human-curated (a small, correct graph is worth more than a large, noisy one at bootstrap): 12 concepts across 8 chapters — Percentages, Ratio, Averages, Profit and Loss, Discount, Simple and Compound Interest, Mixtures and Alligations, Population Growth and Decline, Data Interpretation, Algebra, Probability, and Number Systems — connected by 16 edges using all 8 types. Every edge has a specific, checkable reason. `related_but_distinct → Probability` is marked `certainty: probable`, not `confirmed` — a plausible confusion pattern not yet validated against real student error data.

## Why a graph, not a tag list

Examiner Lens combination derivation and future mastery/repair gating are both real graph queries (`getCombinationCandidates`, `getPrerequisites`), never string matches.

## Concept Depth (`ConceptDepth`)

Structured, per-concept pedagogical content — definition, intuition, formulas, methods, alternative methods, shortcuts, common misconceptions, common traps, application areas, difficulty progression — as typed substructures, not one text blob. Full for Percentages, light for Ratio (to prove the shape generalizes). The other ten concepts in the neighborhood graph have no `ConceptDepth` row — real future curriculum-authoring work, not a structural gap. `commonMisconceptions`/`commonTraps` reference `ErrorTaxonomy.code` by plain string, connecting concept-level teaching content to the same error vocabulary Examiner Lens and Autopsy use.

## Concept normalization (D-030)

`normalizeConceptNameKey()` (trim, collapse whitespace, lowercase) is used wherever an AI-proposed concept name must be matched against the graph — exact match after normalization only, **never** fuzzy or typo correction. "Ratio" and "ratio" match; "Percentage" and "Percentages" do not.

## What the graph does NOT prove

An edge existing is not the same claim as "valid to combine on" — this exact conflation was a real bug (D-023) that the Lens comparison report's four-category split (see [41_EXAMINER_LENS.md](41_EXAMINER_LENS.md)) exists specifically to prevent. `certainty: probable`/`speculative` edges are real, storable facts about *uncertainty itself*, never silently promoted to `confirmed`.
