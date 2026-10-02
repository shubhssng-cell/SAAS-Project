# 43 — Exam Intelligence, Coverage and Calibration (Phase 6 Prompt 5, D-086)

Package `@ipmat/exam-intelligence` (pure domain). Composes pack + concept graph + Question DNA + Question Universe + historical evidence into: coverage, queries, calibration status, selection bridge.

- **Coverage** = fraction of a named MAPPED universe with ≥1 qualifying item; explicit denominator/numerator per facet; no overall number; `no_universe` / `insufficient_data` instead of invented values; count ≠ breadth (distinct structures, concentration).
- **Bases** are separate: available ⊇ validated ⊇ published content; historical (reviewed, real-source, valid only). Fixtures, cross-exam, rejected, invalid and duplicate items are excluded AND counted with reasons.
- **Calibration**: provisional (default) → observed (enough descriptive aggregates) → calibrated (only via an explicit sufficient `CalibrationRecord`). Minimums are provisional. Nothing is calibrated today.
- **Selection bridge**: `selectQuestions` (monotone, traced, DNA-level facts) + `restrictCandidates` (intersect a provider's own candidates). Providers are unchanged.
- **Never**: read student/mastery/confidence, predict appearance, store coverage, expose answers/reviewer/provenance refs/student ids. No migration, no route.
