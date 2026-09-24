# 33 — Trap Lab (`@ipmat/trap-lab`)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-056 (read in full). Third concrete `TrainingSystemProvider` (Phase 5E-4).

## Purpose

Candidate-level (never confirmed) "trap-associated failure recurrence" — explicitly NOT another Autopsy, NOT a second RepairPlan engine, NOT a confirmed diagnosis of anything.

## The core signal

Recurrence evaluated at the **error-taxonomy-code** level (the finest-grained represented error unit in the current data model), aggregated across the student's **entire attempt history regardless of concept** — `base_confusion` recurring across two different concepts still triggers (proven by a dedicated cross-concept test). Different codes never combine merely because they share a broader `ErrorCategory`.

`distinctFailingQuestionIds` (SET-derived) is the **only** hard gate, reusing `AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT` (2) directly — a single incorrect attempt, or the same question retried any number of times, can never trigger applicability. Taxonomy-cell/pattern-family diversity and hint-free "resistance" (correct attempts against the same code) are computed and surfaced but **never** gate applicability, cancel recurrence, or become a score.

## Cumulative, explicitly no recency/decay

Once a code reaches recurrence, later correct attempts never remove it. Disclosed directly in the applicability `notes`, deferred to a future Revision/Overtraining/Exposure-control system — never solved with an invented freshness/confidence number.

## No progression vocabulary — a deliberate absence

Unlike Calculation Gym/Speed Lab, no continuous, graduated DNA dimension exists for "trap intensity" to gate stage transitions on, so none was invented. A speculative exposure→discrimination→resistance vocabulary was considered and rejected as either unevidenceable or a re-encoding of the already-tracked resistance diagnostic.

## Optional `ErrorTaxonomy` enrichment never changes the decision

`context.errorTaxonomy` only ever changes diagnostic label/category text (or adds a `taxonomy_enrichment_missing:<code>` note) — never the applicability decision itself. Proven by a dedicated invariance test comparing omitted vs. empty vs. incomplete taxonomy lists against identical history.

## Epistemic language enforced by regression test, not just convention

Every Trap-Lab-produced `explanation`/`notes`/diagnostic string is regression-tested against confirmation-implying language ("confirmed"/"proven"/"diagnos"/"student's reasoning"), asserting instead the accepted "trap-associated"/"trap-tagged" phrasing. The mandated disclaimer sentence lives in doc-comment prose for developers, never in the runtime-facing strings the regression test scans.

## The lightest dependency footprint of any provider — two "firsts"

`@ipmat/training-systems` + `@ipmat/autopsy` **only** — notably **not** `@ipmat/mastery` (its recurrence gate is a discrete count, not a statistical-reliability floor). **Zero new provisional numeric constants introduced** — every threshold reused, none invented. Both are firsts among the five providers.

## Selection

Provider-local: filter by trap-code + optional concept match, published, structurally valid → prefer an unvisited taxonomy cell (anti-memorization: "repeat the trap, vary the surface") → least prior exposure → lexicographic questionId.

## Status

Wired into orchestration since D-062, and given **first** priority in the fixed order (`trap-lab > calculation-gym > speed-lab > pressure-training > novelty-training`).
