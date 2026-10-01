# Phase 5 Unit 4 — Trap Lab: review

Decision record: [D-078](DECISIONS.md). Roadmap: [product-roadmap/PHASE_5_TRAINING_SYSTEMS.md](product-roadmap/PHASE_5_TRAINING_SYSTEMS.md). Provider design: [D-056](DECISIONS.md), [project-memory/33_TRAP_LAB.md](project-memory/33_TRAP_LAB.md).

## What this unit is

Trap Lab is the third training system made genuinely student-facing inside the Unit 1–3 session framework. **`@ipmat/trap-lab` was not changed** — its applicability, target selection and candidate selection are authoritative exactly as designed in D-056. No Calculation/Speed code was copied, and **Trap Lab has no stages**.

## What was reused (unchanged)

The whole generic framework: session creation / configuration / lifecycle / persistence / ownership / concurrency; the one attempt lifecycle (server-authoritative timing, events, result, evidence); the observable session summary; the Training Hub, session, result and error screens. `apps/api` and `apps/web` gained nothing for this unit; `@ipmat/practice-api`'s service gained only a tiny note-selection helper (below).

## What was added

- **Catalog data** (`@ipmat/training-session`): Trap Lab's session title, goal sentence, focus sentence and student-safe copy, with **no `stages`**. Three small OPTIONAL catalog hooks, used only by Trap Lab: `notApplicableByReason` (the provider's own not-applicable reason picks an authored sentence; the code itself is never shown), `noEligibleNote`, `focusSentence` (appended to the objective when the provider names no target concept).
- A note-selection helper in `TrainingApiService` that applies those hooks (Calculation and Speed unchanged).
- Tests: provider preservation (7, no source change), catalog tests, 21 session-level Trap Lab tests over the real provider, 7 real-Postgres tests; browser QA.
- Docs and D-078.

## Reconciling the brief against the source

The source was authoritative on every point, and matches D-056:

- **Recurrence** is per error-taxonomy CODE across ALL concepts; the only hard gate is `AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT` (2) DISTINCT failing question ids (set-derived: a question retried five times counts once). Submitted + graded + incorrect attempts with a trap code only; correct, skipped and abandoned attempts never count toward recurrence; correct attempts never cancel it; no recency/decay. Different codes never combine, even within one `ErrorCategory`. Cell/family/concept diversity and hint-free/hint-assisted resistance are diagnostic notes only.
- **Applicability:** `insufficient_evidence` (no incorrect trap-tagged attempt at all), `no_recurring_trap_detected` (evidence exists, no code reaches the gate), applicable (target = largest distinct-failure count, then code order). `no_eligible_question` is a select-time outcome; `error` is only for an impossible requirement.
- **Concept:** `evaluate()` never populates `targetConceptName` (a code recurring across two concepts is one pattern); `select()` honors one only if supplied. The brief's phrasing could be read as making concept part of the requirement — it is not, and was not made so.
- **Selection** (provider-local): published + structurally valid (questionId, concept, taxonomy cell, numeric expected time) + the target code (+ concept only if supplied); then prefer a candidate whose taxonomy cell has NOT been attempted against this code (a boolean partition), then least prior exposure, then question id. No score, no randomness.
- **No stages:** no honest graduated DNA dimension exists for "trap intensity"; the earlier exposure → discrimination → resistance idea was rejected as unevidenceable.

## Student-facing behavior and language

- **Hub:** "Traps" card — "Practice a recurring trap pattern: the same kind of trap, in different question formats." Not startable with the reason-specific explanation: *"Needs recorded incorrect answers on questions that share a trap pattern first."* (nothing recorded) or *"Your recorded practice doesn't show the same trap pattern across several different questions yet."* (evidence below the recurrence rule, including a single question failed repeatedly).
- **Session:** titled "Trap Lab"; objective "Practice a recurring trap pattern: … This session focuses on a trap pattern that has appeared across your practice."; "Question N of M" and the timer; **no stage line, no stage progress, no next-stage notice**.
- **Result:** the ordinary result first, then a context line ("Trap Lab · N of M questions done").
- **When nothing is left:** "No further question fits right now. … You can end the session." (the pool for the trap is exhausted inside the session), then a completion screen with observable counts, time vs expected and the record-of-this-session note — no stage row.
- **Never shown:** the trap code, taxonomy-cell ids, recurrence counts, thresholds, resistance, `ErrorCategory`, provider diagnostics, any score; never "diagnosed", "prone", "always", "bad at", "lack", or a claim about why the student answered as they did.

## Consequences of the provider's semantics (unchanged, worth knowing)

- Start-level `no_eligible_question` is effectively unreachable: the questions that caused the recurrence are themselves published, trap-tagged candidates (an unpublished evidence question also drops out of the evidence). The honest "nothing left" state happens inside a session (`no_question`) once every qualifying question has been used.
- Because recurrence is cumulative, correct answers never end applicability: a session ends by its chosen length, the pool running out, or the student.
- Repeating the trap while varying the surface is visible: in the real-database and browser runs the four unseen-surface questions (including the cross-concept ones) were served first, the already-seen surfaces after, with no repeat.

## Verification (see the roadmap file for exact counts)

Unit/application tests over the real provider; real Postgres through the real HTTP server and Prisma repositories with two instances (six not-applicable variants incl. same-question-retried and two-codes, recurring trap incl. cross-concept, no stage anywhere, surface variation then exhaustion, code tie-break and largest-count, unpublished exclusion, ownership, 12-way start and 10-way next concurrency, ordinary evidence and no autopsy/repair/mastery rows, leakage of code/cell ids); real browser against a throwaway database (29 checks incl. API restart, reload, no-stage, variation order, no-eligible state, API-down error and loading states). **Synthetic data:** labelled "[TEST DATA phase-5-unit-4]" clones of the seeded demonstration question carrying seeded error-taxonomy codes, pattern-taxonomy cells and concepts (plus the seeded provenance row), published only in throwaway databases that were dropped; the seeded real questions are withheld from the pool inside those databases only and verified restored/unchanged. The shared test database is never touched; port 5432 is untouched.

## What remains unverified / not claimed

- Calibration: the recurrence threshold is the autopsy package's provisional constant; nothing shows Trap Lab helps anyone avoid a trap. A session is evidence, not proof.
- No real student has used it; the seed content cannot activate it; trap tagging depends on authored `trapErrorTaxonomyCode` DNA, and a question without a code is invisible to the provider.
- No live model is involved anywhere in Trap Lab; no confirmed diagnosis, RepairPlan or confidence is consumed.

## Next

Novelty Training (student-facing) — **not started.**
