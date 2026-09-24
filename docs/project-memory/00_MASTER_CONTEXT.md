# 00 — Master Context (start here)

> **PROJECT MEMORY IS A KNOWLEDGE BASE, NOT PERMISSION TO CHANGE ARCHITECTURE.**
> Reading these files does not authorize implementing, redesigning, or "fixing" anything they describe. Every architectural unit in this project has gone through an explicit design-approval step before implementation; that discipline does not relax because a fresh session read a summary of it.
>
> **When documentation and source code disagree, inspect the actual source, identify the discrepancy, and do not silently change either one.** Report the conflict. These files were reconstructed as faithfully as possible from the repository's own docs, decisions log, and git history as of commit `db9c764a3ed61c844d16156b78f32765f5e637ee`, but the repository is the ground truth, not this memory system.

## What this project is

An AI-native mastery platform for Indian competitive exams (starting with IPMAT). It does not just teach syllabus — it trains a student to handle the legitimate ways an exam can test a concept: standard application, combination with other topics, traps, unfamiliar representations, and time pressure. See [01_PROJECT_VISION.md](01_PROJECT_VISION.md).

Exactly one vertical slice is being built end to end right now: **IPMAT → Quant → Percentages**, from Concept Universe through Examiner Lens, Question Universe, Question DNA, Generation, Validation, Student Attempt, Question Autopsy, Targeted Repair, and Mastery. See [03_MVP_SCOPE.md](03_MVP_SCOPE.md).

## Why it exists

Conventional coaching teaches syllabus coverage and volume of practice. It rarely tells a student *which specific pattern of mistake they keep making*, *whether they can handle a concept when it's disguised or combined with another topic*, or *whether they're actually exam-ready versus merely syllabus-complete*. This project's bet is that a system which observes real attempt behavior, forms a falsifiable hypothesis about a mistake, has the student confirm or correct it, and only then prescribes targeted practice — while never pretending to know more than it has actually observed — produces a fundamentally more honest and more effective preparation product. See [02_PRODUCT_PHILOSOPHY.md](02_PRODUCT_PHILOSOPHY.md).

## Core philosophy — the one sentence that governs every design decision

**Observable behavior is not automatically proof of a psychological state.** The system measures what a student *did* (answered wrong, took 3x expected time, changed their answer twice, used a hint) — never what they *felt* or *how confident/anxious/certain* they were. See [22_OBSERVATION_EVIDENCE_HYPOTHESIS.md](22_OBSERVATION_EVIDENCE_HYPOTHESIS.md) for the full OBSERVATION → EVIDENCE → HYPOTHESIS → CONFIRMATION → REPAIR chain this produces.

## Hard invariants (non-negotiable, verified against `CLAUDE.md` and `docs/DECISIONS.md`)

1. **No confidence score, ever** (D-005). No field, endpoint, or UI element claims to know how a student feels.
2. **No fake AI, no fake analytics.** Anything presented as AI-driven or as real data must be backed by an actual model call or actual recorded attempts.
3. **Autopsy is always a hypothesis until the student confirms it** (D-006, D-038). Unconfirmed diagnosis never writes to mastery or triggers repair.
4. **No hard-coded exam rules or pricing.** Exam/section/chapter structure and pricing are data (DB rows), even with one exam.
5. **Content provenance is mandatory.** No question reaches `published` without a `Provenance` record. Never pirated/coaching-PDF/Telegram-dump content.
6. **Question DNA is enforced, not conventional.** No code path publishes a question with missing DNA fields.
7. **Modular monolith boundaries are real.** `packages/domain/*` never imports Next.js, Prisma, or a concrete AI provider. See [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md).
8. **All AI calls go through `@ipmat/ai`'s `generateStructured()`** with a Zod schema — no raw prompt strings, no unvalidated `JSON.parse`. See [82_AI_USAGE_RULES.md](82_AI_USAGE_RULES.md).
9. **Derive, never store, what can be computed.** Mastery, coverage stage, Examiner Lens combinations, answer-change history — all computed fresh on every read, never cached columns that could drift (D-015 and its many extensions).
10. **Never conflate a candidate/unconfirmed signal with a confirmed one.** Candidate error evidence ≠ confirmed diagnosis; a RepairPlan's `confirmationSource.hypothesisConfirmedAt` is the one gate; `Autopsy.confirmed === true` is the one authoritative confirmation fact anywhere downstream (D-039 addendum).
11. **Coordinate, never reimplement.** `@ipmat/training-orchestration` coordinates `@ipmat/repair-selection`, `@ipmat/adaptive-selection`, and five `TrainingSystemProvider`s through their public contracts only — it never reimplements any of their internal matching/ranking logic, and none of them may recreate another's semantics either.
12. **Fail closed, never fabricate.** An unparseable answer, an unpriced AI model, a pre-migration RepairPlan row, an unresolved ownership chain — all fail closed (reject/exclude/error) rather than guess or default to a misleading value.

