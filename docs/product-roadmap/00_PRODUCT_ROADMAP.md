# Product Roadmap (master index)

## What this document is

This is the **PRODUCT roadmap** — a new, separate planning layer created on 2026-09-29.

It is **not** the same thing as the existing **engineering roadmap** in [../MASTER_PLAN.md](../MASTER_PLAN.md), which uses phase numbers like "Engineering Phase 1", "Engineering Phase 3.1", "Engineering Phase 5E-2", and a decision log `D-001`…`D-064` in [../DECISIONS.md](../DECISIONS.md). Those phase numbers describe how the underlying SaaS engine (concept graph, question engine, AI pipeline, attempt lifecycle, autopsy, mastery, training-system providers, application/API boundary) was actually built, in the order it was actually built. That history is real, valuable, and is **not** being rewritten, renumbered, or reinterpreted to match this new roadmap.

This document, and the `Product Phase N` numbering it introduces, is a **different axis**: it describes what gets built next from a *product* (student-facing, ship-it) point of view, reusing the engineering foundation that already exists wherever it already exists, and calling out plainly where it doesn't yet.

Do not confuse the two numbering schemes. When in doubt:
- "Engineering Phase X" / "D-0XX" → see [../MASTER_PLAN.md](../MASTER_PLAN.md) / [../DECISIONS.md](../DECISIONS.md).
- "Product Phase N" → see this file and the per-phase files in this directory.

## How the two roadmaps relate

- The engineering roadmap answers: *is the underlying capability built, tested, and wired end-to-end?*
- The product roadmap answers: *what does a student actually experience next, and in what order do we ship it?*
- The product roadmap is the layer that decides **what** gets built next. The existing engineering architecture and its module boundaries (see [../ARCHITECTURE.md](../ARCHITECTURE.md)) decide **how** any already-built capability may be reused safely — the product roadmap does not get to bypass those boundaries.
- A product phase can, and generally will, sit on top of engineering work that's already done (e.g. `@ipmat/practice-api` + `@ipmat/api` already exist per Engineering Phase 5I) while adding the product-facing pieces that were explicitly out of scope for that engineering phase (auth, UI wiring, a real database, etc.).

## Product phases

| Phase | Name | One-line scope |
|---|---|---|
| 0 | Product Definition | What we're building, for whom, and why — no code. |
| 1 | Platform Shell | Landing → signup/login → onboarding → enrollment → dashboard → practice entry, as one coherent product. |
| 2 | Real Practice Loop | A real student can practice real published questions end-to-end against a real database. |
| 3 | Adaptive Practice | The dashboard/practice entry actually surfaces `orchestrateNextTrainingAction()`'s recommendation to a real student. |
| 4 | Autopsy + Confirmation + Repair | The confirm/correct UI ships; a wrong answer can lead to a confirmed diagnosis and a repair question, in-product. |
| 5 | Student-facing Training Systems | **COMPLETE.** Calculation Gym / Speed Lab / Trap Lab / Novelty Training / Pressure Training / Revision are things a student can see and enter, on a common Training Session framework. Overtraining is DEFERRED (no specification) and was not part of the completion criteria. |
| 6 | Content Expansion / Question Universe | **NEXT — not started.** Grow real published Percentages coverage (and, later, deliberately, beyond it) once the loop above is proven with real students. |
| 7 | Examiner / Historical Intelligence | Surface Examiner Lens-derived insight to students directly, not just internally. |
| 8 | Mocks / Overtraining | Mock assembly and, once a specification exists, an Overtraining surface. (Revision and Pressure Training were delivered earlier, in Phase 5; Overtraining is DEFERRED.) |
| 9 | Production / Payments / Business Layer | Real auth decision (D-004), payments, pricing, production hardening. |
| 10 | Expansion | Second chapter / section / exam, only after the go/no-go gate in MASTER_PLAN.md is met. |

