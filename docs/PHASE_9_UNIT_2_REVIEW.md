# Product Phase 9 Unit 2 — Application integration + live AI boundary

Decision record: [DECISIONS.md D-098](DECISIONS.md). Code: `packages/assistant-api` (`@ipmat/assistant-api`, application services), `packages/db/src/repositories/prismaTutorPorts.ts`, `apps/api/src/{server,assistantWiring,index}.ts`, `apps/web/src/tutor/*`. No migration, no new table.

This is an integration unit: the Phase 5-8 systems are connected to the HTTP boundary through the existing conventions. No domain logic was rewritten and no policy was changed.

## 1. Specification audit

### 1.1 What existed
- **Transport:** `apps/api/src/server.ts` — plain `node:http`, `/v1` routes, one `resolvePracticeClaim()` turning the session cookie into `{ studentId, enrollmentId }` (the only identity source; D-004, Unit 10). Handlers parse, call ONE application-service method, serialize; errors are fixed `{ error: { code, message } }`.
- **Application services:** `@ipmat/auth-api`, `enrollment-api`, `practice-api` (practice + training). Wiring is in `apps/api/src/wiring.ts` (in-memory and Prisma), entry in `index.ts`.
- **AI boundary:** `@ipmat/ai` (`AiProvider`, `generateStructured`, `AnthropicProvider`, `FixtureProvider`); `apps/api/src/hypothesisWiring.ts` already resolves `IPMAT_AI_PROVIDER` / `ANTHROPIC_API_KEY` / `IPMAT_AI_MODEL` explicitly and fail-closed (`none` default).
- **Phase 8 domain, no application binding:** `@ipmat/tutor`, `@ipmat/personalization`, `@ipmat/question-generation`, `@ipmat/ai-orchestration` — all with injected ports; no HTTP route, no production port implementation.
- **Phase 7:** simulation engine (`@ipmat/exam-simulation`) with Prisma adapters (Unit 1 of Phase 7) but no route; mastery evidence, revision, curriculum, readiness: composers only, no route, **no defined student-facing presentation** (D-087..D-091; D-096 withholds them).
- **Unit 1 (Phase 9):** `PrismaPreferenceStore`, `PrismaOrchestrationAuditStore`.

### 1.2 What was missing (and is now built)
Tutor route; preferences routes; simulation routes; Prisma/in-memory production bindings for the tutor's read ports (ownership, question, attempt) and the concept port; a composition of the Phase 8 orchestrator in the app; the web client and a minimal UI.

### 1.3 What was deliberately NOT exposed
| Capability | Decision | Why |
|---|---|---|
| Question generation | Application service only, **no HTTP route** | The repository has no staff identity/role model (auth is student sessions); inventing one is out of scope. The service accepts only a `StaffClaim` a trusted caller constructs. |
| Revision / curriculum / simulation-readiness / exam intelligence | **Not bound, no route** | No student-facing presentation is defined (D-088/D-089/D-091); the orchestrator already withholds them. |
| Mastery evidence | No route | D-087: evidence only, no verdict, no presentation. |
| Simulation **result** | No route | The result carries per-question correctness; its student presentation (a review mode) is unspecified (D-090). |
| Orchestration audit reads | No route | Retention/access policy unresolved (D-097). |
| Diagnosis / evidence / source ports for the tutor | Not bound | The tutor treats them as optional; binding them needs the autopsy-confirmation and retrieval policies decided (D-093, D-085). `explain_mistake` therefore runs on observable attempt facts only. |

### 1.4 Things that cannot be done honestly yet
- **No exam configuration exists** (D-090): the production simulation config source is empty, so `POST /v1/simulations` answers `no_simulation_configured` (503) until the owner supplies an authoritative configuration. Tests use a labelled fixture.
- **No live model**: see §6.

## 2. Architecture

