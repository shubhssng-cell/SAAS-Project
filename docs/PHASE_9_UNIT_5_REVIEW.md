# Phase 9 Unit 5 — Production Launch + Commercial Hardening

Decision: [D-101](DECISIONS.md). Runbook: [DEPLOYMENT.md](DEPLOYMENT.md). No migration (the chain stays `0001`…`0018`). No new package. **Not deployed. No live AI call. No live payment.** No AI or payment credential exists in the environment, so none of those was attempted or faked.

## 1. Production specification audit

| Area | Production-capable | Mock / test-only | Incomplete / unsafe | Business-policy dependent |
|---|---|---|---|---|
| Auth / sessions | Opaque server-side sessions, `HttpOnly; SameSite=Lax; Secure` (production), rate limits, safe errors | — | — | — |
| API hardening (Unit 3) | Body cap, origin allowlist, headers, correlation id, health/readiness, redacting logs | — | Metrics have no export endpoint; limiter is per instance | Calibration of limits |
| Persistence | PostgreSQL, 18 additive migrations | In-memory wiring (dev) | **Found:** in-memory was the default even under `NODE_ENV=production`; no startup check that migrations are applied; hypothesis secret silently random per process; `IPMAT_TRUST_PROXY` had no explicit-choice rule | Backups, retention |
| Tutor | Real pipeline, grounding validation, AI-labelled UI | Scripted model double in tests | **No live-model run** (no key) | Quality bar |
| Billing / entitlements (Unit 4) | Derived entitlement, verified-event state machine, metered usage, webhook | Signed-event provider **double** | **No payment provider adapter**; summary did ~7 subscription reads | Plans, prices, baseline, limits, tax, refunds |
| Simulation | Engine + routes | Test configuration | **No exam configuration** (by design); student saw nothing about it | The exam format |
| Web | Auth/onboarding/enrollment/practice/training/tutor/billing | Fixture adapter for tests | Onboarding did not mention the tutor/training/plan; no simulation status; billing silent when no plans configured; tutor preference dropdowns below touch-target floor | Pricing copy |
| Deployment | — | `docker-compose.yml` is a dev Postgres on 5432 | **Nothing**: no runbook, no start/smoke procedure, no config check | Hosting, domain, TLS |

## 2. Architecture finalized

Unchanged from Units 1–4 (modular monolith; web → `/v1` API → application services → domain → `@ipmat/db`). Added only the production boundary: `productionConfig.ts` (settings), `schemaVersion.ts` (database version), `smoke.ts` (post-deploy checks), the simulation-availability read, and the single-snapshot billing summary. See DEPLOYMENT.md §1 for the deployment shape (same-origin web + API, managed PostgreSQL, TLS at the edge).

## 3. Production configuration

* **`evaluateProductionConfig` / `assertProductionConfig`** (`apps/api/src/productionConfig.ts`): one value-free report; in production every failure refuses startup, elsewhere it is a warning that says "would block a production start". It composes the per-feature resolvers (persistence, AI, commerce, runtime) and adds the cross-cutting rules: **durable storage mandatory** (in-memory refused), `DATABASE_URL` must be a postgres URL (TLS/host warnings), **https-only origins**, **explicit `IPMAT_TRUST_PROXY`**, **explicit `IPMAT_ENTITLEMENTS`**, a **provider needs `IPMAT_CHECKOUT_RETURN_URL`**, **a model needs a ≥ 32-char shared `IPMAT_HYPOTHESIS_SECRET`**, valid log level and port.
* `npm run check:config --workspace @ipmat/api` prints the report and exits 1 if a production start would be refused (connects to nothing). The entry point runs the same check first.
* **`assertSchemaCurrent`** (`@ipmat/db`): the API refuses to serve against a database with no migration history, a half-applied migration, or a schema older than `LATEST_MIGRATION` (a test pins the constant to the newest migration directory); a newer schema is allowed with a warning (migrations are additive).
* Secrets stay server-side (a repository test scans source and the built bundle). `.env.example` holds names and placeholders only. The report never echoes a value (tested with hostile environments, including in child processes).

