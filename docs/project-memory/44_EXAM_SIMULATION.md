# 44 — Exam Simulation (Phase 7 Unit 4, D-090)

Package `@ipmat/exam-simulation` (pure) + Prisma adapters in `@ipmat/db` + migration 0016.

- **No exam rule is encoded and none is shipped.** Duration, sections, question counts are DATA (`SimulationConfig`); with none supplied nothing starts. The repository specifies no IPMAT duration, sections, counts, marking/negative marking, navigation/review, pause or historical paper.
- **Mechanics:** server-authoritative time; exclusive deadline; expiry at the deadline on next access; submit/expiry race decided by server time; idempotent, terminal finalization; one in-progress simulation per enrollment; recoverable; append-only answer log; row-locked, race-safe.
- **Paper:** explicit editor selection, validated, never historical; content version (fingerprint) and provenance recorded; a question edited later is detected, never graded against a different version.
- **Result:** raw outcomes and timing; `scoring: { defined: false }`; no readiness. Downstream only via `toFinalizedSimulationEvidence()`.
- **Isolation:** not practice - writes nothing to attempts/training/repair/mastery; Units 1-3 reads identical before/during/after.
- **Not built:** route, UI, scoring, navigation/review rules, pause, historical/generated papers. See `docs/PHASE_7_UNIT_4_REVIEW.md` section 7.
