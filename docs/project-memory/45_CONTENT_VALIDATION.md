# 45 — Content Validation (`@ipmat/validation`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/QUESTION_ENGINE.md` §5b, `docs/DECISIONS.md` D-018, D-019, D-022, D-024, D-028, D-029, D-033 (read in full).

## Deterministic recomputation — never trust the stated answer

`verifyComputation()` evaluates the candidate's own `groundTruthDerivation.computation` via `mathjs`, completely independently of the LLM, comparing to both `expectedAnswer` and `correctAnswer`.

## The arithmetic allowlist — untrusted input reaching an evaluator (D-018, D-028)

Since `computation` is AI-generated (untrusted) text reaching an expression evaluator, it is checked against a strict allowlist **before** evaluation — defense in depth against `mathjs`'s own property-injection advisories, regardless of whether a given expression would actually be exploitable. Exact grammar: digits, whitespace, `.`, and `+ - * / ^ ( )` — **no comma** (removed in D-028: it never meant "thousands separator" to `mathjs`'s parser, which treats a top-level comma as a statement separator). Plus explicit bounds, all checked before `evaluate()`: 200-character length cap, 15-digit numeric-literal cap, 3-operator exponentiation-complexity cap, and a `1e12` post-evaluation result-magnitude cap.

## Fail closed on unparseable answers (D-024)

A `correctAnswer` that cannot be parsed as a plain number returns `unverifiable_answer` — a hard rejection, never a silent skip. `Number("")` no longer silently coerces to `0`.

## Blueprint compliance — every field a candidate could drift on (D-022)

Checks concept, pattern family, **difficulty tier, every required testing mode, the specified trap, and the exact combination-concept set** — not just the original 3 fields (id/concept/pattern family).

## Answer-leakage guard (D-029) — narrow by design

`validateNoAnswerLeakageInStem()` checks two concrete, deterministic conditions: the claimed `correctAnswer` must not appear verbatim in the stem, and the internal `blueprintId` must never appear at all. Explicitly **not** a keyword blacklist — that was rejected as creating a false impression of semantic understanding this codebase does not have. Cannot catch a paraphrased or algebraically-derivable leak.

## Duplicate-risk detection (D-019) — an honest interim measure

`checkDuplicateRisk()` uses token-overlap (Jaccard) similarity, not embeddings — catches near-verbatim reuse, will **not** catch a semantically identical question phrased entirely differently. Documented in code and here, not hidden. Proven to actually fire (not merely exist) during Phase 3.5, against a deliberate 100%-overlap near-twin.

## `distractor_quality` — kept deliberately, not removed as dead code (D-033)

A duplicate-distractor branch that was unreachable by every existing test was given a dedicated fixture and test rather than deleted — duplicate wrong-answer options are a genuine, distinct quality defect independent of whether the correct answer itself is fine.

## AI-judge pass — the one thing no deterministic check replaces

Given a `JudgeView` (stem, options, answerFormat, claimed tier — **not** the claimed answer), catches ambiguity and contradictory conditions, since that genuinely requires reading and understanding natural language.

See also: [44_CONTENT_GENERATION.md](44_CONTENT_GENERATION.md), [82_AI_USAGE_RULES.md](82_AI_USAGE_RULES.md).
