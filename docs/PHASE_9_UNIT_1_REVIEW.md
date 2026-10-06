# Product Phase 9 Unit 1 — Production architecture + persistence foundation

Decision record: [DECISIONS.md D-097](DECISIONS.md). Code: `packages/db` (`prismaPreferenceStore.ts`, `orchestrationAudit.ts`), migration `0017_production_persistence_foundation`. No new package, no route, no UI.

This is a productionization unit, not a rewrite. The audit below found that **migrations 0001-0016 already persist every piece of authoritative state the product has**; exactly **two** things were explicitly left unpersisted by earlier phases and are now persisted: a student's explicit preferences (D-095) and the orchestration audit (D-096).

## 1. Specification audit

### 1.1 Already persisted (authoritative unless marked)

| State | Where | Notes |
|---|---|---|
| Identity, sessions | `students`, `sessions` (0008, 0009) | Session token stored only as SHA-256 digest; revocation never deletes |
| Enrollment (student x exam) | `enrollments`, unique `(student_id, exam_id)` | The exam/enrollment scoping anchor |
| Attempts, responses, timing | `attempts`, `attempt_events` (0003, 0010) | Events are the source of truth for timing (D-010); one open attempt per student/question (partial unique index) |
| Autopsy + confirmation | `autopsies`, repair decisions (0003-0007, 0011) | Hypothesis only becomes a diagnosis by the student's own response (D-006) |
| Repair plans | `repair_plans` (0007, 0011) | One per autopsy |
| Practice/training state | `practice_sessions`, `practice_blocks`, `training_sessions` (0006, 0012) | A training session is a thin row on a practice block (D-075) |
| Simulation | `exam_simulations`, `simulation_questions`, `simulation_answer_events` (0016) | Server-authoritative time; result written once (D-090) |
| Content | `questions`, provenance, taxonomy, authoring columns (0002, 0014) | The generated-question lifecycle IS `ValidationState` + `authoring_origin`; no separate state needed |
| Content intelligence, historical records | 0013, 0015 | Internal, never student-readable |
| Mastery snapshot | `mastery_states` (0001, 0004, 0005) | A **derived** snapshot (D-042), written only when all five measures exist |

### 1.2 Ephemeral by design (not persisted, and must not become so without a decision)

Mastery EVIDENCE view (D-087), Revision Intelligence (D-088), Adaptive Curriculum (D-089), simulation readiness evidence (D-091): computed from persisted attempts/simulations on every call; storing them would create a second source of truth. Tutor conversation state (caller-supplied, capped `priorInteraction`; D-092/D-093). Generation traces (metadata, D-094). Orchestration results/outputs (D-096).

### 1.3 Was unpersisted, now persisted

1. **Student preferences** — `student_preferences`. D-095 said a table would be "storage without a writer" until a surface existed; production needs the durable port ready, and the contract (`PreferenceStore`) was already written.
2. **Orchestration audit** — `orchestration_audits`. D-096 listed durable audit storage as unresolved; the `OrchestrationAuditSink` port and the metadata-only `OrchestrationAudit` shape already existed.

### 1.4 Authorization boundaries that already exist (kept, not widened)

Session token -> student; enrollment ownership chain (`PracticeBlock -> PracticeSession -> Enrollment -> Student`, `ownership_mismatch`); simulation ownership (another student's simulation is "not found"); tutor/orchestrator ownership port (the exam is the ENROLLMENT's); content-authoring principals; student readers `select` only student-safe columns. This unit adds repository-level keys on top: every student read takes the authenticated student id and filters on it.

### 1.5 Contradictions found

- `ai-orchestration/src/types.ts` header cited `D-097` for what is D-096 in the decision log (a stale number; corrected here, comment only).
- When a request is refused before routing, the existing orchestrator audit defaults `task` to `explain_question`. A refused audit's `task` is therefore not reliable when `workflowId` is null. Not changed (Phase 8 behaviour); recorded so nobody reports on it as fact.

## 2. Source of truth vs derived vs ephemeral (the rule this unit adds)

| Class | Meaning | Examples | Rule |
|---|---|---|---|
| **Authoritative** | The original fact; nothing else can recreate it | attempts/events, simulation answers + result, enrollment, preferences, audit, question + provenance | Written once or append-only; never overwritten by derived data |
| **Derived / read model** | A function of authoritative data | Mastery evidence, revision signals, curriculum, readiness evidence, `mastery_states` snapshot | Recomputable; never read back as evidence; no new derived store was added |
| **Ephemeral** | Exists only during one execution | Orchestration outputs, prompts, tutor replies, capability results | Never persisted; the audit keeps only facts ABOUT the execution |

Preferences are authoritative but **do not feed any engine** (D-095): they never become evidence about the student, and no evidence becomes a preference.

## 3. What was built

### `student_preferences` / `PrismaPreferenceStore`
One row per student (PK = student id, FK cascade). Three nullable text columns with `CHECK`s matching the closed vocabularies; there is no column that could hold a trait. The store implements the domain's own `PreferenceStore` port. `set()` is an upsert that writes **only the mentioned fields**, so concurrent patches to different fields both survive; an explicit `null` clears; an unknown student is `missing_reference`; every patch passes `validatePreferencePatch` first (trait-like names refused by name). `erase()` deletes the row.

