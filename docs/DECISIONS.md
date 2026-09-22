# Decisions

Format: Status / Context / Decision / Consequences. Newest first once this grows; append, don't rewrite history — if a decision is reversed, add a new entry that supersedes it rather than editing the old one.

## D-001 — Modular monolith over microservices
**Status:** Accepted
**Context:** The domains (concept graph, question engine, attempts, mastery, autopsy) are read together on nearly every student-facing screen; team size is one for the foreseeable future.
**Decision:** One deployable app, internal module boundaries enforced in code (see [ARCHITECTURE.md](ARCHITECTURE.md) §2, §6).
**Consequences:** Faster iteration now; if a module later needs independent scaling, extraction is possible because boundaries already exist — but that's deferred work, not designed for prematurely.

## D-002 — TypeScript + Next.js + Postgres + Prisma + Redis/BullMQ
**Status:** Accepted
**Context:** Solo/small-team build, AI-heavy background workloads, need for strong typing across UI/API/domain/AI-schema boundaries.
**Decision:** See [ARCHITECTURE.md](ARCHITECTURE.md) §3 for the full table and rationale.
**Consequences:** Locks into a Node/TS ecosystem; acceptable since the domain logic itself is framework-agnostic TS and portable if any single piece needs replacing.

## D-003 — All AI outputs schema-validated via Zod through one provider abstraction
**Status:** Accepted
**Context:** Product rules explicitly forbid fake AI and fake analytics; question generation deals in mathematical correctness, which LLMs are not reliable at unaided.
**Decision:** No call site touches a provider SDK directly; every structured AI output is Zod-validated; question generation includes an independently-recomputed ground truth check, not just LLM self-report. See [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md).
**Consequences:** More upfront plumbing per task type; in exchange, "published" questions have a much stronger correctness guarantee, and provider swaps are cheap.

## D-004 — Auth provider: open, not yet decided
**Status:** Open
**Context:** The likely real-world sign-up path for Indian students skews toward phone/OTP rather than email/password; a managed provider (e.g. Clerk) is faster to ship but may not have great phone-OTP support for Indian numbers out of the box, while a self-hosted solution (Auth.js/NextAuth with a custom OTP provider) is more flexible but more work.
**Decision:** Deferred. Phase 1–3 development proceeds with a single seeded internal test user and no real auth flow, per [MASTER_PLAN.md](MASTER_PLAN.md) Phase 1. This must be decided before Phase 4 (first real student use).
**Consequences:** None yet — explicitly not blocking early work. Revisit before Phase 4.

## D-005 — No confidence score, ever
**Status:** Accepted (product-level constraint, not just technical)
**Context:** Explicit instruction from product vision: the system must not claim to know how a student feels.
**Decision:** No schema field, API response, or UI element represents "confidence." All measurement is of observable performance (accuracy, speed, retries, hint use) — see [DATABASE.md](DATABASE.md) §MasteryState.
**Consequences:** Some product ideas that would naturally want a "how sure are you?" input (e.g. self-reported difficulty) are out unless reframed as an observable proxy instead.

