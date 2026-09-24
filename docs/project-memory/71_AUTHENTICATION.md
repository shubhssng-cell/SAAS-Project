# 71 — Authentication

> Part of the [project memory](00_MASTER_CONTEXT.md). Source: `docs/DECISIONS.md` D-004 (read in full). **Status: open decision, not built.**

## The decision, verbatim status

**D-004 — Auth provider: open, not yet decided.** Status: **Open.**

**Context:** the likely real-world sign-up path for Indian students skews toward phone/OTP rather than email/password. A managed provider (e.g. Clerk) is faster to ship but may not have great phone-OTP support for Indian numbers out of the box; a self-hosted solution (Auth.js/NextAuth with a custom OTP provider) is more flexible but more work.

**Decision:** Deferred. Development proceeds with a single seeded internal test user and no real auth flow. **This must be decided before any external student touches the product** — not before.

## Current stand-in

`Student.authRef` is nullable/placeholder on the schema — it exists so `PrepPhaseTemplate`/`CatchUpPlan` calculations have a real `Student`/`Enrollment` row to compute against, not because auth is implemented. No login flow, no session mechanism, no password/OTP handling exists anywhere in this codebase.

## What this means for `apps/web`

The current first-slice UI has **no authentication at all** — it operates against a single hardcoded fixture student id (`"web-demo-student"`), with in-memory session state, explicitly disclosed as such. This is acceptable for a fixture-backed demo but is a hard blocker before any real external student can use the product (see [03_MVP_SCOPE.md](03_MVP_SCOPE.md), [91_OPEN_BLOCKERS.md](91_OPEN_BLOCKERS.md)).

## What must be decided before this can move forward

1. Managed provider (fast, uncertain Indian-phone-OTP support) vs. self-hosted (flexible, more work).
2. How the resolved identity flows into the future Training Recommendation Composition layer's `studentId`/`enrollmentId` inputs — this composition layer's own design (see [37_TRAINING_RECOMMENDATION.md](37_TRAINING_RECOMMENDATION.md)) assumes these arrive already-authenticated; it does not itself perform authentication.

Do not make this decision unilaterally in a future session without the user's explicit input — it remains genuinely open.
