# Question Intelligence Architecture

This document specifies the systems that turn "Percentages" into a servable, trustworthy question bank: Concept Universe, Concept Depth, Examiner Lens, Question Pattern Families, Question Universe (coverage), and Question DNA — plus the two systems that close the loop with the student: Validation and Question Autopsy.

Phase 2 (docs/MASTER_PLAN.md) built the first five of these as domain packages (`@ipmat/concept-graph`, `@ipmat/examiner-lens`, `@ipmat/question-engine`) with deterministic, hand-authored fixtures for Percentages. Phase 3 added real (provider-agnostic) AI generation for two of the tasks Phase 1 always intended (`@ipmat/ai`), independent answer verification and quality validation (`@ipmat/validation`), and a runnable single-question generation pipeline — still no student-facing UI, and still only one hand-authored + one AI-attempted question, not a content factory (docs/MASTER_PLAN.md Phase 3 explicitly excludes large-scale generation). Phase 3.1 hardened the trust boundaries (docs/DECISIONS.md D-020–D-026); Phase 3.1.1 then fixed every correctness/safety issue an implementation-level code review of that work found — see [PHASE_3_1_1_REVIEW.md](PHASE_3_1_1_REVIEW.md) and docs/DECISIONS.md D-027–D-033.

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

**Authorship is tracked honestly:** `authoredBy` (`human`/`ai`) is separate from `status` (the review workflow). Percentages' canonical, seeded Lens analysis is `authoredBy: human` and remains the evaluation baseline (§2a) — an AI regeneration is never allowed to overwrite it; it is stored/compared separately.

**Structural validation without a live AI provider:** `validateExaminerLensAnalysis()` in `@ipmat/examiner-lens` checks the analysis references real concepts, uses only vocabulary-sanctioned testing modes, and — via `findCompletenessClaims()` — that no free-text field asserts literal completeness ("every possible question," "mathematically complete," etc.). This runs against deterministic fixtures in tests; no live AI call is needed to validate structure (docs/QUESTION_ENGINE.md §8 below).

**Versioning:** re-running the Lens on a concept produces a new version; old pattern families/questions keep their original `examiner_lens_analysis_id` reference so provenance never breaks.

## 2a. Examiner Lens regeneration — human baseline vs AI

Phase 3 built the actual AI regeneration task and comparison report (docs/AI_ARCHITECTURE.md §5) — the human-authored analysis from §2 is the fixed evaluation baseline, never overwritten. `buildLensComparisonReport()` (`@ipmat/question-engine`) diffs a human `ExaminerLensAnalysisData` against an AI `ExaminerLensAnalysisAiOutput`, reporting testing-mode and error-category agreement, numeric difficulty-dimension deltas, and — the part that matters most — the AI's proposed combinations split into **four** categories (docs/DECISIONS.md D-023, fixed in Phase 3.1 after the original two-category version conflated "a graph edge exists" with "this is valid to combine on"):
- **`validGenerationCombination`** — a real, generation-useful edge (`commonly_combined`/`application`/`dependent` with `usefulForQuestionGeneration: true`).
- **`relatedButNonCombinable`** — a real edge DOES exist, but it's not a generation-useful type (most notably `related_but_distinct`, which exists specifically to flag confusion risk, not to suggest combining).
- **`unsupportedByGraph`** — no edge at all anywhere in the graph — an invented relationship.
- **`missedByAi`** — a real, useful edge the AI never mentioned.

Concept names are matched by a normalized key (trim, collapse whitespace, lowercase — docs/DECISIONS.md D-030), never raw string equality: "ratio" and "Ratio" classify identically, closing a real false-positive gap where a real model's harmless formatting variance would otherwise be misreported as an invented relationship. This is exact-match-after-normalization only — there is no fuzzy or typo correction, so a genuinely unrecognized or misspelled name still correctly lands in `unsupportedByGraph`.