```
Browser ── cookie ──> apps/api/server.ts
                         resolvePracticeClaim()  (session -> studentId; current enrollment -> enrollmentId)
                         ASSISTANT_ROUTES        (one service call per route; no logic)
                              │
                     @ipmat/assistant-api        strict input validation, fixed task table,
                         TutorApiService          student-safe DTO, fixed error wording
                         PreferencesApiService
                         SimulationApiService
                         ContentGenerationApiService (staff; no route)
                              │
              @ipmat/ai-orchestration  (Phase 8, unchanged)  ── tutor / personalization / generation handlers
              @ipmat/exam-simulation   (Phase 7, unchanged)
                              │
              ports ── @ipmat/db Prisma bindings ── PostgreSQL         @ipmat/ai ── provider ── vendor
```

- `@ipmat/assistant-api` depends on domain packages and the `@ipmat/ai` abstraction only. Boundary test: no Prisma, `@ipmat/db`, vendor SDK, `node:http` or environment/key access.
- Provider selection stays in `apps/api` (`assistantWiring.ts`) and reuses `resolveAiConfig`: `anthropic` (needs `ANTHROPIC_API_KEY` + `IPMAT_AI_MODEL`, refuses to start without them), `none` (default → tutor `503 not_available`), `dev-scripted` (a hypothesis-only scaffold; the tutor stays unavailable). The application layer never reads or logs a key.

## 3. Routes (all cookie-authenticated; unauthenticated → 401, not enrolled → 409)

| Route | Service call | Notes |
|---|---|---|
| `POST /v1/tutor/ask` | `TutorApiService.ask` | body: `operation` (`explain_question`, `explain_concept`, `give_hint`, `guide_with_question`, `explain_mistake`, `clarify_solution`, `help`) + `questionId` or `conceptName` + optional `focus`, `priorInteraction` |
| `GET` / `PUT /v1/preferences` | `PreferencesApiService` | three explicit fields; PUT is a patch, `null` clears |
| `POST /v1/simulations` | `SimulationApiService.start` | starts or recovers |
| `GET /v1/simulations/:id`, `…/questions/:position` | `get`, `question` | |
| `POST /v1/simulations/:id/answers`, `…/submit` | `answer`, `submit` | `{ position, answer }` only |

Status convention: 400 malformed/forbidden field, 401 no session, 403 not permitted, 404 unknown/not yours, 409 wrong state, 503 not available (no provider, no simulation configuration), 500 fixed generic.

