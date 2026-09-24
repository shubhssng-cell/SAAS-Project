# 46 — Publication Workflow and Candidate Import

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-049, D-050 (read in full).

## Two overlapping status vocabularies — do not confuse them

- **`QuestionLifecycleStatus`** (`lifecycle.ts`): `draft/generated/validated/review_required/approved/published/rejected/deprecated` — the generation **pipeline's own in-memory candidate status**, produced by `computeLifecycleStatus()`, **never persisted anywhere**.
- **`ValidationState`** (real Prisma `Question.validationState` column): `draft/ai_validated/human_reviewed/published/rejected` — what everything touching a real `Question` row actually reads (e.g. `@ipmat/practice-loop`'s `QuestionReader` gate).

## `decidePublication()` — operates on the real, persisted vocabulary

Pure, database-free (`@ipmat/question-engine`). Throws `PublicationDecisionError` for: already-terminal current state, validation not yet complete, a tier requiring human review that hasn't reached it, or missing provenance. Nothing in the generation pipeline calls this automatically.

## `QuestionPublicationRepository` — the ONLY write path to `validationState`

`decide(questionId, action: "publish"|"reject")` — takes an **action**, never a raw target state, so an ordinary write can never bypass the check. Both implementations independently load the current state and run it through `decidePublication()` first. Wrapped in a `Serializable`-isolation transaction (a follow-up fix, mirroring D-046's lesson) — the original plain-transaction version had a genuine lost-update race where two concurrent `decide()` calls could both read the same non-terminal state and one could silently overwrite the other's terminal decision.

## `QuestionImportRepository` — the ONLY write path from a candidate to a real `Question` row

`assertCandidateIsImportable()` accepts **only** pipeline status `"validated"` — `"review_required"` and `"rejected"` both refused, fail closed. Persisted `validationState` is always `"ai_validated"`, never `"published"` directly. FK resolution is entirely natural-key-based; **never creates a `PatternTaxonomyCell`** (cells are pre-existing Question-Universe mappings). Idempotency key: `(patternTaxonomyCellId, body)`. A follow-up correctness review found and fixed a missing `candidate.blueprintId === blueprint.id` check — without it, a caller could supply validated content alongside an unrelated blueprint, filing it under an exam/section/chapter it was never actually checked against.

## Current, honest status (see [92_CURRENT_STATE.md](92_CURRENT_STATE.md))

Both pieces of infrastructure exist and are fully tested against in-memory doubles / fake Prisma clients. **Neither has ever been invoked against real content in a real database** — 0 questions are published. This infrastructure makes human publication *possible*; it does not perform it.
