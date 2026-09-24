# 90 — Architectural Decisions Index

> Part of the [project memory](00_MASTER_CONTEXT.md). Full source: `docs/DECISIONS.md` (720 lines, read in full for this reconstruction — every entry below was verified against the actual document, not summarized from memory). This index exists for quick lookup; **the full text in `docs/DECISIONS.md` remains authoritative** — read it directly for exact wording before citing a decision in an implementation.

| ID | Title | Status | Affected package(s) | Major consequence |
|---|---|---|---|---|
| D-001 | Modular monolith over microservices | Accepted | (architecture-wide) | Boundaries enforced in code, extraction possible later |
| D-002 | TypeScript + Next.js + Postgres + Prisma + Redis/BullMQ | Accepted | (stack-wide) | See [10_SYSTEM_ARCHITECTURE.md](10_SYSTEM_ARCHITECTURE.md) for the actual-vs-planned divergence (`apps/web` is Vite, not Next.js) |
| D-003 | All AI outputs schema-validated via one provider abstraction | Accepted | `@ipmat/ai` | Stronger correctness guarantee, cheap provider swaps |
| D-004 | Auth provider: open | **Open** | — | Must decide before any real external student |
| D-005 | No confidence score, ever | Accepted, product-level | all | See [02_PRODUCT_PHILOSOPHY.md](02_PRODUCT_PHILOSOPHY.md) |
| D-006 | Autopsy output is a hypothesis, structurally | Accepted | `@ipmat/autopsy` | See [23_AUTOPSY.md](23_AUTOPSY.md) |
| D-007 | Question Universe claims coverage, not completeness | Accepted | `@ipmat/question-engine` | `findCompletenessClaims()` guard |
| D-008 | Human review gate on Lens / extreme-novel tiers | Accepted, revisit after Phase 7 | `@ipmat/question-engine` | Auto-publish only for Standard/Advanced |
| D-009 | Calendar-aware prep-phase moves to Phase 1 | Accepted (supersedes original plan) | `@ipmat/prep-phase` | Phase 6 becomes UI-only |
| D-010 | Attempt timing is event-sourced | Accepted | `@ipmat/attempt` | New timing signal = new event_type, never new column |
| D-011 | `reasoning_text` distinct from `working_steps` | Accepted | schema | Voice input shaped, not built |
| D-012 | `ErrorTaxonomy` is a real table, FK referenced | Accepted | schema | New error code = seed change, not code change |
| D-013 | 8 concept-relationship types; shared error vocabulary | Accepted | `@ipmat/concept-graph`, `@ipmat/examiner-lens` | `strength` field removed (never had data) |
| D-014 | Pattern family vs. taxonomy cell, two levels | Accepted | `@ipmat/question-engine` | One extra join, real coverage-space expressiveness |
| D-015 | Lens combinations always derived, never stored | Accepted | `@ipmat/examiner-lens` | The seed of the whole "derive, never cache" discipline |
| D-016 | Question DNA finalized (`testingModes`/`noveltyLevel`/etc.) | Accepted | schema | Second, deliberate schema change to `Question` |
| D-017 | `@ipmat/ai` zero dependency on domain packages | Accepted | `@ipmat/ai` | See [14_DOMAIN_BOUNDARIES.md](14_DOMAIN_BOUNDARIES.md) |
| D-018 | Arithmetic allowlist before `mathjs.evaluate()` | Accepted | `@ipmat/validation` | Superseded/narrowed by D-028 |
| D-019 | Token-overlap dedup, interim | Accepted, revisit | `@ipmat/validation` | Real gap disclosed, not hidden |
| D-020 | Independent verifiers get a narrow, allowlisted view | Accepted | `@ipmat/question-engine` | Leakage prevented by type system, not discipline |
| D-021 | Difficulty dimensions marked provisional | Accepted | `@ipmat/question-engine` | Never presented as calibrated |
| D-022 | Blueprint compliance covers every drift-able field | Accepted | `@ipmat/validation` | 7 fields checked, not 3 |
| D-023 | Lens comparison: 4 combination categories, not 2 | Accepted | `@ipmat/question-engine` | Fixed a type-blind bug |
| D-024 | Fail closed on unparseable `correctAnswer` | Accepted | `@ipmat/validation` | No silent skip |
| D-025 | `GenerationLimits` validated before any AI call | Accepted | `@ipmat/question-engine` | Budget breaker exists before any batch generator |
| D-026 | `generateStructured` schema type bug fix | Accepted (bug fix) | `@ipmat/ai` | Found before any real API call |
| D-027 | Fail closed on unpriced model | Accepted | `@ipmat/ai`, `@ipmat/question-engine` | Closes a real budget-breaker-disabling gap |
| D-028 | Arithmetic grammar narrowed further, bounds added | Accepted (supersedes D-018) | `@ipmat/validation` | Comma removed, 4 new bounds |
| D-029 | Stem answer-leakage guard, narrow by design | Accepted | `@ipmat/validation` | Not semantic leakage detection |
| D-030 | Concept-name matching normalized, never fuzzy | Accepted | `@ipmat/concept-graph` | Closes a real false-positive gap |
| D-031 | AnthropicProvider output cap + budget coupling documented | Accepted | `@ipmat/ai`, `@ipmat/question-engine` | Single-call worst case bounded, tested |
| D-032 | Generation prompt lists every enforced field | Accepted | `@ipmat/question-engine` | No behavior change, expected fewer rejections |
| D-033 | `distractor_quality` kept, given real test coverage | Accepted | `@ipmat/validation` | Dead-looking code proven real |
| D-034 | Attempt lifecycle: forgery-immune correctness/timing | Accepted | `@ipmat/attempt` | See [50_ATTEMPTS.md](50_ATTEMPTS.md) |
| D-035 | Skip is terminal; evidence contracts derived, never stored | Accepted | `@ipmat/attempt` | See [50_ATTEMPTS.md](50_ATTEMPTS.md) |
| D-036 | `@ipmat/autopsy`: OBSERVATION -> EVIDENCE only | Accepted | `@ipmat/autopsy` | See [23_AUTOPSY.md](23_AUTOPSY.md) |
| D-037 | `RepairContext` gets a builder; Hypothesis (then) doesn't | Accepted, later updated by D-038 | `@ipmat/autopsy` | Asymmetry explained, then resolved |
| D-038 | Hypothesis generation is 5th AI task; confirmation is one function | Accepted | `@ipmat/autopsy` | See [22](22_OBSERVATION_EVIDENCE_HYPOTHESIS.md) |
| D-039 | RepairPlan requires CONFIRMED hypothesis; **+ addendum this session** | Accepted (amended) | `@ipmat/autopsy`, `@ipmat/db` | See [23](23_AUTOPSY.md)/[24](24_REPAIR.md) — persistence fidelity fixed, migration 0007 |
| D-040 | Mastery reuses `AutopsyQuestionContext`; 1 additive migration | Accepted | `@ipmat/mastery` | See [25_MASTERY.md](25_MASTERY.md) |
| D-041 | Centralized observation-count gate, no composite score | Accepted | `@ipmat/mastery` | `MIN_OBSERVATIONS_FOR_COMPONENT` |
| D-042 | MasteryState writes nothing when any measure insufficient | Accepted (superseded in part by D-043) | `@ipmat/mastery` | Row-level gap later refined |
| D-043 | Nullable `Float?` columns; repository layer in `@ipmat/db` | Accepted | `@ipmat/db` | The persistence-pattern template for everything after |
| D-044 | Repair Selection: deterministic tiers, not AI-chosen | Accepted | `@ipmat/repair-selection` | See [24_REPAIR.md](24_REPAIR.md) |
| D-045 | Phase 3.5 coverage expansion via `FixtureProvider` | Accepted | `@ipmat/question-engine` | 0 published, honestly |
| D-046 | AttemptRepository: first multi-write transaction | Accepted | `@ipmat/db` | See [50_ATTEMPTS.md](50_ATTEMPTS.md) |
| D-047 | Practice-loop is a top-level package, not domain | Accepted | `@ipmat/practice-loop` | See [11_PACKAGE_ARCHITECTURE.md](11_PACKAGE_ARCHITECTURE.md) |
| D-048 | `QuestionReader` resolves answer key server-side | Accepted (security fix) | `@ipmat/practice-loop`, `@ipmat/db` | See [54_SECURITY_AND_OWNERSHIP.md](54_SECURITY_AND_OWNERSHIP.md) |
| D-049 | `decidePublication()` + narrow publication repository | Accepted | `@ipmat/question-engine`, `@ipmat/db` | See [46_PUBLICATION_WORKFLOW.md](46_PUBLICATION_WORKFLOW.md) |
| D-050 | Candidate -> Question import boundary | Accepted | `@ipmat/question-engine`, `@ipmat/db` | See [46_PUBLICATION_WORKFLOW.md](46_PUBLICATION_WORKFLOW.md) |
| D-051 | Adaptive Selection: 10 named reason codes, never a score | Accepted | `@ipmat/adaptive-selection` | See [26_ADAPTIVE_SELECTION.md](26_ADAPTIVE_SELECTION.md) |
| D-052 | Training Orchestration coordinates, never merges | Accepted | `@ipmat/training-orchestration` | See [36_TRAINING_ORCHESTRATION.md](36_TRAINING_ORCHESTRATION.md) |
| D-053 | Training Systems shared contract, no ranking utility | Accepted | `@ipmat/training-systems` | See [30_TRAINING_SYSTEMS.md](30_TRAINING_SYSTEMS.md) |
| D-054 | Calculation Gym: 1st concrete provider | Accepted | `@ipmat/calculation-gym` | See [31_CALCULATION_GYM.md](31_CALCULATION_GYM.md) |
| D-055 | Speed Lab: 2nd concrete provider | Accepted | `@ipmat/speed-lab` | See [32_SPEED_LAB.md](32_SPEED_LAB.md) |
| D-056 | Trap Lab: 3rd concrete provider | Accepted | `@ipmat/trap-lab` | See [33_TRAP_LAB.md](33_TRAP_LAB.md) |
| D-057 | Training Lab Playground, internal tool only | Accepted | `apps/training-playground` | See [60_STUDENT_UX.md](60_STUDENT_UX.md) |
| D-058 | Novelty Training: 4th concrete provider, exposure-first | Accepted | `@ipmat/novelty-training` | See [34_NOVELTY_TRAINING.md](34_NOVELTY_TRAINING.md) |
| D-059 | Pressure Training originally deferred | Accepted (superseded) | — | See [35_PRESSURE_TRAINING.md](35_PRESSURE_TRAINING.md) |
| D-060 | Practice Session/Block Foundation | Accepted | `@ipmat/practice-session`, `@ipmat/practice-block` | See [51](51_PRACTICE_SESSIONS.md)/[52](52_PRACTICE_BLOCKS.md) |
| D-061 | Pressure Training: 5th concrete provider | Accepted | `@ipmat/pressure-training` | See [35_PRESSURE_TRAINING.md](35_PRESSURE_TRAINING.md) |
| D-062 | All 5 providers wired into orchestration | Accepted | `@ipmat/training-orchestration` | See [36_TRAINING_ORCHESTRATION.md](36_TRAINING_ORCHESTRATION.md) |
| — | D-039 addendum: RepairPlan/Autopsy persistence fidelity | Accepted (this session) | `@ipmat/autopsy`, `@ipmat/db` | Migration 0007, see [23](23_AUTOPSY.md)/[24](24_REPAIR.md)/[92](92_CURRENT_STATE.md) |

## Decisions genuinely still open (not resolved anywhere in the repository)

- **D-004** (auth provider) — see [71_AUTHENTICATION.md](71_AUTHENTICATION.md).
- Whether to persist freshly-computed mastery as a side effect of the future Training Recommendation Composition layer — see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md) §13.
- The final package name for the Training Recommendation Composition layer.

## No new D-number was created for the two most recent design/implementation passes in this session

The Training Recommendation Composition design (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md)) and this project-memory system itself were both explicitly scoped as documentation/design-only work, with explicit instructions not to create a new decision number — recorded here as memory files instead, exactly per this session's own instructions.
