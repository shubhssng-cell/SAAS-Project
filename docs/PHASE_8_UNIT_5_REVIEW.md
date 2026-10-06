# Phase 8 Unit 5 — AI Intelligence Orchestration

Decision record: [DECISIONS.md D-096](DECISIONS.md). Code: `packages/domain/ai-orchestration` (`@ipmat/ai-orchestration`, pure). **No migration, no table, no route, no UI, no model call of its own, no new provider, no memory, no planner, no loop.** This completes Phase 8.

## 1. Specification audit

**A. Orchestration that already exists (all deterministic):** the Training Orchestrator (D-052, D-062) with its fixed, named priority policy (`REPAIR_PRECEDES_ADAPTIVE`, the training-system provider order); the read-only composers in `@ipmat/training-recommendation` (`composeAdaptiveCurriculum`, `composeExamPerformanceIntelligence`, revision, mastery evidence) behind one ownership rule (D-063); Revision Intelligence and the Adaptive Curriculum, which compose existing outputs without ranking (D-088, D-089); the tutor's own policy table and grounding (D-092–D-095); the authoring lifecycle (D-084, D-094).

**B. Explicitly specified about AI orchestration:** nothing. A search for agent / multi-agent / planner / tool-use / autonomous / agent loop found no specification and no code. "Orchestration" in this repository means a fixed, named, deterministic order, never a model deciding.

**C. Safely composable (implemented):** a closed capability registry; a fixed task → workflow route table; explicit, validated workflows; an ownership/authorization gate before anything runs; a context router that hands each capability its minimum input; structured, distinct failures; declared-only fallbacks; a metadata-only trace; a public view built field by field.

**D. Unresolved (not invented):** which of several valid capability paths to prefer (none is ranked); Revision's position relative to the adaptive chain (D-081, D-089 — the review workflow returns both independently); any fallback policy (no shipped workflow defines one); a student-facing presentation for revision / curriculum / simulation / exam intelligence; durable audit storage; rate limits and budgets across a workflow; whether a model may ever *suggest* a capability (it may not here).

## 2. Architecture

```
OrchestrationRequest { task, actor, params }
  -> validate task (closed list) and params (strict, per task; escalation keys refused by name)
  -> actor-kind / role check against EVERY capability the workflow names
  -> student: ownership port verifies the enrollment; the exam is the ENROLLMENT's
     staff:   the spec's exam must be in the actor's exams
  -> per step: re-authorize, build the MINIMUM input, invoke the registered handler, verify its result shape
  -> record step (status, failure kind, validation, input digest, timing); keep each output separate
  -> OrchestrationResult { status, steps, outputs (by step id), selection, fallback, decidedBy, notes, audit }
```
The orchestrator holds no model, key or database: capabilities are injected handlers. It has no loop, no recursion, no dynamic code and no memory (boundary-tested at the source level).

## 3. Capability registry (`registry.ts`)

Seven capabilities, each an existing system: `tutor_response`, `personalization`, `question_generation`, `adaptive_curriculum`, `revision_intelligence`, `simulation_intelligence`, `exam_intelligence`. Each descriptor states purpose, required inputs, output type, allowed actors (and staff roles), exam scope, student scope, `mayCallLlm`, `mayMutateState` and the validation it has already passed. Only the tutor and generation may call a model; only generation may mutate state (it stores candidates; `content_admin` only). No capability publishes. A capability absent from the table cannot run, and no function reads a capability name from model output (prototype keys and model-style names are tested).

## 4. Routing and workflows (`workflows.ts`)

A closed task list; a fixed route table; code-defined workflows validated at construction (an invalid override makes construction fail). Shipped:
- the six tutor tasks → optional `personalization` (presentation only) then `tutor_response`;
- `get_help` → `personalization` (the stored help preference chooses among the EXISTING intents; with none, the workflow stops and the caller must choose) then the tutor;
- `generate_question` → `question_generation` alone (spec → existing pipeline → existing gates → candidate; never published);
- `review_revision_and_curriculum` → the two existing results, **independent, order and priority unspecified** (D-081/D-089);
- `review_exam_performance` → finalized-simulation readiness EVIDENCE (no score, no verdict) plus optional exam-level availability.

Every step declares `onFailure` (`stop` / `continue`), dependencies must point to earlier steps (no cycles), and `optional` makes a missing capability an explicit recorded skip.

## 5. Context boundaries

Each capability receives only what its descriptor lists, built from the verified scope: readers get three ids (the exam-level capability only the exam), the tutor one request, generation one spec. Identity and exam are never read from parameters (`studentId`, `enrollmentId`, `examCode`, `intent`, `capability`, `workflow`, `actor`, … are refused as forbidden parameters). The tutor then applies its own context firewall (Units 1–4).

## 6. Authorization

Established before execution, never inferred: actor kind/role against the registry for every capability in the workflow; the enrollment through the tutor's ownership port (a missing and a foreign enrollment give one answer — no enumeration); staff exam scope; then re-checked per step and per fallback. A refusal runs nothing.

## 7. Failure handling and fallback

