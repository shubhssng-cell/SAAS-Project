# Deployment and operations runbook

Status: written in Phase 9 Unit 5 (D-101). **Nothing here has been deployed.** No cloud provider, domain, credential or hosting account exists in this repository or its environment, so this runbook was verified only by running the production entry point locally against a real PostgreSQL (see "Verified locally" below). Steps marked **EXTERNAL** must be performed by the owner outside the repository.

## 1. Architecture

```
Browser ──HTTPS──► reverse proxy / platform edge  (TLS, HSTS, CSP for the static site, X-Forwarded-For)
                     ├─ /            ──► static files: apps/web/dist       (any static host or CDN)
                     └─ /v1/*, /healthz, /readyz ──► apps/api  (Node, one or more instances)
                                                       ├─► PostgreSQL 16 (managed; the only stateful dependency)
                                                       ├─► AI provider (Anthropic) — optional; tutor "not available" without it
                                                       └─► payment provider — NOT CONFIGURED (no adapter exists yet)
                     payment provider ──signed webhook──► POST /v1/billing/webhook
```

* **Serve the web app and the API from the SAME origin** (the web build calls relative `/v1/...` URLs; the session cookie is `HttpOnly; SameSite=Lax; Secure`). A separate API origin needs `VITE_API_BASE_URL`, CORS/cookie work this release does not do — do not do it casually.
* **No cloud provider is assumed.** Anything that can run a Node process, serve static files, terminate TLS and reach a managed PostgreSQL works.
* One API instance is the tested shape. More than one works but note the per-instance limits (rate limits, concurrency gate, metrics) and that every instance must share `IPMAT_HYPOTHESIS_SECRET`.

## 2. Build and run

```bash
npm ci
npm run db:generate                      # Prisma client
npm run build --workspace @ipmat/web     # -> apps/web/dist  (JS ~338 kB, ~93 kB gzip; CSS ~12 kB)
npm run start --workspace @ipmat/api     # tsx src/index.ts  (the workspace packages ship TypeScript sources, so the API runs through tsx)
```

`npm run build` (all workspaces) type-checks and emits `dist/` per package, but the API is started from source; there is no separately bundled server artifact. The build has **no secrets**: the only environment value the web build reads is the optional public `VITE_API_BASE_URL` (a repository test scans the bundle).

## 3. Environment variables (server only; none is ever sent to the browser)

Run **`npm run check:config --workspace @ipmat/api`** with the deployment's environment. It prints one line per setting (names and fixed text, never values) and exits 1 if a production start would be refused. The API runs the same check at startup and refuses to start in production on any failure.

| Variable | Production | Meaning |
|---|---|---|
| `NODE_ENV=production` | required | Secure cookies, HSTS, dev scaffolds refused, strict checks |
| `IPMAT_PERSISTENCE=prisma` + `DATABASE_URL` | required | The in-memory wiring is refused in production. Use `?sslmode=require` (or stronger) unless the platform provides transport encryption; consider `&connection_limit=` for pool sizing |
| `IPMAT_ALLOWED_ORIGINS` | required | Comma-separated bare **https** origins allowed to make state-changing requests (no path, no wildcard) |
| `IPMAT_TRUST_PROXY=true\|false` | required, explicit | `true` only behind a proxy that **overwrites** `X-Forwarded-For` (the last hop is the client). `false` behind a proxy makes all clients share one rate-limit bucket; `true` without a proxy lets clients forge their address |
| `IPMAT_ENTITLEMENTS=open\|enforced` | required, explicit | `open` = no paywall, nothing metered. `enforced` = access follows the catalog and **requires** `IPMAT_BILLING_CATALOG` |
| `IPMAT_BILLING_CATALOG` | when enforced | Plan catalog JSON (section 6). The repository ships no plans, prices or free baseline |
| `IPMAT_PAYMENT_PROVIDER` | `none` today | Any other value is refused at startup (no adapter exists) |
| `IPMAT_CHECKOUT_RETURN_URL` | with a provider | https URL the provider returns the browser to. Returning proves nothing |
| `IPMAT_AI_PROVIDER` | optional | `none` (tutor/hypothesis answer "not available") or `anthropic`. `dev-scripted` is refused in production |
| `ANTHROPIC_API_KEY`, `IPMAT_AI_MODEL` | with `anthropic` | Key (secret) and an explicit model id (no default) |
| `IPMAT_HYPOTHESIS_SECRET` | with a model | ≥ 32 characters, identical on every instance (seals autopsy-confirmation tokens) |
| `IPMAT_LOG_LEVEL` | optional | `info` (default). `debug` is verbose |
| `PORT` | optional | default 4001 |

Secrets belong in the platform's secret store, never in a file in the repository. `.env.example` holds names and placeholders only.

## 4. Database and migrations

