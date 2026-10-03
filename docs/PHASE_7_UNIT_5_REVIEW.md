# Phase 7 Unit 5 — Exam Simulation Intelligence + Readiness Evidence

Decision record: [DECISIONS.md D-091](DECISIONS.md). Code: `packages/domain/simulation-intelligence` (`@ipmat/simulation-intelligence`, pure), `packages/training-recommendation/src/examPerformanceIntelligence.ts` (read-only composer) and `PrismaFinalizedSimulationReader` in `@ipmat/db`. No migration, no table, no route, no UI.

## 1. Specification audit

**A. Explicitly specified:**
- **`docs/PRODUCT_SPEC.md` §3 "The five readiness distinctions"** (verbatim also in `project-memory/01_PROJECT_VISION.md`). The product "must be able to separately measure and report": syllabus completion ("has the student seen the material?"), concept mastery ("observed over attempts"), question-pattern coverage ("the known legitimate ways this concept is tested"), advanced readiness ("above-exam-difficulty, trap, and novel-presentation versions", not standard-difficulty accuracy) and four independent axes (speed, accuracy, novelty-handling, pressure performance). They are "stored as distinct, queryable facts per (student, concept), **not folded into one number**". This is the repository's entire definition of readiness: five separate observable facts, never one score.
- Unit 4's `toFinalizedSimulationEvidence()` contract: raw outcomes and timing of a FINALIZED simulation only; no score, readiness or interpretation.
- Unit 1 (evidence only), Unit 2 (existing signal semantics), Unit 3 (the orchestrator's own next action and fixed tier order, Revision outside it), Phase 6 (content availability and observed historical evidence, never prediction), D-005/D-006 (no confidence, no unconfirmed diagnosis), pressure read only from the `time_pressured` testing mode.

**B. Safe deterministic composition (implemented):** the five distinctions per concept as separate facts from separate sources; per-dimension aggregation across finalized simulations over dimensions that exist in the contracts; cross-simulation history only between identical-paper, identical-configuration simulations; objective observations; read-only bridges to Units 1–3.

**C. NOT specified (not invented — carried on every report as `unresolved`):**
- Any readiness threshold, category, score, percentage, probability, "ready / not ready" classification or verdict.
- Which difficulty tiers count as "above exam difficulty" (outcomes are reported for every tier).
- Whether a timed simulation counts as "pressure performance" (reported as `undefined`; pressure comes only from the question's `time_pressured` mode).
- What counts as having "seen" the material (practice attempts and simulation appearances are reported separately).
- Whether and how finalized simulation evidence feeds practice mastery evidence, revision signals, training systems or the curriculum.
- How simulations of different papers or configurations compare; the marking scheme (none, so no score exists to compare).
- Whether exam date or preparation phase changes anything; limits on the number of simulations or how many are needed for any statement.

## 2. What it is — and is not

**Readiness evidence**, organised exactly around the five distinctions, with every number a count of observed outcomes. It computes **no** readiness score, percentage, probability, category, verdict, pass/selection/admission likelihood, mastery score, confidence, ability, motivation or psychological inference, and the report states `readiness: { defined: false }` with the specification it follows. No table, migration, route or UI; nothing is stored.

## 3. Finalized simulation evidence (the boundary)

Only `finalized_simulation_evidence_v1` objects of status `submitted` or `expired` for this student and this exam are accepted (`assertFinalizedEvidence`); anything else is `not_finalized` or `scope_mismatch`. Three independent layers hold the boundary: the Prisma reader excludes in-progress simulations **in the query**; Unit 4's export function refuses a non-finalized state; and the pure layer re-checks at runtime. A repeated simulation id counts once. A simulation that ended by the deadline is finalized evidence (`endedByDeadline` is a fact, not a judgment).

## 4. The report

- **Per simulation:** id, configuration version, paper source, finalized time and by whom, allowed/elapsed seconds, totals, per-section counts and per-question outcome (correct / incorrect / unanswered / not graded) with answer-change count and seconds to first/last answer. No chosen answer and no answer key (the contract excludes them).
- **Dimensions across simulations:** section, concept, pattern family, novelty level, testing mode, difficulty tier and trap code — each bucket carries counts and the simulation and question ids it came from; questions without Question DNA (e.g. since unpublished) contribute only to the section dimension and are counted.
- **Question exposure** across simulations and repeated questions.
- **Cross-simulation history:** simulations are compared only within a group of the same exam, same configuration version and same ordered paper; each group of two or more yields factual series (answered, correct, incorrect, unanswered, not graded, elapsed seconds) with a plain difference and phrasing such as "correct: 1, then 3 (sim-a, then sim-b)" — never "improved" or "stronger". Everything else is listed as not compared.
- **Observations** (exact facts, each with its simulations, questions and any matching Unit 2 signal): trap errors in simulations (reusing the existing repeat minimum to say whether the existing recurrence minimum is met), a question unanswered in several simulations, a simulation ended by the deadline, sections with unanswered questions, and pattern families the published pool offers but no simulation contained.
- **Five distinctions per concept:** see §1A; practice and simulation are separate sources and merged into nothing; Phase 6 content availability and reviewed-historical-record counts are separate again.

## 5. Bridges (read-only)

- **Unit 1:** simulation outcomes sit beside practice evidence; `rewritesMasteryEvidence: false`.
- **Unit 2:** observations that share a subject with an existing practice-derived signal are linked transparently; `revisionIntelligenceUnchanged: true`.
- **Unit 3:** the existing curriculum's next action is shown verbatim; `reorderingApplied: false`, `priorityDefined: false`; everything simulations add is listed as **unserved** because existing training systems read practice attempts only; the one observation an existing system (Trap Lab) could in principle serve is named, and the missing decisions are listed.
- Nothing is written to practice attempts, mastery, revision, repair or curriculum, and real-Postgres tests prove Units 1–3 and the recommendation are byte-identical with and without finalized simulations.

## 6. Security and isolation

Enrollment ownership is verified first; the reader is scoped by the verified student id and the exam code, and a hostile reader returning another student's or another exam's simulation is refused (`scope_mismatch`). The report carries no answer key, chosen answer, question text, other student's id or enrollment id (JSON checked, with sentinel solution text). No route or UI exists; a future one must return only intentionally public fields and repeat the leakage checks.

## 7. Unresolved product decisions

See §1C. In addition: whether a future readiness definition should use the per-concept five facts, a per-simulation view, or something else; how many finalized simulations make any statement meaningful; and whether the report belongs in a student-facing surface at all (and in what words, given the no-judgment rules).

## 8. Limitations

No route or UI. Question DNA is read from the *currently published* pool, so a simulated question that has since been unpublished has no DNA dimension. The comparability rule (same configuration version and identical ordered paper) is deliberately strict and provisional. No scoring means no simulation can be ranked or normalised. Pressure Training stays insufficient-evidence in the composition (inherited). Historical-record counts are zero until real historical data exists (none does).

## 9. Tests

Pure layer: 404 tests (finalized-only boundary, performance view, dimensions, cross-simulation comparison and its refusals, observations, the five distinctions, bridges leave Units 1–3 unchanged, readiness-boundary vocabulary and key checks, 60-seed property suites for determinism, permutation invariance, isolation, finalized-only filtering and monotonic addition, source-level boundary). Composer over persisted attempts and real Unit 4 finalized simulations: 12 tests. Real Postgres: 8 tests (finalized-only reader, composition of real finalized simulations with real Units 1–3, Units 1–3 byte-identical, read-only and reproducible, student/enrollment/exam isolation, real Phase 6 source, leakage, migration unchanged).
