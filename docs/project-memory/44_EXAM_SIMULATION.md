# 44 — Exam Simulation (Phase 7 Unit 4, D-090)

Package `@ipmat/exam-simulation` (pure) + Prisma adapters in `@ipmat/db` + migration 0016.

- **No exam rule is encoded and none is shipped.** Duration, sections, question counts are DATA (`SimulationConfig`); with none supplied nothing starts. The repository specifies no IPMAT duration, sections, counts, marking/negative marking, navigation/review, pause or historical paper.
- **Mechanics:** server-authoritative time; exclusive deadline; expiry at the deadline on next access; submit/expiry race decided by server time; idempotent, terminal finalization; one in-progress simulation per enrollment; recoverable; append-only answer log; row-locked, race-safe.
- **Paper:** explicit editor selection, validated, never historical; content version (fingerprint) and provenance recorded; a question edited later is detected, never graded against a different version.
- **Result:** raw outcomes and timing; `scoring: { defined: false }`; no readiness. Downstream only via `toFinalizedSimulationEvidence()`.
- **Isolation:** not practice - writes nothing to attempts/training/repair/mastery; Units 1-3 reads identical before/during/after.
- **Not built:** route, UI, scoring, navigation/review rules, pause, historical/generated papers. See `docs/PHASE_7_UNIT_4_REVIEW.md` section 7.

## Phase 7 Unit 5 - simulation intelligence + readiness evidence (D-091)

`@ipmat/simulation-intelligence` reads ONLY finalized simulation evidence (`toFinalizedSimulationEvidence`) beside Units 1-3 and optional Phase 6 content evidence and reports PRODUCT_SPEC section 3's five readiness distinctions per concept as separate facts (practice, simulation and content sources never merged). Comparison only between identical-paper, identical-configuration simulations, phrased factually. Bridges to Units 1-3 are read-only: nothing rewritten, reordered or fed; simulation observations are listed as unserved because existing systems read practice attempts only. `readiness: { defined: false }`: no score, percentage, probability, category or verdict. Derived on read; no migration, route or UI. Detail: `docs/PHASE_7_UNIT_5_REVIEW.md`.