Run against a deterministic AI-output fixture standing in for a live call (docs/AI_ARCHITECTURE.md — no API key configured in this environment through Phase 3.1), the comparison found: the AI correctly identified the `Ratio` prerequisite and 3 real combination concepts (`validGenerationCombination`), proposed `Probability` — which DOES have a real edge (`related_but_distinct`) but is explicitly not combinable, with a rationale ("both are numbers between 0 and 100") that is exactly the surface-level confusion pattern the human Lens already warns about — correctly landing it in `relatedButNonCombinable` rather than being miscounted as support, invented one relationship (`Time and Work`) with no supporting edge anywhere in the graph, and missed 3 real, useful combinations (`Discount`, `Population Growth and Decline`, `Algebra`). It made no completeness claim in this run — a second fixture with one deliberately injected confirms the guard catches it when present. **The comparison never modifies the human baseline or the graph** — an AI's proposal landing in `validGenerationCombination` means only that it happens to match a real, generation-useful edge, not that the AI's reasoning is now authoritative (docs/MASTER_PLAN.md Phase 3 §9: "do not assume AI is correct").

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

`validateQuestionDna()` (in `@ipmat/question-engine`) checks a DNA object's `conceptName`, `subconcepts`, `prerequisites`, and `combinesWithConcepts` all reference real concepts in the supplied graph, and that `patternFamilyName` names a family that actually exists for that concept — this is what makes "Question DNA references valid concepts/patterns" a checkable fact, demonstrated end-to-end by the one hand-authored worked example in `percentagesQuestionDnaExample.ts` (a Reverse-Percentage, Ratio-combined, `published` question with full provenance) and by the one AI-generated candidate in §5b.

## 5a. Question Blueprint

**A blueprint is NOT a question — it is the specification from which a question may be generated** (Phase 3 §4). `buildBlueprintFromCell()` (`@ipmat/question-engine`) builds one `QuestionBlueprint` deterministically from one existing `PatternTaxonomyCell` + its `QuestionPatternFamily` — **no AI is involved in producing a blueprint**, only in filling one. It carries: concept, pattern family, target skill, difficulty tier and dimensions, expected time, combination concepts, trap, a controlled-vocabulary testing-mode list, a free-text `transformationDescription` (a specific elaboration like "hide the original value, express it only via a ratio to a second quantity" — distinct from the `testingMode` category; see docs/DECISIONS.md D-017), and the required answer format. It has no `body`, `options`, or `correctAnswer` field — those don't exist until generation happens.

**Difficulty dimensions are explicitly `provisional`** (docs/DECISIONS.md D-021, Phase 3.1 §4): `difficultyCalibrationStatus` is always `"provisional"` from `buildBlueprintFromCell()` today, because `tierBaselineDimensions()` is a hand-picked linear formula, not a measurement. Real calibration needs actual student-attempt data and/or expert review, neither of which exists — no attempt was made to invent a more convincing-looking formula in its place.

## 5b. Question generation pipeline — independent verification, never trust the stated answer

`runGenerationPipeline()` (`@ipmat/question-engine`) is the full chain from one blueprint to one final candidate (docs/AI_ARCHITECTURE.md §6 has the exact call sequence and §9a the required generation limits). The critical design point, repeated because it's the one rule this whole pipeline exists to enforce: **"the LLM says the answer is X" is never sufficient.** The actual check order is: structural validation, then deterministic recomputation, then independent re-derivation, then duplicate risk, then the AI-judge pass — every check still runs regardless of an earlier failure, so a rejection report shows everything wrong, not just the first problem found.