Thirteen distinct failure kinds (`authorization_denied`, `invalid_request`, `policy_refusal`, `capability_unavailable`, `not_available`, `insufficient_context`, `no_eligible_content`, `provider_timeout`, `provider_error`, `malformed_output`, `grounding_failure`, `validation_failure`, `handler_error`) — a tutor grounding failure is never reported as a timeout, a duplicate candidate is not an AI error. A thrown error is classified by code only; its message is never copied (a provider message may contain a secret). A failed capability's own result is preserved. **No silent fallback:** none is shipped; a workflow may declare one explicitly and `validateWorkflowDefinition` rejects an unregistered, self, mutating, differently-scoped or differently-authorized fallback and any fallback covering authorization / policy / request failures. A fallback that ran is recorded as a separate step and is never reported as `completed`. Status: `completed`, `partial` (only `continue` steps failed, or a fallback ran), `failed` (a `stop` step failed), `refused`.

## 8. Audit model

`OrchestrationResult` answers: task; selected workflow and rule; why (the route reason); inputs supplied (a SHA-256 digest of each capability's input — never the input); what ran, what was skipped and why; each step's named validations and failure; whether a fallback occurred; the policy that decided the final status (e.g. "existing tutor grounding validation"). The sink receives metadata only. No prompt, response, params, output, reasoning, plan or scratchpad is recorded; no such field exists (key-walked in tests).

## 9. Integrations (all by composition)

Tutor: through the existing service; answer-key, hint, Socratic, explanation and grounding rules are untouched (the orchestrated answer equals a direct call byte for byte). Personalization: only the explicit-preference step, never inferred. Question generation: the existing service; outcomes map to their own failure kinds; the orchestrator has no publish step. Adaptive / revision / simulation / exam intelligence: existing composers injected as read-only handlers; results returned verbatim, by reference. Content intelligence: not invoked directly (the tutor's own source port already reuses the Phase 6 retriever); no second retrieval path exists. Provider selection stays in `@ipmat/ai`; this package does not import it.

## 10. Security and privacy

Cross-student and cross-exam isolation (property-tested), unauthorized-capability refusal, prompt injection unable to expand capabilities (hostile text only reaches the tutor as quoted data; a capability output naming other capabilities is inert), no model-granted capability, no provider secret in any result or audit, no answer key through orchestration, and a public view that carries only the tutor's student view, the student's own applied preference decisions, step statuses with failure kind/code, and — for staff — candidate outcome codes. Revision / curriculum / simulation / exam results have **no defined student presentation**, so a student's view names them as withheld instead of exposing their internals.

## 11. Mutation checks

Nine deliberate defects were applied one at a time; eight are caught by existing tests (unauthorized capability allowed — 2; ownership bypass — 5; no unknown-parameter refusal / arbitrary capability params — 17; raw output leaked through the public view — 1; a thrown message copied — 1; exam taken from the request with the refusal removed — 2; a silent fallback — 1; dependencies ignored — 1). One (dropping the actor-kind pre-check) is not caught **because it is a redundant layer**: the role check and the per-step authorization refuse the same actors, so removing one layer changes no outcome.

## 12. Unresolved orchestration policies

Preference among valid capability paths; Revision's position relative to repair/adaptive; any fallback; student-facing presentation of the Phase 7 intelligence results; durable audit storage; cross-workflow budgets and rate limits; whether a model may suggest a capability (not allowed here); per-request timeouts for the whole workflow.

## 13. Known limitations

- No route or UI: nothing calls the orchestrator yet; reader capabilities are injected (their production binding is the existing `@ipmat/training-recommendation` composers, not wired here).
- The help-resolution step cannot know whether a submitted attempt exists, so it labels `explanation` as limited conservatively; the tutor's own policy decides disclosure either way.
- Orchestration is only as strong as the capabilities' own validators (the Hindi/Hinglish backstop caveat of Unit 4 and the non-semantic grounding caveat of Units 1–2 still apply).
- No live model has run.

## 14. Verification

| Check | Result |
|---|---|
| Focused orchestration tests | `@ipmat/ai-orchestration`: 4 files + fixtures, 111 tests passed (registry/workflows 29, orchestration 66, seeded properties 9, boundary 7) |
| Mutation checks | 9 deliberate defects: 8 caught (see section 11), 1 equivalent (a redundant authorization layer) |
| Full suite, real Postgres 16 (disposable, `127.0.0.1:55432`, 5432 untouched, migrations 0001-0016 + seed) | 325 files, 7564 tests passed |
| Full suite, no Postgres | 303 files passed, 22 skipped (DB-only); 7293 tests passed, 271 skipped |
| Typecheck / lint / build / `git diff --check` | all clean (lint flagged one unused variable in a test, fixed) |
| HTTP | real API on Prisma persistence: signup/me work; `/v1/orchestrate`, `/v1/orchestration`, `/v1/ai`, `/v1/ai/run`, `/v1/capabilities`, `/v1/agent`, `/v1/tutor`, `/v1/generate` are all 404 for GET and POST (no route exists); no orchestration, capability, route-id or workflow text in API or web responses |
| Browser | no browser-automation tool; headless Edge rendered the real web app (landing page; no orchestration/capability/agent text). No click-through flow was run - no UI was added |
| Database / migration | none: zero orchestration/agent/capability/memory tables; `students` columns unchanged; the database and servers were removed |
| Live model | never run (no key); the orchestrator never calls a model itself |

Defects found by verification and fixed: a staff request for a tutor task was refused as `invalid_request` instead of `authorization_denied` (scope was derived before the actor check; now the actor-kind and role check runs first); a skipped step reported `stopped_after_failure` where `dependency_failed` is the more specific reason; the student view listed "no preference" decisions (now only decisions that changed something).
