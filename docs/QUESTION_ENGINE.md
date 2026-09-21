# Question Intelligence Architecture

This document specifies the systems that turn "Percentages" into a servable, trustworthy question bank: Concept Universe, Concept Depth, Examiner Lens, Question Pattern Families, Question Universe (coverage), and Question DNA — plus the two systems that close the loop with the student: Validation and Question Autopsy.

Phase 2 (docs/MASTER_PLAN.md) built the first five of these as domain packages (`@ipmat/concept-graph`, `@ipmat/examiner-lens`, `@ipmat/question-engine`) with deterministic, hand-authored fixtures for Percentages — no AI generation yet, no student-facing UI beyond a runnable demonstration script (`npm run demo:percentages --workspace @ipmat/question-engine`).

## 1. Concept Universe

**What it is:** a directed graph. `Concept` nodes belong to a `Chapter`; `ConceptRelation` edges are typed and carry rich metadata, not just a strength score.

**The 8 relationship types** (docs/DECISIONS.md D-013) — deliberately not flattened into "related":

| Type | Meaning | Directional? |
|---|---|---|
| `prerequisite` | Target cannot be correctly understood without the source — a strict skill gate. | Yes |
| `foundational` | Source is a broad numeracy/skill base the target (and usually many other concepts) sits on. | Yes |
| `directly_related` | The two share core reasoning mechanics; neither requires the other. | Symmetric in practice |
| `commonly_combined` | Frequently tested together within a single question. | Symmetric in practice |
| `application` | Source's techniques are applied within the target's domain, without the target introducing new theory of its own. | Yes |
| `dependent` | Certain (often advanced) forms of the target depend on the source, though the target's basic form does not. | Yes |
| `advanced_extension` | Target generalizes/extends the source with additional machinery. | Yes |
| `related_but_distinct` | Surface-level similarity invites confusion, but the underlying rules genuinely differ — for teaching, not combining. | Symmetric in practice |

Every edge also carries: `rationale` (why it exists — never a bare label), `shared_knowledge` (what's actually shared), `useful_for_question_generation` (combinable, or purely a teaching/confusion-risk flag — `related_but_distinct` edges are typically `false` here), `requirement_level` (`required`/`optional`/`contextual`), and `certainty` (`confirmed`/`probable`/`speculative` — a claim we can't yet back with real error data is marked `probable`, not asserted as fact).

**How it's built for Percentages:** human-curated (a small, correct graph is worth more than a large, noisy one at bootstrap). The seeded neighborhood spans 12 concepts across 8 different chapters — Percentages, Ratio, Averages, Profit and Loss, Discount, Simple and Compound Interest, Mixtures and Alligations, Population Growth and Decline, Data Interpretation, Algebra, Probability, and Number Systems (the foundational base) — connected by 16 edges using all 8 relationship types. Every edge has a specific, checkable reason (`packages/domain/concept-graph/fixtures/percentages.ts`); nothing was added because it "sounds related." `related_but_distinct` → Probability is marked `certainty: probable` rather than `confirmed`, because it's a plausible confusion pattern that hasn't been validated against real student error data yet.

**Why a graph and not a tag list:** Examiner Lens combination derivation and future mastery/repair gating are both graph queries (`getCombinationCandidates`, `getPrerequisites`), not string matches.

## 1a. Concept Depth

**What it is:** structured, per-concept pedagogical content — definition, intuition, formulas, methods, alternative methods, shortcuts, common misconceptions, common traps, application areas, and a difficulty progression — kept as typed substructures (`Formula`, `Method`, `Shortcut`, `Misconception`, `TrapExample`, `ApplicationArea`, `DifficultyProgressionStep` in `packages/domain/concept-graph/src/depth.ts`), not one text blob.

**Scope this phase:** full depth for Percentages, a light entry for Ratio (to prove the shape generalizes to a neighbor without redesign). The other ten concepts in the neighborhood graph have no `ConceptDepth` row yet — that's real curriculum-authoring work for later, not a structural gap. `commonMisconceptions`/`commonTraps` reference `ErrorTaxonomy.code` values by plain string, connecting concept-level teaching content to the same error vocabulary Examiner Lens and Autopsy use.

## 2. Examiner Lens

**What it is:** a structured analysis, one per `(concept, version)`, answering four questions in normalized fields and controlled vocabularies — never free prose, never a single opaque JSON blob:

1. **What is being tested** — `concept`, `subconcept`, `skill`, and `prerequisite` (a real concept-graph reference, nullable) as four separate fields.
2. **How it can be tested** — a subset of the 10-value `TestingMode` vocabulary: `direct, reverse, transformed, combined, contextualized, represented_differently, constrained, time_pressured, multi_step, novel_representation`. Percentages' Lens analysis deliberately excludes `constrained` (answer-space constraints are more a Number Systems/Algebra-flavored mode) — the list is reasoned, not a default "select all."
3. **What it can be combined with** — computed live from the concept graph (`deriveCombinations()`), never independently authored. An `ExaminerLensAnalysis` row has no "combinations" column at all; storing one would let it drift from the graph it's supposed to reflect.
4. **What can go wrong** — a list of `{ category, errorTaxonomyCode, description }`, where `category` is one of the same 5 values `ErrorTaxonomy.category` uses (`misconception`, `trap`, `calculation_mistake`, `interpretation_mistake`, `method_selection_mistake`) — see docs/DECISIONS.md D-013 for why this is one shared vocabulary rather than two.

**Difficulty is dimensional, not a label:** `difficultyDimensions` is a fixed 6-field struct (`conceptualLoad`, `computationalLoad`, `trapDensity`, `representationNovelty`, `timePressure`, `multiStepDepth`, each 0-1), calibrated as a standard-tier baseline that harder tiers are characterized by pushing up specific dimensions of, not by a vaguer "harder" claim.

**Authorship is tracked honestly:** `authoredBy` (`human`/`ai`) is separate from `status` (the review workflow). Percentages' Lens analysis is `authoredBy: human` — Phase 2 explicitly does not do AI generation yet (docs/MASTER_PLAN.md), so `generatedByProvider`/`promptVersion` stay null until that changes.

**Structural validation without a live AI provider:** `validateExaminerLensAnalysis()` in `@ipmat/examiner-lens` checks the analysis references real concepts, uses only vocabulary-sanctioned testing modes, and — via `findCompletenessClaims()` — that no free-text field asserts literal completeness ("every possible question," "mathematically complete," etc.). This runs against deterministic fixtures in tests; no live AI call is needed to validate structure (docs/QUESTION_ENGINE.md §8 below).

**Versioning:** re-running the Lens on a concept produces a new version; old pattern families/questions keep their original `examiner_lens_analysis_id` reference so provenance never breaks.

## 3. Question Pattern Families and the Question Universe

**A pattern family describes the STRUCTURE of a question, not a numerical instance** — it has a `name` (e.g. "Reverse Percentage"), a `skill`, a `description`, an `expectedDifficultyTier`, and three "potential" fields (`potentialCombinationConcepts`, `potentialTrapErrorTaxonomyCodes`, `potentialTestingModes`) describing the legitimate space it can draw from. One family generates many valid questions.

Percentages has 4 seeded families (`packages/domain/question-engine/fixtures/percentagesPatternFamilies.ts`):

| Family | Skill | Expected tier | Potential combinations | Potential trap |
|---|---|---|---|---|
| Reverse Percentage | Recovering an original quantity from a stated change and its result | advanced | Ratio, Algebra | base_confusion |
| Successive Percentage Change | Compounding sequential changes multiplicatively, not additively | advanced | Profit and Loss, Simple/Compound Interest | successive_change_error |
| Percentage Point vs Percentage Change | Distinguishing an absolute point difference from a relative change | hard | Simple/Compound Interest | percentage_point_confusion |
| Percentage Share in Data Interpretation | Extracting percentage share/change from raw tabular data | hard | Data Interpretation, Averages | misread_question, base_confusion |

**A `PatternTaxonomyCell` is one concrete, narrow slice of a family's space** — a specific combination, testing mode, trap, and difficulty tier — and is the unit `coverage_status` is tracked against. Percentages has 8 seeded cells (2 per family); only one is `covered` (see §7 — this phase deliberately did not generate a question bank).

**The explicit non-claim:** the product does not claim mathematical completeness ("every possible percentage question"). It claims and displays **coverage of the pattern-family/taxonomy-cell tables**, using "known / mapped / covered / uncovered" language exclusively — the `QuestionUniverseSnapshot` type in `@ipmat/question-engine` structurally cannot express "complete" (there is no field for it), and `findCompletenessClaims()` guards the free-text fields around it. See docs/DECISIONS.md D-007.

**The Question Universe snapshot** (`buildQuestionUniverseSnapshot()`) assembles, for a concept: its mapped pattern families, its related concepts (from the graph), each family's potential combinations/traps/testing modes, the difficulty tiers in use, and a coverage-stage breakdown per family. This is what `npm run demo:percentages --workspace @ipmat/question-engine` renders end to end.

## 4. Pattern Coverage — the readiness ladder

