# CLAUDE.md

Guidance for Claude Code sessions working in this repository.

## What this project is

An AI-native mastery platform for Indian competitive exams. Currently building exactly one vertical slice: **IPMAT → Quant → Percentages**, end to end (Concept Universe → Examiner Lens → Question Universe → Question DNA → Generation → Validation → Student Attempt → Question Autopsy → Targeted Repair → Mastery). Read [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) before making product decisions and [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) before starting any new phase of work.

Full docs:
- [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — what we're building and why
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, module boundaries, repo layout
- [docs/DATABASE.md](docs/DATABASE.md) — domain model
- [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) — provider abstraction, schema validation, background jobs
- [docs/QUESTION_ENGINE.md](docs/QUESTION_ENGINE.md) — concept graph, examiner lens, question taxonomy, validation, autopsy
- [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) — phases, current state, what NOT to build yet
- [docs/DECISIONS.md](docs/DECISIONS.md) — architecture decision log; add an entry for any non-obvious technical or product decision instead of leaving it only in a commit message

## Non-negotiable product rules

- **No confidence score.** Never add a field, endpoint, or UI element that claims to know how a student feels. Only observable performance (accuracy, speed, retries, hints, time-vs-expected) is measurable. See [docs/DECISIONS.md](docs/DECISIONS.md) D-005.
- **No fake AI, no fake analytics.** If something is presented as AI-driven or as real data, it must be backed by an actual model call or actual recorded attempts — never a stub dressed up as the real thing.
- **Autopsy is always a hypothesis until the student confirms it.** Never let unconfirmed diagnosis code paths write to mastery or trigger repair. See [docs/DECISIONS.md](docs/DECISIONS.md) D-006.
- **No hard-coded exam rules or pricing.** Exam/section/chapter structure and any pricing are data (DB rows), even when only one exam exists.
- **Content provenance is mandatory.** No question or content can be marked `published` without a `Provenance` record. Never use pirated/coaching-PDF/Telegram-dump content as a source, including for "just testing" purposes.
- **Question DNA is enforced, not conventional.** Don't add a code path that publishes a question with missing DNA fields, even temporarily.

## Working style for this repo

- **Vertical-slice discipline.** Before adding anything, check [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) §"What should explicitly NOT be built yet." If a request falls in that list, flag it back to the user rather than quietly building it — the plan is intentionally narrow right now.
- **Modular monolith boundaries are real, not aspirational.** Domain packages (`/packages/domain/*`) must not import Next.js, Prisma client, or a concrete AI provider directly — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §6. If a change needs to violate this, that's a sign the boundary needs a design conversation, not a quick import.
- **All AI calls go through `@ipmat/ai`'s `generateStructured()`, with a Zod schema.** No raw prompt strings or unvalidated `JSON.parse` on a model response anywhere else in the codebase — this is real and built, not aspirational (Phase 3).
- **Expensive/slow AI work is meant to be a background job (BullMQ), never inline in a request handler — but that job/queue layer isn't built yet.** Phase 3's generation pipeline (`runGenerationPipeline()`) is a plain async function today, invoked directly. When a queue exists, it should wrap that function without changing its signature (it already takes an injected `AiProvider`) — don't design a job system that requires reshaping the pipeline.
- **No premature abstraction.** This codebase intentionally supports only IPMAT/Quant/Percentages right now — don't add multi-exam branching, plugin systems, or config layers for exams/chapters that don't exist yet just because the long-term vision has them. The schema is already shaped to generalize (see [docs/DATABASE.md](docs/DATABASE.md)); the code should stay simple until a second chapter is actually being built.
- **Tests on domain logic, not on AI call correctness.** Unit-test concept graph traversal, mastery computation, validation rules, and phase-curve logic with Vitest. AI call sites are tested against recorded fixtures (see [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) §6), not live provider calls.
- **Calendar-awareness (`computePrepPhase`, `applyCatchUp`, `PrepPhaseTemplate`, `CatchUpPlan`) is Phase 1 domain logic, not a deferred UI feature.** Only the phase *UI* is Phase 6 — don't push the schema or the pure functions back to "later" if asked to touch this area; see [docs/DECISIONS.md](docs/DECISIONS.md) D-009.
- **`AttemptEvent` is the source of truth for timing, not `Attempt`'s own columns.** A new timing question (e.g. "how long between hint and next click") is a new `event_type`, never a new column on `Attempt` or a new table. See [docs/DECISIONS.md](docs/DECISIONS.md) D-010.
- **`reasoning_text` (why the student answered this way) and `working_steps` (their scratch/computation) are different fields — don't collapse them.** See [docs/DECISIONS.md](docs/DECISIONS.md) D-011.
- **Error classification goes through the `ErrorTaxonomy` table by foreign key, never a free-form string.** See [docs/DECISIONS.md](docs/DECISIONS.md) D-012.
- **Concept relationships are one of 8 typed values, never a flattened "related."** `prerequisite`, `foundational`, `directly_related`, `commonly_combined`, `application`, `dependent`, `advanced_extension`, `related_but_distinct` each have a specific, non-overlapping meaning — see `packages/domain/concept-graph/src/types.ts` and [docs/DECISIONS.md](docs/DECISIONS.md) D-013 before adding a new edge or a new type. Every edge needs a real `rationale`, not just a label, and an honest `certainty` — don't mark something `confirmed` because it sounds plausible.
- **Examiner Lens never stores its own "combinations" list — always derive from the concept graph.** `deriveCombinations()` in `@ipmat/examiner-lens` is the only function that should populate that data; a stored, hand-maintained list is a bug waiting to drift from the graph. See [docs/DECISIONS.md](docs/DECISIONS.md) D-015.
- **A pattern family and a taxonomy cell are different things — don't conflate them.** `QuestionPatternFamily` describes a question's structure (can generate many questions); `PatternTaxonomyCell` is one concrete, coverage-tracked slice of that structure. See [docs/DECISIONS.md](docs/DECISIONS.md) D-014.
- **Coverage stage (`mapped`/`has_questions`/`validated`/`practice_ready`) is computed on every read, never a stored column.** Same rule as mastery. Use `computePatternFamilyReadiness()`/`buildQuestionUniverseSnapshot()` in `@ipmat/question-engine`, don't add a `coverageStage` column anywhere.
- **Never claim literal completeness in any user-facing or authored text.** "Every possible question," "mathematically complete," "fully covers," etc. are banned phrases — `findCompletenessClaims()` in `@ipmat/examiner-lens` is a concrete guard against this regressing; run authored content through it in tests. Only "known/mapped/covered/uncovered" language is allowed. See [docs/DECISIONS.md](docs/DECISIONS.md) D-007.
- **`@ipmat/ai` has zero dependency on domain packages — never import `@ipmat/concept-graph`/`examiner-lens`/`question-engine` into it.** Its Zod schemas deliberately restate the small controlled vocabularies rather than importing the domain types, both to avoid a package cycle (domain depends on `ai`, never the reverse) and because it's a genuine trust boundary. See [docs/DECISIONS.md](docs/DECISIONS.md) D-017.
- **Never trust an LLM's stated answer on its own.** Every numeric answer must be independently recomputed deterministically (`verifyComputation()` in `@ipmat/validation`, via `mathjs`) AND cross-checked against a second, independent AI call that never saw the first one's answer (`compareReverification()`). A mismatch on either is an automatic rejection, full stop — don't add a code path that lets a stated answer through on the AI's confidence alone.
- **Any AI-generated text that reaches `mathjs.evaluate()` (or any expression evaluator) must pass a strict arithmetic-only allowlist first.** It's untrusted input; see [docs/DECISIONS.md](docs/DECISIONS.md) D-018. Don't relax this to support fancier notation without re-checking the security tradeoff.
- **A pattern family and a blueprint and a candidate are three different things, in order of increasing concreteness.** `QuestionPatternFamily` = the structure; `QuestionBlueprint` = one concrete specification built deterministically from one `PatternTaxonomyCell` (no AI); a generated `QuestionCandidateAiOutput` = one AI attempt to fill that blueprint, not yet trusted. The generator echoing back a different `blueprintId`, concept, or pattern family than it was given is a rejection (`blueprint_violation`), not a quiet acceptance.
- **Generated AI questions never auto-publish.** Hard/Extreme/Novel tiers always land in `review_required` regardless of how clean validation looks; only Standard/Advanced can reach `validated → published` without a human. See `computeLifecycleStatus()` in `@ipmat/question-engine` and [docs/DECISIONS.md](docs/DECISIONS.md) D-008.
- **Duplicate-risk detection is token-overlap similarity, not real semantic dedup, until there's an actual bank worth embedding.** Know this gap exists (D-019) rather than assuming it catches paraphrased duplicates.

## Current phase

See [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) for the authoritative phase list and exit criteria. Update that file's "Current state" line and check off phase exit criteria as work lands — don't let it drift out of sync with what's actually built.
