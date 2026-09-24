# 83 — Claude Code Workflow (how future sessions should operate)

> Part of the [project memory](00_MASTER_CONTEXT.md). **This file is prescriptive** — it documents the recommended workflow this memory system exists to support, synthesized from the explicit instruction that produced this memory system and from the pattern this project's actual sessions have followed.

## The core principle

**Repository documentation is the persistent project memory, not conversation context.** A fresh Claude Code session, with no prior conversation, should be able to reconstruct everything it needs to continue this project correctly by reading this memory system plus the actual current source — never by relying on a long-running conversation's accumulated context.

## The recommended per-session workflow

1. **Read [00_MASTER_CONTEXT.md](00_MASTER_CONTEXT.md)** — the hard invariants, the package boundaries, the AI/security/MVP rules.
2. **Read [92_CURRENT_STATE.md](92_CURRENT_STATE.md)** — the exact current checkpoint: commit hash, test counts, what's implemented vs. designed vs. deferred.
3. **Read [99_SESSION_HANDOFF.md](99_SESSION_HANDOFF.md)** — the concise "what's next" briefing.
4. **Read only the topic-specific memory files relevant to the work unit at hand** — don't read all 59 files for a narrow task.
5. **Inspect the actual current repository source** for anything about to be touched — never trust this memory system's claim about a specific type/function signature without verifying, since the repository moves and this memory is a snapshot as of one commit.
6. **Implement exactly one architectural unit at a time.** This project's own history is a long, consistent demonstration of this: each phase/decision is scoped, reviewed (often through multiple design-approval passes before any code is written), implemented, verified, and committed — never several units bundled into one uncontrolled change.
7. **Verify before considering anything done**: typecheck, lint, full test suite, build — across every workspace, not just the one touched.
8. **Commit only when explicitly asked**, with a message that states what changed and references the relevant D-number if one exists.
9. **Update `92_CURRENT_STATE.md` and `99_SESSION_HANDOFF.md`** before ending a session that changed the project's state.
10. **Prefer a fresh session per major work unit over one long-running conversation.** The documentation, not the conversation, is what should carry context forward.

## The design-before-implementation pattern this project has consistently used

Repeatedly, across many decisions (D-053 through D-062, the D-039 addendum, the Training Recommendation Composition design), the actual sequence was: (1) a design-only pass, explicitly forbidden from writing code, producing a specific proposal; (2) often a second, "micro-specification" pass closing every remaining ambiguity; (3) explicit design approval; (4) implementation, strictly scoped to only the approved files/packages; (5) verification; (6) commit. Skipping straight to implementation without this sequence has never been this project's pattern for anything non-trivial, and future sessions should default to the same discipline unless explicitly told to move faster.

## What "one architectural unit" means in practice, drawn from real examples

- One new domain package (e.g. `@ipmat/pressure-training`).
- One persistence-fidelity fix scoped to exactly the files it touches (the D-039 addendum: 14 files, verified against an explicit allow-list before committing).
- One first-slice UI vertical (the `apps/web` build) — large in file count, but a single coherent unit with one clear boundary (never modify the playground, never modify any training decision package).

## What derailed this discipline once, briefly, and how it was corrected

The most recent user-directed pivot ("I want to SEE the product now") explicitly, deliberately paused the backend-first sequencing (`docs/MASTER_PLAN.md`'s own stated "what should be implemented FIRST" order) to build a visible product slice ahead of a reachable database or real AI validation. This was not a violation of the discipline — it was an explicit, user-approved reprioritization, and the strict scope/verification discipline was maintained throughout (no training algorithm touched, no playground touched, adapter genuinely calling real domain code). Record any future reprioritization here in [04_FULL_PRODUCT_ROADMAP.md](04_FULL_PRODUCT_ROADMAP.md) and [92_CURRENT_STATE.md](92_CURRENT_STATE.md) the same way, rather than silently treating a deviation as the new default order.

See also: [84_CHANGE_CONTROL.md](84_CHANGE_CONTROL.md) for exactly how a change should be scoped and reviewed.
