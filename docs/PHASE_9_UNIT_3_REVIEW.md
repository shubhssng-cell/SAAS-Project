# Product Phase 9 Unit 3 — Security, observability and reliability

Decision record: [DECISIONS.md D-099](DECISIONS.md). Code: `packages/observability` (`@ipmat/observability`), `apps/api/src/{hardening,providerObservability,server,assistantWiring,index}.ts`, `packages/assistant-api/src/{tutor,services,errors}.ts`, three small error-mapper changes, one provider-construction change in `@ipmat/ai`. No migration, no table, no new product behaviour.

This is a hardening unit over the Unit 1–2 boundary. It adds controls only where the audit found a real gap, and it states plainly what a single-process, in-memory control cannot guarantee.

## 1. Security specification audit

### 1.1 Controls that already existed (verified, not re-implemented)
| Area | Existing control |
|---|---|
| Identity | Opaque 256-bit session token; only its SHA-256 digest is stored; expiry and revocation checked on every request; identical `not_authenticated` for missing/malformed/expired/revoked (D-004) |
| Login | Unknown email and wrong password are indistinguishable (no account enumeration) |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age`; `Secure` when `NODE_ENV=production` |
| Authorization | Student and enrollment derived server-side (`resolvePracticeClaim`); ownership re-verified by each service; exam is the enrollment's |
| Tutor/orchestration | Closed registry, fixed workflows, strict param whitelist, answer-key policy, grounding validator (Phases 8, Unit 2) |
| Simulation | Server clock, ownership on every operation, 404 for another's resource |
| Provider | `@ipmat/ai` abstraction; fail-closed provider selection; no key in application code |
| Errors | Fixed `{ error: { code, message } }` bodies from every application service |

### 1.2 Gaps found (all verified against the code) and what was done
| Gap | Evidence | Resolution |
|---|---|---|
| Request bodies unbounded | `readJsonBody` accumulated without limit | 32 KiB cap (413 before parsing, also on declared `content-length`); JSON-typed bodies only (415) |
| No rate limiting anywhere | no limiter, no per-student/IP tracking | Server-side limiter + tutor in-flight gate (§4) |
| No request id, no logging, no metrics | only a startup `console.log` | `@ipmat/observability` + correlation (§6) |
| No health/readiness | no such route | `/healthz`, `/readyz` (§7) |
| No security headers | none set | nosniff, no-store, CSP `default-src 'none'`, frame/ referrer/ CORP; HSTS in production |
| No CSRF/origin defence beyond `SameSite=Lax` | no `Origin` check | Origin allowlist for state-changing methods; production refuses to start without one |
| Malformed cookie value | `decodeURIComponent` could throw out of the cookie parser (a 500 for an unauthenticated request) | safe decode; a non-hex or wrong-length token is rejected without a database lookup |
| Provider retries multiplied | `AnthropicProvider` used the SDK defaults (2 silent retries, 10-minute timeout) on top of `generateStructured`'s own retries; tutor worst case ≈ 3 min | SDK `maxRetries: 0`, 60 s transport cap; tutor budget: 20 s per call, 1 explicit retry, grounding retry 1, **45 s overall deadline** |
| Unreachable database = generic 500 | services wrapped every error as 500 | database-unavailable errors map to a retryable **503 + Retry-After** (name/code check only) |
| Unknown paths minted metric labels | (would have, in a naive design) | route labels come from a closed whitelist of templates; anything else is `/unmatched` |

### 1.3 Findings reported, not changed
- **Attempt routes distinguish "not yours" (403 `ownership_mismatch`) from "unknown" (404).** This is the established, tested contract (D-060, `server.test.ts`, the web client). With random UUIDs it cannot be exploited by guessing, but it is an existence oracle for any attempt id that leaks elsewhere. Making it uniform is a product/contract decision, so it is recorded here rather than silently changed. Simulation routes are already uniform (404).
- **No staff identity exists**, so staff authorization cannot depend on anything: there is no staff route to harden (Unit 2). The staff service accepts only a trusted claim and re-authorizes in the orchestrator; no browser-supplied claim can reach it (tested: no route, no header/cookie/body field has effect).

### 1.4 Trust boundaries, sensitive flows, attack surfaces
- **Browser → API:** untrusted. Only the session cookie is credential-bearing; body/query/headers are data.
- **API → services:** the verified `{studentId, enrollmentId}` claim; services re-verify.
- **Services → model provider:** the only outbound call; carries the context the policy authorizes, never keys (the SDK reads its own key; application code never does).
- **Secrets:** `ANTHROPIC_API_KEY`, `DATABASE_URL`, `IPMAT_HYPOTHESIS_SECRET` live in the server environment; the frontend's only environment read is the public API base URL.
- **Student data:** attempts, answers, preferences, simulation answers, audit rows — each keyed by the authenticated student in the query.
- **AI-specific:** prompt/context injection (student text, question content), key exfiltration, system-prompt extraction, provider-output leakage, runaway/duplicated spend, provider failure.
- **Database-specific:** concurrent writes, duplicate submissions, unreachable/overloaded database, connection exhaustion.
- **Operational failure points:** provider timeout/429/5xx, database down, process memory growth from caller-influenced keys.

## 2. Authentication
Unchanged architecture. Verified and hardened: malformed/oversized/NUL/injection-shaped cookies are a clean `401` (never 500) and never reach the database; an expired session is indistinguishable from an unknown one; logout revokes server-side and the old cookie stops working at once; the cookie attributes are asserted (including `Secure` in production); identity cannot be supplied through headers (`x-student-id`, `x-role`, `authorization`…), cookies, query or body; login failures are identical for existing and non-existing accounts and are throttled per account.

## 3. Authorization, IDOR, input
- **HTTP-level tests** cover: every attempt route against another student's id; training sessions; simulations (all four operations: another student's = missing, byte for byte, and the owner's data is untouched); deleted resources (404 for the owner); the same student under a different enrollment (service level against Postgres: the enrollment is part of the key); malformed ids (traversal, NUL, lone `%`, SQL fragment, 5,000 chars, unicode/RTL, encoded slash) on four resource families → 4xx, never 500, never echoed.
- **Input:** strict allowlists on every new route; 21 internal-semantics names (provider, model, task, workflow(Id), capability(Id), actor, role, studentId, enrollmentId, examCode, presentation, simulationId, now, fallback, retries, timeoutMs, budget, systemPrompt, temperature…) are refused by name on the tutor and simulation routes; array/string/null/number bodies, prototype-pollution keys, 200-deep nesting and oversized fields are refused without side effects.

## 4. Rate limiting (server-controlled, bounded, honest)
| Bucket | Key (server-derived) | Limit (PROVISIONAL) |
|---|---|---|
| `ip` | peer address | 600 / min (all requests except health) |
| `auth` | peer address | 20 / min on signup and login |
| `auth_account` | normalized login email | 10 / 15 min (credential stuffing; behaves identically for non-existent accounts) |
| `api` | authenticated student | 300 / min |
| `tutor` | authenticated student | 12 / min, **and at most 1 request in flight** |
| `simulation_write` | authenticated student | 150 / min |
| `preferences_write` | authenticated student | 20 / min |

Responses are `429` with a fixed body and `Retry-After`; a rejected tutor request never reaches the model. The client address is the socket's; `X-Forwarded-For` counts **only** with `IPMAT_TRUST_PROXY=true`, and then only its last hop. Nothing the client reports is an input.
**Limitation (stated, not hidden):** the limiter is in-process and fixed-window. With *N* instances the effective global limit is *N ×* the configured one, and a restart clears counts. A deployment that needs a global limit needs a shared store or a gateway in front. Memory is bounded (oldest-window eviction; it never fails open). The numbers are not calibrated against real traffic.

## 5. AI budgets, timeouts, retries, provider failure
- Explicit, bounded budget per tutor request: per provider call 20 s timeout, 1 retry (`generateStructured`, visible in one place), 1 grounding retry, **45 s deadline** for the whole request (the HTTP response returns a safe "temporarily unavailable"; the in-flight provider call is itself bounded by the above). The SDK no longer retries silently. No loops, no agent behaviour, no model-chosen retry.
- **Failure mapping:** provider unavailable (503, no provider configured), timeout, 429, 5xx, malformed output, grounding failure, deadline → one safe `not_answered` result with fixed wording; the provider's message, status, prompt and keys never reach the response or the logs. Categories (`rate_limited`, `timeout`, `server_error`, `client_error`, `unknown`) are counted in metrics. No fallback capability exists; none runs.
- **Output guard (new, deterministic backstop):** a reply that reproduces 48+ characters of the tutor's system prompt is rejected before projection. It catches verbatim extraction only, not a paraphrase.

## 6. Observability and correlation
- **`@ipmat/observability`** (zero dependencies, no network, no environment): request context (`AsyncLocalStorage`), a **redacting, allowlisted** logger, bounded-cardinality counters and fixed-bucket latency histograms, the rate limiter and a concurrency gate.
- **Logger rules:** only 23 allowlisted fields exist (none can carry content); any other field is dropped and counted; objects are dropped; strings are truncated, control-character-stripped and scanned for credential shapes (API keys, bearer tokens, database URLs, session cookies, `password=`). Errors are logged as **name and code only, never the message**. The student appears as a one-way 12-character reference. Routes are templates, never concrete ids.
- **Not logged, by construction and by test:** passwords, tokens, cookies, student free text, prompts, model output, answer keys, raw student ids, emails.
- **Correlation:** the request id is generated by the server (an inbound `x-request-id` is ignored — it would allow forged correlation, chosen audit keys and log injection), is returned in the `x-request-id` response header, appears in the access log, the tutor log, the provider log and **is the orchestration audit's `request_id`** (one request, one id, across HTTP → service → orchestration → provider → audit). It is not part of any response body.
- **Metrics:** `http_requests_total{route,status}`, `http_request_latency_ms`, `tutor_requests_total{outcome}`, `tutor_latency_ms`, `provider_latency_ms{provider,outcome}`, `provider_errors_total{provider,category}`, `rate_limited_total{bucket}`, `http_errors_total{category}`. Held in process memory; **no endpoint serves them** (tested: `/metrics` and friends are 404). Exporting them needs an operator-authenticated channel, which does not exist yet.

## 7. Health and readiness
`GET /healthz` → `{"status":"ok"}` (process is up; independent of the database). `GET /readyz` → `200 {"status":"ready"}` or `503 {"status":"not_ready"}` from an injected probe (production: `SELECT 1`, 2 s cap). No dependency names, errors, versions or timings are ever exposed; a throwing or hung probe reports `not_ready`. Both bypass the rate limiter.

## 8. Error boundary
Every failure leaves as a fixed `{ error: { code, message } }`. Added: 413, 415, 403 (origin), 429, 503 (database unavailable; `Retry-After: 5`). Internal diagnostics keep error **name and code** only. Tested against injected SQL/path/secret-bearing errors, a throwing store, an unreachable Postgres (real), and a down provider.

## 9. Database reliability (real Postgres)
Concurrency tests over HTTP: 3 concurrent preference writes to different fields (all persist, one row); 8 concurrent simulation starts (exactly one created, all name the same one); 10 concurrent answers (all recorded, strict gap-free sequence); 8 concurrent submits (exactly one `submitted`, 7 idempotent `already_submitted`, one finalization, later answers rejected); 6 concurrent attempt starts (one open attempt); an attempt submit replay (rejected, first stands); 6 concurrent tutor requests (one reaches the model, five 429, one audit row whose id equals the response header). Unreachable database: fixed 503 + `Retry-After`, `readyz` not_ready, `healthz` still ok, no host/port/driver text. Connection and pool timeouts remain a `DATABASE_URL` concern (`connect_timeout`, `pool_timeout`); no schema change was made.

## 10. Secrets and configuration audit
Verified by tests that read the repository: only `apps/api/src/{index,server,wiring}.ts` read `process.env` (the frontend reads only `VITE_API_BASE_URL`); the vendor SDK is imported only in `packages/ai/src/providers/anthropicProvider.ts`; no provider key name appears outside `@ipmat/ai` and `apps/api`; no credential-shaped literal in any source or test (the one synthetic key in a test is assembled at run time); no real `.env` is tracked (`.env` is git-ignored; `.env.example` lists the new variables, all server-side); the built frontend bundle contains no server secret name or connection string. Test credentials are synthetic.

## 11. Browser security / UX (real Edge headless, live Vite + API with the real hardening runtime)
15/15 checks: unauthenticated visit (no tutor, no data) and API calls (401); request id and security headers present; signed-in tutor success with the AI-written label; provider failure -> a calm fixed message and no provider text; rate limit (quota exhausted by real clicks) -> fixed friendly copy, no server wording; an injected generic 500 carrying hostile SQL/path/secret text -> fixed copy, none of the text shown; revoked session -> "Your session has ended. Please log in again" and every old-session read is 401; another student gets 4xx and none of the first student's data, and their result page shows an error; the server's logs for the whole browser session contain no password, answer, cookie or secret text. Screenshots were produced and the temporary harness (API + control server + driver) was deleted.

## 12. Verification record
- **Tests added:** `observability.test.ts` (25), `securityHardening.test.ts` (67, real HTTP), `securityBoundaries.test.ts` (12, repository-wide), `hardeningPostgres.integration.test.ts` (12, real Postgres), `anthropicTransport.test.ts` (1), plus additions to the assistant-api and web suites.
- **Mutation checks:** 33 source mutants (body caps, content-length/type checks, origin allowlist, proxy-header trust and hop choice, route-template whitelist, limiter window/limit/eviction, gate cap and release, logger allowlist/redaction/control characters, metrics bounds and label allowlist, request-id trust, each server limit/gate/header/origin/readiness/session-shape control, tutor deadline and output guard, database-outage mappers, provider-429 classification, SDK retry setting). 29 killed on the first run; 4 survivors were real test gaps (a chunked upload masked by the content-length check, control characters hidden by JSON escaping, `toMatchObject` tolerating an extra metric label, the general per-student bucket untested) and are now killed by new tests. No equivalent mutants remain.
- **Suites:** full real-Postgres suite 26 files / 320 tests; no-Postgres suite 311 files / 7,523 tests (25 files skipped without a database); typecheck, lint and build clean; `git diff --check` clean.
- **Live model:** not run (no credential).

## 13. Unresolved / limitations (not invented)
Global (multi-instance) rate limiting and a metrics export channel need infrastructure that does not exist; the limits are provisional; the 403-vs-404 attempt contract (§1.3); no staff identity (no generation route); log shipping, retention and access policy for logs and audits (D-097 unresolved); no WAF/TLS termination assumptions beyond `Secure`/HSTS in production; the system-prompt guard is verbatim-only; no live-model run (no credential), so provider-failure handling is tested against failure doubles, not a real provider's 429/5xx behaviour.

## 14. Not claimed
That the API is DoS-proof, that in-process limits are global, that logs are tamper-proof, that prompt-injection is solved (it is bounded by policy and deterministic validation, not eliminated), or that anything was validated against a live model.
