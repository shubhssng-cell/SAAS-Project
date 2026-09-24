# 02 — Product Philosophy

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/PRODUCT_SPEC.md` §5, `CLAUDE.md` non-negotiable rules, `docs/DECISIONS.md` D-005/D-006, and the cumulative epistemic discipline visible across D-036 through D-062.

## The one sentence that governs everything

**Observable behavior is not automatically proof of a psychological state.** Every design decision in this codebase that looks unusually restrained — refusing to add a confidence field, refusing to auto-confirm a diagnosis, refusing to claim mathematical completeness — traces back to this one sentence. See [22_OBSERVATION_EVIDENCE_HYPOTHESIS.md](22_OBSERVATION_EVIDENCE_HYPOTHESIS.md) for the full chain this produces.

## No confidence score, ever (D-005)

**Status:** Accepted, product-level constraint, not merely technical.

The system measures observable performance only: accuracy, speed, retries, hint use, time-vs-expected. It never claims to infer how confident, anxious, or certain a student *feels*. No schema field, API response, or UI element anywhere in this codebase represents "confidence" for a student — the one deliberate, narrow exception is `AutopsyHypothesisAiOutput.modelConfidence`, which is explicitly the **model's** own confidence in one hypothesis, for internal ranking only, and is documented in both the schema and the system prompt as never meaning, and never becoming, the student's confidence in anything (D-038).

This constraint has a real product cost: "some product ideas that would naturally want a 'how sure are you?' input (e.g. self-reported difficulty) are out unless reframed as an observable proxy instead" (D-005 consequences).

## Autopsy output is a hypothesis, structurally, not just in prompt wording (D-006)

The `Autopsy` schema has no field representing a confirmed root cause until `confirmed = true`. Anything downstream that would use root cause (mastery updates, repair question selection) is gated on that flag. This is enforced **structurally**, not by convention:

- `generateHypothesis()` can only ever produce `confirmationStatus: "awaiting_confirmation"` — there is no parameter, anywhere, through which a caller could construct a pre-confirmed hypothesis (D-038).
- `buildRepairPlan()` throws unless `hypothesis.confirmationStatus === "confirmed"` specifically — a `"corrected"` hypothesis is deliberately *not* accepted, because free-text correction has no structured category to target without another, unbuilt diagnosis pass (D-039).
- `applyConfirmationResponse()`/`confirmHypothesis()`/`rejectHypothesis()`/`correctHypothesis()` are the *only* functions that can move `confirmationStatus` forward, and each refuses to apply a second response once one has already been applied.

This costs a real step in the loop ("repair can only act after student confirmation") in exchange for keeping the diagnosis honest.

## No fake AI, no fake analytics

If a feature is presented to the student as AI-driven, it must be backed by an actual model call — no hard-coded "analysis" dressed up as a model response. Dashboards show real, derived-from-attempts numbers, or they show nothing. This is enforced architecturally, not just by policy: `generateStructured()` is the *only* way to call an AI provider anywhere in this codebase, `FixtureProvider` implements the exact same interface as `AnthropicProvider` so a deterministic test double is never a special-cased shortcut, and every mastery/coverage/recommendation number is computed fresh from real `Attempt` records — nothing is precomputed and hand-edited to look plausible.

## No hard-coded exam rules or pricing

Exam/section/chapter structure (`Exam`, `Section`, `Chapter` tables) and pricing are data, not enums or code, even though only IPMAT exists today. Adding a second exam is a seed-data change, not a code change.

## Content provenance is mandatory

Every question carries a `Provenance.source_type` ∈ `{original, licensed, public_domain, open_license, official, user_authorized}`. A question cannot reach `published` without a provenance record — this is enforced at the schema level (a DB-level `CHECK` constraint, `questions_published_requires_provenance`, migration `0001_init`), not merely by policy. No pirated coaching material, PDFs, or Telegram-dump content, ever, including "just for testing."

## The epistemic discipline, generalized across every subsystem built since

The four rules above are the seed of a discipline that shows up, restated for a new context, in nearly every phase of this project:

| Where | The restatement |
|---|---|
| Trap Lab (D-056) | "trap-associated failure recurrence" is a candidate-level pattern match, never a confirmed diagnosis of the student's reasoning — every generated string is regression-tested against confirmation-implying language ("confirmed"/"proven"/"diagnos"/"student's reasoning"). |
| Novelty Training, Calculation Gym, Speed Lab (D-054, D-055, D-058) | `computationalLoad`/`difficultyDimensions` are explicitly `difficultyCalibrationStatus: "provisional"` (D-021) — never presented as measured, calibrated fact. |
| Pressure Training (D-061) | Its own applicability `notes` originally included a disclaimer that this "reflects observed sequence-level behavior, not a measured psychological state" — the word "psycholog" tripped its own forbidden-pattern regression test, and the fix moved the disclaimer to a doc comment rather than weakening the check. |
| Mastery (D-041, D-042, D-043) | A `null` measure means "insufficient data," never coerced to `0` — `0` means a real, measured zero. No composite "mastery %" field exists anywhere. |
| RepairPlan persistence (D-039 addendum) | Confirmation truth is `Autopsy.confirmed === true` specifically — never inferred from `RepairStatus`, never from mere presence of a `confirmedAt` timestamp (a rejected hypothesis still has a real `respondedAt`). |
| Duplicate detection (D-019) | Token-overlap similarity is documented as *not* proving semantic sameness — the gap is disclosed in code and in docs, not hidden. |
| Answer-leakage detection (D-029) | Explicitly documented as catching only a literal verbatim match, never claimed as semantic leakage detection. |

## No premature completeness claims (D-007)

"Map the full space of possible questions" is not a well-defined or achievable claim; "cover a curated, explainable taxonomy" is. `PatternTaxonomyCell` is the unit of coverage tracking; `findCompletenessClaims()` (`@ipmat/examiner-lens`) is a concrete, tested guard scanning free-text fields for phrases like "every possible question" or "mathematically complete" — reused across every AI task's output, not just Examiner Lens's own.

## What this means for anyone extending the system

Before adding a new signal, field, or claim: ask whether it represents something genuinely *observed* (an event, a count, a timing fact) or something *inferred beyond the evidence* (a feeling, an intention, a guarantee of completeness, a confirmed fact that hasn't actually been confirmed). The first category is welcome; the second requires either reframing as an observable proxy or an explicit, disclosed "provisional"/"candidate"/"hypothesis" label — never silent promotion to fact.
