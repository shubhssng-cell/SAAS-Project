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
