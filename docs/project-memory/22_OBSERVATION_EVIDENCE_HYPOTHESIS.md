# 22 — Observation → Evidence → Hypothesis → Confirmation → Repair → New Practice → New Observation

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/AI_ARCHITECTURE.md` §10/§10a, `docs/DECISIONS.md` D-036–D-039, and `docs/MASTER_PLAN.md` Phase 5A/5B sections (all read in full).

## The chain, exactly

```
Attempt (finalized, via @ipmat/attempt)
  -> toAutopsyEvidence(): OBSERVATION
       raw per-attempt facts, reused verbatim downstream, never re-derived
  -> @ipmat/autopsy's buildAutopsyOutput(): EVIDENCE
       deterministic behaviorSignals / hintSolutionEvidence / historicalSignals / candidateErrorEvidence
       integrates the EXISTING ErrorTaxonomy; candidate error is explicitly NOT a confirmed one
       no AI call anywhere in this step
  -> @ipmat/autopsy's generateHypothesis(): HYPOTHESIS
       the ONLY AI call in this whole pipeline; refuses to run if candidateErrorEvidence is null
       always phrased as a hypothesis, never an assertion; ALWAYS confirmationStatus: "awaiting_confirmation"
  -> shown to student for confirm / reject / correct: applyConfirmationResponse()
       "confirmed": the ONLY way confirmationStatus becomes "confirmed"
       "corrected": student's own text preserved as NEW evidence, never overwriting the original
  -> on confirm: buildRepairPlan(): CONFIRMED DIAGNOSIS -> REPAIR TARGET
       target concept/pattern family/taxonomy cell/error category/training mode/priority/prerequisites
       still does NOT select or generate actual follow-up questions
  -> @ipmat/repair-selection's selectRepairQuestion(): NEW PRACTICE
       one specific question, deterministically matched, or an explicit no-match
  -> student attempts the repair question: NEW OBSERVATION
       the cycle repeats
```

## Why this distinction exists

Directly from the product philosophy ([02_PRODUCT_PHILOSOPHY.md](02_PRODUCT_PHILOSOPHY.md)): **observable behavior is not automatically proof of a psychological state.** A wrong answer is an observed fact. A pattern match against a question's designed trap is a deterministic, mechanical inference — still not proof of what the student actually thought. An AI-generated hypothesis is a *proposal*, subject to being wrong, and is explicitly labeled as such at every layer (schema, system prompt, and the type system itself — `AutopsyHypothesis.confirmationStatus` starts at `"awaiting_confirmation"` with no code path that skips it). Only the student's own explicit action can promote a hypothesis to something the system is willing to act on. Collapsing any two of these four layers into one would mean either overclaiming knowledge the system doesn't have, or underusing evidence it does have — both explicitly rejected.

## What the system must not fabricate, at any layer of this chain

- **Confidence** — no field represents how sure the system (or the student) is, except `modelConfidence`, explicitly the model's own confidence in a hypothesis, for ranking only (D-038).
- **Motivation, emotion, intelligence, anxiety, laziness (as a trait), carelessness (as a trait), or intent** — no field anywhere in `@ipmat/autopsy`, `@ipmat/attempt`, or `@ipmat/mastery` represents any of these. `careless_arithmetic` existing as an `ErrorTaxonomy` **code name** (a category label from seed data) is explicitly not an exception — the system only ever asserts "this attempt's evidence pattern-matches the `calculation_mistake` category coded `careless_arithmetic`," never "the student IS careless."
- **Predicted future ability** — nothing in this chain, or in mastery, produces a prediction. Only observed, past performance is measured.

## The trust boundary at the HYPOTHESIS layer, specifically (D-038, `docs/AI_ARCHITECTURE.md` §10a)

Three things distinguish this AI call's trust boundary from every other AI call in the codebase:

1. **Input is deterministic EVIDENCE, not raw data.** The model never sees `Attempt`/`AttemptEvent` rows directly — only what `buildAutopsyOutput()` already computed, explicitly labeled by kind ("observed fact" vs. "candidate, unconfirmed match" vs. "repetition count, not a diagnosis") in the prompt itself.
2. **The system prompt forbids inventing evidence and forbids psychological claims** — but this is a prompt instruction, not a structural guarantee. A test in `packages/domain/autopsy/test/hypothesis.test.ts` deliberately feeds a fixture response that DOES make a forbidden claim and confirms it is still schema-valid and still wrapped into an ordinary `awaiting_confirmation` hypothesis — the model ignoring an instruction is a real, accepted possibility this codebase does not claim to prevent at the prompt level.
3. **Confirmation, not model output quality, is what's actually trusted.** `generateHypothesis()` structurally cannot produce anything but `"awaiting_confirmation"`; `buildRepairPlan()` structurally refuses anything but `"confirmed"`. This is the actual enforcement mechanism — the prompt instructions in point 2 are a best-effort quality measure layered on top of it, never a substitute.

## What happens if the student never responds

The hypothesis simply stays `"awaiting_confirmation"` forever. No timeout auto-confirms it, no code path treats silence as agreement. This is a direct, deliberate consequence of D-006's structural gate.

## What happens if the student rejects, or corrects with free text

`rejectHypothesis()` — the chain ends there; no RepairPlan, no downstream effect on mastery or recommendation. `correctHypothesis()` — the student's own explanation is preserved as `studentCorrectionText`, distinct new evidence, but `buildRepairPlan()` explicitly refuses to accept a `"corrected"` hypothesis (D-039) — the free text has no structured category to target without another, unbuilt diagnosis pass. **This is a real, disclosed gap, not silently ignored**: a "corrected" hypothesis currently produces no actionable follow-up at all beyond being recorded.

See also: [23_AUTOPSY.md](23_AUTOPSY.md) for the exact type shapes at each layer, [24_REPAIR.md](24_REPAIR.md) for what happens after confirmation.