## Package boundaries (see [11_PACKAGE_ARCHITECTURE.md](11_PACKAGE_ARCHITECTURE.md) and [12_DEPENDENCY_GRAPH.md](12_DEPENDENCY_GRAPH.md) for full detail)

```
packages/domain/*        pure TypeScript, framework-agnostic, no Prisma, no Next.js, no concrete AI provider
packages/ai               provider abstraction (@ipmat/ai) — zero dependency on any domain package
packages/db               Prisma schema + repository/adapter layer — depends on domain packages, never the reverse
packages/practice-loop     top-level orchestration (NOT packages/domain/*) — depends on @ipmat/attempt + @ipmat/db ports
apps/training-playground   internal dev/debug tool only — never the production student app
apps/web                   the real, uncommitted, in-progress student-facing product (see 92_CURRENT_STATE.md)
```

## AI rules (see [82_AI_USAGE_RULES.md](82_AI_USAGE_RULES.md))

No call site outside `@ipmat/ai/src/providers/` talks to a concrete SDK directly. Every structured AI output is Zod-validated. `FixtureProvider` (deterministic, no network) and `AnthropicProvider` (real, implemented, **still never run against a live model in this environment as of the current checkpoint**) implement the same interface.

## Security rules (see [54_SECURITY_AND_OWNERSHIP.md](54_SECURITY_AND_OWNERSHIP.md))

Ownership is always re-derived from the authoritative chain (`Attempt → PracticeBlock → PracticeSession → Enrollment → Student`), never trusted from a caller's claim, never a redundant stored ownership column. A student-scoped read is always scoped by an indexed column on the authoritative chain. Confirmation truth for a RepairPlan is `Autopsy.confirmed === true`, never a timestamp's mere presence, never `RepairStatus`.

## MVP rules (see [03_MVP_SCOPE.md](03_MVP_SCOPE.md) and [91_OPEN_BLOCKERS.md](91_OPEN_BLOCKERS.md))

One exam (IPMAT), one section (Quant), one chapter (Percentages). No payments, no auth, no parent portal, no multi-tenant orgs, no Mock/Simulation, no Revision, no massive content generation. Do not silently expand this scope.

## Current state (read this before anything else if you're starting fresh)

See **[92_CURRENT_STATE.md](92_CURRENT_STATE.md)** for the exact checkpoint (latest commit, test counts, what's implemented vs. designed vs. deferred) and **[99_SESSION_HANDOFF.md](99_SESSION_HANDOFF.md)** for the concise next-session briefing.

## Document map

| Range | Topic | Start here |
|---|---|---|
| 00–04 | Vision, philosophy, scope, roadmap | [01_PROJECT_VISION.md](01_PROJECT_VISION.md) |
| 10–14 | System/package architecture, data model, boundaries | [10_SYSTEM_ARCHITECTURE.md](10_SYSTEM_ARCHITECTURE.md) |
| 20–26 | Student model, autopsy, mastery, adaptive selection | [20_STUDENT_MODEL.md](20_STUDENT_MODEL.md) |
| 30–37 | Training systems (5 providers), orchestration, recommendation | [30_TRAINING_SYSTEMS.md](30_TRAINING_SYSTEMS.md) |
| 40–46 | Concept/Question intelligence, generation, validation, publication | [40_CONCEPT_UNIVERSE.md](40_CONCEPT_UNIVERSE.md) |
| 50–54 | Attempts, practice sessions/blocks, persistence, security | [50_ATTEMPTS.md](50_ATTEMPTS.md) |
| 60–66 | Student UX, design system, flows | [60_STUDENT_UX.md](60_STUDENT_UX.md) |
| 70–75 | API/app layer, auth, infra, payments, analytics (mostly future) | [70_API_AND_APPLICATION_LAYER.md](70_API_AND_APPLICATION_LAYER.md) |
| 80–84 | Engineering rules, testing, AI usage, Claude Code workflow | [80_ENGINEERING_RULES.md](80_ENGINEERING_RULES.md) |
| 90–99 | Decision index, blockers, current state, handoff | [90_ARCHITECTURAL_DECISIONS_INDEX.md](90_ARCHITECTURAL_DECISIONS_INDEX.md) |

## Session workflow (see [83_CLAUDE_CODE_WORKFLOW.md](83_CLAUDE_CODE_WORKFLOW.md) for full detail)

1. Read this file, then `92_CURRENT_STATE.md`, then `99_SESSION_HANDOFF.md`.
2. Read only the topic files relevant to the work unit at hand.
3. Inspect the actual current repository source for anything you're about to touch — never trust a memory file's claim about a specific type/function signature without verifying it, since the repository can move on.
4. Implement one architectural unit at a time, verify (typecheck/lint/test/build), commit.
5. Update `92_CURRENT_STATE.md` and `99_SESSION_HANDOFF.md` before ending the session.
6. Prefer a fresh session per major work unit over one long-running conversation — the repository's own documentation is the persistent memory, not conversation context.