## D-006 — Autopsy output is a hypothesis, structurally, not just in prompt wording
**Status:** Accepted
**Context:** The product must never pretend to know why a student made a mistake.
**Decision:** The `Autopsy` schema has no field that represents a confirmed root cause until `confirmed = true`; anything downstream (mastery updates, repair question selection) that would use root cause is gated on that flag. See [DATABASE.md](DATABASE.md) §Question Autopsy and [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §4.
**Consequences:** Repair can only act after student confirmation, which adds a step to the loop but keeps the diagnosis honest.

## D-007 — Question Universe claims taxonomy coverage, not mathematical completeness
**Status:** Accepted
**Context:** "Map the full space of possible questions" is not a well-defined or achievable claim; "cover a curated, explainable taxonomy" is.
**Decision:** `PatternTaxonomyCell` is the unit of coverage tracking; all coverage statistics are computed against this table. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §3.
**Consequences:** Coverage numbers are honest but bounded by the quality of the Examiner Lens analysis that produced the taxonomy — garbage-in/garbage-out risk is real and is the reason Lens output gets a human review step in Phase 2.

## D-008 — Human review gate on Examiner Lens and on extreme/novel difficulty tiers, relaxable later
**Status:** Accepted, revisit after Phase 7
**Context:** Bootstrap trust in AI-generated curriculum content and hard/extreme questions is low; a human-in-the-loop gate is cheap insurance early.
**Decision:** Lens analyses require human review before use; Standard/Advanced tier generation can auto-publish after passing the validation pipeline, Hard/Extreme/Novel require human review at launch. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §4.
**Consequences:** Slower initial content velocity; the gate is meant to be loosened once rejection-rate data shows the pipeline is reliable (tracked as an explicit go/no-go input in [MASTER_PLAN.md](MASTER_PLAN.md)).

## D-009 — Calendar-aware prep-phase domain model and core calculation move to Phase 1
**Status:** Accepted (supersedes the original Phase 6 placement)
**Context:** The original plan deferred `Student`/`Enrollment`/`PrepPhaseTemplate`/`CatchUpPlan` to Phase 6 alongside the phase UI. On reconciliation against the product vision, this was wrong: distinguishing a September joiner's experience from a December joiner's is foundational to the product's value proposition, not a late enhancement — and `CatchUpPlan` can't be designed correctly without the schema existing from the start.
**Decision:** `Student`, `Enrollment`, `PrepPhaseTemplate`, `CatchUpPlan`, and the `/packages/domain/prep-phase` pure functions (`computePrepPhase`, `applyCatchUp`) are built and unit-tested in Phase 1. Only the phase *UI* stays in Phase 6. See [MASTER_PLAN.md](MASTER_PLAN.md) Phase 1 and Phase 6.
**Consequences:** Phase 1 is slightly larger than originally scoped; in exchange, Phase 6 becomes UI-only and the risk of discovering a calendar-model flaw late (after real enrollment data exists) is largely eliminated.

## D-010 — Attempt timing is event-sourced (`AttemptEvent`), not a set of duration columns
**Status:** Accepted
**Context:** The product needs time as a first-class signal (hint timing, retry timing, time-between-actions, time-before-first-interaction) without knowing in advance every timing question the autopsy/mastery systems will eventually ask.
**Decision:** `AttemptEvent` is a single, generic, append-only event log (`event_type` + `payload: jsonb` + `occurred_at`) and is the source of truth for all interaction/timing history. `Attempt`'s own timestamp and count fields are denormalizations derived from it, kept only where they make common queries cheap. See [DATABASE.md](DATABASE.md) §Attempt & AttemptEvent.
**Consequences:** A new timing signal is a new `event_type`, never a new column or a new table — this is what makes the model "extensible without over-engineering" rather than either under-specified or prematurely elaborate.

## D-011 — `reasoning_text` is a distinct field from `working_steps`, shaped (not built) for future voice input
**Status:** Accepted
**Context:** "What computation did you do" (`working_steps`) and "why did you pick this answer" (`reasoning_text`) are different diagnostic signals for autopsy; conflating them would lose information the hypothesis step needs.
**Decision:** `Attempt.reasoning_text` (free text) is separate from `Attempt.working_steps` (structured scratch/computation). `reasoning_input_mode` (`text` | `voice`) and `reasoning_audio_ref` exist on the schema now so voice input doesn't require a migration later, but voice capture itself is not implemented — `reasoning_input_mode` defaults to `text` and `reasoning_audio_ref` stays null until that phase starts (not before [MASTER_PLAN.md](MASTER_PLAN.md)'s explicit "not building yet" list is revisited).
**Consequences:** Two nullable text-ish fields exist on `Attempt` from Phase 1 with no reader until Phase 5 — an acceptable, explicitly-justified exception to "no speculative fields," since the alternative is a breaking schema change exactly when autopsy work is underway.

## D-012 — `ErrorTaxonomy` is a real table, referenced by foreign key
**Status:** Accepted
**Context:** [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) already required error classification to be "a controlled taxonomy, not free text," but the original schema stored `Autopsy.error_type` as a bare string, which doesn't actually enforce that.
**Decision:** `ErrorTaxonomy(id, code, label, description)` is a proper table; `Autopsy.error_taxonomy_id` and `RepairPlan.target_error_taxonomy_id` are foreign keys into it, seeded with an initial small set of error codes relevant to Percentages and grown deliberately over time. See [DATABASE.md](DATABASE.md) §Error Taxonomy.
**Consequences:** Adding a new error category is a seed-data change, not a code change or a string-matching risk across the codebase — consistent with how exam structure and content provenance are already handled.