## 4. Real payment-provider status

**Not integrated.** The repository and environment contain no provider choice, account, adapter, test key or webhook secret, and the unit forbids guessing a provider. The Unit 4 abstraction stays **fail-closed**: checkout/cancel → `503`, the webhook accepts nothing, `IPMAT_PAYMENT_PROVIDER` other than `none` is refused at startup, and `check:config` flags a configured provider without a return URL. DEPLOYMENT.md §6 lists the exact steps to add an adapter and validate it in the provider's test mode. **No live payment was run.** The access sequence is unchanged: provider → verified webhook → billing state → entitlement → feature; a return from checkout proves nothing (browser-verified).

## 5. Real AI-provider status

**Not run.** `IPMAT_AI_PROVIDER=anthropic` is implemented since Unit 2 and now has a production config rule (key, explicit model, shared secret). No key exists here, so tutor quality, latency and refusal behaviour against a real model are **unvalidated**; everything tutor-related was verified against deterministic doubles. The production start test proves the product starts and answers honestly "not available" without a provider.

## 6. Billing UX

Server-truth only (unchanged principle): subscription state in plain language (pending = "waiting for payment confirmation", never success), access table, usage, plans with prices formatted from the server's minor units and a "terms not final" notice for provisional plans, checkout (https-only redirect), stop-renewing, refund/expiry copy, bounded polling. **New:** an explicit state when enforcement is on but **no plans are configured** ("Paid plans haven't been set up yet") instead of an empty page; the tutor refusal links to the plan page. Real browser: pending → active by re-reading the server, cancel request, cancelled-keeps-access, refund revokes — all verified; the page never claims success before the server reports access.

## 7. Onboarding

The first-use journey was walked in a real browser (landing → sign up → onboarding → enrollment → dashboard → practice → result → tutor) at desktop and 390 px. Changes: the onboarding page now also introduces the **AI tutor (stated as AI-written)** and the **plan/usage page**; the dashboard gained a "View plan" card and an honest simulation card. No wizard was added. Enrollment remains single-exam (IPMAT) as built; no exam selection was invented.

## 8. Student UX

Loading, error, empty and unavailable states were reviewed and exercised (practice entry, result, training hub, billing, tutor failure/limit, 401 expiry). No raw technical text appeared in any audited screen (pattern scan on every page). Fixed: tutor preference dropdowns below the touch-target floor (CSS). Left alone deliberately: the visual system, practice/autopsy/repair/training flows (no defect found), loading states without headings (they are live `status` regions).

## 9. Tutor production experience

Browser-verified: hint → shown as "written by AI" with no internal data; provider failure → calm fixed message, no provider text; allowance exhausted → fixed copy + link to the plan page; hint prompt never carries the answer key (HTTP). Unit 2/3 suites continue to cover explanation, mistake explanation, clarification, personalization, validation rejection, authorization and the answer-key policy. **Live-model behaviour is unvalidated** (§5).

## 10. Simulation status

**Safely unavailable — the repository has no authoritative IPMAT simulation configuration, and none was invented.** New: `GET /v1/simulations/availability` (server-decided, uses no allowance, starts nothing) and a dashboard card that says "Not available yet — it needs the exam's official format… Nothing is wrong with your account", or, if a configuration ever exists, "the in-app simulation screens are not part of this release". The engine's start/answer/timer/expiry/finalization/duplicate-submission/ownership behaviour keeps its Phase 7 Unit 4 and Unit 2 test coverage; no student-facing simulation screens exist and none were built.

## 11. Phase 7 intelligence presentation

**Nothing new is presented.** The audit found no Phase 7 output with an approved student-facing wording, and the unit forbids inventing scores, readiness categories or verdicts. The most valuable candidate is **revision information**, but it is already student-facing through the Revision training system (D-081); mastery evidence, curriculum, readiness evidence and revision intelligence remain internal and unexposed (their own decisions D-087…D-091 require a product specification first). Recorded as deferred, not forgotten.

## 12. Migration verification

