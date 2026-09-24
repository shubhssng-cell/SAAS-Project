# 73 — Payments

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/MASTER_PLAN.md` "What should explicitly NOT be built yet", `docs/DATABASE.md` "What's intentionally not modeled yet", `CLAUDE.md`. **Status: explicitly out of scope. Not built, not designed, not modeled in the schema.**

## The rule

"Payments, subscriptions, or any pricing logic" is the first item on the MVP exclusion list (see [03_MVP_SCOPE.md](03_MVP_SCOPE.md)). No schema table, no domain package, no UI screen anywhere in this codebase touches payments.

## Why this is a firm boundary, not an oversight

The product philosophy's "no hard-coded exam rules or pricing" rule (see [02_PRODUCT_PHILOSOPHY.md](02_PRODUCT_PHILOSOPHY.md)) implies that **when** pricing is eventually built, it must be data (rows), never code — but building it at all is explicitly deferred past the current vertical-slice phase. Do not design a pricing model, a subscription table, or a payment-provider integration in a future session without an explicit, separate request to do so.

## What this means for `apps/web`

The `apps/web` first slice has no paywall, no account tier, no usage limit of any kind — every student who can reach the app (currently: anyone, since there's no auth either — see [71_AUTHENTICATION.md](71_AUTHENTICATION.md)) gets the identical, unrestricted experience.

## Also explicitly out of scope, immediately adjacent

Multi-tenant/coaching-org accounts, parent portal / any secondary-account model (see [03_MVP_SCOPE.md](03_MVP_SCOPE.md)) — both of these would typically be entangled with a real payments/billing model, and both are equally deferred.