## D-013 — Concept relationships expand to 8 types with rich metadata; error vocabulary is shared between Examiner Lens and Autopsy
**Status:** Accepted
**Context:** Phase 1's `ConceptRelation` had 3 types (`prerequisite_of`, `related_to`, `combines_with`) and a bare `strength` enum — not enough to distinguish, say, "Ratio is required before Percentages" from "Percentages sometimes needs Ratio again for advanced problems" from "Percentages and Probability look similar but shouldn't be combined." Separately, Examiner Lens needed a "what can go wrong" taxonomy (misconception/trap/calculation/interpretation/method-selection), and `ErrorTaxonomy` already existed for Autopsy — building a second, disconnected error vocabulary for Lens would fork a concept that should be singular.
**Decision:** `ConceptRelation.type` expands to 8 values (`prerequisite`, `foundational`, `directly_related`, `commonly_combined`, `application`, `dependent`, `advanced_extension`, `related_but_distinct`), each with `rationale`, `sharedKnowledge`, `usefulForQuestionGeneration`, `requirementLevel`, and `certainty` replacing the single `strength` field. `ErrorTaxonomy` gains a `category` field using the same 5-value vocabulary Examiner Lens error modes use, so both systems key off one table. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §1-2 and [DATABASE.md](DATABASE.md).
**Consequences:** `strength` is removed (not deprecated-and-kept) since no live database has ever held data in this column (confirmed empty in every environment through Phase 2 — see the Phase 2 report). Every future error-mode addition, whether authored for teaching content, Examiner Lens traps, or Autopsy diagnosis, goes through one table.

## D-014 — Pattern family (structure) and taxonomy cell (concrete slice) are two levels, not one
**Status:** Accepted
**Context:** Phase 1's `PatternTaxonomyCell` conflated "the kind of question this is" (e.g. "Reverse Percentage") with "this specific combination/trap/difficulty instance" in one flat row (`patternName: string`). The product vision explicitly describes a pattern as something that "can generate many valid questions" — a single flat row can't represent a structure with multiple potential combinations/traps/testing modes.
**Decision:** `QuestionPatternFamily` is a new, first-class table (name, skill, description, expected difficulty, and three "potential" arrays); `PatternTaxonomyCell.patternName` (string) becomes `patternFamilyId` (FK). A family is authored once; cells are the concrete, narrow coverage-tracked instantiations of it. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §3.
**Consequences:** One extra join to get from a `Question` to its pattern family's name/skill/description, in exchange for the taxonomy actually being able to express "this family has 2 traps and 3 combinations, and only some slices of that space are covered."

## D-015 — Examiner Lens combinations are always derived from the graph, never stored
**Status:** Accepted
**Context:** An earlier draft of this phase considered a `validCombinations: concept_id[]` column on `ExaminerLensAnalysis` (Phase 1 already had one). Storing it risks the classic cached-derived-data problem: `ConceptRelation` edges can be added, corrected, or reclassified after a Lens analysis is saved, and a stored list would silently go stale.
**Decision:** `ExaminerLensAnalysis` has no combinations column at all. `deriveCombinations(graph, conceptName)` in `@ipmat/examiner-lens` computes it live from `ConceptRelation`, every time it's needed, filtering to types that are actually useful for question generation (`commonly_combined`, `application`, `dependent`) and excluding `related_but_distinct`.
**Consequences:** Same discipline already applied to `MasteryState` (derived, never input) and now to pattern-family coverage (D-016) — a consistent architectural pattern: things that can be computed from a source of truth are computed, not cached as a second source of truth that can drift.

## D-016 — Question DNA finalized: `testingModes`/`noveltyLevel`/`examRelevance` are normalized columns; `trapErrorTaxonomyId` replaces the free-text `trapType`
**Status:** Accepted
**Context:** Phase 1's `Question.transformation` and `trapType` were nullable free-text strings — placeholders acknowledged at the time as needing real structure once Examiner Lens's controlled vocabularies existed. Phase 2 built those vocabularies (`TestingMode`, `ErrorTaxonomy.category`); leaving `Question` on the old placeholder fields would mean Question DNA didn't actually reflect the taxonomy it's supposed to be tagged against.
**Decision:** `Question.transformation` → `testingModes: TestingMode[]` (a question can exercise more than one mode); `Question.trapType` → `trapErrorTaxonomyId` (FK into `ErrorTaxonomy`, same table Autopsy uses); new normalized columns `noveltyLevel` and `examRelevance` (previously not tracked at all) since both are filtered on frequently (novelty-handling practice selection, "is this actually exam-typical" filtering) and belong as indexed columns, not inside the `difficultyDimensions` JSON blob. New `combinesWithConceptIds` array records which concepts a specific question actually combines, distinct from a pattern family's broader "potential" list.
**Consequences:** This is the second schema change to `Question` after Phase 1 (the first being none — Phase 1 shipped it once). Justified because Phase 1's `MASTER_PLAN.md` explicitly named "finalize Question DNA" as Phase 2's job, not a promise that Phase 1's placeholder fields were final.

