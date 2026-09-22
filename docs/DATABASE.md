# Database / Domain Model

PostgreSQL, accessed via Prisma. This is the target schema for the vertical slice — fields that clearly generalize to future exams/chapters are included now (as data, not code) so the first migration isn't a rewrite; fields that are speculative for features not yet in scope are left out.

## Design rules

- **Exam structure is data.** `Exam`, `Section`, `Chapter` are rows, not enums — so adding CAT later is a seed script, not a code change.
- **The concept graph is a real graph, with 8 distinct edge types.** `Concept` nodes + typed `ConceptRelation` edges — `prerequisite`, `foundational`, `directly_related`, `commonly_combined`, `application`, `dependent`, `advanced_extension`, `related_but_distinct` — never flattened into one "related" bucket. See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §1 and [DECISIONS.md](DECISIONS.md) D-013.
- **Examiner Lens combinations are always derived, never stored.** `ExaminerLensAnalysis` has no "combinations" column — the "what can this combine with" answer comes from querying `ConceptRelation` live (via `deriveCombinations()`), so it can never drift from the graph it's supposed to reflect. Same discipline as mastery/coverage below.
- **A pattern family describes a question's structure; a taxonomy cell is one concrete point in that structure's space.** `QuestionPatternFamily` (e.g. "Reverse Percentage") is authored once; `PatternTaxonomyCell` rows are the specific (combination × testing mode × trap × difficulty) slices coverage is tracked against.
- **Error taxonomy is one shared vocabulary, not two.** `ErrorTaxonomy.category` uses the same 5-value "what can go wrong" vocabulary Examiner Lens error modes use (misconception, trap, calculation_mistake, interpretation_mistake, method_selection_mistake) — Autopsy diagnosis and Lens-authored traps both key off the same table. See [DECISIONS.md](DECISIONS.md) D-013.
- **Question DNA is enforced, not conventional.** A `Question` cannot be marked `published` without every DNA field populated and a `Provenance` record. Frequently-queried fields (`novelty_level`, `exam_relevance`, `testing_modes`, `trap_error_taxonomy_id`) are normalized columns, not buried inside a JSON blob.
- **Coverage is a computed ladder, never a stored status.** A pattern family's readiness (`mapped` → `has_questions` → `validated` → `practice_ready`) is computed from real `PatternTaxonomyCell`/`Question` rows every time it's asked for — there is no column that could drift out of sync with reality. Same discipline as `MasteryState`.
- **Mastery is derived, never input.** `MasteryState` rows are written only by the mastery-computation job reading `Attempt` history — there is no UI or API path that lets anything set mastery directly.
- **Autopsy output is a hypothesis until confirmed.** The `Autopsy` table's diagnosis fields are only trusted downstream after `confirmed = true`.
- **Error taxonomy is data, not a free-form string.** `Autopsy` references `ErrorTaxonomy` by foreign key, the same way `Provenance.source_type` and exam structure are data-backed rather than hard-coded — the taxonomy can grow without a code change, and downstream repair logic can key off a stable id instead of matching strings.
- **`AttemptEvent` is the source of truth for time and interaction history; `Attempt` only carries denormalized convenience fields.** Timing signals (hint timing, retry timing, time-between-actions) must never require a new column on `Attempt` — they're a new `event_type` on the existing event table.
- **Prep phase and mastery are separate tables with no FK dependency on each other's state**, only on the shared `Student`/`Enrollment`.
- **Calendar-awareness is a Phase 1 entity, not a Phase 6 one.** `Student`, `Enrollment`, `PrepPhaseTemplate`, and `CatchUpPlan` exist from the foundation because prep-phase computation is core product logic, not a UI feature — only the phase *UI* is deferred. See [MASTER_PLAN.md](MASTER_PLAN.md) Phase 1.

## Core entities

### Exam catalog
```
Exam            id, name, code (e.g. "IPMAT_INDORE"), exam_date_rule (data describing how the exam date is determined per cycle)
Section         id, exam_id, name (e.g. "Quant"), order
Chapter         id, section_id, name (e.g. "Percentages"), order
```