* PostgreSQL 16 (tested). Managed service strongly recommended. The migration chain is `0001`…`0018` (`packages/db/prisma/migrations`), additive-only.
* **Apply:** `cd packages/db && npx prisma migrate deploy` with `DATABASE_URL` set (idempotent; applies only what is missing). On an empty database this builds the full schema; then `npx tsx prisma/seed.ts` loads the seeded exam/content set (idempotent) — review what the seed contains before running it against production.
* **The API refuses to start** if the database has no migration history, a half-applied migration, or a schema **older** than the build (`LATEST_MIGRATION`, kept equal to the newest migration directory by a test). A schema **newer** than the build is allowed with a warning (migrations are additive, so an older build keeps working).
* **Release order:** (1) back up (section 7) → (2) `migrate deploy` → (3) start the new API → (4) switch traffic → (5) publish the web build. Because migrations are additive, the previous API build keeps working against the new schema, which makes step (3)/(4) reversible.
* **A migration fails halfway:** the API will not start (by design). Inspect `_prisma_migrations`; fix the cause; resolve with `prisma migrate resolve --applied|--rolled-back <name>` as appropriate, or restore from backup. Do not edit applied migration files.
* **Rollback considerations:** there are **no down migrations**. Application rollback = redeploy the previous build (safe for additive migrations). Data rollback = restore from backup/point-in-time recovery (EXTERNAL). Manual reversal SQL for the two newest migrations is written in their file headers (`0017`, `0018`) and is destructive: use only deliberately.
* Two tables are append-only by trigger (`orchestration_audits`, `billing_events`). `usage_events` rows are deleted with their student; `billing_subscriptions` are **detached**, not deleted, when a student is deleted. Retention policy for these is an owner decision (section 10).

## 5. Health, readiness, logs, monitoring

* `GET /healthz` → `{"status":"ok"}` (liveness; no dependency). `GET /readyz` → `200 {"status":"ready"}` or `503 {"status":"not_ready"}` (database `SELECT 1` with a 2 s bound; generic, no detail). Point the platform's liveness/readiness probes at them.
* **Logs:** one JSON object per line on stdout (`ts, level, event, requestId, route, status, actorKind, studentRef, latencyMs, …`). Only allowlisted fields can be logged: no prompt, model output, answer key, password, token, cookie, student text, email, raw student id, amount, provider reference, signature or error message. Every response carries `x-request-id`; the same id appears in the log lines and the orchestration audit — quote it when investigating.
* **Metrics** are in-process counters/histograms (`http_requests_total`, `http_request_latency_ms`, `rate_limited_total`, `tutor_requests_total`, `provider_latency_ms`, `billing_*`, …). There is **no metrics endpoint** and no exporter: scrape-based monitoring needs a small authenticated exporter that does not exist yet. Until then, derive rates and alerts from the log stream (status ≥ 500, `event` = `billing.webhook_needs_attention`, `http.error`, `billing.usage_settle_failed`, `billing.ai_usage_record_failed`, `tutor.deadline_exceeded`, `http.rate_limited`).
* **Alerts worth setting (log-based):** any `billing.webhook_needs_attention` (money or state needs a human); sustained 5xx; `readyz` failing; `provider.call` errors for the AI provider; a burst of `http.rate_limited` with `bucket=webhook` (the provider could be throttled and events delayed).

## 6. Billing configuration

* **Plans are configuration.** Example **fixture** (not a proposal; values are made up):

```json
{"baseline":{"exams":["IPMAT_INDORE"],"features":["tutor"],"usageLimits":[{"meter":"tutor_request","limit":10,"period":"day"}]},
 "plans":[{"id":"example_plan","name":"Example plan","description":"Illustration only.","active":true,"provisional":true,
           "exams":["IPMAT_INDORE"],"features":["tutor","simulation","advanced_training"],
           "usageLimits":[{"meter":"tutor_request","limit":50,"period":"day"},{"meter":"simulation_start","limit":4,"period":"month"}],
           "durationDays":30,"price":{"amountMinor":0,"currency":"INR","providerPriceRef":null}}]}
```

(`amountMinor: 0` is rejected by validation — a plan needs a positive price to be purchasable, or `"price": null` to be listed as not purchasable. The owner supplies real values.)
* **No payment provider adapter exists.** Checkout, cancellation and the webhook answer `503 not_available` until one does. **To add one:** implement `PaymentProvider` (`packages/domain/billing/src/provider.ts`) in `apps/api`, register it in `PAYMENT_PROVIDER_ADAPTERS` (`commerceWiring.ts`), read its credentials/webhook secret **inside the adapter only**, verify the provider's signature over the raw body (`verifyHmacSha256Signature` is a building block for HMAC schemes), map its events to the six `BillingEventType`s via `normalizeBillingEvent`, honour idempotent checkout creation, set `IPMAT_PAYMENT_PROVIDER` and `IPMAT_CHECKOUT_RETURN_URL`, register `https://<your origin>/v1/billing/webhook` in the provider's dashboard, run the provider's **test mode** end to end (checkout → webhook → entitlement → refund), and only then go live. Until a live run has happened, treat payment as unvalidated.
* The access sequence never changes: provider → verified webhook → `billing_subscriptions` → derived entitlement → feature. Returning from checkout, a URL, a header, a cookie or browser storage never grants access.

