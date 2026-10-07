-- Phase 9 Unit 4 (Monetization + entitlements, docs/DECISIONS.md D-100).
-- Additive only: four NEW tables (billing_subscriptions, billing_events, usage_events, ai_usage_records), their constraints and
-- one trigger function + trigger. No existing table or column is altered and no existing row is touched.
-- Entitlement is deliberately NOT stored: it is derived on every read from subscription status, paid_through, the plan catalog and
-- the clock. Nothing in these tables holds card data, a customer detail, a payload, a signature, a prompt or an answer key.
-- Reversal (controlled, manual): DROP TABLE ai_usage_records, usage_events, billing_events, billing_subscriptions;
-- DROP FUNCTION billing_events_append_only().

-- CreateTable
CREATE TABLE "billing_subscriptions" (
    "id" TEXT NOT NULL,
    "student_id" TEXT,
    "plan_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paid_through" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "digest" TEXT NOT NULL,
    "subscription_id" TEXT,
    "outcome" TEXT NOT NULL,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "request_id" TEXT,
    "student_ref" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "outcome" TEXT NOT NULL,
    "failure_category" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_subscriptions_student_id_idx" ON "billing_subscriptions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscriptions_provider_provider_ref_key" ON "billing_subscriptions"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "billing_events_subscription_id_idx" ON "billing_events"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_provider_event_id_key" ON "billing_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "usage_events_student_id_meter_created_at_idx" ON "usage_events"("student_id", "meter", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_student_id_meter_idempotency_key_key" ON "usage_events"("student_id", "meter", "idempotency_key");

-- CreateIndex
CREATE INDEX "ai_usage_records_request_id_idx" ON "ai_usage_records"("request_id");

-- CreateIndex
CREATE INDEX "ai_usage_records_occurred_at_idx" ON "ai_usage_records"("occurred_at");

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written constraints (Prisma cannot express them).
-- One OPEN checkout per (student, plan): a repeated or concurrent checkout request reuses it instead of creating a second.
CREATE UNIQUE INDEX "billing_subscriptions_one_pending_per_student_plan" ON "billing_subscriptions"("student_id", "plan_id") WHERE "status" = 'pending';

ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_status_check" CHECK ("status" IN ('pending', 'active', 'past_due', 'cancelled', 'expired', 'refunded', 'failed'));
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_amount_check" CHECK ("amount_minor" > 0 AND "amount_minor" <= 2000000000);
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_provider_ref_check" CHECK ("provider_ref" IS NULL OR length(btrim("provider_ref")) > 0);
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_plan_provider_nonblank_check" CHECK (length(btrim("plan_id")) > 0 AND length(btrim("provider")) > 0);
-- Paid access always has a paid period: a row can never be 'active' or 'past_due' without a paid_through.
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_paid_period_check" CHECK ("status" NOT IN ('active', 'past_due') OR "paid_through" IS NOT NULL);
-- A checkout that has not been paid yet carries no paid period.
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_pending_unpaid_check" CHECK ("status" <> 'pending' OR "paid_through" IS NULL);

ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_type_check" CHECK ("type" IN ('payment_succeeded', 'payment_failed', 'payment_past_due', 'subscription_cancelled', 'subscription_expired', 'payment_refunded'));
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_outcome_check" CHECK ("outcome" IN ('applied', 'ignored_stale', 'ignored_terminal', 'ignored_invalid_transition', 'rejected_amount_mismatch', 'rejected_reference_mismatch', 'rejected_unknown_plan', 'ignored_unknown_reference'));
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_digest_check" CHECK ("digest" ~ '^[0-9a-f]{64}$');
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_event_id_nonblank_check" CHECK (length(btrim("event_id")) > 0 AND length(btrim("provider")) > 0);

ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_meter_check" CHECK ("meter" IN ('tutor_request', 'simulation_start'));
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_status_check" CHECK ("status" IN ('reserved', 'consumed', 'released'));
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_quantity_check" CHECK ("quantity" > 0 AND "quantity" <= 100);
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_key_nonblank_check" CHECK (length(btrim("idempotency_key")) > 0);
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_settled_check" CHECK (("status" = 'reserved') = ("settled_at" IS NULL));

ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_outcome_check" CHECK ("outcome" IN ('ok', 'error'));
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_counts_check" CHECK (("input_tokens" IS NULL OR "input_tokens" >= 0) AND ("output_tokens" IS NULL OR "output_tokens" >= 0) AND "latency_ms" >= 0);

-- Recorded provider events are an audit trail: never edited, never deleted by the application.
CREATE FUNCTION billing_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing_events is append-only' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_events_no_update_delete BEFORE UPDATE OR DELETE ON "billing_events" FOR EACH ROW EXECUTE FUNCTION billing_events_append_only();