## D-017 — `@ipmat/ai` has zero dependency on any domain package; its schemas restate rather than import domain shapes
**Status:** Accepted
**Context:** `@ipmat/ai`'s Zod schemas (Examiner Lens output, question candidates) need to match the shapes of `@ipmat/examiner-lens`/`@ipmat/question-engine` types closely. Importing those types directly would create a circular dependency, because the generation pipeline lives in `@ipmat/question-engine` and needs `@ipmat/ai`'s `AiProvider`/`generateStructured` — i.e. `question-engine → ai` must be the only direction.
**Decision:** `@ipmat/ai` restates the small, stable controlled vocabularies (`TestingMode`, `ErrorCategory`, `DifficultyTier`, `DifficultyDimensions`) as its own Zod schemas rather than importing the domain packages' TS types. This is also, independently, the right call at a trust boundary: what an LLM is allowed to produce is a fixed contract that shouldn't silently change just because a domain type gets refactored for an unrelated reason.
**Consequences:** A small amount of duplication (the same ~10-20 string literals exist in two places) that must be kept in sync by hand; a mismatch surfaces immediately as a schema-validation failure on every AI call, not silently, which is an acceptable failure mode for a rare, deliberate vocabulary change.

## D-018 — Untrusted (AI-generated) arithmetic strings are allowlist-filtered before reaching `mathjs.evaluate()`
**Status:** Accepted
**Context:** Independent answer verification (docs/QUESTION_ENGINE.md §5b) needs to recompute a candidate's stated arithmetic without trusting the LLM's claimed answer. `mathjs` had two property-injection advisories (GHSA-29qv-4j9f-fjw5, GHSA-jvff-x2qm-6286, fixed in 15.2.0) — and even patched, evaluating LLM-authored expression strings is evaluating untrusted input by definition.
**Decision:** Pinned `mathjs` to `^15.2.0` (the patched version) AND added a strict regex allowlist (digits, whitespace, `+ - * / ^ ( ) . ,` only) that a computation string must pass before it is evaluated at all — anything else is rejected outright as `impossible_computation`, never passed to `evaluate()`. See `@ipmat/validation/src/verifyComputation.ts`.
**Consequences:** A small class of legitimate-but-unusual arithmetic notation (e.g. scientific notation `1e5`) would currently be rejected rather than evaluated; acceptable for Phase 3's plain percentage arithmetic, revisit if a future pattern family genuinely needs it.

## D-019 — Duplicate-risk detection uses token-overlap (Jaccard) similarity as an interim measure, not embeddings
**Status:** Accepted, revisit when a real content bank exists
**Context:** docs/QUESTION_ENGINE.md's validation pipeline has always named "duplicate/near-duplicate check — embedding similarity" as the real target, but that needs an embedding model and a vector index over a real question bank, neither of which exists yet with only 1-2 questions total.
**Decision:** `checkDuplicateRisk()` in `@ipmat/validation` uses simple token-overlap (Jaccard) similarity against existing question bodies as an honest, deterministic, zero-dependency stand-in.
**Consequences:** Catches near-verbatim reuse (same words, different numbers) but will NOT catch a semantically identical question phrased in entirely different words. This gap is documented in code and here, not hidden — replace with real embedding-based dedup once there's an actual bank worth deduplicating against (Phase 3.5+).

---
The decisions below (D-020 onward) come from Phase 3.1 — AI Pipeline Hardening, which fixed weaknesses [PHASE_REVIEW.md](PHASE_REVIEW.md) identified in Phases 1–3, before any real AI-generated content is trusted. See [PHASE_3_1_REVIEW.md](PHASE_3_1_REVIEW.md) for the full report, including what remains unverified against a live provider.
---

