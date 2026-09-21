# Database / Domain Model

PostgreSQL, accessed via Prisma. This is the target schema for the vertical slice — fields that clearly generalize to future exams/chapters are included now (as data, not code) so the first migration isn't a rewrite; fields that are speculative for features not yet in scope are left out.

## Design rules

- **Exam structure is data.** `Exam`, `Section`, `Chapter` are rows, not enums — so adding CAT later is a seed script, not a code change.
- **The concept graph is a real graph.** `Concept` nodes + typed `ConceptRelation` edges, not a flat `chapter → concept` list.
- **Question DNA is enforced, not conventional.** A `Question` cannot be marked `published` without every DNA field populated and a `Provenance` record.
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
  type: prerequisite_of | related_to | combines_with
  strength: enum(weak, moderate, strong)   -- how load-bearing the relation is, curated or AI-suggested + human-approved
  source: human | ai_suggested            -- provenance of the edge itself
```

### Examiner Lens
```
ExaminerLensAnalysis
  id, concept_id
  version                          -- analyses are versioned; regenerating doesn't overwrite history
  what_is_tested: jsonb
  prerequisites_exercised: concept_id[]
  legitimate_patterns: jsonb        -- structured list, see QUESTION_ENGINE.md
  valid_combinations: concept_id[]
  valid_traps: jsonb
  transformations: jsonb
  novel_representations: jsonb
  generated_by: ai_provider_ref, prompt_version
  reviewed_by: user_id | null       -- human sign-off, nullable until reviewed
  status: draft | reviewed | published
```

### Question Universe (taxonomy)
```
PatternTaxonomyCell
  id, concept_id, examiner_lens_analysis_id
  pattern_name, combination[], transformation, trap_type, difficulty_tier, target_time_seconds
  coverage_status: uncovered | in_generation | covered
```
This table is the explicit, queryable "coverage map" — the product claims coverage of *this table*, never of "all possible questions."

### Question + Question DNA
```
Question
  id
  exam_id, section_id, chapter_id, concept_id
  subconcepts: concept_id[]
  prerequisites: concept_id[]
  pattern_taxonomy_cell_id            -- traces every question back to the universe cell it was generated for
  skill: text
  difficulty_tier: standard | advanced | hard | extreme | novel
  difficulty_dimensions: jsonb        -- e.g. { conceptual, computational, trap_density, representation_novelty }
  expected_time_seconds: int
  trap_type: text | null
  transformation: text | null
  body: text, options: jsonb, correct_answer: text, solution_steps: jsonb
  ground_truth_derivation: jsonb      -- the generator's own worked computation, used by the validator to check the stated answer independently of the LLM's claimed answer
  validation_state: draft | ai_validated | human_reviewed | published | rejected
  provenance_id                       -- FK, required to be non-null before validation_state can be 'published'

Provenance
  id, source_type: original | licensed | public_domain | open_license | official | user_authorized
  source_ref, license_ref, attributed_to
```

### Student & Enrollment (Phase 1 foundation)
```
Student            id, auth_ref, created_at
Enrollment         id, student_id, exam_id, enrolled_at
```
These two tables exist from Phase 1 — not because student-facing practice starts then (it doesn't, see [MASTER_PLAN.md](MASTER_PLAN.md) Phase 4), but because `PrepPhaseTemplate`/`CatchUpPlan` need a real `enrolled_at` to compute against, and Phase 1's single seeded internal test user (see [DECISIONS.md](DECISIONS.md) D-004) already implies a minimal `Student` row. `auth_ref` is nullable/placeholder until the real auth decision lands — it never blocks Phase 1's use of this table for calendar-phase testing.

### Attempt & AttemptEvent (schema finalized now, Phase 4 is when rows start getting written)
```
Attempt
  id, student_id, question_id, enrollment_id
  retry_of_attempt_id: uuid | null   -- self-referential; a retry is a new Attempt row, not a counter increment,
                                      -- so each retry carries its own real started_at/submitted_at
  started_at, submitted_at           -- denormalized from AttemptEvent for query convenience; not the source of truth
  time_spent_seconds                 -- derived (submitted_at - started_at); never written independently of the events
  chosen_answer, is_correct
  hints_used: int                    -- convenience count; per-hint timing lives in AttemptEvent
  solution_opened_at: timestamp | null
  working_steps: jsonb | null        -- scratch/computation input, where the input mode supports it; nullable, never fabricated
  reasoning_text: text | null        -- the student's own explanation of WHY they answered this way — distinct from working_steps
  reasoning_input_mode: text | voice -- defaults to 'text'; 'voice' is a shaped-but-unimplemented placeholder (see PRODUCT_SPEC §4.5)
  reasoning_audio_ref: text | null   -- nullable; unused until voice input ships
  created_at

AttemptEvent
  id, attempt_id
  event_type: question_opened | option_selected | option_changed | hint_requested
              | solution_opened | working_input_changed | reasoning_submitted | answer_submitted
  payload: jsonb | null              -- e.g. { from, to } for option_changed; shape is event_type-specific, not a fixed schema
  occurred_at
```
This is the event model that makes time a first-class, extensible signal: time-before-first-interaction, time-between-actions, hint timing, time-after-hint, and retry timing are all derivable from `AttemptEvent` rows plus the `retry_of_attempt_id` chain — none of them required a bespoke column, and none of them will the next time a new timing question comes up. `Attempt`'s own timestamp/count fields exist purely so common queries (leaderbords excluded — just "how long did this take") don't need to replay the event log every time.

### Error Taxonomy
```
ErrorTaxonomy
  id, code, label, description
```
A small, curated reference table (e.g. `base_confusion`, `sign_error`, `misread_question`, `careless_arithmetic`) — grown deliberately, the same way exam structure is data rather than an enum baked into code.

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