## 7. Backup and recovery (what the repository does and does not do)

The repository performs **no backups**. EXTERNAL actions the owner must take:
1. Enable automated backups and **point-in-time recovery** on the managed PostgreSQL; decide RPO/RTO; keep backups encrypted and access-controlled.
2. **Test a restore** into a scratch database and run `prisma migrate deploy` + `check:config` + the smoke test against it.
3. Back up before every migration (section 4).
4. Everything in the database is authoritative or an audit trail; nothing derived is stored, so a restore needs no rebuild step. `billing_events` and `orchestration_audits` are append-only evidence — include them in any retention decision.
5. Provider-side state (payments) lives with the payment provider; a restored database may be behind it: after any restore, reconcile recent provider events (redelivery is idempotent, so replaying them is safe — there is no reconciliation job yet).

## 8. Production smoke test

After deploying (and again after every release): `npm run smoke --workspace @ipmat/api -- https://<your origin>` — read-only checks that need no credentials: liveness, readiness, security headers (HSTS on https, `nosniff`, `no-store`, request id), anonymous requests to protected routes → 401, an unsigned webhook → rejected, a disallowed `Origin` → 403, an unknown route → a generic 404 with no stack or driver text. Exits non-zero on any failure. It creates no data. Then, manually: sign up a throwaway account, enroll, answer a question, open the billing page; if an AI provider is configured, ask the tutor for a hint (a **live-model** check that has not been run in this repository).

## 9. Troubleshooting

| Symptom | Likely cause / action |
|---|---|
| API exits immediately with `Refusing to start: …` | A production setting is missing/unsafe: read the named settings; run `check:config` |
| API exits with "schema is behind this build" / "no migration history" | Run `prisma migrate deploy` against the same `DATABASE_URL` |
| `/readyz` 503, `/healthz` 200 | Database unreachable/slow (2 s bound): check DB, network, pool |
| Every user gets 429 quickly | `IPMAT_TRUST_PROXY=false` behind a proxy (all clients share one address) — set `true` if (and only if) the proxy overwrites `X-Forwarded-For` |
| Login/signup returns 403 from the browser | The page origin is not in `IPMAT_ALLOWED_ORIGINS` (exact scheme+host+port) |
| Session cookie not kept | Site served over http (cookie is `Secure`) or API on a different site |
| Tutor says it isn't available | No AI provider configured (`IPMAT_AI_PROVIDER`), or the provider is failing (`provider.call` log events) |
| Billing page says plans haven't been set up | `IPMAT_BILLING_CATALOG` has no plans — a business configuration, not a fault |
| Checkout says payments are unavailable | No payment provider adapter/config |
| Simulation says "Not available yet" | No exam simulation configuration exists (the repository does not invent exam rules) |
| `billing.webhook_needs_attention` in logs | An amount/currency mismatch, unknown plan, reference mismatch or event-id conflict — a human must reconcile with the provider |

## 10. Decisions and steps outside the repository (EXTERNAL / owner)

Hosting and domain; TLS certificates; reverse proxy and static host; security headers for the static site (suggested CSP: `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'`, plus HSTS); managed PostgreSQL, backups, PITR, restore drills; secret management; a metrics exporter and alerting; the AI provider account/key/model and a **live-model validation**; the payment provider choice, account, adapter, sandbox validation and go-live; real plans, prices, free baseline, limits, tax, refund and cancellation policy; legal pages (terms, privacy, refund) and personal-data/retention decisions for student records, billing records and audit rows; the IPMAT simulation configuration; load testing against the chosen infrastructure; the web app is currently `noindex` (a deliberate private-launch default in `index.html`).

## Verified locally (what was and was not proven)

Proven in Unit 5: the real entry point (`src/index.ts`) started with `NODE_ENV=production` against a freshly migrated PostgreSQL 16; liveness/readiness; HSTS and the other headers; the origin allowlist; a `Secure; HttpOnly; SameSite=Lax` session cookie; a first-student journey; honest unavailable states for the tutor, simulation, checkout and webhook; refusal to start on unsafe configuration and on an unmigrated database. **Not proven:** any real deployment, TLS termination, a reverse proxy, a managed database, backups/restores, load, a live AI call, a live payment.