## D-020 — Independent verifiers (reverification, judge) receive a narrow, explicitly-allowlisted view of a candidate — never the full object
**Status:** Accepted
**Context:** [PHASE_REVIEW.md](PHASE_REVIEW.md) §9.2 flagged that, while the Phase 3 reverification call happened not to leak the answer (it was passed only `candidate.stem`, a bare string), there was no structural guarantee against future leakage — a later change that passed the full `candidate` object, or added a field to it, could silently start leaking `correctAnswer`/`explanation`/`groundTruthDerivation`/`reasoning`/`solutionSteps` to a call that's supposed to be blind to them. Separately, the judge prompt DID pass `candidate.correctAnswer` labeled "claimed correct answer," which risked anchoring the judge toward confirming it rather than independently assessing the question.
**Decision:** `PresentedQuestionView` (`{ stem, options, answerFormat }`) and `JudgeView` (adds only `claimedDifficultyTier`) in `@ipmat/question-engine/src/verifierView.ts` are the ONLY types `buildReverificationUserPrompt()`/`buildJudgeUserPrompt()` accept, built via explicit field-by-field destructuring (never object spread of the candidate). The judge prompt no longer includes the candidate's claimed answer or explanation at all — it must independently determine whether the question has exactly one defensible answer among the options shown.
**Consequences:** Leakage is now prevented by the type system, not by prompt-authoring discipline — a future field added to `QuestionCandidateAiOutput` cannot leak through these two functions without a deliberate code change to the narrow view types themselves. Tested directly: a candidate fixture with marker strings planted in every field the verifier must not see, asserting those markers never appear in the built prompts (`test/verifierView.test.ts`).

## D-021 — Difficulty dimensions are explicitly marked `provisional`, never presented as calibrated
**Status:** Accepted
**Context:** [PHASE_REVIEW.md](PHASE_REVIEW.md) §8.2 and §9 named `buildBlueprintFromCell`'s `tierBaselineDimensions()` — a linear formula scaling a hand-picked baseline by tier index — as an unvalidated placeholder that could be mistaken for real calibration if nothing said otherwise.
**Decision:** `QuestionBlueprint` gained `difficultyCalibrationStatus: "provisional" | "expert_reviewed" | "empirically_calibrated"`, always `"provisional"` from `buildBlueprintFromCell()` today. No attempt was made to build a more "scientific-looking" formula — Phase 3.1 §4 explicitly asked not to, since a better-looking formula would still not be calibrated data and would only make the gap harder to notice.
**Decision, not done:** Real calibration needs actual student-attempt data (Phase 5+) and/or expert review — neither exists yet, and none was invented to fill the gap.
**Consequences:** Any code path that reads `difficultyDimensions` off a blueprint can also check `difficultyCalibrationStatus` and must not present those numbers as measured fact to a reviewer or student.