Clean PostgreSQL 16 on `127.0.0.1:55432`: `prisma migrate deploy` applies `0001`…`0018`; `_prisma_migrations` shows 18 finished, 0 rolled back; `prisma migrate diff` against the schema is empty (zero drift); all CHECK constraints, partial unique index, foreign keys and triggers are exercised by the Unit 1/4 suites; the production start test also proves the API **refuses** a never-migrated database. No schema change was made in this unit.

## 13. Deployment architecture

See DEPLOYMENT.md: same-origin static web + Node API behind TLS, managed PostgreSQL, optional AI provider, payment provider via signed webhook, health/readiness probes, log-stream monitoring, release order and rollback considerations. **No production deployment occurred** and none is claimed; the local production start was proven (§28).

## 14. Backup / recovery readiness

The repository performs no backups. DEPLOYMENT.md §7 lists the EXTERNAL actions (managed backups + PITR, restore drills, pre-migration backup, post-restore provider reconciliation) and what data matters (everything is authoritative or audit; nothing derived is stored). No backup or recovery capability is claimed.

## 15. Performance findings

* **Fixed — billing summary:** it took ~7 subscription reads (one per feature/decision plus the limit lookups); `EntitlementService.describeAccess` now answers the whole summary from **one** snapshot, parity-tested against the individual decisions across scenarios, and the unit asserts one read and one count per metered limit. `UsageService.status` (now dead) was removed.
* **Measured** (production entry point, real PostgreSQL, local, 40 requests each): `/healthz` p50 13 ms; `/v1/auth/me` 15 ms; `/v1/enrollment` 16 ms; `/v1/preferences` 19 ms; `/v1/billing` 31 ms; `/v1/simulations/availability` 29 ms; `/v1/recommendation` 46 ms; `/v1/training/systems` 47 ms (p95 ≤ 58 ms; the 13 ms floor is the local HTTP client). Responses are small (19 B – 2.2 KB). **These are single-user local numbers, not capacity numbers.**
* **Bundle:** one JS chunk 338 kB (93 kB gzip), CSS 12 kB (3 kB gzip), 1,372 modules (the web package still pulls domain packages for the fixture adapter; trimming that is a later optimisation, not a launch blocker).
* **Reviewed, not changed:** each authenticated request does a session lookup plus an enrollment lookup (and one exam lookup per request in `enforced` mode); billing polling is bounded (4 s × 15, only while pending); the tutor is one in-flight per student with a 45 s deadline; AI-usage recording is fire-and-forget. No Redis/queue/CDN was added — nothing measured requires one.
* **Scalability limits (honest):** per-instance rate limits and metrics; one Postgres; the tutor holds a request open up to 45 s; no load test was run.

## 16. Observability

Unit 3's system is sufficient and unchanged in design: request ids, redacting allowlisted logs, in-process metrics, generic health. Diagnosability by log event is documented (DEPLOYMENT.md §5): failed requests (`http.request`/`http.error`), AI failures (`provider.call`, `tutor.*`), billing (`billing.*`, with `needs_attention` for money/state anomalies), authorization (401/403 in `http.request`; `billing.access_denied`), database failures (`failureCategory=dependency_unavailable`, 503), rate limits (`http.rate_limited`), entitlement denials, unexpected exceptions. Added: the value-free startup configuration report and the database-ahead warning. Unchanged limitation: no metrics endpoint/exporter.

## 17. Final security audit

Executed over real HTTP with the real services (`launchJourneys.test.ts`, plus Unit 3/4 suites and the repository boundary tests): anonymous access to **every** protected route (23) → 401 with no leak; session manipulation (flipped/truncated/wrong-shape/injected/URL-encoded-injection tokens, logged-out token, extra cookies carrying "roles"/"plans") → refused or inert; cross-student isolation of billing, usage, preferences, availability; CSRF/origin on billing writes; request-size abuse (413) on billing/tutor/preferences; rate-limit bypass attempts by forged `X-Forwarded-For`/`X-Real-IP` (per-student/per-address keys unaffected); price/plan/currency/identity/entitlement/status tampering and a **client-supplied `returnUrl`** (400); webhook forgery, replay, tampered body, wrong amount; payment-return-URL manipulation and an unsafe external redirect (the web follows only https URLs without credentials; browser-verified that returning grants nothing); no billing state in browser storage; no secret in responses, logs or the bundle; answer key absent from hints; raw errors never leaked. No control was weakened. Prompt-injection and answer-key-extraction tests from Units 2–3 continue to run. **Not covered:** penetration testing of real infrastructure, DoS resistance, a live provider's webhook scheme.