This table is intentionally high-level. Only Phases 0, 1, 2, 3, 4 and 5 have detailed files in this directory so far — see:
- [PHASE_0_PRODUCT_DEFINITION.md](PHASE_0_PRODUCT_DEFINITION.md)
- [PHASE_1_PLATFORM_SHELL.md](PHASE_1_PLATFORM_SHELL.md)
- [PHASE_2_REAL_PRACTICE_LOOP.md](PHASE_2_REAL_PRACTICE_LOOP.md) (Units 1-8 complete)
- [PHASE_3_ADAPTIVE_PRACTICE.md](PHASE_3_ADAPTIVE_PRACTICE.md) (COMPLETE -- Units 1-5 (3.1-3.5) done — PHASE 3 COMPLETE at technical + policy validation (latest-attempt reaction, accumulated evidence, trend-aware evidence, staged selection policy, hardening/validation); real outcome calibration remains future work; Phase 4 (Question Autopsy / Repair) not started)

- [PHASE_4_AUTOPSY_REPAIR.md](PHASE_4_AUTOPSY_REPAIR.md) (COMPLETE -- Units 1-5 done; PHASE 4 COMPLETE at technical + policy validation, no outcome calibration; Unit 1 (autopsy evidence surfaced, observation only) and Unit 2 (hypothesis + student confirmation/correction) and Unit 3 (offer + response persisted once; a confirmed explanation becomes a diagnosis and exactly one RepairPlan; reject/correct create neither) complete; Unit 4 (targeted repair practice: confirmed plans drive the next question through the existing repair tier, with a derived, conservative pending/in_progress/completed lifecycle) complete; Unit 5 (end-to-end hardening: whole-chain scenarios, security audit, restart/multi-instance/concurrency on real Postgres, correction-diagnosis boundary resolved by decision) complete)

- [PHASE_5_TRAINING_SYSTEMS.md](PHASE_5_TRAINING_SYSTEMS.md) (COMPLETE -- six student-facing training systems plus the Training System Foundation delivered; Overtraining DEFERRED, not implemented, not part of the completion criteria; Phase 6 is next and not started. Per-unit history: Unit 1 (Training System Foundation: a student-chosen, persisted, resumable Training Session framework layered on the existing PracticeBlock and the existing providers; training vs adaptive practice kept separate) complete; Unit 2 (Calculation Gym: the existing provider made student-facing in the session framework; a stage/selection alignment defect fixed; stage derived from history, never stored) complete; Unit 3 (Speed Lab: the existing provider made student-facing on the same framework; a stage/selection alignment defect fixed) complete; Unit 4 (Trap Lab: the existing provider made student-facing with no stages; provider unchanged) complete; Novelty Training (the first exposure-first system, no stages, provider unchanged) complete as Unit 5); Pressure Training (block-evidence, timed run, no stages, provider unchanged) complete as Unit 6; Revision (a new provider from the owner-supplied specification: concept-level re-exposure after a provisional 14-day dormancy, no stages, no stored state) complete as Unit 7)

- [PHASE_6_EXAM_INTELLIGENCE.md](PHASE_6_EXAM_INTELLIGENCE.md) (IN PROGRESS -- Prompt 1 of 5 complete: the exam-agnostic Exam Pack + validated Concept Universe (`@ipmat/exam-pack`), IPMAT Indore as data, no migration, no student-facing change; Prompts 2-5 not started)

Future phase files (2 through 10) will be added as each one is actually about to start, not speculatively ahead of time — this mirrors the existing repo's vertical-slice discipline (see [../MASTER_PLAN.md](../MASTER_PLAN.md) §"What should explicitly NOT be built yet" and the CLAUDE.md working-style rules).

## Ground rules for this roadmap layer

1. The existing non-negotiable product rules in the repo's `CLAUDE.md` (no confidence score, no fake AI/analytics, autopsy-is-hypothesis-until-confirmed, no hard-coded exam rules, content provenance, Question DNA enforcement) apply unchanged to every product phase below. This roadmap does not relax any of them.
2. Domain package boundaries (`/packages/domain/*` must not import Next.js/Prisma client/a concrete AI provider — [../ARCHITECTURE.md](../ARCHITECTURE.md) §6) are not renegotiated by a product phase. If a product need seems to require crossing one, that's a design conversation, not a quick import.
3. Product phase numbers are never used to silently redefine or supersede engineering phase numbers, and vice versa.
4. No product phase assumes engineering work that hasn't actually landed. Each phase file states its real, current dependencies against the actual repository, not against an idealized plan.