### `orchestration_audits` / `PrismaOrchestrationAuditStore`
- **Columns:** request id (unique; the correlation and idempotency key), timestamp, task, workflow, actor kind, student (nullable FK, `ON DELETE SET NULL`), exam code, status, fallback flag, selection rule, deciding policy, `steps` (jsonb array of the audit's own step facts), `recorded_at`. **No** prompt, response, input, output, params, reasoning, plan or message column.
- **Allowlist:** `sanitizeAuditForStorage` rebuilds the audit from known fields only. An unexpected key (top-level or on a step) is **refused**, not stored; ids/codes are pattern-checked, text is single-line and length-capped, digests must be sha256 hex.
- **Idempotent:** the same audit twice stores one row (including 8 concurrent records); a *different* audit under an existing request id is a `conflict`.
- **Append-only:** a trigger rejects every `UPDATE` except the one the FK performs to detach a deleted student. `DELETE` is intentionally not blocked (retention is unresolved).
- **Unverified student claims:** the orchestrator also audits requests refused before ownership was verified, whose `studentId` is only a claim. If it names no student, the row is stored with `student_id = NULL` (claim not retained, audit not lost); it is then reachable only by an operator.
- **Two reader interfaces:** `StudentOrchestrationAuditReader` (every method takes the authenticated student id; another student's request id is indistinguishable from a missing one; staff audits unreachable) and `OperatorOrchestrationAuditReader` (`findByRequestId`; a separate type so student-facing code cannot be handed it). Authorizing an operator is the caller's job — this layer constructs no roles.
- **Wiring:** `PrismaOrchestrationAuditStore` is an `OrchestrationAuditSink`, so it is injected into `createOrchestrator({ audit })` unchanged; a store failure still never changes what the orchestrator returns (tested).

### Architecture
`application -> service -> repository -> Prisma`. The domain ports (`PreferenceStore`, `OrchestrationAuditSink`) are the service-facing contracts and already existed; the Prisma classes live only in `@ipmat/db`, domain packages gained no Prisma import (the existing boundary test still passes), and in-memory reference implementations run the **same contract** as the Prisma ones.

## 4. Retention and deletion (engineering decisions; legal decisions flagged, none invented)

| Data | Class | Deletable | Engineering decision |
|---|---|---|---|
| Preferences | authoritative | yes (`erase`, cascade with the student) | Deleted with the student |
| Orchestration audit | authoritative (execution facts) | by operator `DELETE` only; never updated | **Retained** when a student is deleted: the row is detached (`student_id` NULL), every fact kept |
| Attempts, simulations, autopsies, repair, mastery snapshot | existing | cascade with the student (existing FKs) | Unchanged by this unit |
| Derived intelligence, ephemeral outputs | derived / ephemeral | n/a (not stored) | Nothing to retain |

**Flagged for a product/legal decision (not decided here):** how long audit rows are kept; whether a student's deletion request must also delete their audit rows (the detach-and-retain default is an engineering choice, not a legal position); whether audit `studentId`+`task`+timestamp is personal data in the relevant jurisdiction; whether a student may export/read their own audit (the reader exists, no route does); whether preferences should be per-exam rather than per-student; data-export format.

## 5. Isolation guarantees

Every student-scoped read is keyed by the authenticated student id and filters on it in the query (not after the fact); another student's rows are `null`/absent, identical to missing ones. Preferences are reachable only through their own student key. The DB itself enforces the vocabularies (CHECKs), the request-id uniqueness, the FK, cascade/detach behaviour and append-only. Exam scoping: audits record the enrollment's exam code (the orchestrator derives it from the verified enrollment; never from the request); preferences are student-level, not exam-level (flagged above). **No HTTP route reads either table yet**, so no client can reach them; a future route must pass only the session's student id.

## 6. Tests

- **No-Postgres (`productionPersistence.test.ts`, 40):** sanitizer allowlist (18 refusals), in-memory stores run through the shared contracts, a real orchestrator writing into the store (no output/param leakage; a failing store changes nothing), static schema/migration invariants (next migration, additive-only, no trait column, no content column, only two back-relations on `Student`).
- **Real Postgres (`productionPersistence.integration.test.ts`, 26):** the same contracts against Prisma; FK/CHECK/unique enforced by the database itself; concurrent patches and concurrent audit records; append-only trigger; student deletion cascade (preferences) and detach (audits); jsonb key-order round trip; orchestrator -> Prisma sink end to end; writes touch no evidence/mastery/repair/training table; pre-existing tables and `(student, exam)` uniqueness intact.
- **Mutation checks:** 12 source mutations and 2 database mutations (dropped trigger, dropped CHECK) — all killed (see the unit's final report for the table). The first run left one survivor (patch validation could be skipped because the database happened to reject the bad input); the contract now requires the domain's `PreferenceError`, which killed it.

- **Pinned earlier tests updated:** seven earlier integration tests asserted "the latest migration is X" (each unit's own "this unit added no migration" pin). A new migration invalidates that by construction, so they now assert the latest AS OF their unit / the exact list through 0017. No behavioural assertion changed.

## 7. Known limitations / not done

No route or UI reads or writes either table. Nothing yet constructs the Prisma audit store in `apps/api`. No audit retention job, export, or per-exam preferences. Orchestration budgets/timeouts/rate limits (Phase 8 limitation) are untouched. Student presentation of Phase 7 results is untouched. `mastery_states` remains a snapshot written by existing code; this unit did not change what feeds it. No live model has run.

## 8. Not claimed

That the audit is tamper-proof (a database owner can drop the trigger), that the retention defaults satisfy any legal requirement, or that any new capability reaches a student.