## D-022 — Blueprint compliance checking covers every field a candidate could drift on, not just concept and pattern family
**Status:** Accepted
**Context:** [PHASE_REVIEW.md](PHASE_REVIEW.md) noted (implicitly, via the pipeline's own scope) that `validateBlueprintCompliance()` originally checked only `blueprintId`, `conceptName`, and `patternFamilyName` — a candidate that silently claimed a different difficulty tier, dropped a required testing mode, built in the wrong trap, or combined with an unspecified concept would have passed.
**Decision:** `BlueprintExpectation` (`@ipmat/validation`) now also carries `difficultyTier`, `requiredTestingModes`, `trapErrorTaxonomyCode`, and `combinationConcepts`; `validateBlueprintCompliance()` checks all of them, each producing its own itemized `blueprint_violation` issue with a distinct `field` value. `exam`/`section`/`chapter` need no runtime check — the candidate schema has no field for them, so the AI is structurally unable to restate or change them.
**Consequences:** Five new deterministic rejection-path fixtures and tests (difficulty tier, testing mode, trap, and combination-concept violations, alongside the existing pattern-family violation) prove each check independently.

## D-023 — Examiner Lens comparison distinguishes four combination categories, not two
**Status:** Accepted
**Context:** [PHASE_REVIEW.md](PHASE_REVIEW.md) §9.7 flagged that `buildLensComparisonReport()`'s `supportedByGraph` check was type-blind — an AI proposal matching a `related_but_distinct` edge (which exists specifically to say "these look similar but do not combine them") would have counted as "supported," the same as a genuinely combinable edge.
**Decision:** The report now reports `validGenerationCombination` (a real, `commonly_combined`/`application`/`dependent` edge marked `usefulForQuestionGeneration: true`), `relatedButNonCombinable` (a real edge exists, but not a generation-useful type), `unsupportedByGraph` (no edge at all — invented), and `missedByAi` (a real, useful edge the AI never proposed) as four separate, mutually exclusive sets.
**Consequences:** The Percentages AI-Lens fixture now includes a proposal for "Probability" specifically to exercise the new `relatedButNonCombinable` category — the AI's fictional rationale ("both are numbers between 0 and 100") is the exact surface-level confusion the human Lens's `related_but_distinct` edge already warns about, which is a realistic failure mode this fix now correctly classifies instead of miscounting as support.

## D-024 — Fail closed on an unparseable `correctAnswer`, never silently skip its verification
**Status:** Accepted
**Context:** [PHASE_REVIEW.md](PHASE_REVIEW.md) §8.6/§9.6 flagged that `verifyComputation()`'s `parseNumeric()` returning `null` for an unparseable answer caused the `correctAnswer` cross-check to be silently skipped — a candidate could pass verification despite its stated answer never actually being checked. Worse, `Number("")` coerces to `0`, so an empty `correctAnswer` would have silently "matched" a computed value of 0.
**Decision:** A `correctAnswer` that fails to parse as a plain number now returns `fail("unverifiable_answer", ...)` — a hard rejection, not a skip. `parseNumeric()` also now explicitly regex-validates the cleaned string shape (rejecting `""` outright) rather than relying on `Number()`'s coercion quirks, and supports the common legitimate formats this project's questions actually use (₹/$/Rs. prefix, comma thousands separators, trailing `%`) without attempting fractions, ranges, or other formats (Phase 3.1 §3 explicitly asked not to over-engineer this).
**Consequences:** A candidate whose answer format this project doesn't yet support is now rejected rather than silently passed — a stricter, safer default. Widening supported formats is additive future work, not a redesign.

## D-025 — `runGenerationPipeline()` requires validated, explicit limits before making any AI call, and stops on budget overrun mid-run
**Status:** Accepted
**Context:** Phase 3.1 §9 required the generation infrastructure to have explicit limits (blueprint count, candidates per blueprint, retries, total attempts, estimated budget) before any batch generator is built — so that when one is built later, it inherits enforcement that already exists and is tested, rather than bolting safety on after the fact.
**Decision:** `GenerationLimits` (`@ipmat/question-engine/src/generationLimits.ts`) is validated by `validateGenerationLimits()` — thrown, listing every violated rule, before `runGenerationPipeline()` makes its first AI call. The pipeline also tracks running `estimatedCostUsd` across its own 3 calls and skips any remaining call (marking it `fail("budget_exceeded", ...)`) once the running total exceeds `maxEstimatedBudgetUsd` — proven with a mock provider that reports an artificially large token count.
**Consequences:** `DEFAULT_SINGLE_RUN_LIMITS` (1 blueprint, 1 candidate, $1.00 budget) is deliberately tight for a proof-of-concept; a future batch orchestrator must construct and pass its own `GenerationLimits`, and cannot bypass validation — there is no code path in `runGenerationPipeline()` that skips the check.

## D-026 — `@ipmat/ai`'s `generateStructured` schema parameter type was wrong for any schema using `.default()`
**Status:** Accepted (bug fix)
**Context:** Building the real-provider smoke test script (Phase 3.1 §5) surfaced a genuine type-signature bug: `GenerateStructuredInput<T>.schema` was typed `ZodSchema<T>`, which is `ZodType<T, ZodTypeDef, T>` — it forces the schema's Input type to equal its Output type. `examinerLensAnalysisAiSchema`'s `suggestedCombinations` field uses `.default([])`, making its Input type (`{...}[] | undefined`) legitimately differ from its Output type (`{...}[]`). No existing test caught this because no existing test called `generateStructured` with that specific schema and an explicit type parameter — the FixtureProvider-based tests all let TypeScript infer `T` from context in a way that happened not to trigger the mismatch.
**Decision:** Changed the field to `schema: ZodType<T, any, any>` — constraining only the Output type (T), which is the only one `generateStructured` actually uses (it consumes `schema.safeParse(...).data`, never the pre-parse input shape).
**Consequences:** This was a real bug that could have blocked the Examiner Lens regeneration task specifically (the one task schema using `.default()`) the first time anyone tried to call it with an explicit type parameter — exactly what building the real smoke test did. Found and fixed before any real API call was attempted, not after.
