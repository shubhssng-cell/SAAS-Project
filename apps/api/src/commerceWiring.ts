import { randomUUID } from "node:crypto";
import { parsePlanCatalogJson, type EntitlementMode, type PaymentProvider, type PlanCatalog } from "@ipmat/billing";
import { createCommerceServices, type CommerceServices, type ExamScopeResolver } from "@ipmat/billing-api";
import { InMemoryBillingStore, PrismaAiUsageSink, PrismaBillingStore, PrismaTutorOwnershipPort, PrismaUsageStore, type EnrollmentReader, type ExamReader } from "@ipmat/db";
import type { PrismaClient } from "@prisma/client";
import type { ApiRuntime } from "./hardening.js";

/**
 * Phase 9 Unit 4 (docs/DECISIONS.md D-100) -- the ONE place the commercial layer meets configuration and concrete stores.
 *
 *  - `IPMAT_ENTITLEMENTS`: `open` (no commercial restriction: the behaviour before any plan existed) or `enforced` (access follows
 *    the plan catalog). REQUIRED when NODE_ENV=production -- a production deployment must choose, never inherit a silent default.
 *  - `IPMAT_BILLING_CATALOG`: the plan catalog as JSON (validated strictly; a bad catalog is a startup failure). REQUIRED when
 *    entitlements are enforced -- the baseline (what is free) is a business decision this repository does not make.
 *  - `IPMAT_PAYMENT_PROVIDER`: `none` (default). No payment-provider adapter ships with this build, so any other value is refused
 *    at startup instead of silently ignored; adapters register in `PAYMENT_PROVIDER_ADAPTERS`. There is no fake provider here.
 *  - `IPMAT_CHECKOUT_RETURN_URL`: where the provider returns the browser (https; http only for localhost outside production).
 *
 * Provider credentials and webhook secrets belong to an adapter and are read only there; nothing in this file reads or logs one.
 */
export type PaymentProviderFactory = (env: Record<string, string | undefined>) => PaymentProvider;
/** Concrete adapters (Stripe, Razorpay, ...) are added here when one is chosen. Intentionally empty: none has been selected. */
export const PAYMENT_PROVIDER_ADAPTERS: Readonly<Record<string, PaymentProviderFactory>> = Object.freeze({});

export interface CommerceConfig {
  mode: EntitlementMode;
  catalog: PlanCatalog;
  returnUrl: string | null;
  provider: PaymentProvider | null;
}

export function resolveCommerceConfig(env: Record<string, string | undefined>, adapters: Readonly<Record<string, PaymentProviderFactory>> = PAYMENT_PROVIDER_ADAPTERS): CommerceConfig {
  const production = (env.NODE_ENV ?? "").toLowerCase() === "production";
  const requested = (env.IPMAT_ENTITLEMENTS ?? "").trim().toLowerCase();
  if (requested !== "" && requested !== "open" && requested !== "enforced") throw new Error(`Unknown IPMAT_ENTITLEMENTS value "${requested.slice(0, 20)}" (expected "open" or "enforced").`);
  if (production && requested === "") throw new Error("NODE_ENV=production requires IPMAT_ENTITLEMENTS=open|enforced. Refusing to start without an explicit choice.");
  const mode: EntitlementMode = requested === "enforced" ? "enforced" : "open";

  const rawCatalog = (env.IPMAT_BILLING_CATALOG ?? "").trim();
  if (mode === "enforced" && rawCatalog === "") throw new Error("IPMAT_ENTITLEMENTS=enforced requires IPMAT_BILLING_CATALOG (the plans and the baseline access are business decisions this repository does not make).");
  const catalog = rawCatalog === "" ? parsePlanCatalogJson('{"plans":[]}') : parsePlanCatalogJson(rawCatalog);

  const providerName = (env.IPMAT_PAYMENT_PROVIDER ?? "none").trim().toLowerCase();
  let provider: PaymentProvider | null = null;
  if (providerName !== "none") {
    const factory = Object.prototype.hasOwnProperty.call(adapters, providerName) ? adapters[providerName] : undefined;
    if (!factory) throw new Error(`IPMAT_PAYMENT_PROVIDER="${providerName.slice(0, 30)}" has no adapter in this build. Use "none" (checkout unavailable) until one is added.`);
    provider = factory(env);
  }

  const returnUrl = (env.IPMAT_CHECKOUT_RETURN_URL ?? "").trim();
  if (returnUrl !== "") {
    let url: URL;
    try {
      url = new URL(returnUrl);
    } catch {
      throw new Error("IPMAT_CHECKOUT_RETURN_URL must be an absolute URL.");
    }
    const localDev = !production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localDev) || url.username !== "" || url.password !== "") throw new Error("IPMAT_CHECKOUT_RETURN_URL must be an https URL without credentials (http only for localhost outside production).");
  }
  return { mode, catalog, returnUrl: returnUrl === "" ? null : returnUrl, provider };
}

const NO_FEATURE_RESOLUTION = async (): Promise<string | null> => null;

/** Postgres-backed commerce: durable subscriptions, usage ledger and AI-usage facts. */
export function createPrismaCommerce(prisma: PrismaClient, config: CommerceConfig, runtime?: Pick<ApiRuntime, "logger" | "metrics">, now?: () => Date): { commerce: CommerceServices; aiUsage: PrismaAiUsageSink } {
  const ownership = new PrismaTutorOwnershipPort(prisma);
  const examScope: ExamScopeResolver = async (studentId, enrollmentId) => (await ownership.resolveEnrollment(studentId, enrollmentId))?.examCode ?? null;
  const store = new PrismaBillingStore(prisma);
  return {
    commerce: createCommerceServices({ mode: config.mode, catalog: config.catalog, store, usageStore: new PrismaUsageStore(prisma, now), provider: config.provider, returnUrl: config.returnUrl, examScope, now, newId: randomUUID, metrics: runtime?.metrics, logger: runtime?.logger }),
    aiUsage: new PrismaAiUsageSink(prisma)
  };
}

/**
 * In-memory (development) commerce. The exam of an enrollment is found by matching its exam id against the exam codes the catalog
 * names, so no exam code is hard-coded here.
 */
export function createInMemoryCommerce(config: CommerceConfig, readers: { enrollmentReader: EnrollmentReader; examReader: ExamReader }, runtime?: Pick<ApiRuntime, "logger" | "metrics">, knownStudentIds: ReadonlySet<string> | null = null, now?: () => Date): { commerce: CommerceServices; store: InMemoryBillingStore } {
  const codes = [...new Set([...config.catalog.baseline.exams, ...config.catalog.plans.flatMap((p) => p.exams)])];
  const examScope: ExamScopeResolver = codes.length === 0 ? NO_FEATURE_RESOLUTION : async (studentId, enrollmentId) => {
    const enrollment = await readers.enrollmentReader.findById(enrollmentId);
    if (!enrollment || enrollment.studentId !== studentId) return null;
    for (const code of codes) if ((await readers.examReader.findByCode(code))?.id === enrollment.examId) return code;
    return null;
  };
  const store = new InMemoryBillingStore(knownStudentIds);
  return { commerce: createCommerceServices({ mode: config.mode, catalog: config.catalog, store, usageStore: store, provider: config.provider, returnUrl: config.returnUrl, examScope, now, newId: randomUUID, metrics: runtime?.metrics, logger: runtime?.logger }), store };
}
