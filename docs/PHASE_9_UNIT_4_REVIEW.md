# Phase 9 Unit 4 — Monetization + Entitlements

Decision: [D-100](DECISIONS.md). Migration: `0018_monetization_entitlements` (additive). Packages: `@ipmat/billing` (domain, `packages/domain/billing`), `@ipmat/billing-api` (application layer). Live payment provider: **NOT run — none is chosen and no credential exists.** Final prices, plans, free baseline and limits: **NOT decided — the repository ships none.**

## 1. Specification audit (what existed before this unit)

| Question | Finding |
|---|---|
| Commercial concepts (plan, price, subscription, payment, entitlement, usage)? | **None.** No table, type, route, abstraction or UI; the only "plan" words in the repository were `RepairPlan` / `CatchUpPlan`. |
| Does enrollment imply access? | **Yes, by default and only by default:** the single gate was authentication → onboarding → enrollment (`resolvePracticeClaim`). Every enrolled student could use every feature, including the paid model calls (tutor) and simulations. |
| Roles / plans? | None. There is no staff identity (D-098); a "student" is the only actor. |
| Where would payment state belong? | A new authoritative table: payments are facts the repository could neither derive nor already persist (Unit 1's audit rule, D-097). |
| Where would entitlement state belong? | **Nowhere persistent.** It is derivable on every read from subscription status, the paid period, the plan catalog and the clock; storing it would create a second source of truth that can go stale (same discipline as mastery / coverage). |
| Is usage persisted? | No. Unit 3's limiter is per-process, in memory, and counts requests, not billable units. Provider calls were observed (latency, category) but not recorded as usage. |
| Billing provider / SDK installed? | None. |
| Expensive / limitable features | Tutor (a paid model call per request), full simulation start, training session start; hypothesis generation is also a model call. |
| What must stay separate | identity ≠ enrollment ≠ billing ≠ entitlement ≠ usage ≠ staff permission (§3). |

## 2. Commercial architecture

```
Browser (never authoritative)
   │  names a plan id only
   ▼
apps/api  ── session → verified student ── enrollment → exam (server-side)
   │
   ├─ CommerceGuard ──► EntitlementService ──► BillingStore (subscriptions)  + PlanCatalog (configuration)
   │        └────────► UsageService ───────► UsageStore (ledger, atomic reserve)
   │   (then the EXISTING tutor / simulation / training service runs, unchanged)
   │
   ├─ BillingApiService ─► PaymentProvider (interface; no adapter shipped) ─► provider-hosted payment page
   └─ POST /v1/billing/webhook ─► provider adapter verifies signature ─► BillingWebhookService ─► BillingStore.processEvent (atomic, idempotent) ─► applyBillingEvent (pure)
```

* **`@ipmat/billing`** — pure (no Prisma, `@ipmat/db`, HTTP, vendor SDK, environment or clock read; tested): plan catalog + validation, the subscription state machine (`applyBillingEvent`), `EntitlementService`, `UsageService`, the `PaymentProvider` interface, signature/normalization helpers, persistence **ports**.
* **`@ipmat/billing-api`** — `CommerceGuard` (the one place a feature request meets the rules), `BillingApiService` (summary / checkout / cancel), `BillingWebhookService`, `createCommerceServices`. Test doubles live in `@ipmat/billing-api/testing` (an HMAC-signed provider double) and are never imported by production wiring (tested).
* **`@ipmat/db`** — `PrismaBillingStore`, `PrismaUsageStore`, `PrismaAiUsageSink` and in-memory twins; one shared contract suite runs against both.
* **`apps/api`** — `commerceWiring.ts` (the only place configuration meets stores), routes, hooks on the three gated feature routes.
* Commercial logic does **not** reach the engines: `@ipmat/assistant-api`, `practice-api`, `training-*`, `practice-loop`, `auth-api`, `enrollment-api` contain no billing/entitlement/usage word (tested); only `@ipmat/db`, `@ipmat/billing-api` and `apps/api` may depend on the billing packages (tested).

## 3. Identity, enrollment, entitlement, authorization — kept separate

| Concept | Question | Source of truth | Where decided |
|---|---|---|---|
| Authentication | Who is this? | session cookie → `students` | `resolveAuthenticatedStudentId` (unchanged) |
| Enrollment | Which exam did they join? | `enrollments` | `EnrollmentApiService` (unchanged) |
| Entitlement | May this student use feature F for exam E now? | subscriptions + catalog + clock | `EntitlementService` |
| Usage | Have they used up the allowance? | `usage_events` ledger | `UsageService` |
| Authorization (staff) | May this staff member do X? | none exists yet | orchestration authorization (unchanged); generation has no route |

A student can be authenticated but not entitled; entitled but not enrolled (checkout and `/v1/billing` need only a session — an unenrolled student can see and buy a plan, and the summary reports `access: null` for the exam they have not joined). Staff are never blocked **by** student billing (`canGenerateQuestion`), and a student can never be granted question generation (not a plan feature; `FEATURE_IDS` has no such value).

## 4. Source-of-truth rules

* **Payment provider:** authoritative for "money moved" — but only through a **verified** event.
* **Database (`billing_subscriptions`, `billing_events`):** authoritative application billing state.
* **`EntitlementService`:** the only authority on access, derived on every call.
* **Browser:** never. The client names a plan id, nothing else; every other key (amount, price, currency, duration, student, enrollment, exam, entitlement, status, URL, coupon, provider reference…) is refused with 400 before anything is created (tested for 13 keys). Returning from the payment page, a `?checkout=…` query, a cookie, a header (`x-entitlement`, `x-plan-id`…) or `localStorage` grants nothing (HTTP and real-browser tested).
* **No client-side success grants access:** the web shows "waiting for payment confirmation" until the **server** reports `grantsAccess`.

## 5. Plan / catalog model

A plan is **data**: exams, features, usage limits (per feature meter, per UTC day or month, or `unlimited`), `durationDays` of one payment, `active`, an explicit `provisional` flag, and an optional price (minor units + ISO currency + provider price reference). A catalog also carries the **baseline** (what every authenticated student has with no subscription). Code asks "does this student's access include F for exam E"; there is no `if (plan === …)` anywhere (a repository-wide test fails on a plan comparison or named plan).

* **The repository ships no plan, no price and no baseline.** The catalog comes from `IPMAT_BILLING_CATALOG` (JSON), validated strictly (unknown fields refused, a metered feature must declare its limit, plan features restricted to the three student features, price sanity bounds). A bad catalog is a startup failure. `price: null` = not purchasable. Every value in tests is a labelled synthetic fixture ("Test Plus (fixture)").
* Exam and feature must come from the **same source** (the baseline or one subscription): access cannot be assembled by mixing two plans (tested).
* A subscription whose plan has been removed from the catalog grants nothing (fail closed). Catalog edits therefore apply to existing subscriptions — a deliberate consequence of "plans are configuration" (see §20).

## 6. Subscription lifecycle (deterministic, pure)

Statuses: `pending · active · past_due · cancelled · expired · refunded · failed`. They are moved **only** by a verified provider event through `applyBillingEvent`:

| Event → | pending | active | past_due | cancelled | expired / failed | refunded |
|---|---|---|---|---|---|---|
| `payment_succeeded` | → active (+duration) | extend | → active (+duration) | extend only (stays cancelled) | ignored (terminal) | ignored (terminal) |
| `payment_failed` | → failed | → past_due | stays | ignored | ignored | ignored |
| `payment_past_due` | invalid | → past_due | – | invalid | ignored | ignored |
| `subscription_cancelled` | → cancelled | → cancelled | → cancelled | invalid | ignored | ignored |
| `subscription_expired` | → expired | → expired | → expired | → expired | ignored | ignored |
| `payment_refunded` | → refunded | → refunded | → refunded | → refunded | → refunded | ignored |

* A payment must match the amount and currency **snapshotted by the server at checkout**, and the plan must still exist (its duration), or it is recorded as `rejected_amount_mismatch` / `rejected_unknown_plan` and changes nothing. A client reference naming another subscription is `rejected_reference_mismatch`.
* Extension is monotone: `paidThrough = max(paidThrough, eventTime) + durationDays`, so re-ordered renewals never shorten access.
* **Out of order:** a state-changing event older than the last change is `ignored_stale`; a success older than a later status change extends the paid period but does not undo the status; a **refund applies in any order** (revocation is safety-biased) and `refunded` is final, so a success delivered after its own refund cannot restore access.
* Cancellation (`cancelled`) means "will not renew": access continues to the end of the period already paid. `past_due` also keeps access until the paid period ends (the failed attempt was for the *next* period). No grace beyond the paid period exists (§20).

## 7. Entitlement lifecycle

`grantsAccess(subscription, now)` = status ∈ {active, cancelled, past_due} **and** `now < paidThrough` (exclusive end). Everything else — pending, failed, expired, refunded — grants nothing. An elapsed active/cancelled period **reads as expired without waiting for an event** (`effectiveStatus`). One historical payment never grants permanent access; a stale browser cannot keep access alive; a refund or lapse ends it on the next request, with no sweep job and no stored flag to go stale. Entitlements are derived: valid subscription → `Entitlement` (plan, features, limits, `validUntil`); the database CHECKs "paid access always has a paid period".

## 8. Enforcement — exactly what is gated (provisional policy)

Declared as data next to each route; handlers never read billing state.

| Route | Rule |
|---|---|
| every enrollment-claim route (practice, training, tutor, simulation, preferences) | `requireExam` — a **no-op in `open` mode**; in `enforced` mode the student's access must include their enrolled exam. With a baseline that includes the exam this passes without a billing read. |
| `POST /v1/tutor/ask` | feature `tutor` + metered `tutor_request` (reserve **before** the model call) |
| `POST /v1/simulations` | feature `simulation` + metered `simulation_start`. **Only starting is gated:** an in-progress simulation can still be answered and submitted, so a lapse mid-exam never discards work. Re-starting an already-running simulation (`created: false`) releases the unit. |
| `POST /v1/training/sessions` | feature `advanced_training`; continuing/finishing a started session is not re-gated; the hub is readable |
| core practice, enrollment, auth, preferences, `/v1/billing*` | not behind the paywall (billing and auth are never gated; **core practice stays on the baseline** in the supplied tests — whether it should is unresolved, §20) |

Refusals are fixed student-safe `403`s: `not_entitled` (exam or feature) and `usage_limit_reached`.

**Modes (`IPMAT_ENTITLEMENTS`):** `open` = no commercial restriction (today's behaviour before any plan existed; nothing is metered); `enforced` = access follows the catalog. **Production must choose explicitly** (startup refuses otherwise); `enforced` additionally requires `IPMAT_BILLING_CATALOG`. `open` is the development default and says so (`open_access_mode`, `enforcement: "open"` in the summary); it is never silently inherited in production. This is the documented transition for the pre-Unit-4 behaviour "enrollment is enough": nothing changes until a deployment chooses `enforced`.

## 9. Usage metering

* A unit is **reserved before** the work (atomic per student × meter: a Postgres transaction-scoped advisory lock serializes the sum-check and the insert) and then **settled**: `consumed` when the work delivered, `released` when it did not (provider outage, malformed request, thrown error, an already-running simulation). Released units give the allowance back; consumed ones keep counting. A settle failure never fails the response and leaves the unit counted (the conservative side), and is logged.
* Ledger `usage_events`: one row per unit, idempotent per (student, meter, idempotency key = the request's **server-generated** correlation id), scoped to the student, never edited except reserved → consumed/released, deleted with the student. Periods are UTC calendar day/month; the server clock decides and nothing resets usage but time.
* Concurrency: 25–40 simultaneous reservations against limit 5 admit exactly 5 (in-memory, and against real Postgres at the store, guard and HTTP-adjacent levels).
* Limits come from the entitlement service: the most generous among the sources that grant the feature for the exam (`unlimited` > larger number > longer period); no limit defined → denied (fail closed).

## 10. AI usage / cost facts (Part H)

`observeProvider` (Unit 3) now also records, per provider call, **facts only** into `ai_usage_records`: provider, model, token counts exactly as reported (null for a failed call), outcome, coarse failure category, latency, the request correlation id and the one-way student reference. **Never** a prompt, completion, answer key, provider message — and **no cost**: no authoritative model pricing exists, so none is fabricated (tested). It covers the tutor and the hypothesis generator. It is best-effort telemetry (a failure is logged/counted and never changes the model call); authoritative limiting is the reservation above, not this table. Joining AI facts to a metered request is by `request_id`.

## 11. Payment-provider abstraction

`PaymentProvider`: `createCheckout` (must be idempotent per key — a double click cannot create two sessions), `parseWebhook` (verify signature over the **raw** body + replay window; return a normalized event or `ignored`; throw `WebhookRejectedError`), `cancelSubscription` (asks the provider; local state changes only when the provider's event arrives). **Retrieval is deliberately omitted:** no reconciliation job exists, and the webhook is the sole inbound channel (§20). Building blocks provided: `verifyHmacSha256Signature` (constant-time, ±300 s window) and `normalizeBillingEvent` (strict, bounded). **No provider adapter ships** and `PAYMENT_PROVIDER_ADAPTERS` is intentionally empty: any `IPMAT_PAYMENT_PROVIDER` other than `none` is refused at startup rather than ignored. Without a provider, checkout/cancel answer `503 not_available` and the webhook accepts nothing — nothing is faked in production wiring. Card collection is provider-hosted; this application never receives card data.

## 12. Checkout security

`POST /v1/billing/checkout {planId}` only. The server looks the id up in the **purchasable** allowlist (active **and** priced); unknown, inactive, unpriced, malformed, prototype-ish (`__proto__`, `constructor`) and wrong-case ids all get the **same** 400 (no plan enumeration). It then: refuses a plan the student already holds (409); opens **one** pending subscription per (student, plan) (partial unique index — concurrent and repeated requests share it); snapshots the plan's price/currency from the catalog; calls the provider with the subscription id as idempotency key; refuses a session whose reference is malformed or whose URL is not an `https:` URL without credentials (also re-checked in the browser); attaches the reference once (a provider that returns a different session for the same key is refused, not trusted). Provider outage → 503 with fixed wording, retryable, and the same pending row is reused. The return URL is server configuration (`IPMAT_CHECKOUT_RETURN_URL`, https; localhost http only outside production).

## 13. Webhook behaviour

`POST /v1/billing/webhook` — no session; the caller is the provider. Body read as **exact bytes** (no trim), 32 KiB cap, JSON content type, per-address rate bucket. Flow: adapter verifies → normalize → `processEvent` (one transaction: lock the subscription row, unique-insert the event, apply `applyBillingEvent`). Responses are generic: `200 {received:true}` for applied / duplicate / ignored / rejected-by-rule outcomes (so the provider stops retrying; no oracle), a **single identical** `400 invalid_webhook` for every bad-signature / stale / malformed case (15 variants tested to read byte-identically), `503` if no provider is configured, and a retryable `503`/`500` on a store failure (so the provider redelivers; nothing was applied). Stored event data: provider, event id, type, event time, receive time, subscription id, outcome, and the SHA-256 of the raw body — no payload, customer detail, card data or signature.

## 14. Idempotency and concurrency (results)

* Same event delivered 10–12 times concurrently → applied once, one event row, one period (in-memory, HTTP, real Postgres, restart-durable).
* A **different** payload under a used event id → recorded as a conflict (own metric label + needs-attention log), state unchanged.
* Concurrent deliveries for an **unknown** reference (nothing to lock on) → one row, no error (unique-violation fallback, mutation-tested).
* Different events for one subscription → serialized by the row lock; all applied; renewals add up whatever the arrival order.
* Concurrent checkouts → exactly one pending row; concurrent provider-reference attaches → exactly one wins.
* Concurrent usage reservations never exceed the limit; a repeated idempotency key counts once; released units free capacity.
* Repeated refunds/cancels are no-ops; a refund is final.

## 15. API routes

`GET /v1/billing` (student-safe summary: enforcement mode, access for the enrolled exam, the chosen subscription with its **effective** status, usage, purchasable plans, whether checkout is available); `POST /v1/billing/checkout`; `POST /v1/billing/cancel` (takes no input; cancels the student's own furthest-paid active/past-due subscription; nothing else); `POST /v1/billing/webhook`. No admin, grant, revoke, usage-reset, entitlement-edit or event-list route exists for students (28 path × method combinations tested to 404; there is no staff identity to authorize one). Responses never carry provider references, price references, signatures, digests, URLs-in-logs, or raw provider objects (scanned on success and failure paths). Rate buckets added: `billing_write` (10/min per student), `webhook` (300/min per address) — provisional, per-instance like Unit 3's.

## 16. Frontend

`/billing` ("Your plan"): subscription card, what the plan includes, usage, the plans the server offers (price formatted from the server's minor units + currency; "These terms are not final" when `provisional`), checkout and stop-renewing actions. Status copy never says "paid/successful" except from the server's `grantsAccess`; pending reads "Waiting for payment confirmation" and re-reads the **server** every 4 s (≤15 times). The tutor panel shows fixed copy and a link to billing on `not_entitled` / `usage_limit_reached`; the training hub shows fixed copy on refusal; the dashboard links to the plan. The web imports no billing package (architecture test), holds no price/amount/provider name/secret (repository test), keeps no billing state in browser storage (real-browser test), and sends only `{planId}`.

## 17. Privacy / data minimization

No card number, CVV, bank detail, customer name/email/phone/address, payload, signature, prompt, output or answer key in any new table (column scan in the Postgres suite + migration scan). The financial record is **detached** (`student_id → NULL`), not deleted, when a student account is deleted; usage rows are deleted with the student; `billing_events` is append-only (trigger). Retention/legal status of billing records is **unresolved** (§20). Provider credentials/secrets are read only by an adapter (none exists); nothing logs a URL, reference, signature, amount or email (tested on the HTTP and browser paths). The `ai_usage_records.student_ref` is the one-way reference from Unit 3, never the raw id.

## 18. Observability

Allowlisted log fields added (`feature`, `meter`, `planId`, `eventType`, `subscriptionStatus`) and metric labels (`feature`, `meter`) — the redaction rules and the "no field can carry content" test are unchanged. Events: `billing.checkout_created|failed|invalid_session|reference_conflict`, `billing.webhook_processed|rejected|unknown_reference|needs_attention`, `billing.subscription_transition`, `billing.access_denied`, `billing.cancel_requested|failed`, `billing.usage_settle_failed`, `billing.ai_usage_record_failed`; counters `billing_checkout_total`, `billing_webhook_total`, `billing_denied_total`, `billing_usage_total`, `billing_cancel_total`, `ai_usage_record_failures_total`. All carry the Unit 3 request id; money- or state-affecting anomalies (amount mismatch, unknown plan, reference mismatch, event-id conflict) log at `error` as `needs_attention`. Still no metrics HTTP endpoint.

## 19. Failure handling

Provider unavailable → 503 fixed message + `Retry-After`; checkout failure → retryable, state intact; invalid webhook → generic 400; duplicate → 200; unknown product/plan → the uniform 400; database unreachable → 503 with no driver text, and **paid features fail closed** (never a silent grant); any other store error → fixed 500. No raw provider error ever reaches a student.

## 20. Known limitations and unresolved business-policy decisions (not invented)

Limitations: no payment-provider adapter exists, so **no live provider path has run** (the double speaks an invented signed-JSON scheme; a real adapter must be written, its signature scheme verified against the provider's documentation, and exercised in the provider's test mode); no reconciliation/retrieval job — a lost event is repaired only by redelivery or by an operator; a provider checkout session that expires is not detected here (adapter concern); the limiter is per-instance; operator reads (`OperatorBillingReader`) exist as a type but no route/identity does; payment after a terminal state (`expired`/`failed`) is recorded and flagged for a human, not auto-restored.

Unresolved (need the owner): real plans, prices, currency, durations, trials, coupons/tax, refunds policy; **what is free** (the baseline) and whether core practice should be gated; which features are "advanced"; usage limits and periods; grace period after a failed payment; whether cancel means "end now" or "end at period end" (implemented as the latter — a provisional reading); whether a subscription should keep the terms it was bought on when the catalog changes (today the current catalog governs); retention/deletion of billing records and personal-data status; manual grant/revoke (needs staff identity + policy); gating of hypothesis generation; multi-currency/regional pricing; Phase 10 multi-exam bundles.

## 21. Verification record

See the final report (this section is filled from the gate run): focused tests, mutation results (57 mutants: 56 killed, 1 equivalent), real Postgres (clean 0001→0018 chain, zero drift), HTTP, real-browser (25/25), full regression, typecheck, lint, build, secret/leakage scan, cleanup.

**Equivalent mutant (documented):** removing the `examCode === null` early denial in `CommerceGuard.examOf` survives because a `null` exam can never match the baseline or any entitlement, so the downstream check denies identically.