Given a family's taxonomy cells and the questions referencing them, `computePatternFamilyReadiness()` (in `@ipmat/question-engine`) computes exactly one of:

**mapped** → **has_questions** → **validated** → **practice_ready**

— a family starts `mapped` the moment it's documented (this is the "27" in a future "student has mastered 18/27 mapped pattern families") and climbs only as real, validated, published content backs it. This is **computed on every read, never stored** — the same discipline as `MasteryState` — so it can never silently drift from what's actually in the database. The mastered-count numerator ("18") needs real student attempt data and isn't built yet (Phase 5); this phase only supplies the honest denominator.

## 5. Question DNA + Validation

**Question DNA** is the mandatory, normalized metadata set on every `Question` row (full field list in [DATABASE.md](DATABASE.md) §Question). Fields that get queried frequently are their own typed columns, not buried in JSON: `noveltyLevel` and `examRelevance` are normalized enums; `testingModes` is a real array column; `trapErrorTaxonomyId` is a foreign key into `ErrorTaxonomy`, not a free-form string (docs/DECISIONS.md D-012, extended in D-013 to Question as well as Autopsy). It is enforced structurally: `validation_state` cannot become `published` while any DNA field is null or `provenance_id` is unset.

`validateQuestionDna()` (in `@ipmat/question-engine`) checks a DNA object's `conceptName`, `subconcepts`, `prerequisites`, and `combinesWithConcepts` all reference real concepts in the supplied graph, and that `patternFamilyName` names a family that actually exists for that concept — this is what makes "Question DNA references valid concepts/patterns" a checkable fact, demonstrated end-to-end by the one worked example in `percentagesQuestionDnaExample.ts` (a Reverse-Percentage, Ratio-combined, `published` question with full provenance).

**Validation pipeline** (Phase 3, not built yet), in order, for every generated draft:
1. **Independent re-derivation** — the draft includes the generator's own `ground_truth_derivation`; the system recomputes it deterministically and rejects on mismatch.
2. **AI-judge pass** — a second, schema-validated call checks syllabus relevance, ambiguity, and whether the difficulty tier claim is honest.
3. **Duplicate/near-duplicate check** — embedding similarity against already-published questions in the same concept.
4. **Human review gate** — configurable per difficulty tier.

A question that fails step 1 or 2 is `rejected`, not silently discarded — a pattern of rejections at a given taxonomy cell is a signal the Examiner Lens analysis for that cell needs review, not just the generator prompt.

## 6. Question Autopsy → Targeted Repair

Covered in detail in [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §4. The repair step selects follow-up questions **from the Question Universe taxonomy**, filtered to the confirmed `error_taxonomy_id` (see [DATABASE.md](DATABASE.md) §Error Taxonomy) and `target_concept_id`. The evidence behind a confirmed error can be rich (`AttemptEvent` timing, `reasoning_text`), but repair *selection* only ever consumes the confirmed, stable `error_taxonomy_id` — it never re-derives its own judgment from raw evidence.

## 7. What Phase 2 deliberately did not do

No AI generation, no question bank beyond one hand-authored demonstration question, no student-facing practice UI, no Validation pipeline (Phase 3), no `ConceptDepth` content beyond Percentages/Ratio. 7 of 8 seeded taxonomy cells for Percentages are honestly `uncovered` — that gap is visible and queryable (via the coverage ladder in §4), not hidden. This matches docs/MASTER_PLAN.md Phase 2's explicit scope: build the intellectual structure correctly before adding AI generation and student UX.

## 8. Domain-first design, testable without a live AI provider

`@ipmat/concept-graph`, `@ipmat/examiner-lens`, and `@ipmat/question-engine` are plain TypeScript — no Prisma import, no AI provider import (docs/ARCHITECTURE.md §6). Every fixture (the Percentages graph, the Lens analysis, the 4 pattern families, the 8 taxonomy cells, the 1 worked question) is deterministic and hand-authored, so the full structure — relationship typing, combination derivation, coverage computation, DNA validation — is unit-tested (44 tests across the three packages) without calling any model. AI orchestration (when it's built in Phase 3) will sit strictly outside these packages, in `@ipmat/ai` and the jobs layer, and will consume — never redefine — these types.

## 9. How this generalizes beyond Percentages (without building for it yet)

Nothing above names "Percentages" in a type or table — it's all `concept_id`/`concept_name`-parameterized. Adding the next chapter is: curate its concept graph nodes/edges (with real rationale, not blind combinatorics), optionally add its `ConceptDepth`, run the Examiner Lens, author its pattern families, let the taxonomy and (eventually) generation pipeline fill in. No schema or domain-package change is anticipated. That remains the test of whether this design is right.