## 18. Privacy / data minimization

Reviewed every Unit 4–5 flow: no card data, no provider secret, no prompt, no private reasoning, no answer key and no unnecessary student data in any new table or log (column scan, log scan, report scan). The value-free configuration report cannot leak a credential. Unresolved choices, documented not decided: retention/deletion of student records, **billing records** (detached, not deleted, on account deletion), usage rows and the append-only audit/event tables; personal-data status of each; legal pages (terms, privacy, refunds) — a dependency for launch, **no legal compliance is claimed**.

## 19. Accessibility

Practical audit run on every production-facing screen in a real browser (desktop and mobile): one `h1` per screen, `lang`, a non-empty title, every visible form control labelled, every button/link named, the skip link is the first Tab stop, Enter submits the login form and an announced `role=alert` error appears, no horizontal overflow, no interactive target under 32 px (inline text links exempt), and a computed text-contrast check (4.5:1 / 3:1 for large text) over every text element in the light scheme — all passing after one fix (tutor preference dropdowns). **Not done:** a screen-reader pass, dark-scheme contrast sweep, automated axe-core run (no dependency added), formal WCAG conformance claim.

## 20. Responsive / mobile QA

A full journey at 390×844 (mobile emulation, touch metrics): login, signup, onboarding, enrollment, dashboard, practice entry, question, result with tutor, billing, training hub — no overflow, no clipped controls, all targets ≥ 32 px (screenshots reviewed). Simulation screens do not exist.

## 21. End-to-end journeys

HTTP (`launchJourneys.test.ts`): **J1** new student account→onboarding→enrollment→recommendation→attempt→tutor; **J2** plan→checkout→pending→verified event→entitlement→protected feature; **J3** usage limit→denied tutor→billing path→plan raises the limit; **J4** expired and refunded entitlement→protected features denied; **J5** malicious client (10 manipulation attempts, forged/unsigned/wrong-amount callbacks)→rejected, unentitled; **J6** provider unavailable→safe 503→no entitlement→recovery. Browser: J1–J4 and J6-style failure behaviour through the real UI (60 checks). **Provider and model are deterministic doubles — separate from live validation, which did not occur.**

## 22. Verification record

Focused Unit 5 tests; mutation (29 mutants: 27 killed, 2 equivalent); real PostgreSQL (clean chain, production-start smoke); HTTP; real browser (60/60, desktop + mobile); full PostgreSQL and no-Postgres suites; typecheck; lint; build; `git diff --check`; secret/leakage scan; production start/smoke; cleanup — figures are in the final report. **Equivalent mutants:** in `describeAccess`, dropping `exam &&` from a feature's `allowed` and dropping `exam ?` from the limit selection both survive because each source already requires the exam (a feature or limit can never be granted for an exam the same source does not grant).

## 23. Known limitations

No deployment; no live AI; no live payment; no payment adapter; no reconciliation job; no metrics endpoint; per-instance limits; no load test; no backups (external); no simulation configuration or screens; Phase 7 intelligence unpresented; single exam; legal pages absent; no screen-reader/axe/dark-contrast audit; the web bundle still carries domain packages for the fixture adapter.

## 24. External infrastructure and business decisions still required

See DEPLOYMENT.md §10: hosting/domain/TLS/proxy/static headers; managed PostgreSQL + backups + restore drills; secrets management; metrics exporter + alerting; AI provider key/model and a live-model validation; payment provider, adapter, sandbox validation, go-live; plans, prices, free baseline, limits, tax, refund and cancellation policy; legal pages and retention/personal-data decisions; the IPMAT simulation configuration; product decisions for Phase 7 presentations; load testing.
