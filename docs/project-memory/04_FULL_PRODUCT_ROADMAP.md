# 04 — Full Product Roadmap (chronological)

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/MASTER_PLAN.md` "Build phases" (read in full), `docs/DECISIONS.md` (D-001 through D-062, read in full), and `git log` (28 commits, verified directly). This is the authoritative chronology — cross-check against [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for what's true *right now* versus what's true *as of when each phase finished*.

## Phase-by-phase history

| Phase | Name | Status | Key output | Decisions |
|---|---|---|---|---|
| 0 | Audit + Architecture | ✅ done | Product spec, architecture, database, AI architecture, question engine design docs, CLAUDE.md | D-001–D-004 |
| 1 | Scaffold + data foundation + calendar-awareness | ✅ done | Full Prisma schema, concept graph seed, `@ipmat/prep-phase` | D-009–D-013 |
| 2 | Concept Intelligence + Examiner Lens | ✅ done | `@ipmat/concept-graph` (12 concepts/16 edges/8 types), `@ipmat/examiner-lens`, `@ipmat/question-engine` foundations, finalized Question DNA | D-013–D-016 |
| 3 | AI provider + generation + validation (proof of concept) | ✅ done | `@ipmat/ai`, `@ipmat/validation`, single-blueprint generation pipeline | D-017–D-019 |
| 3.1 | AI Pipeline Hardening | ✅ done | Verifier view types, blueprint compliance expansion, generation limits/budget breaker | D-020–D-026 |
| 3.1.1 | Final Hardening from Code Review | ✅ done | Unpriced-model fail-closed, arithmetic grammar bounds, stem-leakage guard, concept-name normalization | D-027–D-033 |
| 3.5 | Percentages coverage expansion | ⏳ PARTIAL (3-part status) | 7 fixture-validated candidates, publication workflow infra, candidate-import infra | D-045, D-049, D-050 |
| 4A | Student Attempt Intelligence | ✅ done | `@ipmat/attempt` lifecycle state machine | D-034, D-035 |
| 4B-1 | Attempt Persistence Infrastructure | ✅ done | `PrismaAttemptRepository`, first multi-write transaction | D-046 |
| 4B-2 | Practice Loop Foundation | ✅ done (foundation only) | `@ipmat/practice-loop`, `QuestionReader` security fix | D-047, D-048 |
| 4B-3+ | Practice UI / HTTP API | ⛔ NOT STARTED | — | — |
| 5A | Question Autopsy Foundation | ✅ done | `@ipmat/autopsy` OBSERVATION→EVIDENCE | D-036, D-037 |
| 5B | Hypothesis + Confirmation + Mastery Engine | ✅ done | HYPOTHESIS→CONFIRMED DIAGNOSIS, `@ipmat/mastery` | D-038–D-042 |
| 5C-1 | Persistence Boundary | ✅ done | Autopsy/RepairPlan/MasteryState repositories | D-043 |
| 5C-2 | Diagnosis → Repair (Targeted) | ✅ done | `@ipmat/repair-selection` | D-044 |
| 5C-3 | Adaptive Selection (deterministic core) | ✅ done (core only) | `@ipmat/adaptive-selection` | D-051 |
| 5D | Training Orchestration Core | ✅ done (core only) | `@ipmat/training-orchestration` | D-052 |
| 5E-1 | Training Systems Core Contract | ✅ done | `@ipmat/training-systems` | D-053 |
| 5E-2 | Calculation Gym | ✅ done | First concrete provider | D-054 |
| 5E-3 | Speed Lab | ✅ done | Second concrete provider | D-055 |
| 5E-4 | Trap Lab | ✅ done | Third concrete provider | D-056 |
| 5E-PLAYGROUND | Training Lab Playground | ✅ done | `apps/training-playground` | D-057 |
| 5E-5 | Novelty Training | ✅ done | Fourth concrete provider | D-058 |
| 5E-6 | Pressure Training (original) | ⛔ deferred → SUPERSEDED | Deferral reasoning preserved | D-059 |
| 5F | Practice Session / Block Foundation | ✅ done | `@ipmat/practice-session`, `@ipmat/practice-block` | D-060 |
| 5G | Pressure Training + Orchestration Wiring | ✅ done | Fifth provider + all 5 wired into orchestration | D-061, D-062 |
| — | D-039 addendum: RepairPlan/Autopsy persistence fidelity | ✅ done (post-5G, this checkpoint) | Historical snapshot fields, `Autopsy.confirmedAt`, migration 0007 | D-039 (amended) |
| — | First vertical-slice student-facing UI (`apps/web`) | ⏳ built, uncommitted | Fixture-backed demo of the full student journey | (no D-number; explicitly a visual/product slice, not an architecture decision) |
| 6 | Calendar-aware prep phase UI | ⛔ not started | — | — |
| 7 | Vertical slice hardening | ⛔ not started | — | — |

## Git commit history (verified via `git log --oneline`, 28 commits, oldest first)

```
e1f5ca3  Add architecture and product docs for IPMAT vertical slice
38849a2  Reconcile docs: calendar-awareness and attempt/time model into Phase 1
a22238a  Implement Phase 1 foundation: schema, concept graph, prep-phase logic
86793b4  Phase 2: Concept Intelligence + Examiner Lens for Percentages
0298a2a  Phase 3: AI provider + question generation + validation (proof of concept)
2e50c18  Add PHASE_REVIEW.md: architect-level review of Phases 1-3
3d5fde9  Phase 3.1: AI pipeline hardening
9f3ccec  Add PHASE_3_1_CODE_REVIEW.md
9ae3571  feat: harden AI generation and validation pipeline
b7488d5  feat: implement student attempt lifecycle
176cb13  feat: add deterministic question autopsy foundation
448f5ef  feat: implement hypothesis, confirmation, repair plan, and mastery engine
cae769b  feat: add persistence boundary for Autopsy, RepairPlan, and MasteryState
cf108df  feat: add deterministic targeted repair-question selection (Phase 5C-2)
e6758f8  chore: add real-Anthropic smoke test coverage for the autopsy-hypothesis task
b963212  feat: expand Percentages taxonomy-cell coverage via fixture-validated pipeline runs (Phase 3.5)
94e8457  feat: implement attempt persistence infrastructure
18a4cd0  feat: implement practice loop foundation
b7ce7f2  feat: implement publication workflow and candidate import boundary
3e02109  feat: add deterministic global adaptive selection
2eab44b  feat: add adaptive training systems and internal playground
2652fe4  feat: add novelty training provider
f1388b2  docs: record D-059 -- defer Pressure Training pending session/block infrastructure
df9d3fb  feat: implement practice session block foundation
ac43590  D-061: implement Pressure Training
ebdecc5  D-062: wire training system providers into orchestration
56e0144  docs: sync Phase 5E-6/5G status -- Pressure Training no longer deferred (D-061, D-062)
db9c764  D-039 addendum: fix RepairPlan/Autopsy persistence fidelity   <- current HEAD
```

**Note:** several documented phases (Phase 3.5's later passes, the D-062 fix, `apps/web`) don't map to one commit each cleanly — some phases span multiple commits, and the `apps/web` vertical slice, as of this memory's creation, is **uncommitted working-tree state**, not reflected in this git log at all. See [92_CURRENT_STATE.md](92_CURRENT_STATE.md).

## The "What should be implemented FIRST" ordering, verbatim intent

`docs/MASTER_PLAN.md` states the completed order as: Phase 1 → 2 → 3 → 3.1 → 3.1.1 → 4A → 4B-1 → 4B-2 → 5A → 5B → 5C-1 → 5C-2 → 5C-3 (core) → 5D (core) → 5E-1 → 5E-2 → 5E-3 → 5E-4 → 5E-5 → 5F → 5G. Next in that stated order: (1) run the real-Anthropic smoke tests, (2) re-run Phase 3.5's candidates against a real model, (3) Phase 4B-3+ (practice UI/HTTP API, needs published questions + a reachable database), (4) Phase 5C-3's confirm/correct UI. **This project's actual most recent work diverged from that stated order** — the current session built the D-039 persistence-fidelity fix and a first-slice UI (`apps/web`) ahead of a reachable database or real AI validation, explicitly to let the product be *seen* rather than continue the backend-first sequence. See [92_CURRENT_STATE.md](92_CURRENT_STATE.md) for why and what that implies.

## Full chapter-two prerequisite (see [03_MVP_SCOPE.md](03_MVP_SCOPE.md))

Not started, and explicitly gated behind the go/no-go criteria — do not begin any second-chapter content work before that gate is met.