### Concept Universe
```
Concept
  id, chapter_id, name, description
  status: draft | curated | ai_assisted | published

ConceptRelation
  id, from_concept_id, to_concept_id
  type: prerequisite | foundational | directly_related | commonly_combined
        | application | dependent | advanced_extension | related_but_distinct
  rationale: text                          -- WHY this relationship exists — never a bare label
  shared_knowledge: text                   -- WHAT knowledge/mechanic is actually shared
  useful_for_question_generation: boolean  -- combinable, or purely a teaching/confusion-risk flag?
  requirement_level: required | optional | contextual
  certainty: confirmed | probable | speculative   -- never assert confidence we don't have
  source: human | ai_suggested
```
See [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §1 for what each of the 8 `type` values specifically means and how they differ — they are not interchangeable synonyms for "related."

### Concept Depth
```
ConceptDepth
  id, concept_id (unique — one depth record per concept)
  definition: text, intuition: text
  formulas: jsonb[]              -- { label, expression, whenToUse }
  methods: jsonb[]                -- { name, steps[], bestFor }
  alternative_methods: jsonb[]    -- same shape as methods
  shortcuts: jsonb[]              -- { name, description, validWhen }
  common_misconceptions: jsonb[]  -- { description, errorTaxonomyCode }
  common_traps: jsonb[]           -- { description, errorTaxonomyCode }
  application_areas: jsonb[]      -- { name, description }
  difficulty_progression: jsonb[] -- { tier, description }
  status: draft | curated | ai_assisted | published
```
Structured into typed sections rather than one text blob (docs/QUESTION_ENGINE.md §1a) so e.g. just the shortcuts can be queried or rendered independently. Not every concept has a `ConceptDepth` row yet — Phase 2 populated it in full for Percentages and lightly for Ratio to prove the shape generalizes; the rest is future curriculum-authoring work, not an architecture gap.

### Examiner Lens
```
ExaminerLensAnalysis
  id, concept_id
  version                              -- analyses are versioned; regenerating doesn't overwrite history
  what_is_tested_concept: text
  what_is_tested_subconcept: text
  what_is_tested_skill: text
  what_is_tested_prerequisite_id: concept_id | null
  testing_modes: TestingMode[]         -- controlled 10-value vocabulary, see QUESTION_ENGINE.md §2
  error_modes: jsonb                   -- { category, errorTaxonomyCode, description }[]
  difficulty_dimensions: jsonb         -- { conceptualLoad, computationalLoad, trapDensity, representationNovelty, timePressure, multiStepDepth }, each 0-1
  authored_by: human | ai              -- distinct from status: who produced it, not its review state
  generated_by: ai_provider_ref | null, prompt_version | null   -- only set when authored_by = ai
  reviewed_by: user_id | null          -- human sign-off, nullable until reviewed
  status: draft | reviewed | published
```
No "combinations" column — see the design rules above. `TestingMode` is the exact 10-value vocabulary from [QUESTION_ENGINE.md](QUESTION_ENGINE.md) §2: `direct, reverse, transformed, combined, contextualized, represented_differently, constrained, time_pressured, multi_step, novel_representation`.

### Question Universe (pattern families + taxonomy)
```
QuestionPatternFamily
  id, concept_id, examiner_lens_analysis_id (nullable)
  name (e.g. "Reverse Percentage"), skill, description
  expected_difficulty_tier: standard | advanced | hard | extreme | novel
  potential_combination_concept_ids: concept_id[]
  potential_trap_error_taxonomy_ids: error_taxonomy_id[]
  potential_testing_modes: TestingMode[]
  status: draft | reviewed | published

PatternTaxonomyCell
  id, concept_id, examiner_lens_analysis_id, pattern_family_id
  combination: concept_id[], testing_mode: TestingMode | null
  trap_error_taxonomy_id: error_taxonomy_id | null
  difficulty_tier, target_time_seconds
  coverage_status: uncovered | in_generation | covered
```
A pattern family describes the *structure* of a question (docs/QUESTION_ENGINE.md §3) — one family can generate many valid questions. A taxonomy cell is one concrete, narrow slice of that family's space, and is the unit `coverage_status` and coverage-ladder computation (below) are tracked against. The product claims coverage of *this table*, never of "all possible questions."

### Pattern coverage (computed, not stored)
Given a family's `PatternTaxonomyCell` rows and the `Question` rows referencing them, a family's readiness is always one of: **mapped** (documented, nothing else yet) → **has_questions** (a draft exists) → **validated** (at least one `ai_validated`/`human_reviewed`/`published` question) → **practice_ready** (at least one `published` question). This ladder is computed on read (`computePatternFamilyReadiness` in `@ipmat/question-engine`), never a stored column — the same "derived, never input" discipline as `MasteryState`. This is what will eventually support "student has mastered 18/27 mapped pattern families": the mapped-family count comes from this table today; the mastered-count numerator needs student attempt data (Phase 5), not built yet.

### Question + Question DNA (finalized — docs/QUESTION_ENGINE.md §4)
```
Question
  id
  exam_id, section_id, chapter_id, concept_id
  subconcepts: concept_id[]
  prerequisites: concept_id[]
  combines_with_concept_ids: concept_id[]   -- concepts this SPECIFIC question actually combines (vs. a family's "potential" list)
  pattern_taxonomy_cell_id            -- traces every question back to the universe cell it was generated for
  skill: text
  difficulty_tier: standard | advanced | hard | extreme | novel
  difficulty_dimensions: jsonb        -- { conceptualLoad, computationalLoad, trapDensity, representationNovelty, timePressure, multiStepDepth }
  novelty_level: standard | novel_representation | novel_combination | novel_context   -- normalized column: filters novelty-handling practice/mastery
  exam_relevance: core | peripheral | stretch   -- how typical this pattern is of the real exam vs. enrichment
  expected_time_seconds: int
  testing_modes: TestingMode[]        -- which of the 10 legitimate testing modes this question exercises (can be more than one)
  trap_error_taxonomy_id: error_taxonomy_id | null   -- FK, not a free-form string (docs/DECISIONS.md D-012, D-013)
  body: text, options: jsonb, correct_answer: text, solution_steps: jsonb
  ground_truth_derivation: jsonb      -- the generator's own worked computation, used by the validator to check the stated answer independently of the LLM's claimed answer
  validation_state: draft | ai_validated | human_reviewed | published | rejected
  provenance_id                       -- FK, required to be non-null before validation_state can be 'published'

Provenance
  id, source_type: original | licensed | public_domain | open_license | official | user_authorized
  source_ref, license_ref, attributed_to
```
`novelty_level` and `exam_relevance` are separate, normalized fields rather than folded into `difficulty_dimensions` — both are filtered on frequently (novelty-handling practice selection, "is this actually IPMAT-style" filtering), so they get their own indexed columns instead of living inside a JSON blob (docs/DATABASE.md design rules, "normalize fields that will be queried frequently").

### Student & Enrollment (Phase 1 foundation)
```
Student            id, auth_ref, created_at
Enrollment         id, student_id, exam_id, enrolled_at
```
These two tables exist from Phase 1 — not because student-facing practice starts then (it doesn't, see [MASTER_PLAN.md](MASTER_PLAN.md) Phase 4), but because `PrepPhaseTemplate`/`CatchUpPlan` need a real `enrolled_at` to compute against, and Phase 1's single seeded internal test user (see [DECISIONS.md](DECISIONS.md) D-004) already implies a minimal `Student` row. `auth_ref` is nullable/placeholder until the real auth decision lands — it never blocks Phase 1's use of this table for calendar-phase testing.

### Attempt & AttemptEvent (schema finalized in Phase 1, lifecycle implemented in Phase 4A — [PHASE_4A_REVIEW.md](PHASE_4A_REVIEW.md))
```
Attempt
  id, student_id, question_id, enrollment_id
  retry_of_attempt_id: uuid | null   -- self-referential; a retry is a new Attempt row, not a counter increment,
                                      -- so each retry carries its own real started_at/submitted_at
  status: in_progress | submitted | skipped | abandoned   -- the ONE authoritative lifecycle state (docs/DECISIONS.md D-034);
                                      -- in_progress is the only non-terminal value
  started_at, submitted_at, finalized_at
                                      -- submitted_at is set only when status = submitted; finalized_at is set for
                                      -- ALL three terminal outcomes and is what time_spent_seconds is computed from
  time_spent_seconds                 -- derived (finalized_at - started_at), server-computed only — a client-supplied
                                      -- duration is never accepted anywhere in packages/domain/attempt
  chosen_answer, is_correct          -- both derived: chosen_answer from the recorded answer_selected/answer_changed
                                      -- event log (never a raw submit-time parameter), is_correct from comparing it to
                                      -- the authoritative Question.correct_answer (never a client-supplied flag)
  hints_used: int                    -- convenience count; per-hint timing lives in AttemptEvent
  solution_opened_at: timestamp | null
  working_steps: jsonb | null        -- scratch/computation input, where the input mode supports it; nullable, never fabricated
  reasoning_text: text | null        -- the student's own explanation of WHY they answered this way — distinct from working_steps
  reasoning_input_mode: text | voice -- defaults to 'text'; 'voice' is a shaped-but-unimplemented placeholder (see PRODUCT_SPEC §4.5)
  reasoning_audio_ref: text | null   -- nullable; unused until voice input ships
  created_at

AttemptEvent
  id, attempt_id
  event_type: question_opened | answer_selected | answer_changed | hint_opened | solution_opened
              | question_skipped | working_input_changed | reasoning_submitted | answer_submitted
              -- renamed from Phase 1's option_selected/option_changed/hint_requested to the canonical
              -- names above in Phase 4A (docs/DECISIONS.md D-034) — safe because no environment has ever
              -- applied a migration against a live database. working_input_changed/reasoning_submitted
              -- remain reserved for Phase 5 (docs/DECISIONS.md D-011); question_skipped/answer_submitted
              -- are only ever appended by the lifecycle functions themselves, never accepted as raw
              -- caller input (packages/domain/attempt/src/types.ts — RecordableAttemptEventInput)
  payload: jsonb | null              -- e.g. { selectedAnswer } for answer_selected/answer_changed/answer_submitted;
                                      -- shape is event_type-specific, not a fixed schema
  occurred_at
```
This is the event model that makes time a first-class, extensible signal: time-before-first-interaction, time-between-actions, hint timing, time-after-hint, and retry timing are all derivable from `AttemptEvent` rows plus the `retry_of_attempt_id` chain — none of them required a bespoke column, and none of them will the next time a new timing question comes up. `Attempt`'s own timestamp/count fields exist purely so common queries (leaderbords excluded — just "how long did this take") don't need to replay the event log every time. Answer-change history (initial answer, final answer, number of changes, full sequence) is deliberately NOT a stored column either — it's computed on every read from the `AttemptEvent` log (`deriveAnswerChangeHistory()`), the same "derive, don't cache" discipline `MasteryState` and pattern-family coverage already follow (docs/DECISIONS.md D-015).

`packages/domain/attempt` (Phase 4A) is the pure, database-free implementation of this lifecycle — see [PHASE_4A_REVIEW.md](PHASE_4A_REVIEW.md) for the state machine, the exact trust boundaries (what's derived vs. what a client could otherwise forge), and the Autopsy/Mastery evidence contracts a finalized `Attempt` now exposes.

### Error Taxonomy
```
ErrorTaxonomy
  id, code, label, description
  category: misconception | trap | calculation_mistake | interpretation_mistake | method_selection_mistake
```
A small, curated reference table (e.g. `base_confusion`, `sign_error`, `misread_question`, `careless_arithmetic`, `percentage_point_confusion`) — grown deliberately, the same way exam structure is data rather than an enum baked into code. `category` is the SAME 5-value "what can go wrong" vocabulary Examiner Lens error modes use (docs/QUESTION_ENGINE.md §2) — one shared error taxonomy, not two (docs/DECISIONS.md D-013).

### Question Autopsy
```
Autopsy
  id, attempt_id
  hypothesis_text                    -- always phrased as a question back to the student
  error_taxonomy_id                  -- FK to ErrorTaxonomy, not a free-form string
  likely_root_cause
  evidence_used: jsonb               -- which observable signals informed the hypothesis (for auditability, not shown as "proof") —
                                      -- may include reasoning_text, solution_opened_at, and AttemptEvent-derived timing when present
  confirmed: bool | null             -- null = awaiting student response
  student_correction_text: text | null
  generated_by: ai_provider_ref, prompt_version

RepairPlan
  id, autopsy_id, student_id
  target_concept_id, target_error_taxonomy_id
  follow_up_question_ids: uuid[]
  status: pending | in_progress | completed
```
**Phase 5A** ([PHASE_5A_REVIEW.md](PHASE_5A_REVIEW.md)) implemented the OBSERVATION -> EVIDENCE half of this table's eventual content as a pure, database-free package, `packages/domain/autopsy` — `buildAutopsyOutput()` produces exactly the kind of structured signal `evidence_used` above is meant to hold (deterministic behavior signals, historical/repeated-evidence counts, and a CANDIDATE — never confirmed — error-category match against this same `ErrorTaxonomy` table). No `Autopsy` or `RepairPlan` row is ever written by this package; `hypothesis_text`/`likely_root_cause`/`confirmed`/`follow_up_question_ids` remain entirely Phase 5B's responsibility (the actual AI call that turns `AutopsyOutput` into a real hypothesis, actual follow-up-question selection, and the persistence adapter that writes both). This schema itself did not change in Phase 5A.

### Mastery (derived only)
```
MasteryState
  id, student_id, concept_id
  accuracy: float                    -- rolling, time-decayed
  speed_ratio: float                 -- observed time / expected_time, rolling
  novelty_handling: float            -- accuracy specifically on novel-representation / high-transformation questions
  pressure_performance: float        -- accuracy/speed delta under timed conditions vs untimed
  pattern_coverage: float            -- fraction of PatternTaxonomyCell rows for this concept attempted at least N times
  computed_at
```
No `confidence` column exists anywhere in this schema, by design (see [PRODUCT_SPEC.md](PRODUCT_SPEC.md) §5).

### Calendar-aware preparation (Phase 1 foundation)
```
PrepPhaseTemplate
  id, exam_id
  phase_curve: jsonb                 -- pure function input: maps (days_to_exam) -> expected coverage targets per chapter

CatchUpPlan
  id, student_id, enrollment_id
  overlay: jsonb                     -- compresses/reorders the phase_curve for this student only; never mutates PrepPhaseTemplate
  created_at
```
`computePrepPhase(examId, enrollmentDate, today)` reads `PrepPhaseTemplate.phase_curve` and returns the expected coverage curve for that student's position in the calendar; `applyCatchUp(phase, catchUpPlan)` layers a student's `CatchUpPlan.overlay` on top without writing back to `PrepPhaseTemplate`. Both are pure functions in `/packages/domain/prep-phase`, built and unit-tested in Phase 1 — see [MASTER_PLAN.md](MASTER_PLAN.md) Phase 1 and [ARCHITECTURE.md](ARCHITECTURE.md) §4.

## What's intentionally not modeled yet

Payments, subscriptions, pricing, parent/guardian accounts, coaching-org multi-tenancy, mock-test assemblies, calculation-gym and vocabulary-gym item banks, trap/pressure/surprise mode configs. These will be additive tables when their phase starts (see [MASTER_PLAN.md](MASTER_PLAN.md)) — nothing above needs to change shape to accommodate them.
