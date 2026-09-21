# Question Intelligence Architecture

This document specifies the four linked systems that turn "Percentages" into a servable, trustworthy question bank: Concept Universe, Examiner Lens, Question Universe, Question DNA — plus the two systems that close the loop with the student: Validation and Question Autopsy.

## 1. Concept Universe

**What it is:** a directed graph. `Concept` nodes belong to a `Chapter`; `ConceptRelation` edges are typed (`prerequisite_of`, `related_to`, `combines_with`) and carry a strength and a provenance (human-curated vs. AI-suggested-then-approved).

**How it's built for Percentages:** human-curated seed (a small, correct graph is worth more than a large, noisy one at bootstrap) — Percentages, Ratio, Averages, Profit & Loss, Discount, DI, Algebra as nodes; edges reflecting real prerequisite and combination relationships. AI may *suggest* additional edges (e.g. "this could combine with Simple Interest"), but a suggested edge starts `source: ai_suggested` and does not affect question generation until a human flips it to approved. This keeps the graph trustworthy while still using AI to widen the search for what to curate.

**Why a graph and not a tag list:** the Question Universe and Examiner Lens both need to ask "what else is reachable from here" (for combination questions) and "what must be true before this" (for prerequisite gating in mastery/repair) — both are graph queries, not string matches.

## 2. Examiner Lens

**What it is:** a structured analysis, one per `(concept, version)`, answering — in schema-validated JSON, not prose — six questions:

1. What is actually being tested (the core skill, distinct from the topic label)
2. What prerequisite knowledge is exercised (concept IDs, pulled from the graph)
3. What legitimate question patterns can test it (named patterns, e.g. "successive percentage change", "percentage-of-percentage base confusion", "reverse percentage")
4. What valid combinations exist (with which other concepts, and how)
5. What legitimate traps exist (a controlled taxonomy — e.g. "base ambiguity", "unit/whole confusion", "sign of change" — not "make numbers ugly")
6. What transformations and novel representations are possible (e.g. percentages presented as a DI table, as a word problem with nested changes, as a graph-reading question)

**Why this is a first-class stored artifact, not a prompt run on the fly:** every generated question must cite the `ExaminerLensAnalysis` id and the specific pattern/trap/combination it came from. This is what makes "we cover the legitimate ways this can be tested" a checkable claim instead of a marketing sentence — you can query how many taxonomy cells derived from a given Lens analysis are actually covered.

**Versioning:** re-running the Lens on a concept (e.g. after curating more graph edges) produces a new version; old questions keep their original `examiner_lens_analysis_id` reference so provenance never breaks.

## 3. Question Universe (pattern taxonomy)

**What it is:** the `PatternTaxonomyCell` table — the cross product of pattern × combination × transformation × trap × difficulty tier × target time, but only the cells the Examiner Lens actually identified as legitimate (this is a curated cross-product, not every combinatorial possibility).

**The explicit non-claim:** the product does not claim mathematical completeness ("every possible percentage question"). It claims and displays **coverage of this table** — e.g. "38 of 42 identified legitimate pattern/trap/difficulty combinations for Percentages have at least 5 published questions." That number is real because the table is real.

**How cells get filled:** a background job watches `coverage_status`; cells that are `uncovered` or below a minimum question count trigger a generation job (see [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §3).

## 4. Question DNA + Validation

**Question DNA** is the mandatory metadata set on every `Question` row (full field list in [DATABASE.md](DATABASE.md) §Question). It is enforced structurally: `validation_state` cannot become `published` while any DNA field is null or `provenance_id` is unset — this is a database/application-layer invariant, not a style guideline.

**Validation pipeline**, in order, for every generated draft:
1. **Independent re-derivation** — the draft includes the generator's own `ground_truth_derivation`; the system recomputes it deterministically and rejects on mismatch. This catches LLM arithmetic errors without asking the LLM to grade itself.
2. **AI-judge pass** — a second, schema-validated call checks syllabus relevance, ambiguity (exactly one defensible correct answer), and whether the difficulty tier claim is honest.
3. **Duplicate/near-duplicate check** — embedding similarity against already-published questions in the same concept, to keep the "extreme/novel" tiers from silently converging on the same three question shapes.
4. **Human review gate** — configurable per difficulty tier; recommended ON for `extreme`/`novel` tiers at bootstrap, relaxable once the pipeline has a track record.

A question that fails step 1 or 2 is `rejected`, not silently discarded — rejections are logged with reason, because a pattern of rejections at a given taxonomy cell is a signal that the Examiner Lens analysis for that cell needs review, not just the generator prompt.

## 5. Question Autopsy → Targeted Repair

Covered in detail in [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §4. The one point worth restating here: the repair step selects follow-up questions **from the Question Universe taxonomy**, filtered to the confirmed `error_type` and `target_concept_id` — repair is not "give another random question from this chapter," it's "give a question from the taxonomy cell that specifically exercises the thing the student just got wrong." This only works because the taxonomy in §3 exists and every question is tagged against it.

## 6. How this generalizes beyond Percentages (without building for it yet)

Nothing above names "Percentages" in a type or table — it's all `concept_id`-parameterized. Adding the next chapter is: curate its concept graph nodes/edges, run the Examiner Lens, let the taxonomy and generation pipeline fill in. No schema or pipeline change is anticipated. That's the test of whether this design is right — it should not need to be revisited when chapter two starts.
