# 84 — Change Control

> Part of the [project memory](00_MASTER_CONTEXT.md). Synthesized from this project's own repeated, consistent pattern across every phase — see `docs/DECISIONS.md` for dozens of real examples of this pattern in action.

## The pattern, every time something non-trivial changes

1. **Explicit scope statement** — what files/packages are allowed to change, stated before any code is written. Real example: the D-039 addendum's authoritative implementation spec named exactly 14 files/paths as the allowed scope, and a `git status`/`git diff --stat` check against that exact list was run before committing.
2. **Explicit non-goals** — what must NOT be touched, named alongside the scope. Real example: nearly every training-system provider phase explicitly lists "no change to `@ipmat/training-orchestration`" as an out-of-scope item for that phase.
3. **Design review before implementation**, for anything with real architectural weight — see [83_CLAUDE_CODE_WORKFLOW.md](83_CLAUDE_CODE_WORKFLOW.md).
4. **Verification against the full repository, not just the changed package** — typecheck/lint/test/build run across every workspace.
5. **A decision-log entry** (`docs/DECISIONS.md`) for anything non-obvious — Status/Context/Decision/Consequences, appended, never rewriting history. If a decision is later found incomplete or wrong, a new addendum or entry supersedes it; the original stays as an accurate record of what was believed and decided at the time.
6. **Explicit confirmation of what was NOT changed**, alongside the report of what was. Real example: this session's `apps/web` work explicitly ran `git diff --stat -- packages/ apps/training-playground/` and confirmed it was empty before reporting completion.

## What counts as "in scope" vs. requiring a new decision

Fixing a bug found while implementing an approved design (e.g. Speed Lab's progression-gate mathematical contradiction, the three fixture-cross-contamination bugs found during D-062's test-writing) is treated as **within** the current unit's scope, since it's a correctness fix required to make the approved design actually work — not new architecture. Extending a design's actual behavior beyond what was approved (e.g. inventing a new eligibility rule not in the spec) requires a new decision, even mid-implementation.

## What requires stopping and asking, rather than proceeding

- Any request that falls in the MVP exclusion list ([03_MVP_SCOPE.md](03_MVP_SCOPE.md)) — flag it back rather than quietly building it.
- Any destructive git operation (force-push, hard reset, discarding uncommitted work) — always confirm first.
- Any decision named as genuinely open in this memory system (auth provider choice, D-004; whether to persist freshly-computed mastery, §13 of [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md)) — these are recorded as open precisely because they need a human decision, not a unilateral one.

## Commit discipline

Only commit when explicitly asked. Never amend a previous commit unless explicitly asked. Never use `--no-verify`/skip hooks. Stage specific files by name, not `git add -A`, especially when a broad set of files was touched (this session's D-039 addendum staged exactly its 14 approved paths, explicitly, rather than a blanket add).

See also: [90_ARCHITECTURAL_DECISIONS_INDEX.md](90_ARCHITECTURAL_DECISIONS_INDEX.md) for the full record this pattern has produced.