1. **`validateCandidateStructurally()`** — blueprint compliance now covers every field a candidate could silently drift on: concept, pattern family, **difficulty tier, every required testing mode, the specified trap, and the exact combination-concept set** (docs/DECISIONS.md D-022, Phase 3.1 §7) — plus syllabus compatibility, exactly-one-correct-answer, **no verbatim answer/metadata leakage in the stem** (docs/DECISIONS.md D-029, Phase 3.1.1 §3), no completeness claim, and provenance present.
2. **Deterministic recomputation** (`verifyComputation()`, `@ipmat/validation`) — the candidate's own `groundTruthDerivation.computation` (a plain arithmetic expression) is evaluated by `mathjs`, completely independently of the LLM, and compared to both `expectedAnswer` and `correctAnswer`. Because `computation` is AI-generated (untrusted) text reaching an expression evaluator, it is first checked against a strict arithmetic-only character allowlist before evaluation — defense in depth against mathjs's own property-injection advisories (docs/DECISIONS.md D-018), regardless of whether a given expression would actually have been exploitable. The exact supported grammar is digits, whitespace, `.`, and `+ - * / ^ ( )` — no comma (removed in Phase 3.1.1: it never actually meant "thousands separator" to mathjs's parser, which treats a top-level comma as a statement separator, not a grouping character) — plus explicit length (200 chars), numeric-literal-magnitude (15 digits), exponentiation-complexity (3 operators), and result-magnitude (`1e12`) bounds, all checked and rejected BEFORE `evaluate()` is called (docs/DECISIONS.md D-028, Phase 3.1.1 §2). A `correctAnswer` that cannot be parsed as a plain number now **fails closed** (`unverifiable_answer`) instead of silently skipping that part of the check (docs/DECISIONS.md D-024, Phase 3.1 §3).
   - **What this deliberately does not attempt to catch:** the generated `stem` itself can still leak its own answer through free-text wording that isn't a verbatim restatement of `correctAnswer` — e.g. an answer paraphrased in words, or one that's algebraically derivable from other stated givens. `validateNoAnswerLeakageInStem()` catches only the concrete, checkable case of a verbatim whole-token match (docs/DECISIONS.md D-029); it is documented as narrow by design, not claimed as complete semantic leakage detection.
3. **Independent re-derivation** (`compareReverification()`) — a SECOND, separate `generateStructured("answer-reverification")` call is given ONLY a `PresentedQuestionView { stem, options, answerFormat }` (docs/AI_ARCHITECTURE.md §6a, D-020) — structurally incapable of receiving the first candidate's answer, explanation, computation, or reasoning — and asked to solve it from scratch. Disagreement between the two independent answers is a rejection, catching cases where the arithmetic is internally consistent but the question doesn't mean what the first model thought it meant.
4. **`checkDuplicateRisk()`** — token-overlap similarity against existing question bodies — a deliberately lightweight, deterministic stand-in for real embedding-based dedup, which needs an embedding model and remains explicitly future work (docs/DECISIONS.md D-019).
5. **AI-judge pass** (`interpretJudgeVerdict()`) — given a `JudgeView { stem, options, answerFormat, claimedDifficultyTier }`, NOT the claimed answer (docs/AI_ARCHITECTURE.md §6a) — for ambiguity and contradictory conditions, which genuinely require reading and understanding natural language and cannot be replaced by a deterministic check.

Every AI call the pipeline makes is gated by a running estimated-cost check (docs/AI_ARCHITECTURE.md §9a) — if the running total exceeds the run's `maxEstimatedBudgetUsd`, remaining calls are skipped and fail closed (`budget_exceeded`) rather than spending further. Before any of this, the provider's model itself must have a known pricing entry at all (docs/DECISIONS.md D-027, Phase 3.1.1 §1) — an unrecognized model is refused before the first call, never silently treated as free.

The generation prompt itself (`buildGenerationSystemPrompt()`) now explicitly enumerates every field blueprint compliance checks — concept, pattern family, target skill, difficulty tier, required testing modes, the trap, and the exact combination-concept set — and explicitly instructs the model that the stem must never state or imply the answer (docs/DECISIONS.md D-032, Phase 3.1.1 §5). The deterministic validator remains authoritative either way; this is about giving the model a complete, fair statement of a rule it was already being held to, not about relaxing anything.

A rejection at any step carries a specific `RejectionCode` + field + message — never a silent discard. A pattern of rejections at a given taxonomy cell is a signal the Examiner Lens analysis or pattern family for that cell needs review, not just the generator prompt.

## 5c. Question lifecycle

```
draft → generated → validated ─────────────→ published → deprecated
                  ↘ rejected            ↗
                    review_required → approved
```

`computeLifecycleStatus()` (`@ipmat/question-engine`) decides the ONE status a freshly-generated candidate lands in: any failed check → `rejected`; Standard/Advanced tiers that pass everything → `validated` (which can reach `published` directly, matching docs/DECISIONS.md D-008's auto-publish allowance); Hard/Extreme/Novel tiers that pass everything → `review_required` regardless of how clean the results look, reaching `published` only via `approved`. Generated AI questions never automatically become published content (Phase 3 §8).

## 6. Question Autopsy → Targeted Repair

Covered in detail in [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §4. The repair step selects follow-up questions **from the Question Universe taxonomy**, filtered to the confirmed `error_taxonomy_id` (see [DATABASE.md](DATABASE.md) §Error Taxonomy) and `target_concept_id`. The evidence behind a confirmed error can be rich (`AttemptEvent` timing, `reasoning_text`), but repair *selection* only ever consumes the confirmed, stable `error_taxonomy_id` — it never re-derives its own judgment from raw evidence.

## 7. What Phase 3 deliberately did not do

No massive generation batches, no thousands of questions, no automated publishing, no full generation job/queue, no public generation UI (Phase 3 §12). Exactly one AI-generated candidate was pushed through the full pipeline in the demonstration; the remaining 7 of 8 seeded Percentages taxonomy cells stay honestly `uncovered`. No live AI provider call was made anywhere in this repository's tests or demos — no API key is configured in the implementing environment; `AnthropicProvider` is implemented and typechecked but unexercised (docs/AI_ARCHITECTURE.md). This matches docs/MASTER_PLAN.md Phase 3's explicit scope: prove the pipeline works reliably before scaling it.

## 8. Domain-first design, testable without a live AI provider

`@ipmat/concept-graph`, `@ipmat/examiner-lens`, `@ipmat/question-engine`, and `@ipmat/validation` are plain TypeScript — no Prisma import (docs/ARCHITECTURE.md §6). `@ipmat/ai` has no dependency on any of them (docs/DECISIONS.md D-017) — the dependency direction is domain → ai, never the reverse. Every fixture (the Percentages graph, the human Lens analysis, AI-Lens-output fixtures including deliberate name-variance and completeness-claim cases, the 4 pattern families, the 8 taxonomy cells, the 1 hand-authored worked question, the generation-pipeline candidate fixtures covering every rejection path) is deterministic, so the full structure — relationship typing, combination derivation, coverage computation, DNA validation, independent verification, quality validation, and the generation pipeline's control flow — is unit-tested (146 tests across 7 packages as of Phase 3.1.1, up from 118 after Phase 3.1.1's fixes, including leakage-proof tests for the independent-verifier trust boundary, fail-closed tests for answer parsing/generation limits/unpriced models, arithmetic-grammar complexity/magnitude bounds, stem-leakage detection, and concept-name normalization) without ever calling a live model. `FixtureProvider` (`@ipmat/ai`) is what makes this possible: it implements the exact same `AiProvider` interface `AnthropicProvider` does, so pipeline code is identical regardless of which one is injected.

## 9. How this generalizes beyond Percentages (without building for it yet)

Nothing above names "Percentages" in a type or table — it's all `concept_id`/`concept_name`-parameterized. Adding the next chapter is: curate its concept graph nodes/edges (with real rationale, not blind combinatorics), optionally add its `ConceptDepth`, run the Examiner Lens, author its pattern families, let the taxonomy and (eventually) generation pipeline fill in. No schema or domain-package change is anticipated. That remains the test of whether this design is right.
