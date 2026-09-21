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
- **All AI calls go through `/packages/ai`'s `generateStructured`, with a Zod schema.** No raw prompt strings or unvalidated `JSON.parse` on a model response anywhere else in the codebase.
- **Expensive/slow AI work is a background job (BullMQ), never inline in a request handler.** Question generation, validation, and Examiner Lens analysis are never called synchronously from a student-facing route.
- **No premature abstraction.** This codebase intentionally supports only IPMAT/Quant/Percentages right now — don't add multi-exam branching, plugin systems, or config layers for exams/chapters that don't exist yet just because the long-term vision has them. The schema is already shaped to generalize (see [docs/DATABASE.md](docs/DATABASE.md)); the code should stay simple until a second chapter is actually being built.
- **Tests on domain logic, not on AI call correctness.** Unit-test concept graph traversal, mastery computation, validation rules, and phase-curve logic with Vitest. AI call sites are tested against recorded fixtures (see [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md) §6), not live provider calls.
- **Calendar-awareness (`computePrepPhase`, `applyCatchUp`, `PrepPhaseTemplate`, `CatchUpPlan`) is Phase 1 domain logic, not a deferred UI feature.** Only the phase *UI* is Phase 6 — don't push the schema or the pure functions back to "later" if asked to touch this area; see [docs/DECISIONS.md](docs/DECISIONS.md) D-009.
- **`AttemptEvent` is the source of truth for timing, not `Attempt`'s own columns.** A new timing question (e.g. "how long between hint and next click") is a new `event_type`, never a new column on `Attempt` or a new table. See [docs/DECISIONS.md](docs/DECISIONS.md) D-010.
- **`reasoning_text` (why the student answered this way) and `working_steps` (their scratch/computation) are different fields — don't collapse them.** See [docs/DECISIONS.md](docs/DECISIONS.md) D-011.
- **Error classification goes through the `ErrorTaxonomy` table by foreign key, never a free-form string.** See [docs/DECISIONS.md](docs/DECISIONS.md) D-012.

## Current phase

See [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) for the authoritative phase list and exit criteria. Update that file's "Current state" line and check off phase exit criteria as work lands — don't let it drift out of sync with what's actually built.