## 4. Tutor integration
- **Closed approvals:** the request names an `operation`; a fixed table maps it to a Phase 8 task. Any other key — `studentId`, `enrollmentId`, `examCode`, `capability(Id)`, `workflow(Id)`, `task`, `actor`, `role`, `permissions`, `presentation`, `spec`, `fallback` — is refused with 400 **before** anything runs (tested field by field, and the model is shown not to have been called).
- **Identity:** the actor is the verified student + current enrollment. The orchestrator re-verifies the enrollment (the exam is the ENROLLMENT's) before any capability runs.
- **Policy unchanged:** the answer key/solution reaches a prompt only for explain/mistake/clarify AFTER a SUBMITTED attempt (hint never; skip never) — proven at HTTP level on the in-memory and Postgres stacks by inspecting the prompts the model double received.
- **Presentation:** language/verbosity come only from the student's stored preference via the personalization capability; the client cannot supply them. Tests show a stored preference changes the prompt's style while the key decision and context are identical, and that changing preferences changes no training/recommendation output.
- **Projection:** response = `{ status, tutor: StudentTutorView | null, preferenceNotes, failure }`. The tutor view is the existing `toStudentTutorView`; nothing else crosses: no steps, capability names, workflow, audit, grounding report, violation codes, ids, digests, taxonomy ids, provider payload or reasoning. A rejected model text is never returned (a leaking model is shown to produce a fixed "could not verify" message).
- **Failures:** each failure kind has fixed student-safe wording (`SAFE_FAILURE`); the domain's own codes/messages never reach the client. Request/authorization/unavailable are HTTP errors; grounding/provider/insufficient-context are normal `not_answered` results.
- **Orchestration audit:** every tutor request is recorded through the Unit 1 store; tests show only `personalization` and `tutor_response` ever run, even with hostile free text, and that no content reaches the row.

## 5. Other integrations
- **Preferences:** `PrismaPreferenceStore` behind the domain's validator; trait-like names refused by name; per-student isolation.
- **Simulation:** the existing service with the Prisma adapters; server clock only; answers accept only `{ position, answer }`; submit drops the finalized result; another student's simulation is `404`, identical to a missing one; it writes no attempt/practice/training/mastery data (checked on Postgres).
- **Generation:** `ContentGenerationApiService` runs the fixed `generate_question` task, returns reason codes only, `published: false` always, has no publish/approve operation, refuses student and hand-built claims and a spec for another exam; the orchestrator authorizes again.
- **Phase 7 intelligence:** unchanged and unexposed (see §1.3). Unresolved: when a student-facing presentation is specified, it must be added as a projector, not by exposing the internal results.

## 6. Live-model validation — status: NOT RUN (no credential)
No `ANTHROPIC_API_KEY` (or any provider credential) exists in this environment, and none was requested or exposed. Per the unit's rule, no live test was faked. Instead the complete boundary was exercised with deterministic provider doubles (`ScriptedProvider`): request → session → ownership → context → policy → model → deterministic grounding → projection → response, for concept explanation, question explanation, hint, mistake explanation, clarification, personalized presentation, grounding rejection (leaking model), unauthorized request, key-leakage attempt and prompt injection; plus provider failure and malformed output. **Doubles prove the boundary and the policy; they do not prove model quality, latency, cost, grounding recall on real outputs, or Hindi/Hinglish fidelity.** To run live: `IPMAT_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… IPMAT_AI_MODEL=<explicit id>` and the existing `npm run smoke:anthropic` for the pipeline, then the same HTTP suite against the live provider.

## 7. Web
`src/tutor/api.ts` (the only tutor/preference client; narrows every response to a closed set of fields), `TutorPanel.tsx` (loading / answered / not-answered / error; AI text is labelled as AI-written; hypotheses are labelled "AI hypothesis"; the two preference selects), shown on the result screen of a **submitted** attempt only. Tested without a DOM (server-rendered markup + client unit tests); a real-browser pass is reported separately in the unit's final report.

## 8. Unresolved (not invented)
Staff authentication/roles (so no generation route); simulation configuration (owner-supplied IPMAT rules); simulation result/review presentation; student presentation of the Phase 7 results; binding the diagnosis/evidence/source ports to the tutor; tutor rate limits, budgets and per-request timeouts at the HTTP layer (the provider-level timeout/retry of `@ipmat/ai` applies); conversation continuity beyond the caller-supplied, capped `priorInteraction`; audit retention (D-097); a live-model run.

## 9. Not claimed
That any tutor answer is correct or well taught, that a double stands in for a model, that the simulation matches any real exam, or any inference about a student.

## 10. Verification record
- **Tests added:** `assistantServer.test.ts` (45, real HTTP, in-memory wiring + real services/orchestrator/validator), `assistantApi.test.ts` (22), `assistantPostgres.integration.test.ts` (9, real Postgres), `apps/web/test/tutor/tutor.test.ts` (12). Model = deterministic double throughout.
- **Mutation checks:** 23 source mutants (request whitelist, client presentation, authorization/unavailable mapping, failure-code leakage, simulation whitelist/result exposure/404 mapping, preference key/validation, staff check, generation flags/whitelist, claim-from-body, error mapping, provider availability, Prisma port student/exam/ownership scoping, web identity/field narrowing). 21 killed on the first run; 2 survivors exposed real test gaps (authorization-denial -> 403; a student claim carrying a staff role) and are now killed by new tests; 1 survivor (`question_generation` handler bound with no generation service) is an equivalent mutant at the observable level (the staff service is `null`, so the handler is unreachable).
- **Real browser (Edge headless via DevTools protocol, live Vite + API):** 19/19 checks — unauthenticated visit and API (401); authorized result screen shows the panel; loading, success, 503 and offline states; AI-written label; no internal metadata in the tutor card; preference save + reload persistence; another student gets no explanation and cannot read the first student's attempt (403) or see their result. Screenshots were inspected; the temporary harness was deleted and is not part of the repository.
- **Suites:** full real-Postgres suite 25 files / 308 tests; no-Postgres suite 307 files / 7,412 tests passing (24 files skipped without a database); typecheck, lint and build clean; `git diff --check` clean.
- **Live model:** not run (no credential) — see §6.
